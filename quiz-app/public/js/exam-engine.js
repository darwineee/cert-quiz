import { supabase, requireAuth } from './supabase-client.js';

let attemptData = null;
let questions = [];
let isReview = false;
let lastSelectionRange = null;

const state = {
  attemptId: null,
  currentIndex: 0,
  answers: {},     // { qId: ["A", "C"] }
  revealed: new Set(),
  highlights: {},  // { qId: { stem: string, options: { [optKey]: string } } }
  timeRemaining: null,
  timerInterval: null
};

async function init() {
  await requireAuth();
  const urlParams = new URLSearchParams(window.location.search);
  state.attemptId = urlParams.get('attempt');
  isReview = urlParams.get('review') === 'true';

  if (!state.attemptId) {
    window.location.href = '/dashboard.html';
    return;
  }

  try {
    const savedHl = localStorage.getItem('hl_' + state.attemptId);
    state.highlights = savedHl ? JSON.parse(savedHl) : {};
  } catch (e) {
    state.highlights = {};
  }

  // Load Attempt
  const { data: attempt } = await supabase.from('exam_attempts')
    .select('*, exams(name, question_count, time_limit_min, pass_percent)')
    .eq('id', state.attemptId).single();
  
  if (!attempt) return alert("Attempt not found");
  attemptData = attempt;

  if (attempt.status === 'completed' && !isReview) {
    window.location.href = `/results.html?attempt=${state.attemptId}`;
    return;
  }

  // Restore state
  state.currentIndex = isReview ? 0 : attempt.current_index;
  state.answers = attempt.answers || {};
  state.revealed = new Set(attempt.revealed || []);
  state.timeRemaining = attempt.time_remaining;

  document.getElementById('exam-title').textContent = attempt.exams.name;
  
  if (isReview) {
    document.getElementById('discard-btn').classList.add('hidden');
    document.getElementById('save-btn').classList.add('hidden');
    document.getElementById('submit-btn').textContent = 'Back to Results';
    document.getElementById('submit-btn').addEventListener('click', () => {
      window.location.href = `/results.html?attempt=${state.attemptId}`;
    });
  } else {
    document.getElementById('discard-btn').addEventListener('click', async () => {
      if (confirm("Are you sure you want to discard this attempt? All progress will be lost.")) {
        document.getElementById('discard-btn').textContent = 'Discarding...';
        try { localStorage.removeItem('hl_' + state.attemptId); } catch (e) {}
        await supabase.from('exam_attempts').delete().eq('id', state.attemptId);
        window.location.href = '/dashboard.html';
      }
    });
    
    document.getElementById('save-btn').addEventListener('click', manualSave);
    document.getElementById('submit-btn').addEventListener('click', completeExam);
    
    // Auto-save every 60 seconds
    setInterval(() => saveProgress(false), 60000);
    
    // Auto-save when navigating away (visibility hidden or page hide)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveProgress(false);
    });
    window.addEventListener('pagehide', () => saveProgress(false));
    
    if (state.timeRemaining !== null) {
      document.getElementById('timer').classList.remove('hidden');
      state.timerInterval = setInterval(tick, 1000);
      updateTimerDisplay();
    }
  }

  // Highlight button
  const hlBtn = document.getElementById('highlight-btn');
  if (hlBtn) {
    hlBtn.addEventListener('mousedown', (e) => e.preventDefault());
    hlBtn.addEventListener('click', toggleHighlight);
  }

  // Track selection for mobile / tap resilience
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const main = document.querySelector('main');
      if (main && (main.contains(range.startContainer) || main.contains(range.endContainer))) {
        lastSelectionRange = range.cloneRange();
      }
    }
  });

  // Load Questions
  const { data: qData } = await supabase.from('questions')
    .select('*')
    .eq('exam_id', attempt.exam_id)
    .order('number');
  
  // Apply shuffle order if it exists
  if (attempt.question_order && attempt.question_order.length > 0) {
    questions = attempt.question_order.map(num => qData.find(q => q.number === num)).filter(Boolean);
  } else {
    questions = qData;
  }

  // Listeners
  document.getElementById('prev-btn').addEventListener('click', () => goTo(state.currentIndex - 1));
  document.getElementById('next-btn').addEventListener('click', () => goTo(state.currentIndex + 1));
  document.getElementById('show-answer-btn').addEventListener('click', () => {
    state.revealed.add(questions[state.currentIndex].id);
    renderQuestion();
    renderNavigator();
  });

  renderNavigator();
  goTo(state.currentIndex);
}

