'use strict';

// 스파이더 카드: 화면·입력·흐름. 판 규칙은 logic.js (LOGIC) 에 있다.
(() => {
const L = LOGIC;
const $ = (id) => document.getElementById(id);
const board = $('board'), colEl = $('col');

const SUIT = ['♠', '♥', '♣', '♦'];
const SUIT_COLOR = ['#2b1d52', '#e8324f', '#1f9d55', '#2f7df0'];
const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SAVE_KEY = 'spiderSave';
const MODE_NAME = { 1: '1무늬 · 쉬움', 2: '2무늬 · 보통', 4: '4무늬 · 어려움' };
const MODE_ICON = { 1: '♠', 2: '♠♥', 4: '♠♥♣♦' };

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};
const best = { 1: Number(store.get('spiderBest1')) || 0, 2: Number(store.get('spiderBest2')) || 0, 4: Number(store.get('spiderBest4')) || 0 };

// ---------- 소리 ----------
let audio = null;
let muted = store.get('spiderMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  pick: () => tone(620, 0.05, 'triangle', 0.06),
  place: () => tone(330, 0.07, 'sine', 0.1, 120),
  deal: () => { for (let i = 0; i < 5; i++) setTimeout(() => tone(260 + i * 50, 0.05, 'triangle', 0.06), i * 55); },
  nope: () => tone(190, 0.12, 'square', 0.05, -50),
  undo: () => tone(440, 0.09, 'sine', 0.08, -160),
  run: () => seq([523, 659, 784, 1047], 90, 'triangle', 0.1),
  win: () => seq([523, 659, 784, 1047, 784, 1047, 1319], 120, 'square', 0.06),
  hint: () => tone(880, 0.12, 'sine', 0.07, 260),
};

// ---------- 상태 ----------
let st = null, hist = [], mode = 1;
let elapsed = 0, hudClock = 0, playing = false, paused = false, won = false;
let drag = null, hintTimer = null, dealTimer = null;
let M = {};                               // 배치 치수
let lastPos = [];                         // id -> 마지막으로 놓은 자리 {x,y}
const els = [];                           // id -> 카드 요소
let colSlots = [], foundSlots = [], stockSlot = null;

// ---------- 배치 ----------
function metrics() {
  const W = board.clientWidth, H = board.clientHeight;
  const gap = Math.max(2, Math.round(W * 0.007)), padX = Math.max(3, Math.round(W * 0.01));
  const cw = Math.floor((W - padX * 2 - gap * 9) / 10), ch = Math.round(cw * 1.42);
  M = { W, H, gap, padX, cw, ch, top: 8, bottomH: ch + 16 };
  M.sw = Math.floor(cw * 0.66); M.sh = Math.round(M.sw * 1.42);
  board.style.setProperty('--cw', cw + 'px');
  board.style.setProperty('--ch', ch + 'px');
}
const colX = (c) => M.padX + c * (M.cw + M.gap);
const stockX = (g) => M.padX + g * Math.round(M.cw * 0.36);
const stockY = () => M.H - M.ch - 8;
const foundX = (k) => M.W - M.padX - (8 - k) * (M.sw + 3) + 3;
const foundY = () => M.H - M.sh - 10;

function buildSlots() {
  board.querySelectorAll('.slot').forEach((e) => e.remove());
  colSlots = []; foundSlots = [];
  for (let c = 0; c < 10; c++) { const e = document.createElement('div'); e.className = 'slot'; board.appendChild(e); colSlots.push(e); }
  for (let k = 0; k < 8; k++) { const e = document.createElement('div'); e.className = 'slot mini'; board.appendChild(e); foundSlots.push(e); }
  stockSlot = document.createElement('div'); stockSlot.className = 'slot mini'; board.appendChild(stockSlot);
}
function placeSlots() {
  colSlots.forEach((e, c) => Object.assign(e.style, { left: colX(c) + 'px', top: M.top + 'px', width: M.cw + 'px', height: M.ch + 'px' }));
  foundSlots.forEach((e, k) => Object.assign(e.style, { left: foundX(k) + 'px', top: foundY() + 'px', width: M.sw + 'px', height: M.sh + 'px' }));
  Object.assign(stockSlot.style, { left: stockX(0) + 'px', top: stockY() + 'px', width: M.cw + 'px', height: M.ch + 'px' });
}

// 열이 길어지면 카드가 겹치는 간격을 줄인다
function offsets() {
  const avail = M.H - M.bottomH - M.top - 4;
  // 세로 공간이 넉넉한 폰에서는 넓게 펴 놓고, 열이 길어져 모자라면 아래에서 줄인다
  let up = Math.round(M.ch * 0.56), down = Math.max(6, Math.round(M.ch * 0.2));
  const need = (u, d) => Math.max(...st.cols.map((col) => col.reduce((s, id, i) => (i === col.length - 1 ? s + M.ch : s + (st.up[id] ? u : d)), 0)));
  const n0 = need(up, down);
  if (n0 > avail) {
    const f = Math.max(0.3, (avail - M.ch) / (n0 - M.ch));
    up = Math.max(Math.round(M.cw * 0.4), Math.round(up * f)); down = Math.max(3, Math.round(down * f));
  }
  return { up, down };
}

function targets() {
  const { up, down } = offsets();
  const out = new Array(L.DECK);
  st.cols.forEach((col, c) => {
    let y = M.top;
    col.forEach((id, i) => { out[id] = { x: colX(c), y, z: 10 + i, s: 1, up: st.up[id], vis: true }; y += st.up[id] ? up : down; });
  });
  st.stock.forEach((id, j) => { out[id] = { x: stockX(Math.floor(j / 10)), y: stockY(), z: 1 + j, s: 1, up: false, vis: true }; });
  st.runs.forEach((run, k) => run.forEach((id, i) => { out[id] = { x: foundX(k), y: foundY(), z: 5 + i, s: M.sw / M.cw, up: true, vis: i === 0 }; }));
  return out;
}

function render() {
  if (!st) return;
  const t = targets();
  const dragging = drag && drag.started ? new Set(drag.ids) : null;
  for (let id = 0; id < L.DECK; id++) {
    const el = els[id], p = t[id];
    if (!p) continue;
    lastPos[id] = p;
    if (dragging && dragging.has(id)) continue;
    el.style.transform = `translate3d(${p.x}px,${p.y}px,0) scale(${p.s})`;
    el.style.zIndex = p.z;
    el.style.opacity = p.vis ? 1 : 0;
    el.classList.toggle('up', p.up);
  }
  // 빈 열 자리 표시, 더미 자리 표시
  colSlots.forEach((e, c) => { e.style.visibility = st.cols[c].length ? 'hidden' : 'visible'; });
  foundSlots.forEach((e, k) => { e.style.visibility = k < st.runs.length ? 'hidden' : 'visible'; });
  stockSlot.style.visibility = st.stock.length ? 'hidden' : 'visible';
  updateBar();
}

function buildCards() {
  els.forEach((e) => e && e.remove());
  els.length = 0;
  for (let id = 0; id < L.DECK; id++) {
    const c = st.cards[id];
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = id;
    el.style.color = SUIT_COLOR[c.s];
    el.style.transformOrigin = '0 0';
    el.innerHTML = `<div class="face"><div class="tl"><b>${RANK[c.r]}</b><i>${SUIT[c.s]}</i></div><div class="br">${SUIT[c.s]}</div></div><div class="back"></div>`;
    board.appendChild(el);
    els[id] = el;
  }
}

function fit() {
  const maxW = Math.min(innerWidth - 16, 860);
  colEl.style.width = maxW + 'px';
  const used = $('hud').offsetHeight + $('bar').offsetHeight + 8;
  board.style.height = Math.max(320, innerHeight - 16 - used - 14) + 'px';
  metrics();
  if (!stockSlot) buildSlots();
  placeSlots();
  render();
}
addEventListener('resize', fit);

// ---------- 화면 표시 ----------
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function updateHud() {
  $('score').textContent = st ? st.score.toLocaleString() : '500';
  $('moves').textContent = st ? st.moves : 0;
  $('time').textContent = fmtTime(elapsed);
}
function updateBar() {
  $('undoBtn').disabled = !hist.length || won;
  $('hintBtn').disabled = won || !playing;
}
let toastT = null;
function toast(msg, ms = 1800) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
}
function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 350); }

