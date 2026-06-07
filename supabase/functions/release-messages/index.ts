import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const VAPID_PUBLIC_KEY = 'BHqBb8cUt0T7Zb2aBo3G8vFpQRw0zBVnKbGqT5Fv3qYxPkPU4A9J-a4dIWx7U5VnSXBqK8aGnL1yMzRsQf3xG8';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || 'Kx3TUBfA-UqZmA4ky5gE8GGBH5t_2bnRqXB0vMK5a4Q';
const VAPID_SUBJECT = 'mailto:hello@moonpostservice.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Base64url helpers ---
function base64urlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - str.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

// --- VAPID JWT generation ---
async function generateVapidJwt(audience: string): Promise<string> {
  const header = base64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64urlEncode(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: now + 12 * 60 * 60,
    sub: VAPID_SUBJECT,
  })));
  const unsigned = `${header}.${payload}`;

  const rawKey = base64urlDecode(VAPID_PRIVATE_KEY);
  const pubKeyBytes = base64urlDecode(VAPID_PUBLIC_KEY);
  const x = base64urlEncode(pubKeyBytes.slice(1, 33));
  const y = base64urlEncode(pubKeyBytes.slice(33, 65));
  const d = base64urlEncode(rawKey);

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  ));

  const signature = base64urlEncode(sig);
  return `${unsigned}.${signature}`;
}

// --- Web Push payload encryption (RFC 8291 / aes128gcm) ---
async function encryptPayload(payload: string, p256dhKey: string, authSecret: string): Promise<{ encrypted: Uint8Array }> {
  const subscriberPubBytes = base64urlDecode(p256dhKey);
  const authBytes = base64urlDecode(authSecret);

  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  ) as CryptoKeyPair;

  const localPubKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeyPair.publicKey));

  const subscriberPubKey = await crypto.subtle.importKey(
    'raw', subscriberPubBytes,
    { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  const sharedSecretBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subscriberPubKey },
    localKeyPair.privateKey, 256
  ));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();

  const ikmKey = await crypto.subtle.importKey('raw', sharedSecretBits, 'HKDF' as any, false, ['deriveBits']);
  const keyInfoBuf = new Uint8Array([...enc.encode('WebPush: info\0'), ...subscriberPubBytes, ...localPubKeyRaw]);

  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authBytes, info: keyInfoBuf } as any, ikmKey, 256
  ));

  const ikmKey2 = await crypto.subtle.importKey('raw', ikm, 'HKDF' as any, false, ['deriveBits']);

  const cekBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: aes128gcm\0') } as any, ikmKey2, 128
  ));

  const nonceBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: nonce\0') } as any, ikmKey2, 96
  ));

  const payloadBytes = enc.encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 2);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 2;

  const aesKey = await crypto.subtle.importKey('raw', cekBits, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonceBits }, aesKey, paddedPayload
  ));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const header = new Uint8Array(16 + 4 + 1 + localPubKeyRaw.length);
  header.set(salt, 0);
  header.set(rs, 16);
  header[20] = localPubKeyRaw.length;
  header.set(localPubKeyRaw, 21);

  const encrypted = new Uint8Array(header.length + ciphertext.length);
  encrypted.set(header);
  encrypted.set(ciphertext, header.length);

  return { encrypted };
}

// --- Send a single push notification ---
async function sendSinglePush(endpoint: string, p256dh: string, auth: string, payload: string): Promise<boolean> {
  try {
    const endpointUrl = new URL(endpoint);
    const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
    const jwt = await generateVapidJwt(audience);
    const { encrypted } = await encryptPayload(payload, p256dh, auth);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': '86400',
        'Urgency': 'normal',
      },
      body: encrypted,
    });

    if (response.ok || response.status === 201) return true;
    console.error(`Push failed (${response.status}):`, await response.text());
    return false;
  } catch (e) {
    console.error('Push encryption/send error:', e);
    return false;
  }
}

// --- Moonrise Digest Email ---
interface DigestMessage {
  senderName: string;
  preview: string;
}

