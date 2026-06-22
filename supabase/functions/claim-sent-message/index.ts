import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// "Witness the arrival" — the SENDER claims a note they cast anonymously.
//
// A logged-out visitor casts a shareable moon note from the landing hero: the
// message row is born with sender_id = NULL (send-message, anonymous shareable
// path). The share sheet then offers "Save it to your sky →", which is the
// signup. After the new account exists, the client calls this function with the
// note's secret share_token; we bind that orphan note to the now-authenticated
// user so they can watch it land (message_link_opens + the sender-reads-opens
// RLS policy from migration 049 do the rest).
//
// Auth IS required — only a real, just-signed-up user can claim. The bind only
// succeeds while sender_id IS NULL, so a note can never be stolen from another
// account; re-claiming your own note is idempotent. verify_jwt is left off so we
// can return clean JSON on a missing token; we enforce auth in-body instead.

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const token = body.token;
    if (!token || typeof token !== 'string' || !TOKEN_RE.test(token)) {
      return new Response(
        JSON.stringify({ error: 'Invalid link' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Resolve the caller from their JWT — claiming is for a real account only.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const service = createClient(supabaseUrl, serviceKey);

    // Bind the orphan note to this user. The sender_id IS NULL guard makes this
    // safe (can't claim a note already owned by someone) and atomic.
    const { data: claimed, error: claimErr } = await service
      .from('messages')
      .update({ sender_id: user.id })
      .eq('share_token', token)
      .eq('shareable', true)
      .is('sender_id', null)
      .select('id')
      .maybeSingle();

    if (claimErr) {
      console.error('claim-sent-message update error:', claimErr);
      return new Response(
        JSON.stringify({ error: 'Could not save the note' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (claimed) {
      return new Response(
        JSON.stringify({ ok: true, message_id: claimed.id, claimed: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Nothing bound — either the token is unknown, or the note is already owned.
    // If it's already owned BY THIS USER, treat as success (idempotent re-claim,
    // e.g. a retried network call). Otherwise it's gone/taken — don't leak which.
    const { data: existing } = await service
      .from('messages')
      .select('id, sender_id')
      .eq('share_token', token)
      .eq('shareable', true)
      .maybeSingle();

    if (existing && existing.sender_id === user.id) {
      return new Response(
        JSON.stringify({ ok: true, message_id: existing.id, claimed: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: 'not_claimable' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('claim-sent-message error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
