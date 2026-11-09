/* CSWA Practice Tester — exam client logic. Data comes from data/exams.js (window.CSWA_DATA). */
(function () {
  'use strict';
  const DATA = window.CSWA_DATA;
  const SECTIONS = DATA.sections;
  const SHORT = { draft: 'Drafting', basic: 'Basic Part', inter: 'Intermediate Part', adv: 'Advanced Part', asm: 'Assembly' };
  const KEY = 'cswa-practice-v1';
  const $ = (id) => document.getElementById(id);
  const examById = (id) => DATA.exams.find((e) => e.id === id);

  // ---------- storage (optional; the app works without it) ----------
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  let store = Object.assign({ name: '', history: [], current: null }, load());
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* private mode etc. */ }
  }

  // ---------- helpers ----------
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  }
  const fmtTime = (s) => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
  };
  const fmtDate = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    window.scrollTo(0, 0);
  }
  function parseNum(str) {
    if (str == null) return null;
    const t = String(str).trim().replace(',', '.');
    if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(t)) return null;
    return parseFloat(t);
  }
  function isAnswered(q, a) {
    if (a == null || a === '') return false;
    return q.type === 'mc' ? Number.isInteger(a) : true;
  }
  function isCorrect(q, a) {
    if (!isAnswered(q, a)) return false;
    if (q.type === 'mc') return a === q.answer;
    const v = parseNum(a);
    if (v == null) return false;
    return Math.abs(v - q.answer.value) <= Math.abs(q.answer.value) * q.answer.tol;
  }
  function score(exam, answers) {
    let pts = 0, correct = 0;
    const bySec = {};
    for (const q of exam.questions) {
      const s = (bySec[q.section] ||= { n: 0, ok: 0, pts: 0, max: 0 });
      s.n++; s.max += q.points;
      if (isCorrect(q, answers[q.id])) { pts += q.points; correct++; s.ok++; s.pts += q.points; }
    }
    return { pts, correct, bySec };
  }

  // ---------- state ----------
  let pendingExamId = null;  // chosen on the home screen, not started yet
  let reviewRec = null;      // history record being reviewed
  let timerId = null;

  const cur = () => store.current;
  const activeExam = () => examById(reviewRec ? reviewRec.examId : cur().examId);
  const activeAnswers = () => (reviewRec ? reviewRec.answers : cur().answers);

  // ---------- home ----------
  function renderHome() {
    $('cand-name').value = store.name || '';
    const list = $('exam-list');
    list.textContent = '';
    for (const ex of DATA.exams) {
      const tries = store.history.filter((h) => h.examId === ex.id && h.mode === 'exam');
      const best = tries.length ? Math.max(...tries.map((h) => h.score)) : null;
      const counts = {};
      ex.questions.forEach((q) => (counts[q.section] = (counts[q.section] || 0) + 1));
      const tier = ex.id === 'exam3' ? ' tier-hard' : ex.id === 'drill' ? ' tier-drill' : '';
      list.append(el('button', { class: 'exam-card' + tier, type: 'button', onclick: () => openIntro(ex.id) },
        el('div', null,
          el('h3', null, ex.title),
          el('p', null, ex.blurb),
          el('div', { class: 'meta' }, `${ex.questions.length} questions · ${ex.total} points · ${ex.timeMinutes} min · pass ${ex.passScore}`)),
        el('div', { class: 'best' }, best == null ? 'Not taken' : el('span', null, 'Best', el('b', null, `${best}/${ex.total}`)))));
    }
    // resume
    const c = cur();
    if (c && examById(c.examId)) {
      const ex = examById(c.examId);
      const done = ex.questions.filter((q) => isAnswered(q, c.answers[q.id])).length;
      let t = `${ex.title}, ${c.mode} mode, ${done} of ${ex.questions.length} answered`;
      if (c.mode === 'exam') t += `, ${fmtTime((c.deadline - Date.now()) / 1000)} left`;
      $('resume-text').textContent = t + '.';
      $('resume').hidden = false;
    } else {
      $('resume').hidden = true;
    }
    // history
    const hist = $('history');
    if (!store.history.length) return;
    hist.textContent = '';
    const tb = el('tbody');
    store.history.slice(-12).reverse().forEach((h) => {
      const ex = examById(h.examId);
      tb.append(el('tr', null,
        el('td', null, el('div', null, ex ? ex.title.replace('CSWA ', '') : h.examId), el('div', { class: 'small muted' }, fmtDate(h.date))),
        el('td', null, h.mode === 'exam'
          ? el('span', { class: 'pill ' + (h.passed ? 'pass' : 'fail') }, h.passed ? 'Pass' : 'Fail')
          : el('span', { class: 'pill prac' }, 'Practice')),
        el('td', { class: 'mono' }, `${h.score}/${h.total}`),
        el('td', null, ex ? el('button', { class: 'btn sm', type: 'button', onclick: () => startReview(h) }, 'Review') : '')));
    });
    hist.append(el('div', { class: 'table-scroll' }, el('table', { class: 'hist' },
      el('thead', null, el('tr', null, el('th', null, 'Exam'), el('th', null, 'Result'), el('th', null, 'Score'), el('th', null, ''))), tb)));
  }

  function selectedMode() { return $('mode-practice').checked ? 'practice' : 'exam'; }

  function openIntro(examId) {
    store.name = $('cand-name').value.trim();
    save();
    if (cur()) {
      confirmBox('Start a new exam?', 'You have an exam in progress. Starting a new one discards it.', 'Discard and continue', () => {
        store.current = null; save(); openIntro(examId);
      });
      return;
    }
    pendingExamId = examId;
    const ex = examById(examId), mode = selectedMode();
    $('intro-title').textContent = ex.title;
    $('intro-welcome').textContent = `Welcome${store.name ? ', ' + store.name : ''}, to ${ex.title}.`;
    $('rule-count').textContent = `Your exam has ${ex.questions.length} questions. You can answer them in any order.`;
    const f = $('intro-facts');
    f.textContent = '';
    const fact = (k, v) => f.append(el('div', null, el('dt', null, k), el('dd', null, v)));
    fact('Questions', String(ex.questions.length));
    fact('Points', String(ex.total));
    fact('Time', mode === 'exam' ? `${ex.timeMinutes} min` : 'Untimed');
    fact('Pass mark', String(ex.passScore));
    $('rule-time').textContent = mode === 'exam'
      ? `You have ${ex.timeMinutes} minutes. The exam ends when the timer reaches zero; unanswered questions score zero.`
      : 'Practice mode is untimed. Use Check answer to see whether you are right, with the full working, before moving on.';
    $('btn-begin').textContent = mode === 'exam' ? 'Start examination' : 'Start practice';
    show('intro');
  }

  function begin() {
    const ex = examById(pendingExamId), mode = selectedMode(), now = Date.now();
    store.current = {
      examId: ex.id, mode, startedAt: now, deadline: mode === 'exam' ? now + ex.timeMinutes * 60000 : null,
      idx: 0, answers: {}, flags: {}, checked: {},
    };
    save();
    enterExam();
  }

  // ---------- exam ----------
  function enterExam() {
    reviewRec = null;
    const c = cur(), ex = activeExam();
    $('x-title').textContent = ex.title + (c.mode === 'practice' ? ' — Practice' : '');
    $('x-cand').textContent = store.name ? `Candidate: ${store.name}` : '';
    $('btn-check').hidden = c.mode !== 'practice';
    $('btn-summary').hidden = false;
    $('btn-end').textContent = 'End Test';
    $('chk-mark').parentElement.hidden = false;
    show('exam');
    renderList();
    renderQuestion();
    startTimer();
  }

  function startReview(rec) {
    stopTimer();
    reviewRec = rec;
    reviewRec.idx = reviewRec.idx || 0;
    const ex = activeExam();
    $('x-title').textContent = ex.title + ' — Review';
    $('x-cand').textContent = '';
    $('x-timer-lbl').textContent = 'Score';
    $('x-timer').textContent = `${rec.score}/${rec.total}`;
    $('x-timer-wrap').classList.remove('low');
    $('btn-check').hidden = true;
    $('btn-summary').hidden = true;
    $('btn-end').textContent = 'Close review';
    $('chk-mark').parentElement.hidden = true;
    show('exam');
    renderList();
    renderQuestion();
  }

  const curIdx = () => (reviewRec ? reviewRec.idx : cur().idx);
  function setIdx(i) {
    const ex = activeExam();
    i = Math.max(0, Math.min(ex.questions.length - 1, i));
    if (reviewRec) reviewRec.idx = i; else { cur().idx = i; save(); }
    renderList();
    renderQuestion();
    $('qpane').scrollTop = 0;
  }

  function renderLegend() {
    const lg = $('legend');
    lg.textContent = '';
    const row = (cls, txt, flag) => lg.append(el('span', null, flag ? el('i', { class: 'flag-ic' }, '⚑') : el('i', { class: cls }), txt));
    if (!reviewRec) { row('dot ans', 'Answered'); row('dot', 'Not answered'); }
    if (reviewRec || cur().mode === 'practice') { row('dot ok', 'Correct'); row('dot bad', 'Incorrect'); }
    if (!reviewRec) row('', 'Marked for review', true);
  }

  function renderList() {
    renderLegend();
    const ex = activeExam(), ans = activeAnswers(), ol = $('qlist');
    ol.textContent = '';
    ex.questions.forEach((q, i) => {
      let dot = 'dot';
      if (reviewRec) dot += isCorrect(q, ans[q.id]) ? ' ok' : ' bad';
      else if (cur().checked[q.id]) dot += isCorrect(q, ans[q.id]) ? ' ok' : ' bad';
      else if (isAnswered(q, ans[q.id])) dot += ' ans';
      const flagged = !reviewRec && cur().flags[q.id];
      ol.append(el('li', null, el('button', {
        type: 'button', 'aria-current': i === curIdx() ? 'true' : 'false', onclick: () => setIdx(i),
        title: `Question ${q.n}: ${SECTIONS[q.section]}`,
      }, el('span', { class: 'qn' }, String(q.n)), el('span', { class: 'qs' }, SHORT[q.section]),
      el('span', { class: 'qf', 'aria-label': flagged ? 'marked for review' : null }, flagged ? '⚑' : ''), el('i', { class: dot }))));
    });
    const btn = ol.querySelector('[aria-current="true"]');
    if (btn) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderQuestion() {
    const ex = activeExam(), q = ex.questions[curIdx()], ans = activeAnswers();
    const locked = !!reviewRec || !!(cur() && cur().checked[q.id]);
    $('x-pos').innerHTML = `Question <b>${q.n}</b> of <b>${ex.questions.length}</b>`;
    $('q-num').innerHTML = `Question <span class="num">${q.n}</span>`;
    $('q-sec').textContent = SECTIONS[q.section];
    $('q-pts').innerHTML = `<b>${q.points}</b>points`;
    $('q-prompt').innerHTML = (q.heading ? `<p class="q-heading">${q.heading}</p>` : '') + q.prompt;

    const th = $('q-thumbs');
    th.textContent = '';
    q.images.forEach((im, i) => {
      th.append(el('button', { class: 'thumb' + (q.images.length === 1 ? ' wide' : ''), type: 'button', onclick: () => openViewer(q.images, i), 'aria-label': `Open ${im.title} in the image viewer` },
        el('img', { src: im.src, alt: im.title, loading: 'lazy' }), el('span', null, `${i + 1}. ${im.title}`)));
    });

    const dl = $('q-parts');
    dl.textContent = '';
    dl.hidden = !q.parts;
    if (q.parts) {
      const name = q.parts.split('/').pop();
      dl.append(
        el('div', { class: 'parts-row' },
          el('button', { class: 'btn primary', type: 'button', onclick: () => downloadParts(q.parts, name) }, 'Download parts (zip)'),
          el('span', { class: 'mono small' }, name)),
        el('p', { class: 'small muted' }, 'Open each .step file in SOLIDWORKS (answer No if it offers feature recognition) and save it as a part. Apply the materials listed in the question. Insert the Base first and leave it fixed at the assembly origin: its part origin is already on the origin shown in the image.'));
    }

    const box = $('q-answer');
    box.textContent = '';
    box.setAttribute('aria-disabled', locked ? 'true' : 'false');
    if (q.type === 'mc') {
      box.append(el('div', { class: 'lbl' }, 'Select one answer'));
      const opts = el('div', { class: 'opts', role: 'radiogroup' });
      q.options.forEach((o, i) => {
        let cls = 'opt';
        if (locked && i === q.answer) cls += ' is-correct';
        else if (locked && ans[q.id] === i) cls += ' is-wrong';
        const isCom = /^X = /.test(o);
        const input = el('input', { type: 'radio', name: 'mc-' + q.id, id: `opt-${q.id}-${i}`, value: String(i), disabled: locked });
        if (ans[q.id] === i) input.checked = true;
        input.addEventListener('change', () => setAnswer(q, i));
        opts.append(el('label', { class: cls, for: `opt-${q.id}-${i}` }, input,
          el('span', { class: 'letter' }, 'abcd'[i] + ')'),
          el('span', { class: 'otext' + (isCom || / g$/.test(o) ? ' num' : '') }, isCom ? o.replace(/, /g, '\n') : o)));
      });
      box.append(opts);
    } else {
      box.append(el('label', { class: 'lbl', for: 'num-' + q.id }, 'Enter your answer'));
      const input = el('input', { type: 'text', id: 'num-' + q.id, inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: '0.00', disabled: locked });
      input.value = ans[q.id] ?? '';
      const hint = el('div', { class: 'hint' }, 'Numbers only, period as the decimal separator, no units.');
      const check = () => {
        const bad = input.value.trim() !== '' && parseNum(input.value) == null;
        input.classList.toggle('bad-format', bad);
        hint.className = 'hint' + (bad ? ' err' : '');
        hint.textContent = bad ? 'That is not a number. Use digits and one period, for example 1234.56.' : 'Numbers only, period as the decimal separator, no units.';
      };
      input.addEventListener('input', () => { setAnswer(q, input.value); check(); });
      check();
      box.append(el('div', { class: 'numrow' }, input, el('span', { class: 'unit' }, q.unit)), hint);
    }

    // feedback
    const fb = $('q-feedback');
    if (locked) {
      const ok = isCorrect(q, ans[q.id]);
      const answered = isAnswered(q, ans[q.id]);
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      let head = ok ? `Correct — ${q.points} points` : answered ? 'Incorrect — 0 points' : 'Not answered — 0 points';
      let body = '';
      if (q.type === 'num') {
        body += `<p>Correct answer: <b class="mono">${q.answer.value.toFixed(2)} ${q.unit}</b> (accepted range ${(q.answer.value * (1 - q.answer.tol)).toFixed(2)} – ${(q.answer.value * (1 + q.answer.tol)).toFixed(2)}).`;
        if (answered) body += ` Your answer: <b class="mono">${escapeHtml(String(ans[q.id]))}</b>.`;
        body += '</p>';
      } else if (!ok) {
        body += `<p>Correct answer: <b>${'abcd'[q.answer]})</b> ${escapeHtml(q.options[q.answer])}</p>`;
      }
      fb.innerHTML = `<div class="fb-head">${head}</div>${body}<div>${q.explain}</div>`;
      fb.hidden = false;
    } else {
      fb.hidden = true;
    }

    // buttons
    $('btn-prev').disabled = curIdx() === 0;
    $('btn-next').disabled = curIdx() === ex.questions.length - 1;
    if (!reviewRec) {
      $('chk-mark').checked = !!cur().flags[q.id];
      $('btn-check').disabled = locked || !isAnswered(q, ans[q.id]);
    }
  }

  // The part zips are served by cswa.mattdicks.org and work from a local copy. Anywhere else
  // (e.g. a preview that can't serve archives) the button fetches them from the live site.
  const LIVE = 'https://cswa.mattdicks.org/';
  function downloadParts(href, name) {
    const here = location.protocol === 'file:' || location.hostname === 'cswa.mattdicks.org' ||
      /^(localhost|127\.0\.0\.1)$|\.workers\.dev$/.test(location.hostname);
    const a = here ? el('a', { href, download: name }) : el('a', { href: LIVE + href, target: '_blank', rel: 'noopener' });
    document.body.append(a);
    a.click();
    a.remove();
  }

  function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function setAnswer(q, v) {
    if (reviewRec) return;
    const c = cur();
    if (c.checked[q.id]) return;
    c.answers[q.id] = v;
    save();
    renderList();
    $('btn-check').disabled = !isAnswered(q, v);
  }

  // ---------- timer ----------
  function startTimer() {
    stopTimer();
    const tick = () => {
      const c = cur();
      if (!c || reviewRec) return;
      if (c.mode === 'exam') {
        const left = (c.deadline - Date.now()) / 1000;
        $('x-timer-lbl').textContent = 'Time left';
        $('x-timer').textContent = fmtTime(left);
        $('x-timer-wrap').classList.toggle('low', left < 600);
        if (left <= 0) { finish(true); }
      } else {
        $('x-timer-lbl').textContent = 'Elapsed';
        $('x-timer').textContent = fmtTime((Date.now() - c.startedAt) / 1000);
        $('x-timer-wrap').classList.remove('low');
      }
    };
    tick();
    timerId = setInterval(tick, 1000);
  }
  function stopTimer() { if (timerId) clearInterval(timerId); timerId = null; }

  // ---------- summary ----------
  function renderSummary() {
    const c = cur(), ex = examById(c.examId);
    const tb = $('sum-body');
    tb.textContent = '';
    let a = 0, m = 0;
    ex.questions.forEach((q, i) => {
      const answered = isAnswered(q, c.answers[q.id]);
      if (answered) a++;
      if (c.flags[q.id]) m++;
      const st = el('td', null, el('span', { class: 'st ' + (answered ? 'ans' : 'no') }, answered ? 'Answered' : 'Not answered'),
        c.flags[q.id] ? el('span', { class: 'st mk' }, '  ⚑ Marked') : '');
      tb.append(el('tr', null, el('td', { class: 'mono' }, String(q.n)), el('td', null, SECTIONS[q.section]), el('td', null, String(q.points)), st,
        el('td', null, el('button', { class: 'btn sm', type: 'button', onclick: () => { show('exam'); setIdx(i); } }, 'Go to'))));
    });
    $('sum-counts').innerHTML = `<b>${a}</b> of <b>${ex.questions.length}</b> answered · <b>${ex.questions.length - a}</b> not answered · <b>${m}</b> marked for review`;
    show('summary');
  }

  // ---------- end ----------
  function confirmBox(title, text, yesLabel, onYes) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yesLabel;
    $('confirm').hidden = false;
    $('confirm-no').focus();
    $('confirm-yes').onclick = () => { $('confirm').hidden = true; onYes(); };
  }
  function askEnd() {
    const c = cur(), ex = examById(c.examId);
    const un = ex.questions.filter((q) => !isAnswered(q, c.answers[q.id])).length;
    const mk = ex.questions.filter((q) => c.flags[q.id]).length;
    let t = 'You cannot go back to your questions after you end the test.';
    if (un) t = `You have ${un} unanswered question${un > 1 ? 's' : ''}. ` + t;
    if (mk) t = `${mk} question${mk > 1 ? 's are' : ' is'} marked for review. ` + t;
    confirmBox('End test', t, 'End Test', () => finish(false));
  }

  function finish(timeUp) {
    stopTimer();
    const c = cur(), ex = examById(c.examId);
    const s = score(ex, c.answers);
    const end = c.mode === 'exam' ? Math.min(Date.now(), c.deadline) : Date.now();
    const rec = {
      examId: ex.id, mode: c.mode, date: Date.now(), score: s.pts, total: ex.total, passScore: ex.passScore,
      passed: s.pts >= ex.passScore, correct: s.correct, used: Math.round((end - c.startedAt) / 1000), timeUp: !!timeUp,
      answers: c.answers,
    };
    store.history.push(rec);
    if (store.history.length > 60) store.history = store.history.slice(-60);
    store.current = null;
    save();
    renderResults(rec);
  }

  function renderResults(rec) {
    const ex = examById(rec.examId), s = score(ex, rec.answers);
    $('r-title').textContent = `${ex.title} — ${rec.mode === 'exam' ? 'Results' : 'Practice results'}`;
    const v = $('r-verdict');
    v.textContent = rec.passed ? 'PASS' : 'FAIL';
    v.className = 'verdict ' + (rec.passed ? 'pass' : 'fail');
    $('r-score').innerHTML = `<b>${rec.score}/${rec.total}</b> points · pass mark <span class="num">${rec.passScore}</span>`;
    $('r-meter').style.width = `${(100 * rec.score) / rec.total}%`;
    $('r-meter').className = 'meter-fill ' + (rec.passed ? 'pass' : 'fail');
    $('r-pass').style.left = `${(100 * rec.passScore) / rec.total}%`;
    const f = $('r-facts');
    f.textContent = '';
    const fact = (k, val) => f.append(el('div', null, el('dt', null, k), el('dd', null, val)));
    fact('Correct', `${s.correct}/${ex.questions.length}`);
    fact('Percent', `${Math.round((100 * rec.score) / rec.total)} %`);
    fact('Time used', fmtTime(rec.used));
    fact('Mode', rec.mode === 'exam' ? (rec.timeUp ? 'Time up' : 'Exam') : 'Practice');
    const tb = $('r-sections');
    tb.textContent = '';
    for (const key of Object.keys(SECTIONS)) {
      const b = s.bySec[key];
      if (!b) continue;
      tb.append(el('tr', null, el('td', null, SECTIONS[key]), el('td', null, `${b.ok}/${b.n}`), el('td', null, `${b.pts}/${b.max}`),
        el('td', null, el('div', { class: 'secbar' }, el('i', { style: `width:${(100 * b.pts) / b.max}%` })))));
    }
    $('btn-review').onclick = () => startReview(rec);
    $('btn-retake').onclick = () => { $('mode-' + rec.mode).checked = true; renderHome(); openIntro(rec.examId); };
    show('results');
  }

  // ---------- image viewer ----------
  const V = { imgs: [], i: 0, s: 1, x: 0, y: 0 };
  function openViewer(imgs, i) {
    V.imgs = imgs; V.i = i;
    $('viewer').hidden = false;
    loadViewerImage();
    $('v-close').focus();
  }
  function loadViewerImage() {
    const im = V.imgs[V.i], img = $('v-img');
    $('v-title').textContent = im.title;
    $('v-count').textContent = `${V.i + 1} / ${V.imgs.length}`;
    $('v-prev').disabled = V.i === 0;
    $('v-next').disabled = V.i === V.imgs.length - 1;
    img.onload = fitViewer;
    img.src = im.src;
    img.alt = im.title;
    if (img.complete && img.naturalWidth) fitViewer();
  }
  function applyView() { $('v-img').style.transform = `translate(${V.x}px, ${V.y}px) scale(${V.s})`; }
  function fitViewer() {
    const st = $('v-stage').getBoundingClientRect(), img = $('v-img');
    const w = img.naturalWidth || 1800, h = img.naturalHeight || 1200;
    img.style.width = w + 'px';
    img.style.height = h + 'px';
    V.s = Math.min(st.width / w, st.height / h) * 0.98;
    V.x = (st.width - w * V.s) / 2;
    V.y = (st.height - h * V.s) / 2;
    applyView();
  }
  function zoomAt(f, cx, cy) {
    const st = $('v-stage').getBoundingClientRect();
    if (cx == null) { cx = st.width / 2; cy = st.height / 2; }
    const ns = Math.min(8, Math.max(0.05, V.s * f));
    V.x = cx - ((cx - V.x) * ns) / V.s;
    V.y = cy - ((cy - V.y) * ns) / V.s;
    V.s = ns;
    applyView();
  }
  function closeViewer() { $('viewer').hidden = true; }
  (function wireViewer() {
    const stage = $('v-stage');
    let drag = null;
    stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, ox: V.x, oy: V.y }; stage.setPointerCapture(e.pointerId); stage.classList.add('drag'); });
    stage.addEventListener('pointermove', (e) => { if (!drag) return; V.x = drag.ox + e.clientX - drag.x; V.y = drag.oy + e.clientY - drag.y; applyView(); });
    const up = () => { drag = null; stage.classList.remove('drag'); };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    stage.addEventListener('dblclick', (e) => { const r = stage.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); });
    $('v-in').onclick = () => zoomAt(1.3);
    $('v-out').onclick = () => zoomAt(1 / 1.3);
    $('v-fit').onclick = fitViewer;
    $('v-close').onclick = closeViewer;
    $('v-prev').onclick = () => { if (V.i > 0) { V.i--; loadViewerImage(); } };
    $('v-next').onclick = () => { if (V.i < V.imgs.length - 1) { V.i++; loadViewerImage(); } };
    window.addEventListener('resize', () => { if (!$('viewer').hidden) fitViewer(); });
  })();

  // ---------- wiring ----------
  $('cand-name').addEventListener('change', (e) => { store.name = e.target.value.trim(); save(); });
  $('btn-resume').onclick = () => { store.name = $('cand-name').value.trim() || store.name; enterExam(); };
  $('btn-discard').onclick = () => confirmBox('Discard exam', 'The exam in progress and its answers will be deleted.', 'Discard', () => { store.current = null; save(); renderHome(); });
  $('btn-intro-back').onclick = () => { renderHome(); show('home'); };
  $('btn-begin').onclick = begin;
  $('btn-prev').onclick = () => setIdx(curIdx() - 1);
  $('btn-next').onclick = () => setIdx(curIdx() + 1);
  $('chk-mark').onchange = (e) => {
    const q = activeExam().questions[curIdx()];
    if (e.target.checked) cur().flags[q.id] = true; else delete cur().flags[q.id];
    save();
    renderList();
  };
  $('btn-check').onclick = () => {
    const q = activeExam().questions[curIdx()];
    if (!isAnswered(q, cur().answers[q.id])) return;
    cur().checked[q.id] = true;
    save();
    renderList();
    renderQuestion();
    $('q-feedback').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  $('btn-summary').onclick = renderSummary;
  $('btn-sum-back').onclick = () => { show('exam'); renderQuestion(); };
  $('btn-sum-end').onclick = askEnd;
  $('btn-end').onclick = () => {
    if (reviewRec) { reviewRec = null; renderHome(); show('home'); return; }
    askEnd();
  };
  $('confirm-no').onclick = () => { $('confirm').hidden = true; };
  $('btn-home').onclick = () => { renderHome(); show('home'); };

  document.addEventListener('keydown', (e) => {
    if (!$('viewer').hidden) {
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowLeft') $('v-prev').click();
      else if (e.key === 'ArrowRight') $('v-next').click();
      else if (e.key === '+' || e.key === '=') zoomAt(1.3);
      else if (e.key === '-') zoomAt(1 / 1.3);
      return;
    }
    if (!$('confirm').hidden && e.key === 'Escape') { $('confirm').hidden = true; return; }
    if (!$('exam').hidden && (e.key === 'PageDown' || e.key === 'PageUp')) {
      e.preventDefault();
      setIdx(curIdx() + (e.key === 'PageDown' ? 1 : -1));
    }
  });

  renderHome();
  show('home');
})();
