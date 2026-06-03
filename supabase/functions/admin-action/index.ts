// supabase/functions/admin-action/index.ts
// Privileged admin operations: suspend/unsuspend user, delete roulette message.
// All actions are audit-logged to admin_actions before execution.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_EMAILS = ["mymanko@gmail.com", "yoashf@gmail.com"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // --- 1. Authenticate caller ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return err(401, "Unauthorized");
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !user) return err(401, "Unauthorized");
    if (!ADMIN_EMAILS.includes(user.email ?? "")) return err(403, "Forbidden");

    // --- 2. Parse payload ---
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return err(400, "Invalid JSON"); }

    const action         = typeof body.action          === "string" ? body.action          : null;
    const targetUserId   = typeof body.target_user_id  === "string" ? body.target_user_id  : null;
    const targetMsgId    = typeof body.target_message_id === "string" ? body.target_message_id : null;
    const reason         = typeof body.reason          === "string" ? body.reason.trim()   : null;

    if (!action) return err(400, "Missing field: action");
    if (!["suspend", "unsuspend", "delete_roulette_message"].includes(action)) {
      return err(400, `Unknown action: ${action}`);
    }

    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // --- 3. Write audit log first ---
    const { error: auditErr } = await serviceClient.from("admin_actions").insert({
      admin_id:          user.id,
      admin_email:       user.email,
      action,
      target_user_id:    targetUserId   ?? null,
      target_message_id: targetMsgId    ?? null,
      reason:            reason         ?? null,
    });
    if (auditErr) {
      console.error("Audit log failed:", auditErr);
      return err(500, "Failed to write audit log");
    }

    // --- 4. Execute action ---

    if (action === "suspend") {
      if (!targetUserId) return err(400, "Missing target_user_id");

      // Ban via Supabase auth (prevents login)
      const { error: banErr } = await serviceClient.auth.admin.updateUserById(targetUserId, {
        ban_duration: "87600h", // 10 years = effectively permanent until unsuspended
      });
      if (banErr) { console.error("Ban error:", banErr); return err(500, "Failed to ban user"); }

      // Record on profile for the login-check explanation
      const { error: profileErr } = await serviceClient.from("profiles")
        .update({ suspended_at: new Date().toISOString(), suspended_reason: reason ?? null })
        .eq("id", targetUserId);
      if (profileErr) console.error("Profile suspend update failed:", profileErr);

      return ok({ action: "suspend", target_user_id: targetUserId });
    }

    if (action === "unsuspend") {
      if (!targetUserId) return err(400, "Missing target_user_id");

      const { error: unbanErr } = await serviceClient.auth.admin.updateUserById(targetUserId, {
        ban_duration: "none",
      });
      if (unbanErr) { console.error("Unban error:", unbanErr); return err(500, "Failed to unban user"); }

      const { error: profileErr } = await serviceClient.from("profiles")
        .update({ suspended_at: null, suspended_reason: null })
        .eq("id", targetUserId);
      if (profileErr) console.error("Profile unsuspend update failed:", profileErr);

      return ok({ action: "unsuspend", target_user_id: targetUserId });
    }

    if (action === "delete_roulette_message") {
      if (!targetMsgId) return err(400, "Missing target_message_id");

      const { error: delErr } = await serviceClient.from("moon_roulette_messages")
        .update({
          admin_deleted_at: new Date().toISOString(),
          admin_deleted_by: user.id,
        })
        .eq("id", targetMsgId);
      if (delErr) { console.error("Delete error:", delErr); return err(500, "Failed to delete message"); }

      return ok({ action: "delete_roulette_message", target_message_id: targetMsgId });
    }

    return err(400, "Unhandled action");

  } catch (e) {
    console.error("Unhandled error:", e);
    return err(500, "Internal server error");
  }
});

function ok(data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
