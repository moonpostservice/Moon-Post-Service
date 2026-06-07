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

    // --- 3. Build email by type ---
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
      htmlBody = `
        <h2>You have a new moon message from ${senderName}!</h2>
        <p>It will be revealed when the moon rises over ${recipientLocation} (around ${moonriseTime}).</p>
        ${messagePreview ? `<p><em>"${messagePreview}..."</em></p>` : ""}
        ${link ? `<p><a href="${link}">View your message</a></p>` : ""}
      `;

    } else if (emailType === "invite") {
      const senderName = esc(body.senderName, "Someone");
      const link = safeLink(body.revealLink, appUrl);
      subject = `🌙 ${senderName} invited you to Moon Post Service!`;
      htmlBody = `
        <h2>${senderName} wants to send you moon messages!</h2>
        <p>Moon Post Service lets you send messages that are revealed when the moon rises at the recipient's location.</p>
        ${link ? `<p><a href="${link}">Join Moon Post Service</a></p>` : ""}
      `;

    } else if (emailType === "roulette_received") {
      // Recipient notification: message in transit, reveal city only
      const senderCity = esc(body.senderCity, "somewhere");
      const moonPhase = esc(body.moonPhase);
      const releaseTime = esc(body.releaseTime);

      subject = "🌕 A mystery moon message is on its way to you";
      htmlBody = `
        <h2>A Moon Roulette message is travelling your way</h2>
        <p>Someone from <strong>${senderCity}</strong> sent you an anonymous moon message.</p>
        ${moonPhase ? `<p>Moon phase: ${moonPhase}</p>` : ""}
        ${releaseTime ? `<p>It will arrive when the moon rises — around <strong>${releaseTime}</strong>.</p>` : ""}
        <p>When it arrives, you can choose to read it, reveal who sent it, or decline.</p>
        <p><a href="${appUrl}/roulette">Open Moon Roulette</a></p>
      `;

    } else {
      // roulette_returned
      const messagePreview = esc(body.messagePreview);

      subject = "🌙 Your Moon Roulette message found its way back to you";
      htmlBody = `
        <h2>Your Moon Roulette message has returned</h2>
        ${messagePreview ? `<p><em>"${messagePreview}"</em></p>` : ""}
        <p>The recipient chose not to connect this time. You can re-launch it to someone new, or let it rest.</p>
        <p><a href="${appUrl}/roulette">Open Moon Roulette</a></p>
      `;
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
