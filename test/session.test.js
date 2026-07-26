// The acceptance test for EDU-013: a 50-item session must report per-pattern accuracy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { buildDeck } from '../src/deck.js';
import { State } from '../src/fsrs.js';
import { PATTERN_KEYS } from '../src/accent.js';
import { rawPairs } from './helpers.js';

const T0 = Date.parse('2026-01-01T00:00:00Z');
const deck = () => buildDeck(rawPairs());

/**
 * Drive a whole session with a policy function that decides what the learner picks.
 * @param {(item) => string} policy returns the pattern the simulated learner chooses
 */
function runSession(policy, opts = {}) {
  const s = new Session({ deck: deck(), length: 50, now: T0, seed: 7, ...opts });
  let item;
  while ((item = s.next()) !== null) s.answer(policy(item));
  return s;
}

test('a 50 item session asks exactly 50 items', () => {
  const s = runSession((it) => it.pattern);
  assert.equal(s.report().total, 50);
  assert.equal(s.answers.length, 50);
});

test('a 50 item session reports per-pattern accuracy for all four patterns', () => {
  // A learner who is right two times out of three, deterministically.
  let n = 0;
  const s = runSession((it) => {
    n += 1;
    if (n % 3 === 0) {
      const wrong = PATTERN_KEYS.filter((k) => k !== it.pattern);
      return wrong[n % wrong.length];
    }
    return it.pattern;
  });
  const rep = s.report();

  assert.equal(rep.total, 50);
  assert.ok(rep.accuracy > 0 && rep.accuracy < 1);

  let askedSum = 0;
  let correctSum = 0;
  for (const k of PATTERN_KEYS) {
    const p = rep.perPattern[k];
    assert.ok(k in rep.perPattern, `report is missing pattern ${k}`);
    assert.ok(p.asked > 0, `pattern ${k} was never asked, so its accuracy is unmeasured`);
    assert.equal(typeof p.accuracy, 'number');
    assert.ok(p.accuracy >= 0 && p.accuracy <= 1);
    assert.equal(p.accuracy, p.correct / p.asked, `${k} accuracy does not match its counts`);
    askedSum += p.asked;
    correctSum += p.correct;
  }
  assert.equal(askedSum, 50, 'per-pattern asked counts must sum to the session length');
  assert.equal(correctSum, rep.correct);
  assert.equal(rep.accuracy, rep.correct / rep.total);

  // The formatted report a human sees must actually contain the numbers.
  const text = Session.formatReport(rep);
  for (const k of PATTERN_KEYS) assert.match(text, new RegExp(k));
  assert.match(text, /Per-pattern accuracy/);
});

test('a perfect learner reports 100 percent on every pattern that was asked', () => {
  const rep = runSession((it) => it.pattern).report();
  assert.equal(rep.correct, 50);
  assert.equal(rep.accuracy, 1);
  for (const k of PATTERN_KEYS) {
    assert.equal(rep.perPattern[k].accuracy, 1, `${k} should be perfect`);
  }
  assert.equal(rep.scheduledMisses.length, 0);
});

test('per-pattern accuracy isolates the pattern the learner is bad at', () => {
  // This learner knows everything except nakadaka, which they always call heiban.
  const rep = runSession((it) => (it.pattern === 'nakadaka' ? 'heiban' : it.pattern)).report();
  assert.equal(rep.perPattern.nakadaka.accuracy, 0);
  assert.ok(rep.perPattern.nakadaka.asked > 0);
  for (const k of ['atamadaka', 'odaka']) {
    assert.equal(rep.perPattern[k].accuracy, 1, `${k} should be unaffected`);
  }
  // heiban items themselves were answered correctly, so heiban accuracy stays 1.
  assert.equal(rep.perPattern.heiban.accuracy, 1);
  // The confusion matrix should point straight at the mistake.
  assert.equal(rep.confusion.nakadaka.heiban, rep.perPattern.nakadaka.asked);
  assert.equal(rep.confusion.nakadaka.nakadaka, 0);
});

test('a pattern that was never asked reports null accuracy, not zero', () => {
  const s = new Session({ deck: deck(), length: 1, now: T0, seed: 7 });
  const item = s.next();
  s.answer(item.pattern);
  const rep = s.report();
  const unasked = PATTERN_KEYS.filter((k) => rep.perPattern[k].asked === 0);
  assert.ok(unasked.length >= 3);
  for (const k of unasked) {
    assert.equal(rep.perPattern[k].accuracy, null,
      'an unasked pattern must not be reported as 0% accuracy');
  }
  assert.match(Session.formatReport(rep), /n\/a/);
});