function goTo(index) {
  if (index < 0 || index >= questions.length) return;
  state.currentIndex = index;
  renderQuestion();
  renderNavigator();
}

function renderQuestion() {
  const q = questions[state.currentIndex];
  document.getElementById('q-number').textContent = `Question ${state.currentIndex + 1} of ${questions.length}`;
  document.getElementById('q-section').textContent = q.section || '';
  
  let stemHtml;
  if (state.highlights?.[q.id]?.stem) {
    stemHtml = state.highlights[q.id].stem;
  } else {
    stemHtml = q.stem_html || `<p>${q.stem}</p>`;
    if (q.image_urls && q.image_urls.length > 0) {
      q.image_urls.forEach(url => {
        if (!stemHtml.includes(url)) stemHtml += `<br/><img src="${url}" />`;
      });
    }
  }
  document.getElementById('stem').innerHTML = stemHtml;

  const isRevealed = isReview || state.revealed.has(q.id);
  const userAnswers = state.answers[q.id] || [];
  const isMulti = q.correct.length > 1;

  document.getElementById('options-container').innerHTML = q.options.map(opt => {
    const checked = userAnswers.includes(opt.key) ? 'checked' : '';
    let classes = 'option';
    if (checked) classes += ' selected';
    
    if (isRevealed) {
      const isCorrectOpt = q.correct.includes(opt.key);
      if (isCorrectOpt) {
        classes += ' correct';
      } else if (checked && !isCorrectOpt) {
        classes += ' incorrect';
      }
    }

    const optContent = state.highlights?.[q.id]?.options?.[opt.key] || `<strong>${opt.key}.</strong> ${opt.text}`;

    return `
      <label class="${classes}">
        <input type="${isMulti ? 'checkbox' : 'radio'}" name="q-opt" value="${opt.key}" ${checked} ${isRevealed ? 'disabled' : ''}>
        <div class="opt-content" data-key="${opt.key}">
          ${optContent}
        </div>
      </label>
    `;
  }).join('');

  if (!isRevealed) {
    document.querySelectorAll('input[name="q-opt"]').forEach(input => {
      input.addEventListener('change', (e) => {
        let selected = Array.from(document.querySelectorAll('input[name="q-opt"]:checked')).map(el => el.value);
        state.answers[q.id] = selected;
        renderQuestion();
        renderNavigator();
      });
    });
    document.getElementById('show-answer-btn').classList.remove('hidden');
    document.getElementById('explanation-panel').classList.add('hidden');
  } else {
    document.getElementById('show-answer-btn').classList.add('hidden');
    const expl = document.getElementById('explanation-panel');
    expl.classList.remove('hidden');
    if (state.highlights?.[q.id]?.explanation) {
      expl.innerHTML = state.highlights[q.id].explanation;
    } else {
      expl.innerHTML = `<h4>Correct Answer: ${q.correct.join(', ')}</h4>${q.explanation_html || ''}`;
    }
  }

  document.getElementById('prev-btn').disabled = state.currentIndex === 0;
  document.getElementById('next-btn').disabled = state.currentIndex === questions.length - 1;
}