function clearHint() {
  clearTimeout(hintTimer);
  board.querySelectorAll('.card.hint').forEach((e) => e.classList.remove('hint'));
  board.querySelectorAll('.slot.hint, .slot.stockhint').forEach((e) => e.classList.remove('hint', 'stockhint'));
}
function showHint() {
  if (!st || won || !playing) return;
  const h = L.hint(st);
  clearHint();
  if (!h) { toast('움직일 수 있는 카드가 없어요'); sfx.nope(); return; }
  sfx.hint();
  if (h.type === 'deal') {
    toast('더미에서 카드를 나눠요 (왼쪽 아래)');
    st.stock.slice(-10).forEach((id) => els[id].classList.add('hint'));
  } else {
    st.cols[h.from].slice(h.idx).forEach((id) => els[id].classList.add('hint'));
    if (st.cols[h.to].length) els[st.cols[h.to][st.cols[h.to].length - 1]].classList.add('hint');
    else colSlots[h.to].classList.add('hint');
  }
  hintTimer = setTimeout(clearHint, 3200);
}

// ---------- 행동 ----------
const locate = (id) => {
  for (let c = 0; c < 10; c++) { const i = st.cols[c].indexOf(id); if (i >= 0) return { col: c, idx: i }; }
  return null;
};
function pushHist() { hist.push(L.snapshot(st)); if (hist.length > 600) hist.shift(); }

