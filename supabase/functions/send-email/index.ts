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
      const senderName = str(body.senderName, "Someone");
      const recipientLocation = str(body.recipientLocation, "your location");
      const moonriseTime = str(body.moonriseTime, "soon");
      const messagePreview = str(body.messagePreview);

      subject = `🌙 ${senderName} sent you a moon message!`;
      htmlBody = `
        <h2>You have a new moon message from ${senderName}!</h2>
        <p>It will be revealed when the moon rises over ${recipientLocation} (around ${moonriseTime}).</p>
        ${messagePreview ? `<p><em>"${messagePreview}..."</em></p>` : ""}
        <p><a href="${str(body.revealLink)}">View your message</a></p>
      `;

    } else if (emailType === "invite") {
      const senderName = str(body.senderName, "Someone");
      const revealLink = str(body.revealLink);
      subject = `🌙 ${senderName} invited you to Moon Post Service!`;
      htmlBody = `
        <h2>${senderName} wants to send you moon messages!</h2>
        <p>Moon Post Service lets you send messages that are revealed when the moon rises at the recipient's location.</p>
        ${revealLink ? `<p><a href="${revealLink}">Join Moon Post Service</a></p>` : ""}
      `;

    } else if (emailType === "roulette_received") {
      // Recipient notification: message in transit, reveal city only
      const senderCity = str(body.senderCity, "somewhere");
      const moonPhase = str(body.moonPhase);
      const releaseTime = str(body.releaseTime);

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
      const messagePreview = str(body.messagePreview);

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