function toggleHighlight() {
  const q = questions[state.currentIndex];
  if (!q) return;

  const sel = window.getSelection();
  let range = null;

  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    range = sel.getRangeAt(0);
  } else if (lastSelectionRange && !lastSelectionRange.collapsed) {
    range = lastSelectionRange;
  }

  // Check if cursor/selection is inside an existing highlight mark
  let targetMark = null;
  if (sel && sel.anchorNode) {
    const el = sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement;
    if (el) targetMark = el.closest('.exam-highlight');
  }

  // Case 1: Cursor is inside an existing highlight mark directly
  if (targetMark && (!range || range.collapsed || targetMark.contains(range.commonAncestorContainer))) {
    removeHighlightMark(targetMark);
    saveCurrentHighlights(q.id);
    if (sel) sel.removeAllRanges();
    lastSelectionRange = null;
    return;
  }

  if (!range) return;

  const stemEl = document.getElementById('stem');
  const optsEl = document.getElementById('options-container');
  const explEl = document.getElementById('explanation-panel');

  const inStem = stemEl && (stemEl.contains(range.startContainer) || stemEl.contains(range.endContainer));
  const inOpts = optsEl && (optsEl.contains(range.startContainer) || optsEl.contains(range.endContainer));
  const inExpl = explEl && (explEl.contains(range.startContainer) || explEl.contains(range.endContainer));

  if (!inStem && !inOpts && !inExpl) {
    return;
  }

  // Case 2: Range intersects any existing highlights -> UNHIGHLIGHT
  const allMarks = document.querySelectorAll('#stem .exam-highlight, #options-container .exam-highlight, #explanation-panel .exam-highlight');
  const intersectingMarks = [];
  allMarks.forEach(m => {
    try {
      if (range.intersectsNode(m)) {
        intersectingMarks.push(m);
      }
    } catch (e) {}
  });

  if (intersectingMarks.length > 0) {
    intersectingMarks.forEach(m => removeHighlightMark(m));
    saveCurrentHighlights(q.id);
    if (sel) sel.removeAllRanges();
    lastSelectionRange = null;
    return;
  }

  // Case 3: HIGHLIGHT the selected range
  highlightRange(range);
  saveCurrentHighlights(q.id);
  if (sel) sel.removeAllRanges();
  lastSelectionRange = null;
}

function removeHighlightMark(mark) {
  const parent = mark.parentNode;
  if (!parent) return;
  while (mark.firstChild) {
    parent.insertBefore(mark.firstChild, mark);
  }
  parent.removeChild(mark);
  parent.normalize();
}

function highlightRange(range) {
  const textNodes = [];
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer;

  if (!root) return;

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        if (!node.textContent || node.textContent.length === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement && (node.parentElement.tagName === 'INPUT' || node.parentElement.tagName === 'BUTTON')) {
          return NodeFilter.FILTER_REJECT;
        }
        try {
          if (range.intersectsNode(node)) {
            return NodeFilter.FILTER_ACCEPT;
          }
        } catch (e) {}
        return NodeFilter.FILTER_REJECT;
      }
    }
  );

  let curr;
  while ((curr = walker.nextNode())) {
    textNodes.push(curr);
  }

  textNodes.forEach(node => {
    if (node.parentElement && node.parentElement.closest('.exam-highlight')) {
      return;
    }

    const isStart = (node === range.startContainer);
    const isEnd = (node === range.endContainer);

    const startOffset = isStart ? Math.min(range.startOffset, node.length) : 0;
    const endOffset = isEnd ? Math.min(range.endOffset, node.length) : node.length;

    if (startOffset >= endOffset) return;

    const text = node.textContent;
    const before = text.substring(0, startOffset);
    const selected = text.substring(startOffset, endOffset);
    const after = text.substring(endOffset);

    if (!selected) return;

    const mark = document.createElement('mark');
    mark.className = 'exam-highlight';
    mark.textContent = selected;

    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    frag.appendChild(mark);
    if (after) frag.appendChild(document.createTextNode(after));

    if (node.parentNode) {
      node.parentNode.replaceChild(frag, node);
    }
  });
}