// Brass-on-navy design system. Email clients can't use CSS variables, so the
// tokens are inlined as literal hex/rgba: --bg #030A18, --accent #D4B58A,
// --text #EAD8BF, --text-bright #F0DFC2, --on-accent #0A1422.
function buildDigestEmailHtml(recipientCity: string, messages: DigestMessage[]): string {
  const count = messages.length;
  const plural = count === 1 ? 'message' : 'messages';

  const messageRows = messages.map(m => {
    const preview = m.preview ? `&ldquo;${m.preview}...&rdquo;` : 'A moon message';
    return `<tr><td style="padding:10px 16px;border-bottom:1px solid rgba(212,181,138,0.12);">
      <p style="color:#F0DFC2;font-size:15px;font-weight:600;margin:0 0 4px;">${m.senderName}</p>
      <p style="color:rgba(234,216,191,0.6);font-size:14px;margin:0;font-style:italic;">${preview}</p>
    </td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#030A18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#030A18;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:linear-gradient(135deg,#030A18 0%,#0A1422 100%);border-radius:16px;border:1px solid rgba(212,181,138,0.28);">
        <tr><td style="padding:32px 24px 16px;text-align:center;">
          <div style="font-size:48px;margin-bottom:8px;">&#127769;</div>
          <h1 style="color:#F0DFC2;font-size:20px;font-weight:600;margin:0 0 6px;">The moon just rose${recipientCity ? ' over ' + recipientCity : ''}</h1>
          <p style="color:rgba(234,216,191,0.55);font-size:14px;margin:0;">${count} ${plural} waiting for you</p>
        </td></tr>
        <tr><td style="padding:0 24px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(212,181,138,0.06);border:1px solid rgba(212,181,138,0.18);border-radius:12px;overflow:hidden;">
            ${messageRows}
          </table>
        </td></tr>
        <tr><td style="padding:0 24px 24px;text-align:center;">
          <a href="https://www.moonpostservice.com" style="display:inline-block;background:linear-gradient(135deg,#D4B58A,#C7A678);color:#0A1422;text-decoration:none;padding:14px 40px;border-radius:24px;font-size:15px;font-weight:600;">Read your moon ${plural}</a>
        </td></tr>
        <tr><td style="padding:0 24px 20px;text-align:center;">
          <p style="color:rgba(234,216,191,0.32);font-size:11px;margin:0;">You can disable email notifications in your settings.</p>
          <p style="color:rgba(234,216,191,0.28);font-size:11px;margin:4px 0 0;">Moon Post Service &#8212; Messages delivered at moonrise &#127769;</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendDigestEmail(recipientEmail: string, recipientCity: string, messages: DigestMessage[]): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured, skipping email');
    return false;
  }

  const count = messages.length;
  const plural = count === 1 ? 'message' : 'messages';
  const subject = count === 1
    ? `${messages[0].senderName} sent you a moon message`
    : `The moon just rose — ${count} ${plural} waiting for you`;

  const html = buildDigestEmailHtml(recipientCity, messages);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Moon Post Service <hello@moonpostservice.com>',
        to: [recipientEmail],
        subject,
        html,
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      console.error('Resend error:', result);
      return false;
    }
    console.log(`Digest email sent to ${recipientEmail} (${count} msgs):`, result.id);
    return true;
  } catch (e) {
    console.error('Digest email failed:', e);
    return false;
  }
}

async function sendPushDigest(supabase: any, userId: string, messages: DigestMessage[]) {
  try {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);
    if (!subs || subs.length === 0) return;

    const count = messages.length;
    const body = count === 1
      ? `${messages[0].senderName} sent you a moon message`
      : `${count} moon messages are waiting for you`;

    const payload = JSON.stringify({
      title: 'Moon Post Service',
      body,
      url: '/',
      tag: 'moonpost-digest',
    });

    for (const sub of subs) {
      try {
        if (!sub.p256dh || !sub.auth) continue;
        const success = await sendSinglePush(sub.endpoint, sub.p256dh, sub.auth, payload);
        if (!success) {
          const res = await fetch(sub.endpoint, { method: 'HEAD' }).catch(() => null);
          if (res && (res.status === 404 || res.status === 410)) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id);
            console.log('Removed expired push sub:', sub.id);
          }
        }
      } catch (e) {
        console.error('Push send error:', e);
      }
    }
  } catch (e) {
    console.error('Push digest error:', e);
  }
}

// --- Main handler ---
// Note: lunar-cycle message cleanup now lives in the separate `new-moon-wipe`
// edge function (triggered only near true new moon, not every minute).
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const now = new Date().toISOString();

    // --- Phase 1: Release in_transit messages whose release_at has passed ---
    const { data: toRelease, error: fetchError } = await supabase
      .from('messages')
      .select('id')
      .eq('status', 'in_transit')
      .lte('release_at', now);

    if (fetchError) throw new Error(`Fetch error: ${fetchError.message}`);

    let releasedCount = 0;
    if (toRelease && toRelease.length > 0) {
      const ids = toRelease.map((m: { id: string }) => m.id);
      const { error: updateError } = await supabase
        .from('messages')
        .update({ status: 'released', released_at: now })
        .in('id', ids);
      if (updateError) throw new Error(`Update error: ${updateError.message}`);
      releasedCount = ids.length;
      console.log(`Released ${releasedCount} messages at ${now}`);
    }

    // --- Phase 2: Release in_transit replies ---
    const { data: toReleaseReplies } = await supabase
      .from('replies')
      .select('id')
      .eq('status', 'in_transit')
      .lte('release_at', now);

    let releasedRepliesCount = 0;
    if (toReleaseReplies && toReleaseReplies.length > 0) {
      const replyIds = toReleaseReplies.map((r: { id: string }) => r.id);
      await supabase.from('replies').update({ status: 'released' }).in('id', replyIds);
      releasedRepliesCount = replyIds.length;
      console.log(`Released ${releasedRepliesCount} replies at ${now}`);
    }

    // --- Phase 3: Digest notifications --- group by recipient, one email per user ---
    const { data: unnotifiedMsgs } = await supabase
      .from('messages')
      .select('id, sender_id, recipient_id, message_text, lunar_note_text')
      .eq('status', 'released')
      .is('notified_at', null)
      .not('recipient_id', 'is', null)
      .limit(50);

    const { data: unnotifiedReplies } = await supabase
      .from('replies')
      .select('id, sender_id, text, lunar_note_text, message_id, messages!inner(sender_id, recipient_id)')
      .eq('status', 'released')
      .is('notified_at', null)
      .limit(100);

    interface NotifyItem {
      type: 'message' | 'reply';
      id: string;
      senderId: string;
      recipientId: string;
      text: string;
    }

    const notifyItems: NotifyItem[] = [];

    if (unnotifiedMsgs) {
      for (const m of unnotifiedMsgs) {
        if (!m.recipient_id) continue;
        notifyItems.push({
          type: 'message',
          id: m.id,
          senderId: m.sender_id,
          recipientId: m.recipient_id,
          text: (m.message_text || m.lunar_note_text || '').trim(),
        });
      }
    }

    if (unnotifiedReplies) {
      for (const r of unnotifiedReplies as any[]) {
        const parentMsg = r.messages;
        if (!parentMsg) continue;
        const recipientId = r.sender_id === parentMsg.sender_id
          ? parentMsg.recipient_id
          : parentMsg.sender_id;
        if (!recipientId || recipientId === r.sender_id) continue;
        notifyItems.push({
          type: 'reply',
          id: r.id,
          senderId: r.sender_id,
          recipientId,
          text: (r.text || r.lunar_note_text || '').trim(),
        });
      }
    }

    let notifiedCount = 0;
    if (notifyItems.length > 0) {
      const profileIds = new Set<string>();
      notifyItems.forEach(item => {
        profileIds.add(item.recipientId);
        profileIds.add(item.senderId);
      });

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, username, city, notify_email, notify_push')
        .in('id', Array.from(profileIds));

      const profileMap: Record<string, any> = {};
      if (profiles) profiles.forEach((p: any) => { profileMap[p.id] = p; });

      const byRecipient: Record<string, { msgs: DigestMessage[]; msgIds: string[]; replyIds: string[] }> = {};
      for (const item of notifyItems) {
        const rid = item.recipientId;
        if (!byRecipient[rid]) byRecipient[rid] = { msgs: [], msgIds: [], replyIds: [] };

        const sender = profileMap[item.senderId];
        const senderName = sender?.username || 'Someone';
        const preview = item.text.split(/\s+/).slice(0, 5).join(' ');

        byRecipient[rid].msgs.push({ senderName, preview });
        if (item.type === 'message') {
          byRecipient[rid].msgIds.push(item.id);
        } else {
          byRecipient[rid].replyIds.push(item.id);
        }
      }

      const allMsgIds: string[] = [];
      const allReplyIds: string[] = [];
      for (const [recipientId, data] of Object.entries(byRecipient)) {
        const recipient = profileMap[recipientId];
        if (!recipient) {
          allMsgIds.push(...data.msgIds);
          allReplyIds.push(...data.replyIds);
          continue;
        }

        if (recipient.notify_email !== false && recipient.email) {
          await sendDigestEmail(recipient.email, recipient.city || '', data.msgs);
        }

        if (recipient.notify_push !== false) {
          await sendPushDigest(supabase, recipientId, data.msgs);
        }

        allMsgIds.push(...data.msgIds);
        allReplyIds.push(...data.replyIds);
        notifiedCount++;
      }

      if (allMsgIds.length > 0) {
        await supabase.from('messages').update({ notified_at: now }).in('id', allMsgIds);
      }
      if (allReplyIds.length > 0) {
        await supabase.from('replies').update({ notified_at: now }).in('id', allReplyIds);
      }
    }

    console.log(`Release cycle: ${releasedCount} msgs + ${releasedRepliesCount} replies released, ${notifiedCount} users notified`);

    return new Response(
      JSON.stringify({ released: releasedCount, releasedReplies: releasedRepliesCount, notified: notifiedCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Release messages error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
