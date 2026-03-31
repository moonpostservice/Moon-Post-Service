// supabase/functions/send-message/index.ts
// Edge Function: Validate JWT, enforce sender_id = auth.uid(), validate payload, rate limit, insert via service role key
// Requirements: 12.1, 12.4

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CORS headers ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- In-memory rate limiter: 10 messages per minute per user ---
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(userId) ?? [];
  // Remove entries outside the window
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  rateLimitMap.set(userId, recent);
  if (recent.length >= RATE_LIMIT_MAX) {
    return true;
  }
  recent.push(now);
  return false;
}

// --- Required fields for a valid message payload ---
const REQUIRED_FIELDS = ["recipient_email", "sender_city", "recipient_city", "status"] as const;

function validatePayload(body: Record<string, unknown>): string | null {
  for (const field of REQUIRED_FIELDS) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return field;
    }
  }
  // Must have at least text or photo_url
  if (!body.text && !body.message_text && !body.photo_url) {
    return "text or photo_url";
  }
  // status must be valid
  if (body.status !== "in_transit" && body.status !== "released") {
    return "status (must be 'in_transit' or 'released')";
  }
  return null;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
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
    // --- 1. Extract and validate JWT ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the JWT by creating an anon client and calling auth.getUser
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 2. Parse and validate payload ---
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const missingField = validatePayload(body);
    if (missingField) {
      return new Response(
        JSON.stringify({ error: `Missing field: ${missingField}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 3. Enforce sender_id = auth.uid() ---
    // Override sender_id with the authenticated user's id regardless of what was sent
    body.sender_id = user.id;

    // --- 4. Rate limit ---
    if (isRateLimited(user.id)) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 5. Insert via service role key (bypasses RLS) ---
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Build the insert row from the validated payload
    const insertData: Record<string, unknown> = {
      sender_id: user.id,
      recipient_email: body.recipient_email,
      recipient_id: body.recipient_id ?? null,
      recipient_name: body.recipient_name ?? null,
      recipient_city: body.recipient_city,
      sender_city: body.sender_city,
      message_text: body.message_text ?? body.text ?? null,
      photo_url: body.photo_url ?? null,
      status: body.status,
      release_at: body.release_at ?? null,
      released_at: body.released_at ?? null,
      moon_phase: body.moon_phase ?? null,
      moon_illumination: body.moon_illumination ?? null,
      lunar_note_text: body.lunar_note_text ?? null,
      lunar_note_closing: body.lunar_note_closing ?? null,
      song_url: body.song_url ?? null,
      song_title: body.song_title ?? null,
    };

    const { data: message, error: insertError } = await serviceClient
      .from("messages")
      .insert(insertData)
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ message }),
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
