import { supabase, requireAuth } from './supabase-client.js';

let currentUser = null;
let selectedExamId = null;

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  document.getElementById('user-email').textContent = currentUser.email;
  
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/index.html';
  });

  loadInProgress();
  loadCertifications();
  
  // Modal listeners
  document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('pre-exam-modal').classList.add('hidden');
  });
  
  document.getElementById('modal-start').addEventListener('click', startExam);
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
        <div style="font-size: 0.9rem; color: var(--salmon);">${att.exams.exam_sets.name}</div>
        <h4>${att.exams.name}</h4>
        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.5rem;">
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

async function loadCertifications() {
  const { data } = await supabase.from('certifications').select('*').eq('is_active', true);
  const list = document.getElementById('cert-list');
  
  if (data && data.length > 0) {
    list.innerHTML = data.map(cert => `
      <div class="card clickable cert-card" data-id="${cert.id}">
        <h2>${cert.code}</h2>
        <p style="color: var(--text-secondary);">${cert.name}</p>
      </div>
    `).join('');

    document.querySelectorAll('.cert-card').forEach(el => {
      el.addEventListener('click', (e) => {
        document.querySelectorAll('.cert-card').forEach(c => c.style.borderColor = 'var(--border)');
        e.currentTarget.style.borderColor = 'var(--salmon)';
        loadExamSets(el.dataset.id);
      });
    });
  }
}

async function loadExamSets(certId) {
  document.getElementById('set-section').classList.remove('hidden');
  document.getElementById('exam-section').classList.add('hidden');
  const list = document.getElementById('set-list');
  list.innerHTML = 'Loading...';

  const { data } = await supabase.from('exam_sets').select('*').eq('certification_id', certId).order('sort_order');
  
  if (data) {
    list.innerHTML = data.map(set => `
      <div class="card clickable set-card" data-id="${set.id}">
        <h3>${set.name}</h3>
        <p style="font-size: 0.9rem; color: var(--text-secondary);">${set.description || 'Practice set'}</p>
      </div>
    `).join('');

    document.querySelectorAll('.set-card').forEach(el => {
      el.addEventListener('click', (e) => {
        document.querySelectorAll('.set-card').forEach(c => c.style.borderColor = 'var(--border)');
        e.currentTarget.style.borderColor = 'var(--salmon)';
        loadExams(el.dataset.id);
      });
    });
  }
}

async function loadExams(setId) {
  document.getElementById('exam-section').classList.remove('hidden');
  const list = document.getElementById('exam-list');
  list.innerHTML = 'Loading...';

  const { data } = await supabase.from('exams').select('*').eq('exam_set_id', setId).order('sort_order');
  
  if (data) {
    list.innerHTML = data.map(exam => `
      <div class="card">
        <h4>${exam.name}</h4>
        <div style="font-size: 0.85rem; color: var(--text-secondary); margin: 0.5rem 0 1rem;">
          ${exam.question_count} Qs | ${exam.time_limit_min} min | Pass: ${exam.pass_percent}%
        </div>
        <button class="start-btn" data-id="${exam.id}" data-name="${exam.name}">Start</button>
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

