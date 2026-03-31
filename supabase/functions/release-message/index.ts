// supabase/functions/release-message/index.ts
// Edge Function: Validate JWT, verify requester is the intended recipient, update status via service role key
// Requirements: 12.2, 12.4

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CORS headers ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    // Verify the JWT
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
    let body: { message_ids?: string[] };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.message_ids || !Array.isArray(body.message_ids) || body.message_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing field: message_ids" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 3. Verify requester is the intended recipient for all messages ---
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Fetch the messages to verify ownership
    const { data: messages, error: fetchError } = await serviceClient
      .from("messages")
      .select("id, recipient_id, recipient_email, status")
      .in("id", body.message_ids);

    if (fetchError) {
      console.error("Fetch error:", fetchError);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "No messages found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check that the requester is the recipient of every message
    const userEmail = user.email ?? "";
    const unauthorizedIds: string[] = [];
    for (const msg of messages) {
      const isRecipientById = msg.recipient_id === user.id;
      const isRecipientByEmail = msg.recipient_email === userEmail;
      if (!isRecipientById && !isRecipientByEmail) {
        unauthorizedIds.push(msg.id);
      }
    }

    if (unauthorizedIds.length > 0) {
      return new Response(
        JSON.stringify({ error: "Not authorized to release" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 4. Update status to 'released' via service role key ---
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await serviceClient
      .from("messages")
      .update({ status: "released", released_at: now, release_at: now })
      .in("id", body.message_ids)
      .eq("status", "in_transit")
      .select("id");

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ updated: updated?.length ?? 0 }),
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
