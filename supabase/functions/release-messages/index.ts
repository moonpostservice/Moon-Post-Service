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
}

// --- One-click unsubscribe links ---
// Personal signed link per recipient: the unsubscribe-email edge function
// verifies HMAC(uid, INTERNAL_NOTIFY_SECRET) before flipping notify_email,
// so the link works without login but can't be forged for other users.
const UNSUBSCRIBE_SECRET = Deno.env.get('INTERNAL_NOTIFY_SECRET') || '';

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function buildUnsubscribeUrl(userId: string): Promise<string | null> {
  if (!UNSUBSCRIBE_SECRET) return null;
  const sig = await hmacHex(UNSUBSCRIBE_SECRET, userId.toLowerCase());
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/unsubscribe-email?uid=${userId.toLowerCase()}&sig=${sig}`;
}

// Brass-on-navy design system. Email clients can't use CSS variables, so the
// tokens are inlined as literal hex/rgba: --bg #030A18, --accent #D4B58A,
// --text #EAD8BF, --text-bright #F0DFC2, --on-accent #0A1422.
// Escape user-supplied values (usernames, message text) before interpolating
// into the email HTML, so stored content can't inject markup.
function escHtml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDigestEmailHtml(recipientCity: string, messages: DigestMessage[], unsubscribeUrl: string | null): string {
  const count = messages.length;
  const plural = count === 1 ? 'message' : 'messages';

  // Honest headline whether the message arrived instantly (recipient's moon
  // already up) or waited for moonrise: name the sender when it's one, count
  // when it's several. Never claim "the moon just rose" — it may have risen
  // hours ago and the message only just landed.
  const headline = count === 1
    ? `${escHtml(messages[0].senderName)} sent you a moon message`
    : `${count} moon messages waiting`;

  // The message stays sealed — the digest only names the sender, never the
  // contents. It can only be read under the moon, in-app. For a single message
  // the headline already names the sender, so show a gentle subline instead of
  // repeating it; for several, list who they're from.
  const messageRows = count === 1
    ? `<tr><td style="padding:10px 16px;">
      <p style="color:rgba(234,216,191,0.6);font-size:14px;margin:0;font-style:italic;">Read it under tonight's moon.</p>
    </td></tr>`
    : messages.map(m => {
        return `<tr><td style="padding:10px 16px;border-bottom:1px solid rgba(212,181,138,0.12);">
      <p style="color:#F0DFC2;font-size:15px;font-weight:600;margin:0 0 4px;">${escHtml(m.senderName)}</p>
      <p style="color:rgba(234,216,191,0.6);font-size:14px;margin:0;font-style:italic;">sent you a moon message</p>
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
          <h1 style="color:#F0DFC2;font-size:20px;font-weight:600;margin:0 0 6px;">${headline}</h1>
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
          <p style="color:rgba(234,216,191,0.32);font-size:11px;margin:0;">${
            unsubscribeUrl
              ? `<a href="${unsubscribeUrl}" style="color:rgba(234,216,191,0.45);">Unsubscribe from these emails</a> &#183; or disable them in your settings`
              : 'You can disable email notifications in your settings.'
          }</p>
          <p style="color:rgba(234,216,191,0.28);font-size:11px;margin:4px 0 0;">Moon Post Service &#8212; Messages delivered at moonrise</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendDigestEmail(recipientEmail: string, recipientCity: string, messages: DigestMessage[], unsubscribeUrl: string | null): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured, skipping email');
    return false;
  }

  const count = messages.length;
  const plural = count === 1 ? 'message' : 'messages';
  const subject = count === 1
    ? `${messages[0].senderName} sent you a moon message`
    : `${count} moon messages waiting for you`;

  const html = buildDigestEmailHtml(recipientCity, messages, unsubscribeUrl);

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
        // Native "Unsubscribe" button in Gmail/Apple Mail (RFC 8058 one-click)
        ...(unsubscribeUrl ? {
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        } : {}),
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
    const nowMs = Date.parse(now);

    // Fatigue guard: a recipient gets at most one notification per this window.
    // The first message still lands instantly (no prior stamp); a flurry that
    // follows is held and batched into the next digest once the window clears.
    const NOTIFY_COOLDOWN_MS = 60 * 60 * 1000;

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
    // Guard: never notify about an ALREADY-READ message. Normally read state lives in
    // read_receipts (messages.read_at stays null for live messages), so this only
    // excludes rows born already-read — e.g. graduated roulette threads, which mirror
    // old delivered messages in with read_at set. Without this, revealing a roulette
    // thread emailed "1 message waiting" for messages the recipient read weeks ago.
    const { data: unnotifiedMsgs } = await supabase
      .from('messages')
      .select('id, sender_id, recipient_id, message_text, lunar_note_text')
      .eq('status', 'released')
      .is('notified_at', null)
      .is('read_at', null)
      .not('recipient_id', 'is', null)
      .limit(50);

    const { data: unnotifiedReplies } = await supabase
      .from('replies')
      .select('id, sender_id, text, lunar_note_text, message_id, messages!inner(sender_id, recipient_id)')
      .eq('status', 'released')
      .is('notified_at', null)
      .limit(100);

    // Roulette messages join the same digest instead of firing their own
    // emails (migration 047 retired the per-message notify trigger/sweep).
    // notify_at is the recipient's moonrise — instantly-delivered messages
    // (same-city, replies) are visible in-app right away but only emailed
    // when the moon rises for them.
    const { data: unnotifiedRoulette } = await supabase
      .from('moon_roulette_messages')
      .select('id, sender_city, recipient_id, message_text')
      .eq('status', 'delivered')
      .is('notified_at', null)
      .or(`notify_at.is.null,notify_at.lte.${now}`)
      .limit(50);

    interface NotifyItem {
      type: 'message' | 'reply' | 'roulette';
      id: string;
      senderId: string | null;   // null for roulette — sender stays anonymous
      recipientId: string;
      text: string;
      senderLabel?: string;      // pre-built display name (roulette)
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

    if (unnotifiedRoulette) {
      for (const m of unnotifiedRoulette as any[]) {
        if (!m.recipient_id) continue;
        notifyItems.push({
          type: 'roulette',
          id: m.id,
          senderId: null, // anonymous — never resolve to a profile
          recipientId: m.recipient_id,
          text: (m.message_text || '').trim(),
          senderLabel: `A stranger from ${m.sender_city || 'somewhere'}`,
        });
      }
    }

    let notifiedCount = 0;
    if (notifyItems.length > 0) {
      const profileIds = new Set<string>();
      notifyItems.forEach(item => {
        profileIds.add(item.recipientId);
        if (item.senderId) profileIds.add(item.senderId);
      });

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, username, city, notify_email, notify_push, last_notified_at')
        .in('id', Array.from(profileIds));

      const profileMap: Record<string, any> = {};
      if (profiles) profiles.forEach((p: any) => { profileMap[p.id] = p; });

      const byRecipient: Record<string, { msgs: DigestMessage[]; msgIds: string[]; replyIds: string[]; rouletteIds: string[] }> = {};
      for (const item of notifyItems) {
        const rid = item.recipientId;
        if (!byRecipient[rid]) byRecipient[rid] = { msgs: [], msgIds: [], replyIds: [], rouletteIds: [] };

        const sender = item.senderId ? profileMap[item.senderId] : null;
        const senderName = item.senderLabel || sender?.username || 'Someone';

        byRecipient[rid].msgs.push({ senderName });
        if (item.type === 'message') {
          byRecipient[rid].msgIds.push(item.id);
        } else if (item.type === 'reply') {
          byRecipient[rid].replyIds.push(item.id);
        } else {
          byRecipient[rid].rouletteIds.push(item.id);
        }
      }

      const allMsgIds: string[] = [];
      const allReplyIds: string[] = [];
      const allRouletteIds: string[] = [];
      for (const [recipientId, data] of Object.entries(byRecipient)) {
        const recipient = profileMap[recipientId];
        if (!recipient) {
          allMsgIds.push(...data.msgIds);
          allReplyIds.push(...data.replyIds);
          allRouletteIds.push(...data.rouletteIds);
          continue;
        }

        const willEmail = recipient.notify_email !== false && !!recipient.email;
        const willPush = recipient.notify_push !== false;

        // Cooldown applies only when we'd actually notify. If the recipient was
        // notified within the window, hold these items (leave notified_at
        // unstamped) so they fold into the next cycle's digest once it clears.
        if (willEmail || willPush) {
          const last = recipient.last_notified_at ? Date.parse(recipient.last_notified_at) : 0;
          if (last && (nowMs - last) < NOTIFY_COOLDOWN_MS) {
            continue;
          }
        }

        if (willEmail) {
          const unsubscribeUrl = await buildUnsubscribeUrl(recipientId);
          await sendDigestEmail(recipient.email, recipient.city || '', data.msgs, unsubscribeUrl);
        }

        if (willPush) {
          await sendPushDigest(supabase, recipientId, data.msgs);
        }

        if (willEmail || willPush) {
          await supabase.from('profiles').update({ last_notified_at: now }).eq('id', recipientId);
        }

        allMsgIds.push(...data.msgIds);
        allReplyIds.push(...data.replyIds);
        allRouletteIds.push(...data.rouletteIds);
        notifiedCount++;
      }

      if (allMsgIds.length > 0) {
        await supabase.from('messages').update({ notified_at: now }).in('id', allMsgIds);
      }
      if (allReplyIds.length > 0) {
        await supabase.from('replies').update({ notified_at: now }).in('id', allReplyIds);
      }
      if (allRouletteIds.length > 0) {
        await supabase.from('moon_roulette_messages').update({ notified_at: now }).in('id', allRouletteIds);
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
