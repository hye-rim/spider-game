'use strict';

// 스파이더 솔리테어: 판 규칙만 모아 둔 파일 (그리기·입력 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 카드 104장(2벌): 1무늬는 ♠ 8벌, 2무늬는 ♠·♥ 4벌씩, 4무늬는 4무늬 2벌씩
// - 10열에 54장을 깔고(앞 4열 6장, 나머지 5장), 맨 위 한 장만 앞면. 나머지 50장은 더미(stock)
// - 같은 무늬로 K→A 까지 13장이 이어지면 그 묶음이 사라진다. 8번 사라지면 승리
// - 옮기는 법: 같은 무늬로 1씩 줄어드는 묶음을 통째로 옮긴다. 놓을 곳은 '한 끗 큰 카드 위'(무늬 상관없음)나 빈 열
// - 더미: 빈 열이 없을 때 한 번에 10장을 열마다 한 장씩 나눠 준다 (5번)
//
// 상태(st): { mode, seed, cards:[{s,r}], cols:[[id]], up:[bool], stock:[id], runs:[[id×13]], score, moves }
const COLS = 10, RANKS = 13, RUNS_TO_WIN = 8, DECK = 104;
const START_SCORE = 500;

function rng(seed) {                                 // mulberry32: 같은 씨앗이면 같은 배치
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCards(mode) {
  const cards = [];
  const suits = mode === 1 ? [0] : mode === 2 ? [0, 1] : [0, 1, 2, 3];
  const sets = 8 / suits.length;                      // 무늬마다 몇 벌
  for (let k = 0; k < sets; k++) for (const s of suits) for (let r = 1; r <= RANKS; r++) cards.push({ s, r });
  return cards;                                        // 길이 104, id 는 이 배열의 위치
}

function newGame(mode = 1, seed = (Math.random() * 2 ** 31) | 0) {
  const cards = makeCards(mode);
  const order = cards.map((_, i) => i);
  const rand = rng(seed);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const st = { mode, seed, cards, cols: Array.from({ length: COLS }, () => []), up: new Array(DECK).fill(false), stock: [], runs: [], score: START_SCORE, moves: 0 };
  let p = 0;
  for (let c = 0; c < COLS; c++) {
    const n = c < 4 ? 6 : 5;
    for (let i = 0; i < n; i++) st.cols[c].push(order[p++]);
    st.up[st.cols[c][n - 1]] = true;
  }
  st.stock = order.slice(p);                          // 나눌 때는 맨 뒤에서 꺼낸다
  return st;
}

const topOf = (st, c) => st.cols[c][st.cols[c].length - 1];

// c 열의 idx 번째 카드부터 끝까지가 '같은 무늬로 1씩 줄어드는' 묶음인가 (앞면이어야 한다)
function canPick(st, c, idx) {
  const col = st.cols[c];
  if (idx < 0 || idx >= col.length || !st.up[col[idx]]) return false;
  for (let i = idx; i < col.length - 1; i++) {
    const a = st.cards[col[i]], b = st.cards[col[i + 1]];
    if (a.s !== b.s || a.r !== b.r + 1) return false;
  }
  return true;
}

// 그 묶음을 to 열에 놓을 수 있는가 (빈 열이거나, 맨 위 카드가 묶음 첫 카드보다 한 끗 큼)
function canDrop(st, c, idx, to) {
  if (to === c || !canPick(st, c, idx)) return false;
  if (!st.cols[to].length) return true;
  return st.cards[topOf(st, to)].r === st.cards[st.cols[c][idx]].r + 1;
}

// 맨 위 카드가 앞면이 아니면 뒤집는다
function flipTop(st, c) {
  const col = st.cols[c];
  if (col.length && !st.up[col[col.length - 1]]) { st.up[col[col.length - 1]] = true; return true; }
  return false;
}

// c 열 끝의 K→A 13장 묶음이 있으면 떼어 낸다. 떼어 낸 묶음(없으면 null)
function takeRun(st, c) {
  const col = st.cols[c];
  if (col.length < RANKS) return null;
  const base = col.length - RANKS;
  if (!canPick(st, c, base)) return null;
  if (st.cards[col[base]].r !== RANKS || st.cards[col[col.length - 1]].r !== 1) return null;
  const run = col.splice(base, RANKS);
  st.runs.push(run);
  st.score += 100;
  flipTop(st, c);
  return run;
}

// 묶음 옮기기. 돌려주는 값: { from, to, idx, flipped, run } (안 되면 null)
function move(st, c, idx, to) {
  if (!canDrop(st, c, idx, to)) return null;
  const moved = st.cols[c].splice(idx);
  st.cols[to].push(...moved);
  const flipped = flipTop(st, c);
  st.moves++; st.score = Math.max(0, st.score - 1);
  const run = takeRun(st, to);
  return { from: c, to, idx, count: moved.length, flipped, run };
}

const canDeal = (st) => st.stock.length >= COLS && st.cols.every((col) => col.length > 0);

// 더미에서 열마다 한 장씩 앞면으로 나눈다. 돌려주는 값: { dealt:[{id, col}], runs:[{col, run}] } (안 되면 null)
function dealStock(st) {
  if (!canDeal(st)) return null;
  const dealt = [], runs = [];
  for (let c = 0; c < COLS; c++) {
    const id = st.stock.pop();
    st.up[id] = true;
    st.cols[c].push(id);
    dealt.push({ id, col: c });
  }
  st.moves++; st.score = Math.max(0, st.score - 1);
  for (let c = 0; c < COLS; c++) { const run = takeRun(st, c); if (run) runs.push({ col: c, run }); }
  return { dealt, runs };
}

// 지금 할 수 있는 모든 옮기기
function legalMoves(st) {
  const out = [];
  for (let c = 0; c < COLS; c++) {
    const col = st.cols[c];
    for (let idx = 0; idx < col.length; idx++) {
      if (!canPick(st, c, idx)) continue;
      for (let to = 0; to < COLS; to++) if (canDrop(st, c, idx, to)) out.push({ from: c, idx, to });
    }
  }
  return out;
}

// 옮기기의 좋고 나쁨 (힌트와 탭 자동 이동이 고른다)
function rate(st, m) {
  const col = st.cols[m.from], card = st.cards[col[m.idx]];
  const dest = st.cols[m.to];
  let s = 0;
  if (dest.length) {
    const t = st.cards[dest[dest.length - 1]];
    if (t.s === card.s) s += 50;                       // 같은 무늬 위에 붙이면 묶음이 길어진다
    else s -= 6;                                        // 다른 무늬 위는 나중에 풀어야 한다
  } else s -= 12;                                       // 빈 열은 아껴 둔다
  if (m.idx > 0) {
    const below = st.cards[col[m.idx - 1]];
    if (!st.up[col[m.idx - 1]]) s += 30;                // 뒤집힌 카드가 드러난다
    else if (below.s === card.s && below.r === card.r + 1) s -= 45;   // 이미 이어진 묶음을 끊는다
  } else if (dest.length) s += 18;                      // 열이 통째로 비어 새 자리가 생긴다
  // 묶음 길이가 길수록 조금 더 좋다
  s += Math.min(col.length - m.idx, 6);
  const newLen = dest.length ? runLenAfter(st, m) : col.length - m.idx;
  if (newLen >= RANKS) s += 100;                        // 한 묶음이 완성된다
  return s;
}
function runLenAfter(st, m) {
  // m 을 한 뒤 to 열 끝의 같은 무늬 묶음 길이
  const col = st.cols[m.from], dest = st.cols[m.to];
  const seq = [...dest, ...col.slice(m.idx)];
  let n = 1;
  for (let i = seq.length - 1; i > 0; i--) {
    const a = st.cards[seq[i - 1]], b = st.cards[seq[i]];
    if (a.s === b.s && a.r === b.r + 1 && st.up[seq[i - 1]]) n++; else break;
  }
  return n;
}
function bestMove(st, filter) {
  let best = null, bs = -Infinity;
  for (const m of legalMoves(st)) {
    if (filter && !filter(m)) continue;
    const s = rate(st, m);
    if (s > bs) { bs = s; best = m; }
  }
  return best;
}
// 이 묶음(c, idx)을 옮길 가장 좋은 열 (탭 자동 이동). 없으면 -1
function bestTarget(st, c, idx) {
  const m = bestMove(st, (x) => x.from === c && x.idx === idx);
  return m ? m.to : -1;
}

// 힌트: 옮길 수 있으면 { type:'move', from, idx, to }, 더미를 나눌 수 있으면 { type:'deal' }, 아무것도 없으면 null
function hint(st) {
  const m = bestMove(st);
  // 의미 없는 옮기기(빈 열끼리 돌려 놓기 등)는 힌트로 주지 않는다
  if (m && rate(st, m) > -10) return { type: 'move', ...m };
  if (canDeal(st)) return { type: 'deal' };
  return m ? { type: 'move', ...m } : null;
}

const isWon = (st) => st.runs.length === RUNS_TO_WIN;
// 더 할 수 있는 게 없다: 옮길 곳도, 나눌 더미도 없다
const isStuck = (st) => !isWon(st) && legalMoves(st).length === 0 && !canDeal(st) && (st.stock.length < COLS || st.cols.some((c) => !c.length));

// 되돌리기용 복사본
function snapshot(st) {
  return { cols: st.cols.map((c) => c.slice()), up: st.up.slice(), stock: st.stock.slice(), runs: st.runs.map((r) => r.slice()), score: st.score, moves: st.moves };
}
function restore(st, snap) {
  st.cols = snap.cols.map((c) => c.slice()); st.up = snap.up.slice(); st.stock = snap.stock.slice();
  st.runs = snap.runs.map((r) => r.slice()); st.score = snap.score; st.moves = snap.moves;
}

// 저장·불러오기 (이어하기)
function serialize(st) { return { mode: st.mode, seed: st.seed, cols: st.cols, up: st.up.map((u) => (u ? 1 : 0)), stock: st.stock, runs: st.runs, score: st.score, moves: st.moves }; }
function deserialize(o) {
  const st = { mode: o.mode, seed: o.seed, cards: makeCards(o.mode), cols: o.cols, up: o.up.map((u) => !!u), stock: o.stock, runs: o.runs, score: o.score, moves: o.moves };
  if (!validState(st)) return null;
  return st;
}

// 상태가 앞뒤가 맞는가 (카드 104장이 한 번씩, 뒷면은 열의 아래쪽에만, 완성 묶음은 13장)
function validState(st) {
  const seen = new Set();
  const add = (id) => { if (!Number.isInteger(id) || id < 0 || id >= DECK || seen.has(id)) return false; seen.add(id); return true; };
  for (const col of st.cols) {
    let faceUp = false;
    for (const id of col) { if (!add(id)) return false; if (st.up[id]) faceUp = true; else if (faceUp) return false; }
  }
  for (const id of st.stock) if (!add(id)) return false;
  for (const run of st.runs) { if (run.length !== RANKS) return false; for (const id of run) if (!add(id)) return false; }
  return seen.size === DECK;
}

const LOGIC = { COLS, RANKS, DECK, RUNS_TO_WIN, START_SCORE, newGame, makeCards, canPick, canDrop, move, dealStock, canDeal, legalMoves, bestMove, bestTarget, hint, rate, isWon, isStuck, snapshot, restore, serialize, deserialize, validState, takeRun, flipTop };
if (typeof module !== 'undefined') module.exports = LOGIC;