function afterAction(info) {
  clearHint();
  render();
  updateHud();
  save();
  if (info && info.run) { sfx.run(); toast('🎉 한 묶음 완성! +100'); }
  if (L.isWon(st)) return win();
  if (L.isStuck(st)) toast('더 움직일 수 없어요! 되돌리기나 새 게임을 눌러 보세요', 3500);
}

function doMove(from, idx, to) {
  pushHist();
  const info = L.move(st, from, idx, to);
  if (!info) { hist.pop(); return false; }
  if (!info.run) sfx.place();
  afterAction(info);
  return true;
}

function doDeal() {
  if (!st || won) return;
  if (!L.canDeal(st)) {
    if (!st.stock.length) toast('나눌 카드가 없어요');
    else toast('빈 열부터 채워 주세요!');
    sfx.nope();
    st.stock.slice(-10).forEach((id) => shake(els[id]));
    return;
  }
  pushHist();
  const r = L.dealStock(st);
  // 열마다 조금씩 늦게 날아가도록
  r.dealt.forEach(({ id, col }) => { els[id].style.transitionDelay = col * 40 + 'ms'; });
  clearTimeout(dealTimer); dealTimer = setTimeout(() => els.forEach((e) => { e.style.transitionDelay = ''; }), 700);
  sfx.deal();
  afterAction(r.runs.length ? { run: true } : null);
}

function undo() {
  if (!st || won || !hist.length) return;
  L.restore(st, hist.pop());
  st.moves++; st.score = Math.max(0, st.score - 1);       // 되돌리기도 한 번으로 친다
  sfx.undo();
  clearHint(); render(); updateHud(); save();
}

// ---------- 끌기·누르기 ----------
board.addEventListener('pointerdown', (e) => {
  if (!st || won || !playing || paused || !$('overlay').classList.contains('hidden')) return;
  const el = e.target.closest('.card');
  if (!el) return;
  const id = Number(el.dataset.id);
  if (st.stock.includes(id)) { doDeal(); return; }
  const loc = locate(id);
  if (!loc || !st.up[id]) return;
  if (!L.canPick(st, loc.col, loc.idx)) { shake(el); sfx.nope(); return; }
  try { board.setPointerCapture(e.pointerId); } catch (_) {}
  drag = { pid: e.pointerId, from: loc.col, idx: loc.idx, ids: st.cols[loc.col].slice(loc.idx), sx: e.clientX, sy: e.clientY, started: false };
  sfx.pick();
  clearHint();
});
board.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.started) {
    if (Math.hypot(dx, dy) < 7) return;
    drag.started = true;
    drag.ids.forEach((id, k) => { els[id].classList.add('dragging'); els[id].style.zIndex = 1000 + k; });
  }
  drag.ids.forEach((id) => {
    const p = lastPos[id];
    els[id].style.transform = `translate3d(${p.x + dx}px,${p.y + dy}px,0)`;
  });
  drag.dx = dx; drag.dy = dy;
});
function endDrag(e, cancel) {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag; drag = null;
  d.ids.forEach((id) => els[id].classList.remove('dragging'));
  if (!d.started) {
    // 그냥 누름: 가장 좋은 열로 자동 이동
    if (cancel) return;
    const to = L.bestTarget(st, d.from, d.idx);
    if (to >= 0) doMove(d.from, d.idx, to);
    else { shake(els[d.ids[0]]); sfx.nope(); toast('옮길 곳이 없어요'); }
    return;
  }
  if (!cancel) {
    // 끌어다 놓은 자리에서 가장 가까운 열부터 (놓을 수 있는 열만)
    const p0 = lastPos[d.ids[0]];
    const cx = p0.x + (d.dx || 0) + M.cw / 2;
    const near = Math.round((cx - M.padX - M.cw / 2) / (M.cw + M.gap));
    const cand = [near, near - 1, near + 1].filter((c) => c >= 0 && c < 10).sort((a, b) => Math.abs(colX(a) + M.cw / 2 - cx) - Math.abs(colX(b) + M.cw / 2 - cx));
    for (const c of cand) {
      if (L.canDrop(st, d.from, d.idx, c)) { if (doMove(d.from, d.idx, c)) return; }
    }
    sfx.nope();
  }
  render();          // 제자리로 돌아간다
}
board.addEventListener('pointerup', (e) => endDrag(e, false));
board.addEventListener('pointercancel', (e) => endDrag(e, true));
// 더미 자리(빈 칸)를 눌러도 나눈다
board.addEventListener('pointerdown', (e) => { if (e.target === stockSlot) doDeal(); });

