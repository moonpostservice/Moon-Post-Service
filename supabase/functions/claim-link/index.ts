import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// A shareable moon message is opened by a person via its secret link. This
// records THAT opener's location + their own moonrise (release_at, stamped
// client-side from SunCalc — same trust posture as the send path) in
// message_link_opens, and returns the content ONLY if their moonrise has
// already passed. The link is reusable: each opener gets their own row, so the
// same message can reach many people, each revealing at their own moon.
//
// Anonymous by design — no auth required to open a link. recipient_id stays
// null until the opener signs up to reply (Phase 3).

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_RELEASE_AHEAD_MS = 8 * 24 * 3600_000; // a full two-hop cycle, capped
const MAX_OPENS_PER_MESSAGE = 5000;             // soft abuse backstop

function clampRelease(releaseRaw: unknown, nowMs: number): number {
  let ms = nowMs;
  if (typeof releaseRaw === 'string') {
    const parsed = Date.parse(releaseRaw);
    if (!Number.isNaN(parsed)) ms = parsed;
  }
  if (ms < nowMs) ms = nowMs;                       // never reveal "in the past"
  if (ms > nowMs + MAX_RELEASE_AHEAD_MS) ms = nowMs + MAX_RELEASE_AHEAD_MS;
  return ms;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const token = body.token;
    if (!token || typeof token !== 'string' || !TOKEN_RE.test(token)) {
      return new Response(
        JSON.stringify({ error: 'Invalid link' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve the shareable message by its secret token.
    const { data: msg, error: msgError } = await serviceClient
      .from('messages')
      .select('id, message_text, lunar_note_text, lunar_note_closing, moon_phase, moon_illumination, song_url, song_title, photo_url, pickup_at')
      .eq('share_token', token)
      .eq('shareable', true)
      .maybeSingle();

    if (msgError || !msg) {
      return new Response(
        JSON.stringify({ error: 'Message not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const nowMs = Date.now();
    const releaseMs = clampRelease(body.release_at, nowMs);
    const releaseIso = new Date(releaseMs).toISOString();
    const sealed = releaseMs > nowMs;

    const city = typeof body.recipient_city === 'string' ? body.recipient_city.slice(0, 120) : null;
    const lat = typeof body.recipient_lat === 'number' ? body.recipient_lat : null;
    const lon = typeof body.recipient_lon === 'number' ? body.recipient_lon : null;
    const tz = typeof body.recipient_tz === 'string' ? body.recipient_tz.slice(0, 64) : null;
    // "Remind me at moonrise" opt-in — set only when provided so re-confirming a
    // city never clears an existing reminder.
    const reminderEmail = (typeof body.reminder_email === 'string' && body.reminder_email.includes('@'))
      ? body.reminder_email.trim().slice(0, 200) : null;

    // Re-confirm an existing open (same browser revisiting / correcting city), or
    // create a fresh one. open_id is an opaque uuid the client stores locally.
    let openId: string | null = typeof body.open_id === 'string' ? body.open_id : null;

    if (openId) {
      const updateFields: Record<string, unknown> = {
        recipient_city: city,
        recipient_lat: lat,
        recipient_lon: lon,
        recipient_tz: tz,
        release_at: releaseIso,
        revealed_at: sealed ? null : new Date(nowMs).toISOString(),
      };
      if (reminderEmail) updateFields.reminder_email = reminderEmail;
      const { data: updated, error: upErr } = await serviceClient
        .from('message_link_opens')
        .update(updateFields)
        .eq('id', openId)
        .eq('message_id', msg.id)
        .select('id')
        .maybeSingle();
      if (upErr || !updated) openId = null; // stale/foreign open_id → fall through to insert
    }

    if (!openId) {
      // Soft abuse cap on a single link.
      const { count } = await serviceClient
        .from('message_link_opens')
        .select('id', { count: 'exact', head: true })
        .eq('message_id', msg.id);
      if (count !== null && count >= MAX_OPENS_PER_MESSAGE) {
        return new Response(
          JSON.stringify({ error: 'This link has reached its limit' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: inserted, error: insErr } = await serviceClient
        .from('message_link_opens')
        .insert({
          message_id: msg.id,
          recipient_city: city,
          recipient_lat: lat,
          recipient_lon: lon,
          recipient_tz: tz,
          release_at: releaseIso,
          revealed_at: sealed ? null : new Date(nowMs).toISOString(),
          reminder_email: reminderEmail,
        })
        .select('id')
        .single();
      if (insErr || !inserted) {
        return new Response(
          JSON.stringify({ error: 'Could not open the message' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      openId = inserted.id;
    }

    // Content only crosses the wire once this opener's moonrise has passed.
    const content = sealed ? {
      message_text: null, lunar_note_text: null, lunar_note_closing: null,
      song_url: null, song_title: null, photo_url: null,
    } : {
      message_text: msg.message_text,
      lunar_note_text: msg.lunar_note_text,
      lunar_note_closing: msg.lunar_note_closing,
      song_url: msg.song_url,
      song_title: msg.song_title,
      photo_url: msg.photo_url,
    };

    return new Response(
      JSON.stringify({
        open_id: openId,
        sealed,
        release_at: releaseIso,
        message: { moon_phase: msg.moon_phase, moon_illumination: msg.moon_illumination, ...content },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('claim-link error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
