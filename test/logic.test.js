'use strict';
// 스파이더 솔리테어 규칙 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

// 1무늬 카드 번호: 숫자 r(1~13)의 k 번째 벌 = k * 13 + (r - 1)
const id1 = (r, k = 0) => k * 13 + (r - 1);
// 1무늬 판을 손으로 만든다. cols 는 [[id, 앞면?] ...] 의 열 목록
function craft(cols, stock = []) {
  const st = L.newGame(1, 1);
  st.cols = cols.map((col) => col.map(([id]) => id));
  st.up = new Array(L.DECK).fill(false);
  cols.forEach((col) => col.forEach(([id, up]) => { st.up[id] = !!up; }));
  st.stock = stock; st.runs = []; st.score = L.START_SCORE; st.moves = 0;
  while (st.cols.length < L.COLS) st.cols.push([]);
  return st;
}

test('a new game: 54 cards in 10 columns (6,6,6,6,5,...), 50 in the stock, only the tops face up', () => {
  for (const mode of [1, 2, 4]) {
    const st = L.newGame(mode, 123);
    assert.deepStrictEqual(st.cols.map((c) => c.length), [6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
    assert.strictEqual(st.stock.length, 50);
    for (const col of st.cols) col.forEach((id, i) => assert.strictEqual(st.up[id], i === col.length - 1));
    assert.ok(L.validState(st));
    const suits = new Map();
    for (const c of st.cards) suits.set(c.s, (suits.get(c.s) || 0) + 1);
    assert.strictEqual(suits.size, mode);
    for (const v of suits.values()) assert.strictEqual(v, 104 / mode);
  }
  assert.deepStrictEqual(L.newGame(2, 5).cols, L.newGame(2, 5).cols, 'same seed, same deal');
});

test('picking: only a face-up run of the same suit going down by one', () => {
  const st = L.newGame(2, 1);
  const s = (suit, r) => st.cards.findIndex((c) => c.s === suit && c.r === r);
  st.cols[0] = [s(0, 9), s(0, 8), s(0, 7)];
  st.cols[1] = [s(0, 9), s(1, 8)].map((x, i) => (i ? x : st.cards.findIndex((c, j) => j !== s(0, 9) && c.s === 0 && c.r === 9)));
  for (const id of [...st.cols[0], ...st.cols[1]]) st.up[id] = true;
  assert.ok(L.canPick(st, 0, 0) && L.canPick(st, 0, 1) && L.canPick(st, 0, 2));
  assert.ok(!L.canPick(st, 1, 0), 'different suits do not form a run');
  assert.ok(L.canPick(st, 1, 1));
  st.up[st.cols[0][0]] = false;
  assert.ok(!L.canPick(st, 0, 0), 'face-down cards cannot be picked');
  assert.ok(!L.canPick(st, 0, 5));
});

test('dropping: on a card one higher of any suit, or on an empty column', () => {
  const st = craft([[[id1(9), 1], [id1(8), 1]], [[id1(5), 0], [id1(9, 1), 1]], [[id1(10), 1]]]);
  assert.ok(L.canDrop(st, 0, 0, 2), '9 on 10');
  assert.ok(!L.canDrop(st, 0, 0, 1), '9 on 9');
  assert.ok(L.canDrop(st, 0, 1, 1), '8 on 9');
  assert.ok(L.canDrop(st, 0, 0, 5), 'anything on an empty column');
  assert.ok(!L.canDrop(st, 0, 0, 0), 'not on itself');
  const r = L.move(st, 1, 1, 2);                     // 9 를 10 위로 → 아래 5 가 뒤집힌다
  assert.ok(r && r.flipped);
  assert.ok(st.up[id1(5)]);
  assert.strictEqual(st.moves, 1);
  assert.strictEqual(st.score, L.START_SCORE - 1);
  assert.strictEqual(L.move(st, 0, 0, 0), null);
});

test('completing K to A removes the run, flips the card under it and adds 100', () => {
  const run = [];
  for (let r = 13; r >= 2; r--) run.push([id1(r), 1]);
  const st = craft([[[id1(7, 1), 0], ...run], [[id1(1), 1]]]);
  const r = L.move(st, 1, 0, 0);
  assert.ok(r.run);
  assert.strictEqual(st.runs.length, 1);
  assert.deepStrictEqual(st.cols[0], [id1(7, 1)]);
  assert.ok(st.up[id1(7, 1)]);
  assert.strictEqual(st.score, L.START_SCORE - 1 + 100);
});

test('dealing: needs 10 cards and no empty column; deals one face-up card to each column', () => {
  const st = L.newGame(1, 9);
  assert.ok(L.canDeal(st));
  const r = L.dealStock(st);
  assert.strictEqual(r.dealt.length, 10);
  assert.strictEqual(st.stock.length, 40);
  for (const col of st.cols) assert.ok(st.up[col[col.length - 1]]);
  st.cols[3] = [];
  assert.ok(!L.canDeal(st));
  assert.strictEqual(L.dealStock(st), null);
});

test('save and load round-trip; broken saves are refused', () => {
  const st = L.newGame(4, 77);
  for (let k = 0; k < 20; k++) { const h = L.hint(st); if (!h) break; if (h.type === 'deal') L.dealStock(st); else L.move(st, h.from, h.idx, h.to); }
  const o = JSON.parse(JSON.stringify(L.serialize(st)));
  const back = L.deserialize(o);
  assert.deepStrictEqual(back.cols, st.cols);
  assert.deepStrictEqual(back.up, st.up);
  assert.strictEqual(back.score, st.score);
  const dup = JSON.parse(JSON.stringify(o)); dup.stock[0] = dup.cols[0][0];
  assert.strictEqual(L.deserialize(dup), null, 'a card twice');
  const lost = JSON.parse(JSON.stringify(o)); lost.stock.pop();
  assert.strictEqual(L.deserialize(lost), null, 'a card missing');
  const flip = JSON.parse(JSON.stringify(o)); const c = flip.cols.find((x) => x.length > 2 && !flip.up[x[1]]); flip.up[c[0]] = 1;
  assert.strictEqual(L.deserialize(flip), null, 'a face-down card above a face-up one');
});

test('snapshot and restore undo a move exactly', () => {
  const st = L.newGame(1, 3);
  const before = JSON.stringify(L.serialize(st));
  const snap = L.snapshot(st);
  const h = L.hint(st);
  if (h.type === 'deal') L.dealStock(st); else L.move(st, h.from, h.idx, h.to);
  assert.notStrictEqual(JSON.stringify(L.serialize(st)), before);
  L.restore(st, snap);
  assert.strictEqual(JSON.stringify(L.serialize(st)), before);
});

test('a pointless move (Q from one K to another K) is not a good hint, so the hint says to deal', () => {
  const st = craft([[[id1(13), 1], [id1(12), 1]], [[id1(13, 1), 1]], [[id1(5), 1]], [[id1(3), 1]], [[id1(9), 1]],
    [[id1(7), 1]], [[id1(1), 1]], [[id1(11, 2), 1]], [[id1(6, 2), 1]], [[id1(4, 2), 1]]], [id1(2, 3), id1(2, 4), id1(2, 5), id1(2, 6), id1(2, 7), id1(3, 3), id1(3, 4), id1(3, 5), id1(3, 6), id1(3, 7)]);
  assert.ok(L.canDrop(st, 0, 1, 1));
  assert.ok(L.rate(st, { from: 0, idx: 1, to: 1 }) < -10);
  assert.deepStrictEqual(L.hint(st), { type: 'deal' });
});

// 힌트만 따라 둔다. 같은 판이 다시 나오면(맴돌기) 멈춘다
function followHints(mode, seed) {
  const st = L.newGame(mode, seed), seen = new Set();
  for (let step = 0; step < 4000; step++) {
    if (L.isWon(st) || L.isStuck(st)) return { st, end: L.isWon(st) ? 'won' : 'stuck' };
    const key = JSON.stringify([st.cols, st.up, st.stock.length]);
    if (seen.has(key)) return { st, end: 'repeat' };
    seen.add(key);
    const h = L.hint(st);
    assert.ok(h, 'a game that is not stuck always has a hint');
    if (h.type === 'deal') assert.ok(L.dealStock(st));
    else assert.ok(L.move(st, h.from, h.idx, h.to));
    assert.ok(L.validState(st), `mode ${mode} seed ${seed} step ${step}`);
    assert.ok(st.score >= 0);
  }
  return { st, end: 'long' };
}

test('following the hint never goes round in circles while the stock still has cards', () => {
  // 예전엔 같은 두 수를 번갈아 알려 주며 더미 50장을 하나도 안 나눈 채 맴돌았다
  let wins = 0;
  for (const mode of [1, 2, 4]) {
    for (let seed = 1; seed <= 30; seed++) {
      const { st, end } = followHints(mode, seed);
      assert.notStrictEqual(end, 'long');
      if (end === 'repeat') assert.strictEqual(st.stock.length, 0, `mode ${mode} seed ${seed} repeats with ${st.stock.length} cards in the stock`);
      if (end === 'won') { wins++; assert.strictEqual(st.cols.flat().length + st.stock.length, 0); }
    }
  }
  assert.ok(wins >= 5, 'hint-only 1-suit games win sometimes: ' + wins);
});
