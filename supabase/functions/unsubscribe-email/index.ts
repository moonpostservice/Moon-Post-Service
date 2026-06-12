// supabase/functions/unsubscribe-email/index.ts
// One-click email unsubscribe, reachable straight from a digest email.
//
// Links are personal and signed: ?uid=<user-id>&sig=HMAC-SHA256(uid, secret),
// so nobody can unsubscribe someone else by guessing their id. The secret is
// INTERNAL_NOTIFY_SECRET (already configured), shared with release-messages
// which mints the links.
//
// GET  → branded confirmation page with an Unsubscribe button (never mutates:
//        mail scanners like Outlook SafeLinks prefetch GET links, and that
//        must not silently unsubscribe people).
// POST → verifies the signature, sets profiles.notify_email = false, shows a
//        confirmation page. Gmail/Apple's native one-click unsubscribe POSTs
//        here via the List-Unsubscribe headers.
//
// Deployed with verify_jwt = false — recipients are not logged in.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Brass-on-navy page shell matching the email design. Tokens inlined:
// --bg #030A18, --accent #D4B58A, --text #EAD8BF, --text-bright #F0DFC2,
// --on-accent #0A1422.
function page(heading: string, innerHtml: string, status = 200): Response {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading} — Moon Post Service</title>
</head>
<body style="margin:0;padding:40px 20px;background:#030A18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;box-sizing:border-box;">
  <div style="max-width:480px;margin:8vh auto 0;background:linear-gradient(135deg,#030A18 0%,#0A1422 100%);border-radius:16px;border:1px solid rgba(212,181,138,0.28);padding:40px 28px;text-align:center;">
    <div style="font-size:48px;margin-bottom:12px;">&#127769;</div>
    <h1 style="color:#F0DFC2;font-size:20px;font-weight:600;margin:0 0 16px;">${heading}</h1>
    ${innerHtml}
    <p style="color:rgba(234,216,191,0.28);font-size:11px;margin:28px 0 0;">Moon Post Service &#8212; Messages delivered at moonrise</p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const invalidLinkPage = () =>
  page(
    "This link isn't valid",
    `<p style="color:rgba(234,216,191,0.7);font-size:15px;line-height:1.55;margin:0;">
      This unsubscribe link is invalid or has expired. You can still turn off
      email notifications from the settings inside
      <a href="https://www.moonpostservice.com" style="color:#D4B58A;">Moon Post Service</a>.
    </p>`,
    400,
  );

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
      },
    });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = Deno.env.get("INTERNAL_NOTIFY_SECRET");
  if (!secret) {
    console.error("INTERNAL_NOTIFY_SECRET not configured — refusing to run");
    return page("Something went wrong", `<p style="color:rgba(234,216,191,0.7);font-size:15px;margin:0;">Please try again later.</p>`, 503);
  }

  const url = new URL(req.url);
  const uid = (url.searchParams.get("uid") ?? "").toLowerCase();
  const sig = url.searchParams.get("sig") ?? "";

  if (!UUID_RE.test(uid) || !sig) return invalidLinkPage();

  const expected = await hmacHex(secret, uid);
  if (!timingSafeEqual(expected, sig.toLowerCase())) return invalidLinkPage();

  // --- GET: show the confirm button, mutate nothing (scanner-safe) ---
  if (req.method === "GET") {
    const action = `${url.pathname}?uid=${uid}&sig=${expected}`;
    return page(
      "Unsubscribe from moonrise emails?",
      `<p style="color:rgba(234,216,191,0.7);font-size:15px;line-height:1.55;margin:0 0 24px;">
        You'll stop receiving emails when moon messages arrive for you.
        Your messages will still be waiting inside Moon Post Service.
      </p>
      <form method="POST" action="${action}" style="margin:0;">
        <button type="submit" style="display:inline-block;background:linear-gradient(135deg,#D4B58A,#C7A678);color:#0A1422;border:none;cursor:pointer;padding:14px 40px;border-radius:24px;font-size:15px;font-weight:600;font-family:inherit;">Unsubscribe</button>
      </form>`,
    );
  }

  // --- POST: flip the flag (button submit or Gmail one-click) ---
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await db
    .from("profiles")
    .update({ notify_email: false })
    .eq("id", uid);

  if (error) {
    console.error(`[unsubscribe] update failed for ${uid}:`, error);
    return page("Something went wrong", `<p style="color:rgba(234,216,191,0.7);font-size:15px;margin:0;">Please try again later.</p>`, 500);
  }

  // Deliberately the same page whether or not the profile existed — an
  // unsubscribe endpoint must not leak which account ids are real.
  return page(
    "You're unsubscribed",
    `<p style="color:rgba(234,216,191,0.7);font-size:15px;line-height:1.55;margin:0 0 24px;">
      You won't receive moonrise emails anymore. Messages will still arrive
      inside the app, and you can re-enable emails anytime from your settings.
    </p>
    <a href="https://www.moonpostservice.com" style="display:inline-block;background:linear-gradient(135deg,#D4B58A,#C7A678);color:#0A1422;text-decoration:none;padding:14px 40px;border-radius:24px;font-size:15px;font-weight:600;">Open Moon Post Service</a>`,
  );
});
