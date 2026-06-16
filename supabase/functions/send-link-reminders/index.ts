import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// "Remind me when my moon rises" sender for send-by-link openers.
//
// A standalone cron (every few minutes) so it never touches the critical
// release-messages pipeline. Finds message_link_opens rows that opted in
// (reminder_email set), whose moonrise (release_at) has passed and which
// haven't been emailed yet, sends a one-off branded email linking straight
// back to the reveal (?g=<token>&o=<open_id>), and stamps reminder_sent_at so
// each fires exactly once.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const APP_URL = 'https://www.moonpostservice.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function escHtml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function reminderHtml(senderName: string, link: string): string {
  const who = escHtml(senderName || 'Someone');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#030A18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#030A18;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:linear-gradient(135deg,#030A18 0%,#0A1422 100%);border-radius:16px;border:1px solid rgba(212,181,138,0.28);">
        <tr><td style="padding:36px 24px 8px;text-align:center;">
          <div style="font-size:40px;line-height:1;margin-bottom:10px;">&#127765;</div>
          <h1 style="color:#F0DFC2;font-size:21px;font-weight:600;margin:0 0 8px;">The moon has risen</h1>
          <p style="color:rgba(234,216,191,0.72);font-size:15px;line-height:1.55;margin:0;">${who}&#39;s moon message is ready to read.</p>
        </td></tr>
        <tr><td style="padding:20px 24px 28px;text-align:center;">
          <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#D4B58A,#C7A678);color:#0A1422;text-decoration:none;padding:14px 40px;border-radius:24px;font-size:15px;font-weight:600;">Read it under your moon</a>
        </td></tr>
        <tr><td style="padding:0 24px 20px;text-align:center;">
          <p style="color:rgba(234,216,191,0.28);font-size:11px;margin:0;">Moon Post Service &#8212; Messages delivered at moonrise</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.error('RESEND_API_KEY missing'); return false; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Moon Post Service <hello@moonpostservice.com>', to: [to], subject, html }),
    });
    const result = await res.json();
    if (!res.ok) { console.error('Resend error:', result); return false; }
    return true;
  } catch (e) { console.error('reminder send failed:', e); return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const now = new Date().toISOString();

    const { data: due } = await supabase
      .from('message_link_opens')
      .select('id, reminder_email, messages!inner(share_token, sender_id)')
      .not('reminder_email', 'is', null)
      .is('reminder_sent_at', null)
      .lte('release_at', now)
      .limit(100);

    let sent = 0;
    if (due && due.length > 0) {
      const senderIds = Array.from(new Set(due.map((r: any) => r.messages?.sender_id).filter(Boolean)));
      const names: Record<string, string> = {};
      if (senderIds.length > 0) {
        const { data: sp } = await supabase.from('profiles').select('id, username').in('id', senderIds);
        if (sp) sp.forEach((p: any) => { names[p.id] = p.username; });
      }

      for (const r of due as any[]) {
        const token = r.messages?.share_token;
        if (!token) {
          await supabase.from('message_link_opens').update({ reminder_sent_at: now }).eq('id', r.id);
          continue;
        }
        const senderName = names[r.messages?.sender_id] || 'Someone';
        const link = `${APP_URL}/?g=${encodeURIComponent(token)}&o=${r.id}`;
        const ok = await sendEmail(r.reminder_email, `${senderName}'s moon message is ready 🌙`, reminderHtml(senderName, link));
        // Stamp regardless so a bad address can't wedge the cron into retrying.
        await supabase.from('message_link_opens').update({ reminder_sent_at: now }).eq('id', r.id);
        if (ok) sent++;
      }
    }

    console.log(`Link reminders: ${sent} sent`);
    return new Response(JSON.stringify({ sent }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('send-link-reminders error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