// ---------- 저장·이어하기 ----------
function save() {
  if (!st || won) return;
  store.set(SAVE_KEY, JSON.stringify({ v: 1, st: L.serialize(st), elapsed }));
}
function loadSave() {
  try {
    const o = JSON.parse(store.get(SAVE_KEY) || 'null');
    if (!o || o.v !== 1) return null;
    const s = L.deserialize(o.st);
    if (!s || L.isWon(s)) return null;
    return { st: s, elapsed: Number(o.elapsed) || 0 };
  } catch (_) { return null; }
}

// ---------- 시작·끝 ----------
function startGame(m, seed) {
  mode = m;
  st = L.newGame(m, seed);
  hist = []; elapsed = 0; won = false; playing = true; paused = false;
  buildCards();
  hideOverlay();
  dealIn();
  updateHud(); save();
}
function resumeGame(data) {
  st = data.st; mode = st.mode; hist = []; elapsed = data.elapsed; won = false; playing = true; paused = false;
  buildCards();
  hideOverlay();
  metrics(); placeSlots();
  els.forEach((e) => { e.style.transition = 'none'; });
  render();
  void board.offsetWidth;
  els.forEach((e) => { e.style.transition = ''; });
  updateHud();
}
// 처음 깔 때: 더미 자리에서 열마다 차례로 날아간다
function dealIn() {
  metrics(); placeSlots();
  els.forEach((e, id) => { e.style.transition = 'none'; e.style.transform = `translate3d(${stockX(0)}px,${stockY()}px,0)`; e.style.opacity = 1; });
  void board.offsetWidth;
  let n = 0;
  for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) { const id = st.cols[c][r]; if (id !== undefined) els[id].style.transitionDelay = (n++ * 14) + 'ms'; }
  els.forEach((e) => { e.style.transition = ''; });
  render();
  sfx.deal();
  clearTimeout(dealTimer); dealTimer = setTimeout(() => els.forEach((e) => { e.style.transitionDelay = ''; }), 1600);
}

function win() {
  won = true; playing = false;
  store.del(SAVE_KEY);
  const secs = Math.max(1, Math.round(elapsed));
  const bonus = Math.floor(700000 / Math.max(30, secs));
  const base = st.score, total = base + bonus;
  const isBest = total > best[mode];
  if (isBest) {
    best[mode] = total; store.set('spiderBest' + mode, String(total));
    store.set('spiderBest', String(Math.max(best[1], best[2], best[4])));
  }
  updateHud(); render();
  sfx.win();
  setTimeout(() => showOverlay(`
    <h2>🎉 승리!</h2>
    <div class="big">${total.toLocaleString()}</div>
    <span class="tag">${isBest ? '🏆 최고 기록!' : `${MODE_NAME[mode]} 최고 ${best[mode].toLocaleString()}`}</span>
    <div class="card2"><dl class="stats">
      <dt>이동</dt><dd>${st.moves}번 → ${base}점</dd>
      <dt>걸린 시간</dt><dd>${fmtTime(secs)}</dd>
      <dt>시간 보너스</dt><dd>+${bonus.toLocaleString()}</dd>
    </dl></div>
    <button id="againBtn">새 게임</button>`), 900);
  setTimeout(() => { const b = $('againBtn'); if (b) b.onclick = () => showMenu(false); }, 950);
}

