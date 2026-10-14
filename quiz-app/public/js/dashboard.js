import { supabase, requireAuth } from './supabase-client.js';

let currentUser = null;
let selectedExamId = null;

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  document.getElementById('user-email').textContent = currentUser.email;
  // document.getElementById('welcome-name').textContent = currentUser.email ? `, ${currentUser.email.split('@')[0]}` : '';
  
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/index.html';
  });

  await Promise.all([loadInProgress(), loadHistory(), loadAllExams()]);
  
  // Modal listeners
  document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('pre-exam-modal').classList.add('hidden');
  });
  
  document.getElementById('modal-start').addEventListener('click', startExam);
}

async function loadHistory() {
  const { data, error } = await supabase
    .from('exam_attempts')
    .select('id, score, completed_at, exams(name, question_count, pass_percent, exam_sets(name, certifications(code)))')
    .eq('user_id', currentUser.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(50);

  if (data && data.length > 0) {
    updateStats(data);
    const sec = document.getElementById('history-section');
    const list = document.getElementById('history-list');
    sec.classList.remove('hidden');
    document.getElementById('history-count').textContent = `${data.length} completed`;
    list.innerHTML = `<div class="history-table" role="table">
      <div class="history-row history-header" role="row"><span>Exam</span><span>Score</span><span>Result</span><span>Completed</span><span></span></div>
      ${data.map(renderHistoryRow).join('')}
    </div>`;

    document.querySelectorAll('.history-card').forEach(el => {
      el.addEventListener('click', () => {
        window.location.href = `/results.html?attempt=${el.dataset.id}`;
      });
    });
  }
}

function updateStats(attempts) {
  const percentages = attempts.map(att => Math.round((att.score / att.exams.question_count) * 100));
  document.getElementById('stat-completed').textContent = attempts.length;
  document.getElementById('stat-average').textContent = `${Math.round(percentages.reduce((sum, score) => sum + score, 0) / percentages.length)}%`;
  document.getElementById('stat-best').textContent = `${Math.max(...percentages)}%`;
}

function renderHistoryRow(att) {
  const percent = Math.round((att.score / att.exams.question_count) * 100);
  const passed = percent >= att.exams.pass_percent;
  const code = att.exams.exam_sets?.certifications?.code || '';
  return `<div class="history-row history-card" data-id="${att.id}" role="row">
    <div class="history-exam"><span class="cert-badge">${code}</span><strong>${att.exams.name}</strong></div>
    <span class="history-score">${att.score}/${att.exams.question_count} <small>${percent}%</small></span>
    <span class="result-pill ${passed ? 'passed' : 'failed'}">${passed ? 'Passed' : 'Needs review'}</span>
    <span class="history-date">${new Date(att.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
    <a class="review-link" href="/results.html?attempt=${att.id}">Review <span aria-hidden="true">→</span></a>
  </div>`;
}

async function loadInProgress() {
  const { data, error } = await supabase
    .from('exam_attempts')
    .select('id, current_index, time_remaining, exams(name, question_count, exam_sets(name))')
    .eq('user_id', currentUser.id)
    .eq('status', 'in_progress')
    .order('updated_at', { ascending: false });

  if (data && data.length > 0) {
    const sec = document.getElementById('resume-section');
    const list = document.getElementById('resume-list');
    sec.classList.remove('hidden');
    
    list.innerHTML = data.map(att => `
      <div class="card clickable resume-card" data-id="${att.id}">
        <div class="resume-source">${att.exams.exam_sets.name}</div>
        <h4>${att.exams.name}</h4>
        <div class="resume-meta">
          Progress: ${att.current_index + 1} / ${att.exams.question_count} answered
          ${att.time_remaining ? ` | Time left: ${Math.floor(att.time_remaining/60)}m ${att.time_remaining%60}s` : ''}
        </div>
      </div>
    `).join('');

    document.querySelectorAll('.resume-card').forEach(el => {
      el.addEventListener('click', () => {
        window.location.href = `/exam.html?attempt=${el.dataset.id}`;
      });
    });
  }
}

async function loadAllExams() {
  const list = document.getElementById('all-exams-list');
  const { data, error } = await supabase
    .from('exam_sets')
    .select('id, name, sort_order, certification_id, certifications(name, code), exams(id, name, question_count, time_limit_min, pass_percent, sort_order)')
    .order('sort_order')
    .order('sort_order', { foreignTable: 'exams' });
  
  if (error) {
    list.innerHTML = 'Error loading exams.';
    return;
  }

  if (data) {
    list.innerHTML = data.map(set => `
      <div class="exam-group">
      <div class="exam-group-heading"><div><span class="cert-badge">${set.certifications?.code || set.certification_id.toUpperCase()}</span><h3>${set.name}</h3></div><span class="section-meta">${set.exams.length} tests</span></div>
      <div class="exam-grid">
          ${set.exams.map(exam => `
            <div class="exam-card">
              <h4>${exam.name}</h4>
              <div class="exam-meta">
                ${exam.question_count} Qs | ${exam.time_limit_min} min | Pass: ${exam.pass_percent}%
              </div>
              <button class="start-btn" data-id="${exam.id}" data-name="${exam.name}">Start</button>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    document.querySelectorAll('.start-btn').forEach(el => {
      el.addEventListener('click', () => {
        selectedExamId = el.dataset.id;
        document.getElementById('modal-exam-name').textContent = `Start ${el.dataset.name}`;
        document.getElementById('pre-exam-modal').classList.remove('hidden');
      });
    });
  }
}

async function startExam() {
  const btn = document.getElementById('modal-start');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  const shuffle = document.getElementById('modal-shuffle').checked;
  const timer = document.getElementById('modal-timer').checked;

  const { data, error } = await supabase.functions.invoke('start-exam', {
    body: { exam_id: selectedExamId, shuffle, timer }
  });

  if (error || !data) {
    alert('Error starting exam: ' + (error?.message || 'Unknown error'));
    btn.disabled = false;
    btn.textContent = 'Start Exam';
    return;
  }

  window.location.href = `/exam.html?attempt=${data.attempt_id}`;
}

init();
