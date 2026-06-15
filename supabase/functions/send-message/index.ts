import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MessagePayload {
  sender_id: string;
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
  release_at: string;
  released_at?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get the user's JWT from the Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the user via Supabase auth
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // User client to verify identity
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: MessagePayload = await req.json();

    // === VALIDATION ===
    const errors: string[] = [];

    // Ensure sender_id matches authenticated user
    if (body.sender_id !== user.id) {
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

    // Recipient validation
    if (!body.recipient_id && !body.recipient_email) {
      errors.push('Either recipient_id or recipient_email is required');
    }
    if (body.recipient_email && !body.recipient_email.includes('@')) {
      errors.push('recipient_email must be a valid email address');
    }

    // Status validation
    const validStatuses = ['in_transit', 'released'];
    if (!validStatuses.includes(body.status)) {
      errors.push('status must be one of: ' + validStatuses.join(', '));
    }

    if (errors.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Validation failed', details: errors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // === RATE LIMITING ===
    // Check messages sent in last hour by this user
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
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

    // === INSERT MESSAGE ===
    const insertData = {
      sender_id: user.id,
      recipient_name: body.recipient_name || null,
      recipient_email: body.recipient_email || null,
      recipient_id: body.recipient_id || null,
      recipient_city: body.recipient_city || null,
      message_text: body.message_text || null,
      lunar_note_text: body.lunar_note_text || null,
      lunar_note_closing: body.lunar_note_closing || null,
      song_url: body.song_url || null,
      song_title: body.song_title || null,
      moon_phase: body.moon_phase || null,
      moon_illumination: body.moon_illumination || null,
      photo_url: body.photo_url || null,
      status: body.status,
      pickup_at: body.pickup_at || null,
      release_at: body.release_at,
      released_at: body.released_at || null,
    };

    const { data: msgData, error: insertError } = await serviceClient
      .from('messages')
      .insert(insertData)
      .select()
      .single();

    if (insertError) {
      console.error('Message insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to send message', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Message ${msgData.id} sent from ${user.id} to ${body.recipient_id || body.recipient_email}`);

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
