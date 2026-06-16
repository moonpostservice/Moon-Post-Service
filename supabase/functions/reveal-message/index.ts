import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { id } = body;

    // ===== SHARE-LINK PATH (?g=<token>) =====================================
    // A reusable, recipient-less message. The first open returns the sender +
    // a short teaser (no content); content only crosses the wire once THIS
    // opener's moonrise (their message_link_opens.release_at) has passed, keyed
    // by the opaque open_id the client stored when it claimed.
    if (body.token) {
      const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
      if (typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) {
        return new Response(
          JSON.stringify({ error: 'Invalid link' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

      const { data: msg, error: msgError } = await serviceClient
        .from('messages')
        .select('id, message_text, lunar_note_text, lunar_note_closing, moon_phase, moon_illumination, song_url, song_title, photo_url, pickup_at, sender_id')
        .eq('share_token', body.token)
        .eq('shareable', true)
        .maybeSingle();

      if (msgError || !msg) {
        return new Response(
          JSON.stringify({ error: 'Message not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Resolve this opener's claim (if they've already claimed) to decide seal.
      const nowMs = Date.now();
      let openRelease: string | null = null;
      let sealed = true;
      if (typeof body.open_id === 'string') {
        const { data: open } = await serviceClient
          .from('message_link_opens')
          .select('id, release_at')
          .eq('id', body.open_id)
          .eq('message_id', msg.id)
          .maybeSingle();
        if (open) {
          openRelease = open.release_at;
          sealed = !open.release_at || new Date(open.release_at).getTime() > nowMs;
          if (!sealed) {
            await serviceClient.from('message_link_opens')
              .update({ revealed_at: new Date(nowMs).toISOString() })
              .eq('id', open.id).is('revealed_at', null);
          }
        }
      }

      // Sender's public identity for the "X wrote you a moon message" framing.
      let senderUsername: string | null = null;
      let senderCity: string | null = null;
      if (msg.sender_id) {
        const { data: profile } = await serviceClient
          .from('profiles').select('username, city').eq('id', msg.sender_id).maybeSingle();
        if (profile) { senderUsername = profile.username; senderCity = profile.city; }
      }

      // A short hook shown before reveal (a few words, never the whole note).
      const source = (msg.message_text || msg.lunar_note_text || '').trim();
      const teaser = source ? source.split(/\s+/).slice(0, 8).join(' ') + (source.split(/\s+/).length > 8 ? '…' : '') : '';

      return new Response(
        JSON.stringify({
          shareable: true,
          message: {
            id: msg.id,
            shareable: true,
            teaser,
            moon_phase: msg.moon_phase,
            moon_illumination: msg.moon_illumination,
            pickup_at: msg.pickup_at,
            release_at: openRelease,
            sealed,
            message_text: sealed ? null : msg.message_text,
            lunar_note_text: sealed ? null : msg.lunar_note_text,
            lunar_note_closing: sealed ? null : msg.lunar_note_closing,
            song_url: sealed ? null : msg.song_url,
            song_title: sealed ? null : msg.song_title,
            photo_url: sealed ? null : msg.photo_url,
          },
          sender: { username: senderUsername, city: senderCity },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ===== END SHARE-LINK PATH ==============================================

    if (!id || typeof id !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid message id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate UUID format to prevent injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return new Response(
        JSON.stringify({ error: 'Invalid message id format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch only the fields needed for the reveal page
    const { data: msg, error: msgError } = await serviceClient
      .from('messages')
      .select('id, message_text, lunar_note_text, lunar_note_closing, moon_phase, moon_illumination, status, release_at, recipient_city, song_url, song_title, photo_url, sender_id, created_at')
      .eq('id', id)
      .single();

    if (msgError || !msg) {
      return new Response(
        JSON.stringify({ error: 'Message not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // TRANSIT SEAL — same predicate as the messages_v masking view (migration
    // 043): the reveal link must never ship content before moonrise. Anyone
    // holding the link (including the recipient) could otherwise read the
    // message early; the countdown page only needs metadata + release_at.
    const nowMs = Date.now();
    const within24h = msg.created_at &&
      new Date(msg.created_at).getTime() > nowMs - 24 * 3600_000;
    const sealed = !!within24h && (
      (msg.release_at !== null && new Date(msg.release_at).getTime() > nowMs) ||
      (msg.release_at === null && msg.status === 'in_transit')
    );

    // Fetch sender profile (only public fields)
    let senderUsername = null;
    let senderCity = null;
    if (msg.sender_id) {
      const { data: profile } = await serviceClient
        .from('profiles')
        .select('username, city')
        .eq('id', msg.sender_id)
        .maybeSingle();
      if (profile) {
        senderUsername = profile.username;
        senderCity = profile.city;
      }
    }

    // Return only safe fields - no sender_id, recipient_id, or recipient_email;
    // content fields are NULL while the message is still sealed.
    return new Response(
      JSON.stringify({
        message: {
          id: msg.id,
          message_text: sealed ? null : msg.message_text,
          lunar_note_text: sealed ? null : msg.lunar_note_text,
          lunar_note_closing: sealed ? null : msg.lunar_note_closing,
          moon_phase: msg.moon_phase,
          moon_illumination: msg.moon_illumination,
          status: msg.status,
          release_at: msg.release_at,
          recipient_city: msg.recipient_city,
          song_url: sealed ? null : msg.song_url,
          song_title: sealed ? null : msg.song_title,
          photo_url: sealed ? null : msg.photo_url,
        },
        sender: {
          username: senderUsername,
          city: senderCity,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Reveal message error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
