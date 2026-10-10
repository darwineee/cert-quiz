import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Compare two string arrays for equality (order-insensitive). */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, i) => val === sortedB[i]);
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

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
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
    const { attempt_id, answers, time_remaining } = await req.json();

    if (!attempt_id) {
      return new Response(
        JSON.stringify({ error: "attempt_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Fetch the attempt (verify ownership & in_progress) ---
    const { data: attempt, error: attemptErr } = await adminClient
      .from("exam_attempts")
      .select("exam_id")
      .eq("id", attempt_id)
      .eq("user_id", user.id)
      .eq("status", "in_progress")
      .single();

    if (attemptErr || !attempt) {
      return new Response(
        JSON.stringify({ error: "Attempt not found or already completed" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Fetch all questions for the exam ---
    const { data: questions, error: qErr } = await adminClient
      .from("questions")
      .select("id, correct")
      .eq("exam_id", attempt.exam_id);

    if (qErr) throw qErr;

    // --- Calculate score ---
    const total = questions?.length ?? 0;
    let score = 0;

    for (const q of questions ?? []) {
      const userAnswer: string[] = answers?.[q.id] ?? [];
      if (arraysEqual(userAnswer, q.correct)) {
        score++;
      }
    }

    // --- Fetch pass_percent from exam ---
    const { data: exam, error: examErr } = await adminClient
      .from("exams")
      .select("pass_percent")
      .eq("id", attempt.exam_id)
      .single();

    if (examErr || !exam) throw examErr ?? new Error("Exam not found");

    const completedAt = new Date().toISOString();

    // --- Update attempt ---
    const { error: updateErr } = await adminClient
      .from("exam_attempts")
      .update({
        status: "completed",
        score,
        answers,
        time_remaining,
        completed_at: completedAt,
      })
      .eq("id", attempt_id)
      .eq("user_id", user.id);

    if (updateErr) throw updateErr;

    const passPercent = exam.pass_percent;
    const passed = total > 0 ? (score / total) * 100 >= passPercent : false;

    return new Response(
      JSON.stringify({
        score,
        total,
        pass_percent: passPercent,
        passed,
        completed_at: completedAt,
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
