(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const LETTERS = ['A', 'B', 'C', 'D'];
  const MAXQ = 40;
  const STORE_KEY = 'omr-scanner-v1';

  // ---------------- storage ----------------
  function blankKeys() { const k = {}; LETTERS.forEach(s => k[s] = Array(MAXQ).fill('')); return k; }
  function newExam(subject) {
    return { id: 'e' + Date.now().toString(36), subject: subject || '', numQ: 40, markRight: 1, markWrong: 0, keys: blankKeys(), results: [] };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.exams && Object.keys(s.exams).length) return s;
    } catch (e) {}
    const e = newExam('');
    return { exams: { [e.id]: e }, activeExam: e.id, activeSet: 'A' };
  }
  let store = load();
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {} }
  const exam = () => store.exams[store.activeExam];

  // ---------------- toast ----------------
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------------- tabs ----------------
  let currentView = 'setup';
  function show(view) {
    currentView = view;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    if (view === 'scan') enterScan(); else stopCamera();
    if (view === 'results') renderResults();
    if (view === 'setup') renderSetup();
  }
  $$('.tab').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

  // ---------------- setup ----------------
  function renderExamSelect() {
    const sel = $('#exam-select');
    sel.innerHTML = '';
    Object.values(store.exams).forEach(e => {
      const o = document.createElement('option');
      o.value = e.id; o.textContent = e.subject || '(নাম নেই)';
      if (e.id === store.activeExam) o.selected = true;
      sel.appendChild(o);
    });
  }
  function renderSets() {
    $$('.set').forEach(b => b.classList.toggle('active', b.dataset.set === store.activeSet));
  }
  function keyToText(arr, n) { return arr.slice(0, n).map(x => x || '-').join('').replace(/-+$/, ''); }
  function renderKeyGrid() {
    const e = exam(), key = e.keys[store.activeSet], grid = $('#key-grid');
    grid.innerHTML = '';
    for (let i = 0; i < e.numQ; i++) {
      const row = document.createElement('div'); row.className = 'key-row';
      row.innerHTML = `<span class="qn">${i + 1}</span>` +
        LETTERS.map(L => `<button class="opt${key[i] === L ? ' on' : ''}" data-q="${i}" data-l="${L}">${L}</button>`).join('');
      grid.appendChild(row);
    }
    $('#key-text').value = keyToText(key, e.numQ);
    const done = key.slice(0, e.numQ).filter(Boolean).length;
    $('#key-progress').textContent = `সেট ${store.activeSet}: ${done}/${e.numQ}`;
  }
  function renderSetup() {
    const e = exam();
    renderExamSelect(); renderSets();
    $('#subject-name').value = e.subject;
    $('#num-q').value = e.numQ;
    $('#mark-right').value = e.markRight;
    $('#mark-wrong').value = e.markWrong;
    renderKeyGrid();
  }

  $('#key-grid').addEventListener('click', (ev) => {
    const b = ev.target.closest('.opt'); if (!b) return;
    const key = exam().keys[store.activeSet], i = +b.dataset.q;
    key[i] = key[i] === b.dataset.l ? '' : b.dataset.l;
    save(); renderKeyGrid();
  });
  $('#key-text').addEventListener('input', (ev) => {
    const e = exam(), key = e.keys[store.activeSet];
    const txt = ev.target.value.toUpperCase().replace(/[^ABCD\-_. ]/g, '');
    for (let i = 0; i < MAXQ; i++) {
      const c = txt[i]; key[i] = (c && 'ABCD'.includes(c)) ? c : '';
    }
    save();
    // update grid without resetting the cursor of the text input
    $$('#key-grid .opt').forEach(b => b.classList.toggle('on', key[+b.dataset.q] === b.dataset.l));
    const done = key.slice(0, e.numQ).filter(Boolean).length;
    $('#key-progress').textContent = `সেট ${store.activeSet}: ${done}/${e.numQ}`;
  });
  $('#exam-select').addEventListener('change', (ev) => { store.activeExam = ev.target.value; save(); renderSetup(); });
  $('#subject-name').addEventListener('input', (ev) => { exam().subject = ev.target.value.trim(); save(); renderExamSelect(); });
  $('#num-q').addEventListener('change', (ev) => {
    exam().numQ = Math.max(1, Math.min(MAXQ, parseInt(ev.target.value) || MAXQ));
    ev.target.value = exam().numQ; save(); renderKeyGrid();
  });
  $('#mark-right').addEventListener('change', (ev) => { exam().markRight = parseFloat(ev.target.value) || 0; save(); });
  $('#mark-wrong').addEventListener('change', (ev) => { exam().markWrong = Math.abs(parseFloat(ev.target.value) || 0); save(); });
  $('#btn-new-exam').addEventListener('click', () => {
    const name = prompt('নতুন বিষয়ের নাম:'); if (name === null) return;
    const e = newExam(name.trim()); store.exams[e.id] = e; store.activeExam = e.id; store.activeSet = 'A';
    save(); renderSetup();
  });
  $('#btn-delete-exam').addEventListener('click', () => {
    const e = exam();
    if (!confirm(`"${e.subject || 'এই বিষয়'}" এবং এর সব রেজাল্ট মুছে ফেলবেন?`)) return;
    delete store.exams[e.id];
    if (!Object.keys(store.exams).length) { const n = newExam(''); store.exams[n.id] = n; }
    store.activeExam = Object.keys(store.exams)[0]; save(); renderSetup();
  });
  $('#btn-clear-key').addEventListener('click', () => {
    if (!confirm(`সেট ${store.activeSet} এর সব উত্তর মুছবেন?`)) return;
    exam().keys[store.activeSet] = Array(MAXQ).fill(''); save(); renderKeyGrid();
  });
  $('#btn-copy-key').addEventListener('click', () => {
    const from = (prompt('কোন সেট থেকে কপি করবেন? (A/B/C/D)') || '').trim().toUpperCase();
    if (!LETTERS.includes(from) || from === store.activeSet) return;
    exam().keys[store.activeSet] = exam().keys[from].slice(); save(); renderKeyGrid();
    toast(`সেট ${from} → সেট ${store.activeSet} কপি হয়েছে`);
  });
  $$('.set').forEach(b => b.addEventListener('click', () => {
    store.activeSet = b.dataset.set; save(); renderSets();
    if (currentView === 'setup') renderKeyGrid();
    else { updateScanHeader(); if (frozen && lastSheet) showFrozenResult(); }
  }));
  $('#btn-go-scan').addEventListener('click', () => show('scan'));

  // ---------------- scanning ----------------
  const video = $('#video'), canvas = $('#canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null, rafId = 0, frozen = false, lastProc = 0;
  let lastSheet = null;       // {H, corners, geom, result}
  let frozenImage = null;     // ImageData of frozen frame
  const PROC_LONG = 1400;

  function updateScanHeader() {
    const e = exam();
    const n = e.keys[store.activeSet].slice(0, e.numQ).filter(Boolean).length;
    $('#scan-subject').textContent = `${e.subject || '(নাম নেই)'} · সেট ${store.activeSet}`;
    if (n === 0) setHint(`সেট ${store.activeSet} এর উত্তর সেট করা নেই — সেটআপে গিয়ে দিন`);
    else setHint(`শিটের ৪ কোণার ছোট চারকোনা বক্স ফ্রেমে রাখুন`);
  }
  function setHint(t) { $('#scan-hint').textContent = t; }
  function setStatus(t, cls) { const c = $('#status-chip'); c.textContent = t; c.className = 'status-chip' + (cls ? ' ' + cls : ''); }

  async function enterScan() {
    updateScanHeader(); renderSets();
    if (frozen) return;
    await startCamera();
  }
  async function startCamera() {
    if (stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('ক্যামেরা পাওয়া যায়নি', 'warn');
      setHint('HTTPS লিংকে খুলুন, অথবা "ছবি" বাটনে ছবি দিন'); return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      video.srcObject = stream; await video.play();
      const track = stream.getVideoTracks()[0];
      try {
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        $('#btn-torch').hidden = !caps.torch;
      } catch (e) {}
      frozen = false;
      $('#frame-guide').classList.remove('hide');
      loop();
    } catch (err) {
      setStatus('ক্যামেরা অনুমতি পাওয়া যায়নি', 'warn');
      setHint('ব্রাউজারে ক্যামেরার অনুমতি দিন, অথবা "ছবি" বাটন ব্যবহার করুন');
    }
  }
  function stopCamera() {
    cancelAnimationFrame(rafId); rafId = 0;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    torchOn = false;
  }
  let torchOn = false;
  $('#btn-torch').addEventListener('click', async () => {
    if (!stream) return;
    torchOn = !torchOn;
    try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) {}
  });

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (frozen || !video.videoWidth) return;
    if (ts && ts - lastProc < 70) return;
    lastProc = ts || 0;
    const vw = video.videoWidth, vh = video.videoHeight;
    const sc = Math.min(1, PROC_LONG / Math.max(vw, vh));
    const w = Math.round(vw * sc), h = Math.round(vh * sc);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    processFrame(img, true);
  }

  // live: only look for the sheet; freeze as soon as it is found and held steady.
  let steady = 0, prevCorners = null, accum = null;
  function processFrame(img, live) {
    const { width: w, height: h } = img;
    const g = OMR.toGray(img);
    const sheet = OMR.detectSheet(g, w, h);
    if (!sheet) {
      if (live) {
        steady = 0; prevCorners = null; accum = null;
        setStatus('শিট খোঁজা হচ্ছে…', '');
        $('#frame-guide').classList.remove('hide');
      } else {
        setStatus('শিট পাওয়া যায়নি — নতুন ক্যাপচার দিন', 'warn');
        $('#btn-save').disabled = true;
      }
      return null;
    }
    $('#frame-guide').classList.add('hide');
    const raw = OMR.readSheet(g, w, h, sheet.H);
    const fq = raw.q.map(r => r.map(b => b.fill)), fid = raw.id.map(c => c.map(b => b.fill));

    if (live) {
      // how much did the sheet move since the previous frame?
      const size = Math.hypot(sheet.corners[0][0] - sheet.corners[2][0], sheet.corners[0][1] - sheet.corners[2][1]);
      const moved = prevCorners ? Math.max(...sheet.corners.map((p, i) => Math.hypot(p[0] - prevCorners[i][0], p[1] - prevCorners[i][1]))) / size : 1;
      prevCorners = sheet.corners;
      if (moved < 0.025) steady++; else { steady = 0; accum = null; }
      if (!accum) accum = { n: 0, q: fq.map(r => r.map(() => 0)), id: fid.map(c => c.map(() => 0)) };
      accum.n++;
      fq.forEach((r, i) => r.forEach((v, j) => accum.q[i][j] += v));
      fid.forEach((c, i) => c.forEach((v, j) => accum.id[i][j] += v));
      // outline only while live
      ctx.save(); ctx.lineWidth = Math.max(3, w / 300); ctx.strokeStyle = '#22c55e';
      ctx.beginPath(); sheet.corners.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke(); ctx.restore();
      setStatus('শিট পাওয়া গেছে… স্থির রাখুন', '');
      if (steady >= 2) {
        const n = accum.n;
        const fills = { q: accum.q.map(r => r.map(v => v / n)), id: accum.id.map(c => c.map(v => v / n)) };
        lastSheet = { corners: sheet.corners, geom: raw, fills };
        autoCapture(img);
      }
      return lastSheet;
    }

    lastSheet = { corners: sheet.corners, geom: raw, fills: { q: fq, id: fid } };
    showFrozenResult();
    return lastSheet;
  }

  function showFrozenResult() {
    ctx.putImageData(frozenImage, 0, 0);
    lastSheet.result = evaluate(lastSheet.fills);
    drawOverlay(lastSheet); updateScore(lastSheet.result);
    setStatus('ক্যাপচার হয়েছে ✓', 'ok');
    $('#btn-save').disabled = false;
    $('#btn-new').textContent = '📷 নতুন ক্যাপচার';
  }

  function autoCapture(img) {
    frozen = true;
    frozenImage = img;
    cancelAnimationFrame(rafId); rafId = 0;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    torchOn = false;
    showFrozenResult();
    if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
  }

  // manual capture while live (fallback if auto-detect is slow)
  function captureNow() {
    if (!video.videoWidth) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    frozen = true; frozenImage = img;
    stopCamera();
    $('#btn-new').textContent = '📷 নতুন ক্যাপচার';
    processFrame(img, false);
  }

  function newCapture() {
    frozen = false; frozenImage = null; lastSheet = null;
    steady = 0; prevCorners = null; accum = null;
    resetScore();
    $('#btn-save').disabled = true;
    $('#btn-new').textContent = '📸 এখনই ক্যাপচার';
    setStatus('শিট খোঁজা হচ্ছে…', '');
    startCamera();
  }

  function evaluate(fills) {
    const e = exam(), key = e.keys[store.activeSet];
    let correct = 0, wrong = 0, blank = 0, counted = 0;
    const per = [], answers = [];
    for (let i = 0; i < e.numQ; i++) {
      const marked = OMR.decide(fills.q[i]);
      const k = LETTERS.indexOf(key[i]);
      answers.push(marked.length === 0 ? '-' : marked.length === 1 ? LETTERS[marked[0]] : '*');
      let status;
      if (k < 0) status = 'nokey';
      else if (marked.length === 0) { status = 'blank'; blank++; }
      else if (marked.length === 1 && marked[0] === k) { status = 'correct'; correct++; }
      else { status = 'wrong'; wrong++; }
      if (k >= 0) counted++;
      per.push({ marked, k, status });
    }
    const score = +(correct * e.markRight - wrong * e.markWrong).toFixed(2);
    const roll = OMR.decodeId(fills.id);
    return { per, answers, correct, wrong, blank, counted, score, total: +(counted * e.markRight).toFixed(2), roll };
  }

  function drawOverlay(sheet) {
    const { geom, result, corners } = sheet;
    // sheet outline
    ctx.save();
    ctx.lineWidth = Math.max(2, canvas.width / 400);
    ctx.strokeStyle = 'rgba(29,95,209,.85)';
    ctx.beginPath(); corners.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
    result.per.forEach((p, i) => {
      if (p.status === 'nokey') {
        p.marked.forEach(m => dot(geom.q[i][m], 'rgba(100,116,139,.85)'));
        return;
      }
      p.marked.forEach(m => dot(geom.q[i][m], (p.status === 'correct') ? 'rgba(22,163,74,.92)' : 'rgba(220,38,38,.92)'));
      if (p.status !== 'correct') ring(geom.q[i][p.k], '#16a34a');
    });
    ctx.restore();
  }
  function dot(b, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(b.x, b.y, b.R * 0.85, 0, Math.PI * 2); ctx.fill();
  }
  function ring(b, color) {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, b.R * 0.28);
    ctx.beginPath(); ctx.arc(b.x, b.y, b.R * 1.12, 0, Math.PI * 2); ctx.stroke();
  }
  function updateScore(r) {
    $('#score-num').textContent = r.counted ? r.score : '–';
    $('#score-of').textContent = r.counted ? `${r.total} এর মধ্যে` : 'উত্তর সেট নেই';
    $('#st-correct').textContent = r.correct;
    $('#st-wrong').textContent = r.wrong;
    $('#st-blank').textContent = r.blank;
    $('#st-roll').textContent = r.roll || '—';
  }
  function resetScore() {
    ['#st-correct', '#st-wrong', '#st-blank'].forEach(s => $(s).textContent = '0');
    $('#score-num').textContent = '–'; $('#st-roll').textContent = '—';
  }

  $('#btn-new').addEventListener('click', () => (frozen ? newCapture() : captureNow()));

  $('#file-input').addEventListener('change', (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    const im = new Image();
    im.onload = () => {
      stopCamera(); frozen = true;
      const sc = Math.min(1, 1800 / Math.max(im.width, im.height));
      canvas.width = Math.round(im.width * sc); canvas.height = Math.round(im.height * sc);
      ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
      frozenImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
      $('#btn-new').textContent = '📷 নতুন ক্যাপচার';
      const r = processFrame(frozenImage, false);
      if (!r) toast('শিটের ৪ কোণার মার্কার পাওয়া যায়নি — আরেকটি ছবি দিন');
      URL.revokeObjectURL(im.src);
    };
    im.src = URL.createObjectURL(f);
    ev.target.value = '';
  });

  $('#btn-save').addEventListener('click', () => {
    if (!lastSheet) return;
    const e = exam(), r = evaluate(lastSheet.fills);
    if (!r.counted) { toast('আগে এই সেটের উত্তর সেট করুন'); return; }
    let roll = r.roll;
    if (!roll || roll.includes('?') || roll.length < 1) {
      const v = prompt('আইডি ঠিকমতো পড়া যায়নি। আইডি লিখুন:', roll || '');
      if (v === null) return; roll = v.trim();
    }
    const existing = e.results.findIndex(x => x.roll && x.roll === roll);
    const rec = { roll, set: store.activeSet, correct: r.correct, wrong: r.wrong, blank: r.blank, score: r.score, total: r.total, answers: r.answers.join(''), time: Date.now() };
    if (existing >= 0) {
      if (!confirm(`আইডি ${roll} আগেই সেভ আছে। নতুনটি দিয়ে বদলাবেন?`)) return;
      e.results[existing] = rec;
    } else e.results.push(rec);
    save();
    toast(`সেভ হয়েছে — আইডি ${roll || '—'}: ${r.score}/${r.total}`);
    if (navigator.vibrate) navigator.vibrate(60);
    $('#btn-save').disabled = true; // avoid double-save
  });

  // ---------------- results ----------------
  function renderResults() {
    const e = exam();
    $('#results-title').textContent = `রেজাল্ট — ${e.subject || '(নাম নেই)'}`;
    const body = $('#results-body'); body.innerHTML = '';
    const rows = e.results.slice().sort((a, b) => (a.roll || '').localeCompare(b.roll || '', undefined, { numeric: true }));
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i + 1}</td><td>${esc(r.roll || '—')}</td><td>${r.set}</td><td class="ok">${r.correct}</td><td class="bad">${r.wrong}</td><td>${r.blank}</td><td><b>${r.score}</b>/${r.total}</td><td><button class="del" data-t="${r.time}" title="মুছুন">✕</button></td>`;
      body.appendChild(tr);
    });
    if (!rows.length) body.innerHTML = '<tr><td colspan="8" class="muted">এখনো কোনো রেজাল্ট সেভ হয়নি</td></tr>';
    const avg = rows.length ? (rows.reduce((s, r) => s + r.score, 0) / rows.length).toFixed(2) : 0;
    $('#results-summary').textContent = rows.length ? `মোট ${rows.length} জন · গড় ${avg}` : '';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  $('#results-body').addEventListener('click', (ev) => {
    const b = ev.target.closest('.del'); if (!b) return;
    const e = exam(); e.results = e.results.filter(r => String(r.time) !== b.dataset.t); save(); renderResults();
  });
  $('#btn-clear-results').addEventListener('click', () => {
    if (!confirm('এই বিষয়ের সব রেজাল্ট মুছবেন?')) return;
    exam().results = []; save(); renderResults();
  });
  $('#btn-export').addEventListener('click', () => {
    const e = exam();
    const head = ['ID', 'Set', 'Correct', 'Wrong', 'Blank', 'Score', 'Total', 'Answers', 'Time'];
    const lines = [head.join(',')].concat(e.results.map(r =>
      [r.roll, r.set, r.correct, r.wrong, r.blank, r.score, r.total, r.answers, new Date(r.time).toLocaleString()].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${(e.subject || 'omr').replace(/[^\w\-]+/g, '_')}_results.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
    else if (currentView === 'scan' && !frozen) startCamera();
  });

  renderSetup();
})();