test('FSRS reschedules a missed item and it comes back inside the same session', () => {
  // Miss the very first item shown, answer everything else correctly, then check that
  // the one missed item is the one that comes round again.
  let target = null;
  const s = new Session({ deck: deck(), length: 50, now: T0, seed: 7 });
  let item;
  while ((item = s.next()) !== null) {
    if (target === null) {
      target = item;
      s.answer(item.pattern === 'heiban' ? 'atamadaka' : 'heiban');
    } else {
      s.answer(item.pattern);
    }
  }
  const showings = s.answers.filter((a) => a.itemId === target.id);
  assert.ok(showings.length >= 2,
    `a missed item should reappear in the session, saw it ${showings.length} time(s)`);
  assert.equal(showings[0].correct, false);
  assert.equal(showings[1].correct, true);
});

test('a miss puts the card on the one minute learning step, a hit pushes it out to days', () => {
  const d = deck();
  const s = new Session({ deck: d, length: 2, now: T0, seed: 7 });
  const item = s.next();
  const missed = s.answer('atamadaka' === item.pattern ? 'heiban' : 'atamadaka');
  assert.equal(missed.correct, false);
  assert.equal(missed.card.state, State.Learning);
  assert.equal(missed.card.step, 0);
  assert.equal(missed.card.due - T0, 60000, 'a missed new item is due again in one minute');

  const s2 = new Session({ deck: d, length: 2, now: T0, seed: 7 });
  const it2 = s2.next();
  const hit = s2.answer(it2.pattern);
  assert.equal(hit.correct, true);
  assert.ok(hit.card.due - T0 > 60000, 'a correct answer must schedule further out than a miss');
});

test('missed items dominate the session, which is the point of scheduling the misses', () => {
  const rep = runSession((it) => (it.pattern === 'nakadaka' ? 'heiban' : it.pattern)).report();
  assert.ok(rep.perPattern.nakadaka.asked > rep.perPattern.atamadaka.asked,
    'the pattern being failed should be drilled more than the ones being passed');
  assert.ok(rep.scheduledMisses.length > 0);
  for (const m of rep.scheduledMisses) {
    assert.ok(Number.isFinite(m.stability) && m.stability > 0);
    assert.ok(m.difficulty >= 1 && m.difficulty <= 10);
  }
});

test('session state round-trips through JSON so progress can persist', () => {
  const s1 = runSession((it) => it.pattern, { length: 20 });
  const saved = JSON.parse(JSON.stringify(s1.cards));
  const s2 = new Session({ deck: deck(), cards: saved, length: 10, now: T0 + 86400000, seed: 7 });
  let item;
  while ((item = s2.next()) !== null) s2.answer(item.pattern);
  assert.equal(s2.report().total, 10);
  // The cards carried over kept their learning history.
  const reviewed = Object.values(saved).filter((c) => c.lastReview !== null);
  assert.ok(reviewed.length > 0);
  assert.ok(reviewed.every((c) => c.stability > 0));
});

test('a later session drills the due backlog before introducing new words', () => {
  // Session one studies 20 words. A month later they are all overdue, so session two
  // must come back to them rather than treating the rest of the deck as more interesting.
  const s1 = runSession((it) => it.pattern, { length: 20 });
  const studied = new Set(s1.answers.map((a) => a.itemId));
  assert.ok(studied.size >= 15, `expected a decent backlog, got ${studied.size}`);

  const s2 = new Session({
    deck: deck(), cards: JSON.parse(JSON.stringify(s1.cards)),
    length: studied.size, now: T0 + 30 * 86400000, seed: 7,
  });
  let item;
  while ((item = s2.next()) !== null) s2.answer(item.pattern);

  const asked = s2.answers.map((a) => a.itemId);
  const fromBacklog = asked.filter((id) => studied.has(id)).length;
  assert.equal(fromBacklog, asked.length,
    `session two asked ${asked.length - fromBacklog} new words while ${studied.size} were due`);
});

test('a card missing from saved progress is created rather than crashing the session', () => {
  // Saved progress predates a word being added to the dataset.
  const partial = { 'ame:雨': { id: 'ame:雨', state: 2, step: null, stability: 5, difficulty: 5, due: T0, lastReview: T0 - 86400000 } };
  const s = new Session({ deck: deck(), cards: partial, length: 5, now: T0, seed: 7 });
  assert.equal(Object.keys(s.cards).length, deck().length);
  let item;
  while ((item = s.next()) !== null) s.answer(item.pattern);
  assert.equal(s.report().total, 5);
});

test('answer() rejects an unknown pattern and answering with nothing shown', () => {
  const s = new Session({ deck: deck(), length: 5, now: T0 });
  assert.throws(() => s.answer('heiban'), /no current item/);
  s.next();
  assert.throws(() => s.answer('kyoban'), /unknown pattern/);
});

test('the same seed replays the same session', () => {
  const a = runSession((it) => it.pattern).answers.map((x) => x.itemId);
  const b = runSession((it) => it.pattern).answers.map((x) => x.itemId);
  assert.deepEqual(a, b);
});