function saveCurrentHighlights(qId) {
  if (!state.highlights) state.highlights = {};
  if (!state.highlights[qId]) state.highlights[qId] = {};

  const stemEl = document.getElementById('stem');
  if (stemEl) {
    state.highlights[qId].stem = stemEl.innerHTML;
  }

  const options = {};
  document.querySelectorAll('#options-container .opt-content').forEach(el => {
    const key = el.dataset.key;
    if (key) {
      options[key] = el.innerHTML;
    }
  });
  state.highlights[qId].options = options;

  const explEl = document.getElementById('explanation-panel');
  if (explEl && !explEl.classList.contains('hidden')) {
    state.highlights[qId].explanation = explEl.innerHTML;
  }

  if (state.attemptId) {
    try {
      localStorage.setItem('hl_' + state.attemptId, JSON.stringify(state.highlights));
    } catch (e) {}
  }
}

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, i) => val === sortedB[i]);
}

function renderNavigator() {
  const nav = document.getElementById('navigator');
  nav.innerHTML = questions.map((q, i) => {
    let classes = 'nav-dot';
    
    if (isReview) {
      const isCorrect = arraysEqual(state.answers[q.id] || [], q.correct || []);
      classes += isCorrect ? ' correct' : ' incorrect';
    } else {
      if (state.answers[q.id] && state.answers[q.id].length > 0) classes += ' answered';
      if (state.revealed.has(q.id)) {
        const isCorrect = arraysEqual(state.answers[q.id] || [], q.correct || []);
        classes += isCorrect ? ' correct' : ' incorrect';
      }
    }

    if (state.currentIndex === i) classes += ' current';
    
    return `<div class="${classes}" data-idx="${i}">${i + 1}</div>`;
  }).join('');

  document.querySelectorAll('.nav-dot').forEach(dot => {
    dot.addEventListener('click', (e) => goTo(parseInt(e.target.dataset.idx)));
  });
  
  // Scroll to current
  const currentDot = nav.querySelector('.current');
  if (currentDot) {
    currentDot.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}

function tick() {
  if (state.timeRemaining <= 0) {
    clearInterval(state.timerInterval);
    completeExam();
    return;
  }
  state.timeRemaining--;
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const t = document.getElementById('timer');
  const h = Math.floor(state.timeRemaining / 3600);
  const m = Math.floor((state.timeRemaining % 3600) / 60);
  const s = state.timeRemaining % 60;
  t.textContent = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  
  if (state.timeRemaining < 300) t.classList.add('danger');
  else t.classList.remove('danger');
}

async function saveProgress(showToast = false) {
  if (isReview) return;
  document.getElementById('save-status').textContent = 'Saving...';
  
  await supabase.functions.invoke('save-progress', {
    body: {
      attempt_id: state.attemptId,
      current_index: state.currentIndex,
      answers: state.answers,
      revealed: Array.from(state.revealed),
      time_remaining: state.timeRemaining
    }
  });
  
  document.getElementById('save-status').textContent = 'Saved ' + new Date().toLocaleTimeString();
  
  if (showToast) {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

async function manualSave() {
  await saveProgress(true);
}

async function completeExam() {
  if (isReview) return;
  if (!confirm("Are you sure you want to submit? You cannot change your answers after submitting.")) return;
  
  clearInterval(state.timerInterval);
  document.getElementById('submit-btn').textContent = 'Submitting...';
  document.getElementById('submit-btn').disabled = true;

  // Final save first
  await supabase.functions.invoke('save-progress', {
    body: {
      attempt_id: state.attemptId,
      current_index: state.currentIndex,
      answers: state.answers,
      revealed: Array.from(state.revealed),
      time_remaining: state.timeRemaining
    }
  });

  const { data, error } = await supabase.functions.invoke('complete-exam', {
    body: { attempt_id: state.attemptId, answers: state.answers, time_remaining: state.timeRemaining }
  });

  if (error || !data) {
    alert("Error submitting exam");
    document.getElementById('submit-btn').textContent = 'Submit Exam';
    document.getElementById('submit-btn').disabled = false;
    return;
  }

  window.location.href = `/results.html?attempt=${state.attemptId}`;
}

init();

