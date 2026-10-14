import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Deterministic Fisher-Yates shuffle using a seeded PRNG. */
function seededShuffle(arr: number[], seed: number): number[] {
  const result = [...arr];
  let s = seed;
  const next = () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const jwt = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Admin client for DB operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // User-scoped client to resolve the user identity
    const userClient = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Body ---
    const { exam_id, shuffle, timer } = await req.json();
    if (!exam_id) {
      return new Response(
        JSON.stringify({ error: "exam_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Check for existing in-progress attempt ---
    const { data: existing, error: existErr } = await adminClient
      .from("exam_attempts")
      .select("id, question_order, time_remaining")
      .eq("user_id", user.id)
      .eq("exam_id", exam_id)
      .eq("status", "in_progress")
      .maybeSingle();

    if (existErr) throw existErr;

    if (existing) {
      return new Response(
        JSON.stringify({
          attempt_id: existing.id,
          question_order: existing.question_order,
          time_remaining: existing.time_remaining,
          resumed: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Fetch exam metadata ---
    const { data: exam, error: examErr } = await adminClient
      .from("exams")
      .select("question_count, time_limit_min")
      .eq("id", exam_id)
      .single();

    if (examErr || !exam) {
      return new Response(
        JSON.stringify({ error: "Exam not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Build question order ---
    const baseOrder = Array.from({ length: exam.question_count }, (_, i) => i + 1);
    let shuffleSeed: number | null = null;
    let questionOrder: number[];

    if (shuffle) {
      shuffleSeed = Math.floor(Math.random() * 2147483647);
      questionOrder = seededShuffle(baseOrder, shuffleSeed);
    } else {
      questionOrder = baseOrder;
    }

    const timeRemaining = timer ? exam.time_limit_min * 60 : null;

    // --- Insert attempt ---
    const { data: attempt, error: insertErr } = await adminClient
      .from("exam_attempts")
      .insert({
        user_id: user.id,
        exam_id,
        shuffle_seed: shuffleSeed,
        timer_enabled: !!timer,
        question_order: questionOrder,
        time_remaining: timeRemaining,
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({
        attempt_id: attempt.id,
        question_order: questionOrder,
        time_remaining: timeRemaining,
        resumed: false,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
