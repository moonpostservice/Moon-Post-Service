// supabase/functions/send-roulette-message/index.ts
// Creates a Moon Roulette message with a system-picked anonymous recipient.
// Picks recipient via weighted random selection, computes moonrise at their location,
// inserts the row, and returns enough for the client to show a confirmation.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import SunCalc from "https://esm.sh/suncalc@1.9.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Rate limiter: 10 roulette messages per minute per user ---
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(userId) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  rateLimitMap.set(userId, timestamps);
  if (timestamps.length >= RATE_LIMIT_MAX) return true;
  timestamps.push(now);
  return false;
}

// --- Moon phase name from SunCalc illumination fraction (0–1) ---
function moonPhaseName(phase: number): string {
  if (phase < 0.0625) return "New Moon";
  if (phase < 0.1875) return "Waxing Crescent";
  if (phase < 0.3125) return "First Quarter";
  if (phase < 0.4375) return "Waxing Gibbous";
  if (phase < 0.5625) return "Full Moon";
  if (phase < 0.6875) return "Waning Gibbous";
  if (phase < 0.8125) return "Last Quarter";
  if (phase < 0.9375) return "Waning Crescent";
  return "New Moon";
}

// --- Next moonrise at given coordinates ---
// Checks today then tomorrow. Returns null if the moon doesn't rise in 48h (polar edge case).
function nextMoonrise(lat: number, lng: number): Date | null {
  const now = new Date();

  const todayTimes = SunCalc.getMoonTimes(now, lat, lng);
  if (todayTimes.rise && todayTimes.rise > now) return todayTimes.rise;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowTimes = SunCalc.getMoonTimes(tomorrow, lat, lng);
  if (tomorrowTimes.rise) return tomorrowTimes.rise;

  return null;
}

// --- Weighted random selection from candidate pool ---
interface Candidate {
  id: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  last_sign_in_at: string | null;
}

function weightedPick(candidates: Candidate[]): Candidate {
  const now = Date.now();
  const DAY_MS = 86_400_000;

  const weighted = candidates.map((c) => {
    const lastSeen = c.last_sign_in_at ? Date.parse(c.last_sign_in_at) : 0;
    const daysSince = (now - lastSeen) / DAY_MS;
    const weight = daysSince <= 30 ? 1.0 : daysSince <= 90 ? 0.5 : 0.2;
    return { candidate: c, weight };
  });

  const total = weighted.reduce((sum, w) => sum + w.weight, 0);
  let rand = Math.random() * total;

  for (const { candidate, weight } of weighted) {
    rand -= weight;
    if (rand <= 0) return candidate;
  }

  // Fallback (floating-point edge case)
  return weighted[weighted.length - 1].candidate;
}

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

    if (!body.message_text && !body.photo_url) {
      return new Response(
        JSON.stringify({ error: "Missing field: message_text or photo_url" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // parent_id is present when this is a re-launch of a returned message
    const parentId = typeof body.parent_id === "string" ? body.parent_id : null;

    // --- 3. Rate limit ---
    if (isRateLimited(user.id)) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // --- 4. Fetch sender's city (stored on their profile) ---
    const { data: senderProfile, error: senderErr } = await serviceClient
      .from("profiles")
      .select("city")
      .eq("id", user.id)
      .single();

    if (senderErr || !senderProfile?.city) {
      return new Response(
        JSON.stringify({ error: "Sender profile incomplete" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 5. Build eligible recipient pool ---
    // Step 5a: All opted-in users (excluding sender)
    const { data: allCandidates, error: candidatesErr } = await serviceClient
      .from("profiles")
      .select("id, city, latitude, longitude, last_sign_in_at")
      .eq("receive_moon_roulette", true)
      .neq("id", user.id);

    if (candidatesErr || !allCandidates?.length) {
      return new Response(
        JSON.stringify({ error: "No eligible recipients available" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 5b: Collect IDs to exclude
    const [alreadySentRes, blockedBySenderRes, blockedSenderRes] = await Promise.all([
      // Anyone sender has ever sent a roulette message to
      serviceClient
        .from("moon_roulette_messages")
        .select("recipient_id")
        .eq("sender_id", user.id),
      // Anyone the sender has blocked
      serviceClient
        .from("blocked_users")
        .select("blocked_id")
        .eq("blocker_id", user.id),
      // Anyone who has blocked the sender
      serviceClient
        .from("blocked_users")
        .select("blocker_id")
        .eq("blocked_id", user.id),
    ]);

    const excludedIds = new Set<string>([
      ...(alreadySentRes.data ?? []).map((r: { recipient_id: string }) => r.recipient_id),
      ...(blockedBySenderRes.data ?? []).map((r: { blocked_id: string }) => r.blocked_id),
      ...(blockedSenderRes.data ?? []).map((r: { blocker_id: string }) => r.blocker_id),
    ]);

    const eligibleCandidates = (allCandidates as Candidate[]).filter(
      (c) => !excludedIds.has(c.id)
    );

    if (eligibleCandidates.length === 0) {
      return new Response(
        JSON.stringify({
          error: "no_eligible_recipients",
          message: "No new recipients available right now. Try again after the next moon.",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 6. Weighted random pick ---
    const recipient = weightedPick(eligibleCandidates);

    // --- 7. Calculate moonrise at recipient's location ---
    let releaseAt: string | null = null;
    let moonPhase: string | null = null;
    let moonIllumination: number | null = null;

    if (recipient.latitude != null && recipient.longitude != null) {
      const moonrise = nextMoonrise(recipient.latitude, recipient.longitude);
      if (moonrise) releaseAt = moonrise.toISOString();

      const illum = SunCalc.getMoonIllumination(new Date());
      moonPhase = moonPhaseName(illum.phase);
      moonIllumination = Math.round(illum.fraction * 100) / 100;
    }
    // If no coordinates: releaseAt stays null → pg_cron skips it → message sits as 'queued'
    // until coordinates are backfilled. For MVP this is acceptable.

    // --- 8. Determine send_attempt (re-launch increments the chain) ---
    let sendAttempt = 1;
    if (parentId) {
      const { data: parent } = await serviceClient
        .from("moon_roulette_messages")
        .select("send_attempt")
        .eq("id", parentId)
        .single();
      sendAttempt = (parent?.send_attempt ?? 0) + 1;
    }

    // --- 9. Insert roulette message ---
    const { data: rouletteMessage, error: insertErr } = await serviceClient
      .from("moon_roulette_messages")
      .insert({
        sender_id: user.id,
        recipient_id: recipient.id,
        sender_city: senderProfile.city,
        recipient_city: recipient.city,
        message_text: body.message_text ?? null,
        photo_url: body.photo_url ?? null,
        song_url: body.song_url ?? null,
        song_title: body.song_title ?? null,
        status: "queued",
        release_at: releaseAt,
        moon_phase: moonPhase,
        moon_illumination: moonIllumination,
        parent_id: parentId,
        send_attempt: sendAttempt,
      })
      .select("id, status, release_at, moon_phase")
      .single();

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 10. If this is a re-launch, mark the parent as re-launched ---
    if (parentId) {
      await serviceClient
        .from("moon_roulette_messages")
        .update({ status: "re-launched" })
        .eq("id", parentId)
        .eq("sender_id", user.id); // Safety: only the original sender can re-launch
    }

    return new Response(
      JSON.stringify({ message: rouletteMessage }),
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