// ---------- 오버레이 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.scrollTop = 0; }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function choices(extra = '') {
  return `<div class="choices">${extra}
    ${[1, 2, 4].map((m) => `<button data-mode="${m}">${MODE_ICON[m]} ${MODE_NAME[m]}<small>${best[m] ? '최고 ' + best[m].toLocaleString() : '아직 기록 없음'}</small></button>`).join('')}
  </div>`;
}
function bindChoices() {
  document.querySelectorAll('#overlay [data-mode]').forEach((b) => { b.onclick = () => startGame(Number(b.dataset.mode)); });
  const c = $('contBtn'); if (c) c.onclick = () => { const d = loadSave(); if (d) resumeGame(d); };
  const r = $('restartBtn'); if (r) r.onclick = () => startGame(st.mode, st.seed);
  const x = $('closeBtn'); if (x) x.onclick = () => { hideOverlay(); paused = false; };
}
function showTitle() {
  playing = false;
  const s = loadSave();
  showOverlay(`
    <h1>스파이더<br>카드</h1>
    <p>같은 무늬로 <b>K부터 A까지</b> 13장을 이어 붙이면 사라져요.<br>8묶음을 모두 없애면 승리!</p>
    ${choices(s ? `<button id="contBtn">▶ 이어서 하기<small>${MODE_NAME[s.st.mode]} · ${s.st.runs.length}/8 묶음 · ${fmtTime(s.elapsed)}</small></button>` : '')}
    <div class="card2">
      👆 카드를 누르면 알아서 옮겨요 · 끌어서 옮겨도 돼요<br>
      🔢 놓을 곳은 '한 끗 큰 카드 위'나 빈 열<br>
      🂠 왼쪽 아래 더미를 누르면 열마다 한 장씩 나눠요 (빈 열이 없을 때)
    </div>`);
  bindChoices();
}
function showMenu(canClose = true) {
  paused = true;
  showOverlay(`
    <h2>새 게임</h2>
    ${choices(st && playing && !won ? '<button id="restartBtn" class="sub">↻ 같은 판 다시 시작</button>' : '')}
    ${canClose && st && !won ? '<button id="closeBtn" class="sub">닫기</button>' : ''}`);
  bindChoices();
}
function pause() {
  if (!playing || paused) return;
  paused = true;
  showOverlay(`<h2>일시정지</h2><button id="closeBtn">계속하기</button>`);
  bindChoices();
}

// ---------- 버튼·키 ----------
$('undoBtn').onclick = undo;
$('hintBtn').onclick = showHint;
$('newBtn').onclick = () => { if (st && playing && !won) showMenu(true); else showMenu(false); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); if (paused) { hideOverlay(); paused = false; } else pause(); };
function toggleMute() { muted = !muted; store.set('spiderMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyZ' || e.code === 'KeyU') undo();
  else if (e.code === 'KeyH') showHint();
  else if (e.code === 'KeyD' || e.code === 'Space') { if ($('overlay').classList.contains('hidden')) { e.preventDefault(); doDeal(); } }
  else if (e.code === 'KeyM') toggleMute();
  else if (e.code === 'KeyP' || e.code === 'Escape') { if (paused) { hideOverlay(); paused = false; } else pause(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
addEventListener('pagehide', save);

// ---------- 시계 ----------
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (playing && !paused && !won && !document.hidden) {
    elapsed += dt; hudClock += dt;
    if (hudClock > 0.25) { hudClock = 0; $('time').textContent = fmtTime(elapsed); }
  }
  requestAnimationFrame(tick);
}

// 시작: 타이틀 뒤에 빈 판을 깔아 둔다
st = L.newGame(1, 20240930);
buildCards();
fit();
showTitle();
requestAnimationFrame(tick);

// 테스트용
window.__sp = { get drag() { return drag; }, get lastPos() { return lastPos; }, get st() { return st; }, get hist() { return hist; }, get state() { return { playing, paused, won, elapsed }; }, doMove, doDeal, undo, showHint, startGame, locate, render, fit, get M() { return M; }, els };
})();
