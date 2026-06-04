// supabase/functions/notify-roulette-deliveries/index.ts
// Sends email notifications for Moon Roulette messages that have been delivered
// but not yet notified (notified_at IS NULL).
//
// Called by a PostgreSQL trigger (via pg_net) whenever a roulette message
// transitions to status = 'delivered'. Falls back to processing all pending
// unnotified messages in one sweep, so any missed trigger calls self-heal.
//
// Authentication: called internally via DB trigger — no client JWT needed.
// The function verifies the caller using a shared INTERNAL_NOTIFY_SECRET
// env var checked against the X-Internal-Secret request header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Escape sender-supplied values (e.g. sender_city) before interpolating into
// the recipient's HTML email, so stored content can't inject markup.
function esc(val: unknown): string {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  // --- Verify internal caller (fail CLOSED) ---
  // This function runs with the service-role key and can read recipient emails and
  // send mail, so it must never be open. If the secret is unset or does not match,
  // reject. (Previously the check was skipped entirely when the env var was unset,
  // which left the endpoint callable by anyone.)
  const internalSecret = Deno.env.get("INTERNAL_NOTIFY_SECRET");
  if (!internalSecret) {
    console.error("INTERNAL_NOTIFY_SECRET not configured — refusing to run");
    return new Response(
      JSON.stringify({ error: "Service misconfigured" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  if (req.headers.get("x-internal-secret") !== internalSecret) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRole);

    // --- 1. Find delivered messages with no notification sent yet ---
    const { data: messages, error: fetchErr } = await db
      .from("moon_roulette_messages")
      .select("id, sender_city, moon_phase, released_at, recipient_id, message_text")
      .eq("status", "delivered")
      .is("notified_at", null)
      .limit(50); // process in batches; trigger fires per-row so this is a safety sweep

    if (fetchErr) {
      console.error("[notify-roulette] fetch error:", fetchErr);
      return new Response(
        JSON.stringify({ error: "DB fetch failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!messages?.length) {
      return new Response(
        JSON.stringify({ processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const appUrl = Deno.env.get("APP_URL") ?? "https://moonpop.app";
    const emailFrom = Deno.env.get("EMAIL_FROM") ?? "Moon Post Service <noreply@moonpop.app>";

    let processed = 0;
    let skipped = 0;

    for (const msg of messages) {
      // --- 2. Get recipient's auth email and notify_email preference ---
      const { data: recipientProfile, error: profileErr } = await db
        .from("profiles")
        .select("notify_email")
        .eq("id", msg.recipient_id)
        .single();

      if (profileErr) {
        console.error(`[notify-roulette] profile fetch failed for ${msg.recipient_id}:`, profileErr);
        continue;
      }

      // Mark notified_at regardless of whether email is sent (prevents re-processing)
      const markResult = await db
        .from("moon_roulette_messages")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", msg.id)
        .is("notified_at", null); // guard against double-processing under concurrent calls

      if (markResult.error) {
        console.error(`[notify-roulette] failed to mark notified_at for ${msg.id}:`, markResult.error);
        continue;
      }

      // Skip email if recipient has opted out
      if (recipientProfile.notify_email === false) {
        skipped++;
        continue;
      }

      if (!resendApiKey) {
        console.warn("[notify-roulette] RESEND_API_KEY not set — skipping email");
        skipped++;
        continue;
      }

      // --- 3. Look up recipient's email from auth.users ---
      const { data: authUser, error: authErr } = await db.auth.admin.getUserById(msg.recipient_id);
      if (authErr || !authUser?.user?.email) {
        console.error(`[notify-roulette] auth user fetch failed for ${msg.recipient_id}:`, authErr);
        skipped++;
        continue;
      }

      const recipientEmail = authUser.user.email;

      // --- 4. Format release time ---
      const releaseTime = msg.released_at
        ? new Date(msg.released_at).toLocaleString("en-US", { timeStyle: "short", dateStyle: "medium" })
        : "";

      const moonPhase = esc(msg.moon_phase);
      const senderCity = esc(msg.sender_city ?? "somewhere");

      // --- 5. Send via Resend ---
      const subject = "🌕 A mystery moon message has arrived";
      const htmlBody = `
        <h2>A Moon Roulette message has arrived</h2>
        <p>Someone from <strong>${senderCity}</strong> sent you an anonymous moon message.</p>
        ${moonPhase ? `<p>Moon phase: ${moonPhase}</p>` : ""}
        ${releaseTime ? `<p>It arrived at <strong>${releaseTime}</strong>.</p>` : ""}
        <p>You can read it, choose to reveal who sent it, or decline — anonymously.</p>
        <p><a href="${appUrl}/roulette">Open Moon Roulette</a></p>
      `;

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [recipientEmail],
          subject,
          html: htmlBody,
        }),
      });

      if (!emailRes.ok) {
        const errText = await emailRes.text();
        console.error(`[notify-roulette] Resend failed for message ${msg.id}:`, errText);
        skipped++;
        continue;
      }

      processed++;
    }

    return new Response(
      JSON.stringify({ processed, skipped }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[notify-roulette] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
