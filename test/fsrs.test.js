// Checks the JS FSRS-6 port against reference output captured from py-fsrs 6.3.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler, Rating, State, newCard, bankersRound, DEFAULT_PARAMETERS } from '../src/fsrs.js';
import { vectors } from './helpers.js';

const V = vectors();
const EPOCH = Date.parse(V.epochIso);
const DAY = 86400000;
const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a} (diff ${Math.abs(a - b)})`);

test('default parameters match the py-fsrs 6.3.1 defaults exactly', () => {
  assert.equal(DEFAULT_PARAMETERS.length, 21);
  assert.deepEqual([...DEFAULT_PARAMETERS], V.parameters);
});

test('rejects a parameter vector that is not FSRS-6 shaped', () => {
  // 17 params is FSRS-4.5. Silently accepting it would mean running the wrong algorithm.
  assert.throws(() => new Scheduler({ parameters: new Array(17).fill(1) }), /21 parameters/);
});

test(`reproduces all ${V.sequences.length} py-fsrs review sequences`, () => {
  const s = new Scheduler();
  for (const seq of V.sequences) {
    let card = newCard(1, EPOCH);
    seq.steps.forEach((expected, i) => {
      const when = EPOCH + expected.atDay * DAY;
      card = s.review(card, expected.rating, when);
      const where = `seq ${JSON.stringify(seq.ratings)}@${JSON.stringify(seq.offsets)} step ${i}`;
      close(card.stability, expected.stability, 1e-9);
      close(card.difficulty, expected.difficulty, 1e-9);
      assert.equal(card.state, expected.state, `${where}: state`);
      assert.equal(card.step, expected.step, `${where}: step`);
      assert.equal(card.due - EPOCH, expected.dueMsFromEpoch, `${where}: due`);
    });
  }
});

test(`reproduces all ${V.intervals.length} py-fsrs _next_interval values`, () => {
  for (const v of V.intervals) {
    const s = new Scheduler({ desiredRetention: v.desiredRetention });
    assert.equal(s._nextInterval(v.stability), v.days,
      `S=${v.stability} R=${v.desiredRetention}`);
  }
});

test(`reproduces all ${V.retrievability.length} py-fsrs retrievability values`, () => {
  const s = new Scheduler();
  for (const v of V.retrievability) {
    const card = { ...newCard(1), stability: v.stability, lastReview: EPOCH };
    close(s.retrievability(card, EPOCH + v.elapsedDays * DAY), v.r, 1e-12);
  }
});

test('interval grows monotonically with stability', () => {
  const s = new Scheduler();
  let prev = 0;
  for (const stab of [0.1, 0.5, 1, 2, 5, 10, 40, 100, 400, 2000]) {
    const days = s._nextInterval(stab);
    assert.ok(days >= prev, `interval fell from ${prev} to ${days} at S=${stab}`);
    prev = days;
  }
});

test('a higher desired retention shortens the interval', () => {
  const stab = 50;
  const days = [0.7, 0.8, 0.9, 0.95].map(
    (r) => new Scheduler({ desiredRetention: r })._nextInterval(stab));
  for (let i = 1; i < days.length; i++) {
    assert.ok(days[i] < days[i - 1], `retention sweep not decreasing: ${days}`);
  }
  // Sanity anchor: at the default 0.9 the interval should be near the stability itself,
  // which is what stability means.
  assert.equal(new Scheduler()._nextInterval(50), 50);
});

test('interval is clamped to at least one day and at most maximumInterval', () => {
  const s = new Scheduler({ maximumInterval: 30 });
  assert.equal(s._nextInterval(0.001), 1);
  assert.equal(s._nextInterval(100000), 30);
});

test('Again on a graduated card drops it into Relearning on the 10 minute step', () => {
  const s = new Scheduler();
  let c = newCard(1, EPOCH);
  c = s.review(c, Rating.Good, EPOCH);          // learning step 1 -> step 2
  c = s.review(c, Rating.Good, EPOCH);          // graduates
  assert.equal(c.state, State.Review);
  const before = c.stability;
  const t = EPOCH + 10 * DAY;
  c = s.review(c, Rating.Again, t);
  assert.equal(c.state, State.Relearning);
  assert.equal(c.step, 0);
  assert.equal(c.due - t, 10 * 60000, 'relearning step is 10 minutes');
  assert.ok(c.stability < before, 'a lapse must not increase stability');
});

test('Again during learning resets to step 0 and comes due one minute later', () => {
  const s = new Scheduler();
  let c = newCard(1, EPOCH);
  c = s.review(c, Rating.Good, EPOCH);
  assert.equal(c.step, 1);
  c = s.review(c, Rating.Again, EPOCH);
  assert.equal(c.state, State.Learning);
  assert.equal(c.step, 0);
  assert.equal(c.due - EPOCH, 60000);
});

test('Easy graduates immediately from the first learning step', () => {
  const s = new Scheduler();
  const c = s.review(newCard(1, EPOCH), Rating.Easy, EPOCH);
  assert.equal(c.state, State.Review);
  assert.equal(c.step, null);
  assert.ok(c.due - EPOCH >= DAY);
});

test('difficulty stays inside [1, 10] under a long run of Again', () => {
  const s = new Scheduler();
  let c = newCard(1, EPOCH);
  for (let i = 0; i < 60; i++) c = s.review(c, Rating.Again, EPOCH + i * DAY);
  assert.ok(c.difficulty >= 1 && c.difficulty <= 10, `difficulty escaped: ${c.difficulty}`);
  assert.ok(c.stability >= 0.001);
});

test('review() does not mutate the card it is given', () => {
  const s = new Scheduler();
  const c = newCard(1, EPOCH);
  const snapshot = JSON.stringify(c);
  s.review(c, Rating.Good, EPOCH);
  assert.equal(JSON.stringify(c), snapshot);
});

test('bankersRound matches Python round() on halves', () => {
  assert.equal(bankersRound(0.5), 0);
  assert.equal(bankersRound(1.5), 2);
  assert.equal(bankersRound(2.5), 2);
  assert.equal(bankersRound(3.5), 4);
  assert.equal(bankersRound(2.4), 2);
  assert.equal(bankersRound(2.6), 3);
});
