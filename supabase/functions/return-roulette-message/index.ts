// supabase/functions/return-roulette-message/index.ts
// Called when a recipient declines or blocks a Moon Roulette message.
// Decline: marks message as 'declined', soft-deletes from recipient view, notifies sender.
// Block:   same as decline + inserts into blocked_users so the pair is never matched again.
// Sender sees identical "Returned" state for both actions — they cannot tell the difference.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ReturnAction = "decline" | "block";

function isValidAction(action: unknown): action is ReturnAction {
  return action === "decline" || action === "block";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // --- 1. Validate JWT ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 2. Parse and validate payload ---
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.message_id || typeof body.message_id !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing field: message_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isValidAction(body.action)) {
      return new Response(
        JSON.stringify({ error: "Missing field: action (must be 'decline' or 'block')" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // --- 3. Fetch the message and verify the requester is the recipient ---
    const { data: message, error: fetchErr } = await serviceClient
      .from("moon_roulette_messages")
      .select("id, sender_id, recipient_id, status, message_text")
      .eq("id", body.message_id)
      .single();

    if (fetchErr || !message) {
      return new Response(
        JSON.stringify({ error: "Message not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (message.recipient_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only delivered messages can be declined/blocked
    if (message.status !== "delivered") {
      return new Response(
        JSON.stringify({ error: "Message is not in a returnable state" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();

    // --- 4. If blocking, insert into blocked_users ---
    // Status written as 'declined' in both cases — sender cannot distinguish.
    if (body.action === "block") {
      const { error: blockErr } = await serviceClient
        .from("blocked_users")
        .upsert(
          { blocker_id: user.id, blocked_id: message.sender_id },
          { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true }
        );

      if (blockErr) {
        console.error("Block insert error:", blockErr);
        // Non-fatal: proceed with decline even if block insert fails
      }
    }

    // --- 5. Update message: mark declined, soft-delete from recipient view ---
    const { error: updateErr } = await serviceClient
      .from("moon_roulette_messages")
      .update({
        status: "declined",
        recipient_deleted_at: now,
        updated_at: now,
      })
      .eq("id", body.message_id);

    if (updateErr) {
      console.error("Update error:", updateErr);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 6. Fetch sender's push subscription and email for notification ---
    // Notification tells sender their message was returned (no mention of block vs. decline).
    const { data: senderProfile } = await serviceClient
      .from("profiles")
      .select("email, notify_email")
      .eq("id", message.sender_id)
      .single();

    if (senderProfile?.notify_email && senderProfile.email) {
      const appUrl = Deno.env.get("APP_URL") ?? "https://www.moonpostservice.com";
      const resendApiKey = Deno.env.get("RESEND_API_KEY");

      if (resendApiKey) {
        const preview = message.message_text
          ? message.message_text.slice(0, 80) + (message.message_text.length > 80 ? "…" : "")
          : null;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: Deno.env.get("EMAIL_FROM") ?? "Moon Post Service <hello@moonpostservice.com>",
            to: [senderProfile.email],
            subject: "🌙 Your Moon Roulette message found its way back to you",
            html: `
              <h2>Your Moon Roulette message has returned</h2>
              ${preview ? `<p><em>"${preview}"</em></p>` : ""}
              <p>The recipient chose not to connect this time. You can re-launch it to someone new, or let it rest.</p>
              <p><a href="${appUrl}/roulette">Open Moon Roulette</a></p>
            `,
          }),
        }).catch((err) => console.error("Return notification email failed:", err));
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
