// supabase/functions/submit-contact-message/index.ts
// Receives a "Contact Us" form submission from the public site, stores it in
// public.contact_messages, and notifies the team by email (via Resend).
//
// The submitter is frequently logged out, so this function runs with
// verify_jwt OFF and writes with the SERVICE ROLE key. To stop the open
// endpoint being used to spam mail from our verified domain, submissions are
// rate-limited per client IP (hashed) via the shared consume_rate_limit RPC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX = { name: 100, email: 254, subject: 100, message: 5000 };
const ALLOWED_SUBJECTS = [
  "General Question",
  "Bug Report",
  "Feature Request",
  "Privacy or Safety Concern",
  "Account Issue",
  "Other",
];
const TEAM_INBOX = "themoonpostservice@gmail.com";

// Escape user-supplied values before interpolating into the notification email.
function esc(val: unknown): string {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Hash the client IP into a stable UUID-shaped key. Used only as the rate-limit
// bucket and an abuse-tracing fingerprint — we never store or log the raw IP.
async function ipToUuid(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("contact:" + ip));
  const h = Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!name || !email || !subject || !message) {
      return json({ error: "Please fill in every field before sending." }, 400);
    }
    if (
      name.length > MAX.name || email.length > MAX.email ||
      subject.length > MAX.subject || message.length > MAX.message
    ) {
      return json({ error: "One or more fields are too long." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Please enter a valid email address." }, 400);
    }
    // The form is a fixed <select>; fall back to "Other" for anything unexpected.
    const safeSubject = ALLOWED_SUBJECTS.includes(subject) ? subject : "Other";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // --- Rate limit per client IP: 5 submissions / hour ---
    const fwd = req.headers.get("x-forwarded-for") ?? "";
    const ip = fwd.split(",")[0].trim() || "unknown";
    const ipKey = await ipToUuid(ip);
    const { data: allowed, error: rlErr } = await serviceClient.rpc("consume_rate_limit", {
      p_user_id: ipKey,
      p_action: "contact_submit",
      p_limit: 5,
      p_window_seconds: 3600,
    });
    if (rlErr) {
      console.error("[contact] rate limit check failed:", rlErr);
      return json({ error: "Internal server error" }, 500);
    }
    if (!allowed) {
      return json({ error: "You've sent several messages recently. Please try again later." }, 429);
    }

    // Best-effort: capture the user id if the submitter happened to be logged in.
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const token = authHeader.replace("Bearer ", "");
        const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: { user } } = await anon.auth.getUser(token);
        userId = user?.id ?? null;
      } catch {
        /* anonymous submitter — fine */
      }
    }

    const { error: insertErr } = await serviceClient.from("contact_messages").insert({
      name,
      email,
      subject: safeSubject,
      message,
      user_id: userId,
      ip_hash: ipKey,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500),
    });
    if (insertErr) {
      console.error("[contact] insert error:", insertErr);
      return json({ error: "Internal server error" }, 500);
    }

    // --- Notify the team (best-effort: the message is already stored if this fails) ---
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      const html = `
        <h2 style="font-family:sans-serif;">New contact message</h2>
        <p style="font-family:sans-serif;"><strong>From:</strong> ${esc(name)} &lt;${esc(email)}&gt;</p>
        <p style="font-family:sans-serif;"><strong>Subject:</strong> ${esc(safeSubject)}</p>
        <p style="font-family:sans-serif;white-space:pre-wrap;line-height:1.5;">${esc(message)}</p>
        <hr>
        <p style="font-family:sans-serif;color:#888;font-size:12px;">Sent via the Moon Post Service contact form. Reply directly to this email to respond to the sender.</p>`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: Deno.env.get("EMAIL_FROM") ?? "Moon Post Service <hello@moonpostservice.com>",
          to: [Deno.env.get("CONTACT_INBOX") ?? TEAM_INBOX],
          reply_to: email,
          subject: `[Contact] ${safeSubject} — ${name}`,
          html,
        }),
      }).catch((e) => console.error("[contact] notify email failed:", e));
    }

    return json({ success: true });
  } catch (err) {
    console.error("[contact] unhandled error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
