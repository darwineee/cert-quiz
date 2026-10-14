import { supabase, requireAuth } from './supabase-client.js';

async function init() {
  await requireAuth();
  
  const urlParams = new URLSearchParams(window.location.search);
  const attemptId = urlParams.get('attempt');
  if (!attemptId) {
    window.location.href = '/dashboard.html';
    return;
  }

  const { data: attempt } = await supabase.from('exam_attempts')
    .select('*, exams(name, question_count, pass_percent)')
    .eq('id', attemptId).single();
  
  if (!attempt) return alert("Attempt not found");

  document.getElementById('exam-name').textContent = attempt.exams.name;
  
  const score = attempt.score || 0;
  const total = attempt.exams.question_count;
  const percent = Math.round((score / total) * 100);
  const passed = percent >= attempt.exams.pass_percent;

  document.getElementById('score-num').textContent = score;
  document.getElementById('total-num').textContent = total;
  document.getElementById('percentage').textContent = `${percent}% (Pass mark: ${attempt.exams.pass_percent}%)`;

  const badge = document.getElementById('badge');
  if (passed) {
    badge.textContent = "✅ PASSED";
    badge.style.backgroundColor = "var(--correct-bg)";
    badge.style.color = "var(--correct)";
    badge.style.border = "1px solid var(--correct)";
  } else {
    badge.textContent = "❌ FAILED";
    badge.style.backgroundColor = "var(--incorrect-bg)";
    badge.style.color = "var(--incorrect)";
    badge.style.border = "1px solid var(--incorrect)";
  }

  document.getElementById('review-btn').addEventListener('click', () => {
    window.location.href = `/exam.html?attempt=${attemptId}&review=true`;
  });

  document.getElementById('dash-btn').addEventListener('click', () => {
    window.location.href = '/dashboard.html';
  });
}

init();

