// supabase/functions/send-email/index.ts
// Edge Function: Send notification emails (message arrival, invites)
// Hardened with JWT validation and structured error responses
// Requirements: 12.4

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CORS headers ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Supported email types
const VALID_EMAIL_TYPES = ["message", "invite"] as const;
type EmailType = (typeof VALID_EMAIL_TYPES)[number];

function isValidEmailType(type: unknown): type is EmailType {
  return typeof type === "string" && VALID_EMAIL_TYPES.includes(type as EmailType);
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
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
    // --- 1. Extract and validate JWT ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify the JWT
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
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

    if (!isValidEmailType(body.type)) {
      return new Response(
        JSON.stringify({ error: "Missing field: type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.recipientEmail || typeof body.recipientEmail !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing field: recipientEmail" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.senderName || typeof body.senderName !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing field: senderName" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 3. Build email content based on type ---
    const emailType = body.type as EmailType;
    let subject: string;
    let htmlBody: string;

    if (emailType === "message") {
      // Validate message-specific fields
      if (!body.revealLink || typeof body.revealLink !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing field: revealLink" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const recipientLocation = (body.recipientLocation as string) || "your location";
      const moonriseTime = (body.moonriseTime as string) || "soon";
      const messagePreview = (body.messagePreview as string) || "";

      subject = `🌙 ${body.senderName} sent you a moon message!`;
      htmlBody = `
        <h2>You have a new moon message from ${body.senderName}!</h2>
        <p>It will be revealed when the moon rises over ${recipientLocation} (around ${moonriseTime}).</p>
        ${messagePreview ? `<p><em>"${messagePreview}..."</em></p>` : ""}
        <p><a href="${body.revealLink}">View your message</a></p>
      `;
    } else {
      // invite type
      const revealLink = (body.revealLink as string) || "";
      subject = `🌙 ${body.senderName} invited you to Moon Post Service!`;
      htmlBody = `
        <h2>${body.senderName} wants to send you moon messages!</h2>
        <p>Moon Post Service lets you send messages that are revealed when the moon rises at the recipient's location.</p>
        ${revealLink ? `<p><a href="${revealLink}">Join Moon Post Service</a></p>` : ""}
      `;
    }

    // --- 4. Send email via Resend (or configured provider) ---
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
        from: Deno.env.get("EMAIL_FROM") || "Moon Post Service <noreply@moonpop.app>",
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
