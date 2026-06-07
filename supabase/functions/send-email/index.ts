// supabase/functions/send-email/index.ts
// Sends notification emails via Resend.
// Supported types: "message", "invite", "roulette_received", "roulette_returned"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_EMAIL_TYPES = ["message", "invite", "roulette_received", "roulette_returned"] as const;
type EmailType = (typeof VALID_EMAIL_TYPES)[number];

function isValidEmailType(type: unknown): type is EmailType {
  return typeof type === "string" && (VALID_EMAIL_TYPES as readonly string[]).includes(type);
}

function str(val: unknown, fallback = ""): string {
  return typeof val === "string" ? val : fallback;
}

// Escape user-controlled values before interpolating into HTML email bodies.
// Prevents HTML/link injection that would let an authenticated caller craft
// arbitrary phishing markup sent from our verified domain.
function esc(val: unknown, fallback = ""): string {
  return str(val, fallback)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only allow links that point back to our own app origin. Anything else
// (attacker-controlled href) is dropped so the email can't be weaponised
// as a same-domain phishing lure.
function safeLink(val: unknown, allowedOrigin: string): string {
  const s = str(val);
  try {
    if (new URL(s).origin === new URL(allowedOrigin).origin) {
      return s.replace(/"/g, "%22").replace(/'/g, "%27");
    }
  } catch {
    /* not a valid URL */
  }
  return "";
}

// --- Brass-on-navy email shell (matches the moonrise digest in
// release-messages). Email clients can't use CSS variables, so the design
// tokens are inlined as literal hex/rgba: --bg #030A18, --accent #D4B58A,
// --text #EAD8BF, --text-bright #F0DFC2, --on-accent #0A1422. ---
function para(html: string): string {
  return `<p style="color:rgba(234,216,191,0.7);font-size:15px;line-height:1.55;margin:0 0 12px;">${html}</p>`;
}
function quote(text: string, ellipsis = false): string {
  return `<p style="color:rgba(234,216,191,0.6);font-size:15px;font-style:italic;margin:0 0 12px;">&ldquo;${text}${ellipsis ? "..." : ""}&rdquo;</p>`;
}
function emailShell(heading: string, innerHtml: string, ctaText: string, ctaHref: string): string {
  const cta = ctaText && ctaHref
    ? `
        <tr><td style="padding:4px 24px 28px;text-align:center;">
          <a href="${ctaHref}" style="display:inline-block;background:linear-gradient(135deg,#D4B58A,#C7A678);color:#0A1422;text-decoration:none;padding:14px 40px;border-radius:24px;font-size:15px;font-weight:600;">${ctaText}</a>
        </td></tr>`
    : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#030A18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#030A18;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:linear-gradient(135deg,#030A18 0%,#0A1422 100%);border-radius:16px;border:1px solid rgba(212,181,138,0.28);">
        <tr><td style="padding:32px 24px 8px;text-align:center;">
          <div style="font-size:48px;margin-bottom:8px;">&#127769;</div>
          <h1 style="color:#F0DFC2;font-size:20px;font-weight:600;margin:0;">${heading}</h1>
        </td></tr>
        <tr><td style="padding:12px 28px 16px;text-align:center;">
          ${innerHtml}
        </td></tr>${cta}
        <tr><td style="padding:0 24px 22px;text-align:center;">
          <p style="color:rgba(234,216,191,0.28);font-size:11px;margin:0;">Moon Post Service &#8212; Messages delivered at moonrise &#127769;</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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

    // --- 1b. Rate limit (durable, cross-isolate): 40 emails per hour per user ---
    // Bounds the invite/notification path so it can't be used to spam mail from
    // our verified domain. Uses the service role so the limiter table stays private.
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: allowed, error: rlErr } = await serviceClient.rpc("consume_rate_limit", {
      p_user_id: user.id,
      p_action: "email_send",
      p_limit: 40,
      p_window_seconds: 3600,
    });
    if (rlErr) {
      console.error("Rate limit check failed:", rlErr);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 1c. Suspension gate (server-side enforcement — the client check is
    // only UX and is bypassable). A suspended account cannot send mail. ---
    const { data: senderProfile } = await serviceClient
      .from("profiles")
      .select("suspended_at")
      .eq("id", user.id)
      .single();
    if (senderProfile?.suspended_at) {
      return new Response(
        JSON.stringify({ error: "Your account has been suspended." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 2. Parse payload ---
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isValidEmailType(body.type)) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid field: type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.recipientEmail || typeof body.recipientEmail !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing field: recipientEmail" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Basic shape/length validation to reject malformed or header-injection addresses.
    if (body.recipientEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.recipientEmail)) {
      return new Response(
        JSON.stringify({ error: "Invalid recipientEmail" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailType = body.type as EmailType;
    const appUrl = Deno.env.get("APP_URL") ?? "https://moonpop.app";

    // --- 3. Build email by type (brass-on-navy shell) ---
    let subject: string;
    let htmlBody: string;

    if (emailType === "message") {
      if (!body.revealLink) {
        return new Response(
          JSON.stringify({ error: "Missing field: revealLink" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const senderName = esc(body.senderName, "Someone");
      const recipientLocation = esc(body.recipientLocation, "your location");
      const moonriseTime = esc(body.moonriseTime, "soon");
      const messagePreview = esc(body.messagePreview);
      const link = safeLink(body.revealLink, appUrl);

      subject = `🌙 ${senderName} sent you a moon message!`;
      const inner =
        para(`It will be revealed when the moon rises over <strong>${recipientLocation}</strong> (around ${moonriseTime}).`) +
        (messagePreview ? quote(messagePreview, true) : "");
      htmlBody = emailShell(`${senderName} sent you a moon message`, inner, link ? "View your message" : "", link);

    } else if (emailType === "invite") {
      const senderName = esc(body.senderName, "Someone");
      const link = safeLink(body.revealLink, appUrl);

      subject = `🌙 ${senderName} invited you to Moon Post Service!`;
      const inner = para(`${senderName} wants to send you moon messages. Moon Post Service delivers messages that are revealed when the moon rises at the recipient's location.`);
      htmlBody = emailShell(`${senderName} invited you to Moon Post Service`, inner, link ? "Join Moon Post Service" : "", link);

    } else if (emailType === "roulette_received") {
      // Recipient notification: message in transit, reveal city only
      const senderCity = esc(body.senderCity, "somewhere");
      const moonPhase = esc(body.moonPhase);
      const releaseTime = esc(body.releaseTime);

      subject = "🌕 A mystery moon message is on its way to you";
      const inner =
        para(`Someone from <strong>${senderCity}</strong> sent you an anonymous moon message.`) +
        (moonPhase ? para(`Moon phase: ${moonPhase}`) : "") +
        (releaseTime ? para(`It will arrive when the moon rises — around <strong>${releaseTime}</strong>.`) : "") +
        para("When it arrives, you can read it, reveal who sent it, or decline.");
      htmlBody = emailShell("A mystery moon message is on its way", inner, "Open Moon Roulette", `${appUrl}/roulette`);

    } else {
      // roulette_returned
      const messagePreview = esc(body.messagePreview);

      subject = "🌙 Your Moon Roulette message found its way back to you";
      const inner =
        (messagePreview ? quote(messagePreview) : "") +
        para("The recipient chose not to connect this time. You can re-launch it to someone new, or let it rest.");
      htmlBody = emailShell("Your message found its way back to you", inner, "Open Moon Roulette", `${appUrl}/roulette`);
    }

    // --- 4. Send via Resend ---
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_FROM") ?? "Moon Post Service <noreply@moonpop.app>",
        to: [body.recipientEmail as string],
        subject,
        html: htmlBody,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Email send failed:", errText);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailData = await emailRes.json();
    return new Response(
      JSON.stringify({ success: true, id: emailData.id }),
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
