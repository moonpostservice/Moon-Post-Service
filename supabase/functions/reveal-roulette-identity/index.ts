// supabase/functions/reveal-roulette-identity/index.ts
// Either party (sender or recipient) calls this to register their reveal intent.
// Inserts a row into moon_roulette_reveals for the calling user.
// The DB trigger (check_mutual_reveal) handles flipping status to 'revealed'
// when both parties have registered — this function does not need to check that.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // --- 1. Validate JWT ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 2. Parse payload ---
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.message_id || typeof body.message_id !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing field: message_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // --- 3. Verify the user participates in this message ---
    const { data: message, error: fetchErr } = await serviceClient
      .from("moon_roulette_messages")
      .select("id, sender_id, recipient_id, status")
      .eq("id", body.message_id)
      .single();

    if (fetchErr || !message) {
      return new Response(
        JSON.stringify({ error: "Message not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isParticipant = message.sender_id === user.id || message.recipient_id === user.id;
    if (!isParticipant) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reveal only makes sense on delivered or already-revealed messages
    if (message.status !== "delivered" && message.status !== "revealed") {
      return new Response(
        JSON.stringify({ error: "Message is not in a revealable state" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 4. Insert reveal row (idempotent via ON CONFLICT DO NOTHING) ---
    const { error: insertErr } = await serviceClient
      .from("moon_roulette_reveals")
      .insert({ roulette_message_id: body.message_id, user_id: user.id })
      .select()
      // The UNIQUE constraint (roulette_message_id, user_id) prevents duplicates.
      // We use upsert with ignoreDuplicates so a double-tap is a no-op, not an error.
      ;

    // Swallow unique-constraint violations — idempotent by design
    if (insertErr && !insertErr.message.includes("unique")) {
      console.error("Reveal insert error:", insertErr);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 5. Check current reveal state to inform the client ---
    // The DB trigger (check_mutual_reveal) already flipped status if both revealed.
    // Re-fetch to return the current status so the client can update UI immediately.
    const { data: updatedMessage } = await serviceClient
      .from("moon_roulette_messages")
      .select("status")
      .eq("id", body.message_id)
      .single();

    const mutualRevealComplete = updatedMessage?.status === "revealed";

    return new Response(
      JSON.stringify({
        success: true,
        reveal_registered: true,
        mutual_reveal_complete: mutualRevealComplete,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
