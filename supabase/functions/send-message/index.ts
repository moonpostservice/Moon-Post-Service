import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MessagePayload {
  sender_id?: string;
  recipient_name?: string;
  recipient_email?: string;
  recipient_id?: string;
  recipient_city?: string;
  message_text?: string | null;
  lunar_note_text?: string | null;
  lunar_note_closing?: string | null;
  song_url?: string | null;
  song_title?: string | null;
  moon_phase?: string | null;
  moon_illumination?: number | null;
  photo_url?: string | null;
  status: string;
  // Two-hop moon courier: pickup_at = when the sender's moon collects the
  // message (now if their moon is up, else their next moonrise); release_at =
  // when it lands in the recipient's sky. Both stamped client-side at send.
  pickup_at?: string | null;
  release_at?: string | null;
  released_at?: string | null;
  // "Send by link": a recipient-less, shareable message. May be created
  // ANONYMOUSLY (no account) from the landing hero — each opener locks their own
  // moonrise client-side. We mint a secret share_token and an expires_at (the
  // next new moon, when the whole link vanishes). Optional sender_display_name
  // is a free-text signature (no profile).
  shareable?: boolean;
  sender_display_name?: string | null;
}

// URL-safe, unguessable token for shareable links (~22 chars of base64url).
function makeShareToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Next astronomical new moon at/after `from`. Mean-lunation approximation
// (synodic month from a known new-moon epoch) — accurate to a few hours, which
// is plenty for "the message vanishes with the new moon".
function nextNewMoon(from: Date): Date {
  const SYNODIC_MS = 29.530588853 * 86400000;
  const REF = Date.UTC(2000, 0, 6, 18, 14, 0); // 2000-01-06 18:14 UTC new moon
  const k = Math.ceil((from.getTime() - REF) / SYNODIC_MS);
  return new Date(REF + k * SYNODIC_MS);
}

function getClientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const body: MessagePayload = await req.json();
    const shareable = !!body.shareable;

    // Resolve the caller. A shareable "send by link" message can be created
    // anonymously (the landing hero, logged out). Everything else REQUIRES a
    // real authenticated user — the anonymous path is strictly recipient-less.
    let user: { id: string } | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data } = await userClient.auth.getUser();
      user = data?.user ?? null;
    }

    if (!shareable && !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // === VALIDATION ===
    const errors: string[] = [];

    // For a non-anonymous send, sender_id must match the authenticated user.
    if (user && body.sender_id && body.sender_id !== user.id) {
      errors.push('sender_id does not match authenticated user');
    }

    // At least one content field must be non-null
    if (!body.message_text && !body.lunar_note_text && !body.photo_url) {
      errors.push('At least one of message_text, lunar_note_text, or photo_url is required');
    }

    // Content length limits
    if (body.message_text && body.message_text.length > 2000) {
      errors.push('message_text must be 2000 characters or less');
    }
    if (body.lunar_note_text && body.lunar_note_text.length > 500) {
      errors.push('lunar_note_text must be 500 characters or less');
    }

    // An anonymous shareable message carries a written note only — no photo, no
    // lunar note, no recipient (those route through the authenticated flow).
    if (shareable && !user) {
      if (!body.message_text || !body.message_text.trim()) {
        errors.push('message_text is required');
      }
      if (body.photo_url || body.lunar_note_text) {
        errors.push('anonymous links carry a written message only');
      }
    }

    // Recipient validation — skipped for a shareable "send by link" message,
    // which has no recipient yet (each opener binds themselves later).
    if (!shareable) {
      if (!body.recipient_id && !body.recipient_email) {
        errors.push('Either recipient_id or recipient_email is required');
      }
      if (body.recipient_email && !body.recipient_email.includes('@')) {
        errors.push('recipient_email must be a valid email address');
      }
      if (!body.release_at) {
        errors.push('release_at is required');
      }
    }

    // Status validation. A shareable message is always 'in_transit'.
    const validStatuses = ['in_transit', 'released'];
    if (shareable) {
      if (body.status && body.status !== 'in_transit') {
        errors.push('a shareable message must have status in_transit');
      }
    } else if (!validStatuses.includes(body.status)) {
      errors.push('status must be one of: ' + validStatuses.join(', '));
    }

    if (errors.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Validation failed', details: errors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // === RATE LIMITING ===
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const clientIp = getClientIp(req);

    if (user) {
      // Authenticated: max 50 messages/hour per account.
      const { count, error: countError } = await serviceClient
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_id', user.id)
        .gte('created_at', oneHourAgo);
      if (!countError && count !== null && count >= 50) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Maximum 50 messages per hour.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (clientIp) {
      // Anonymous link minting: max 15/hour per IP (abuse backstop — no account
      // gate, so this + the length cap are the guards).
      const { count, error: countError } = await serviceClient
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('creator_ip', clientIp)
        .gte('created_at', oneHourAgo);
      if (!countError && count !== null && count >= 15) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // === INSERT MESSAGE ===
    const senderName = shareable && typeof body.sender_display_name === 'string'
      ? body.sender_display_name.replace(/\s+/g, ' ').trim().slice(0, 40) || null
      : null;

    const insertData: Record<string, unknown> = {
      sender_id: user ? user.id : null,
      // A shareable message is recipient-less; ignore any recipient_* the client
      // may have sent so the link can't be silently bound at send time.
      recipient_name: shareable ? null : (body.recipient_name || null),
      recipient_email: shareable ? null : (body.recipient_email || null),
      recipient_id: shareable ? null : (body.recipient_id || null),
      recipient_city: shareable ? null : (body.recipient_city || null),
      message_text: body.message_text || null,
      lunar_note_text: shareable ? null : (body.lunar_note_text || null),
      lunar_note_closing: shareable ? null : (body.lunar_note_closing || null),
      song_url: shareable ? null : (body.song_url || null),
      song_title: shareable ? null : (body.song_title || null),
      moon_phase: body.moon_phase || null,
      moon_illumination: body.moon_illumination || null,
      photo_url: shareable ? null : (body.photo_url || null),
      status: shareable ? 'in_transit' : body.status,
      pickup_at: shareable ? null : (body.pickup_at || null),
      // No recipient yet → no delivery time yet (each opener gates client-side).
      release_at: shareable ? null : body.release_at,
      released_at: shareable ? null : (body.released_at || null),
      shareable,
      share_token: shareable ? makeShareToken() : null,
      // The link vanishes with the next new moon.
      expires_at: shareable ? nextNewMoon(new Date()).toISOString() : null,
      sender_display_name: senderName,
      creator_ip: (shareable && !user) ? clientIp : null,
    };

    const { data: msgData, error: insertError } = await serviceClient
      .from('messages')
      .insert(insertData)
      .select('id, share_token, expires_at, shareable, moon_phase, moon_illumination')
      .single();

    if (insertError) {
      console.error('Message insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to send message', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Message ${msgData.id} created (${shareable ? 'link:' + msgData.share_token : 'to ' + (body.recipient_id || body.recipient_email)})${user ? '' : ' [anon]'}`);

    return new Response(
      JSON.stringify({ success: true, message: msgData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Send message error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
