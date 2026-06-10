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

// --- Brass-on-navy email shell (matches the moonrise digest in
// release-messages). Email clients can't use CSS variables, so the design
// tokens are inlined as literal hex/rgba: --bg #030A18, --accent #D4B58A,
// --text #EAD8BF, --text-bright #F0DFC2, --on-accent #0A1422. ---
function para(html: string): string {
  return `<p style="color:rgba(234,216,191,0.7);font-size:15px;line-height:1.55;margin:0 0 12px;">${html}</p>`;
}
function emailShell(heading: string, innerHtml: string, ctaText: string, ctaHref: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#030A18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#030A18;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:linear-gradient(135deg,#030A18 0%,#0A1422 100%);border-radius:16px;border:1px solid rgba(212,181,138,0.28);">
        <tr><td style="padding:32px 24px 8px;text-align:center;">
          <div style="font-size:48px;margin-bottom:8px;">&#127765;</div>
          <h1 style="color:#F0DFC2;font-size:20px;font-weight:600;margin:0;">${heading}</h1>
        </td></tr>
        <tr><td style="padding:12px 28px 16px;text-align:center;">
          ${innerHtml}
        </td></tr>
        <tr><td style="padding:4px 24px 28px;text-align:center;">
          <a href="${ctaHref}" style="display:inline-block;background:linear-gradient(135deg,#D4B58A,#C7A678);color:#0A1422;text-decoration:none;padding:14px 40px;border-radius:24px;font-size:15px;font-weight:600;">${ctaText}</a>
        </td></tr>
        <tr><td style="padding:0 24px 22px;text-align:center;">
          <p style="color:rgba(234,216,191,0.28);font-size:11px;margin:0;">Moon Post Service &#8212; Messages delivered at moonrise &#127769;</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
    const appUrl = Deno.env.get("APP_URL") ?? "https://www.moonpostservice.com";
    const emailFrom = Deno.env.get("EMAIL_FROM") ?? "Moon Post Service <hello@moonpostservice.com>";

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
      const inner =
        para(`Someone from <strong>${senderCity}</strong> sent you an anonymous moon message.`) +
        (moonPhase ? para(`Moon phase: ${moonPhase}`) : "") +
        (releaseTime ? para(`It arrived at <strong>${releaseTime}</strong>.`) : "") +
        para("You can read it, choose to reveal who sent it, or decline — anonymously.");
      const htmlBody = emailShell("A mystery moon message has arrived", inner, "Open Moon Roulette", `${appUrl}/roulette`);

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
