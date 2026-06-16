// Vercel serverless function: serve the app shell for a send-by-link share URL
// (/m/<token>) with per-link Open Graph tags injected, so the link unfurls as
// "<sender> sent you a moon message 🌙" on WhatsApp / iMessage / Instagram /
// etc., instead of the generic homepage card.
//
// Real browsers still get the full SPA HTML (with all the JS), so reveal.js
// boots and runs the normal claim/countdown flow. Unfurl bots (no JS) read the
// injected meta tags. The message content stays sealed — only the sender name
// and a short teaser are exposed (same as the reveal page's pre-claim state).

const SUPABASE_URL = 'https://znfqqehthxcrizcixzpu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZnFxZWh0aHhjcml6Y2l4enB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MzMyMDgsImV4cCI6MjA4NjAwOTIwOH0.Twf3d9QEhVq6j9yVKaS9QNhnvygYgxPj0zg6Ug5pAq0';
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = async (req, res) => {
  const token = (req.query && req.query.token) || '';
  const host = req.headers.host || 'www.moonpostservice.com';

  // Pull the app shell. Fetch /index.html directly (a real static file, so this
  // does not recurse through the /m rewrite).
  let html;
  try {
    const r = await fetch(`https://${host}/index.html`);
    html = await r.text();
  } catch (e) {
    res.statusCode = 302;
    res.setHeader('Location', '/');
    res.end();
    return;
  }

  // Look up the sender + teaser (content stays sealed) via the same edge fn the
  // reveal page uses. Best-effort — fall back to a generic card on any error.
  let sender = 'Someone';
  let teaser = '';
  if (TOKEN_RE.test(token)) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/reveal-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ token }),
      });
      const d = await r.json();
      if (d && d.sender && d.sender.username) sender = d.sender.username;
      if (d && d.message && d.message.teaser) teaser = d.message.teaser;
    } catch (e) { /* generic card */ }
  }

  const title = `${sender} sent you a moon message 🌙`;
  const desc = teaser
    ? `“${teaser}” — it reveals when the moon rises over you.`
    : 'A moon message is waiting for you — it reveals when the moon rises where you are.';
  const url = `https://${host}/m/${esc(token)}`;

  html = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(">)/, `$1${esc(desc)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, `$1${esc(title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, `$1${esc(desc)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(">)/, `$1${url}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(">)/, `$1${esc(title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(">)/, `$1${esc(desc)}$2`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.status(200).send(html);
};
