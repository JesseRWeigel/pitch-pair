import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morae, classify, contour, PATTERN_KEYS } from '../src/accent.js';
import { buildDeck, patternCensus } from '../src/deck.js';
import { rawPairs } from './helpers.js';

test('mora segmentation binds small kana and keeps ん, っ and ー separate', () => {
  assert.deepEqual(morae('はし'), ['は', 'し']);
  assert.deepEqual(morae('にほん'), ['に', 'ほ', 'ん']);
  assert.deepEqual(morae('しんかんせん'), ['し', 'ん', 'か', 'ん', 'せ', 'ん']);
  assert.deepEqual(morae('じてんしゃ'), ['じ', 'て', 'ん', 'しゃ']);
  assert.deepEqual(morae('きょう'), ['きょ', 'う']);
  assert.deepEqual(morae('がっこう'), ['が', 'っ', 'こ', 'う']);
  assert.deepEqual(morae('コーヒー'), ['コ', 'ー', 'ヒ', 'ー']);
});

test('classify maps downstep position to the four named patterns', () => {
  assert.equal(classify(0, 2), 'heiban');
  assert.equal(classify(1, 2), 'atamadaka');
  assert.equal(classify(2, 2), 'odaka');
  assert.equal(classify(2, 3), 'nakadaka');
  assert.equal(classify(3, 3), 'odaka');
  assert.equal(classify(3, 4), 'nakadaka');
  assert.equal(classify(0, 5), 'heiban');
  // A one-mora word accented [1] is called atamadaka, not odaka.
  assert.equal(classify(1, 1), 'atamadaka');
});

test('classify rejects an out-of-range downstep', () => {
  assert.throws(() => classify(3, 2), /out of range/);
  assert.throws(() => classify(-1, 2), /out of range/);
});

test('heiban and odaka are identical across the word and differ only on the particle', () => {
  const heiban = contour('はな', 0);  // 鼻
  const odaka = contour('はな', 2);   // 花
  assert.deepEqual(heiban.morae.map((m) => m.high), odaka.morae.map((m) => m.high),
    'the word itself must look the same, that is what makes this pair hard');
  assert.equal(heiban.particleHigh, true);
  assert.equal(odaka.particleHigh, false);
  assert.equal(heiban.pattern, 'heiban');
  assert.equal(odaka.pattern, 'odaka');
});

test('contours follow the downstep rules', () => {
  assert.deepEqual(contour('はし', 1).morae.map((m) => m.high), [true, false]);   // atamadaka
  assert.deepEqual(contour('はし', 2).morae.map((m) => m.high), [false, true]);   // odaka
  assert.deepEqual(contour('はし', 0).morae.map((m) => m.high), [false, true]);   // heiban
  assert.deepEqual(contour('にほん', 2).morae.map((m) => m.high), [false, true, false]);
  assert.deepEqual(contour('しんかんせん', 3).morae.map((m) => m.high),
    [false, true, true, false, false, false]);
});

test('mora 1 and mora 2 always differ in pitch, which is the core rule of Tokyo accent', () => {
  for (let n = 2; n <= 6; n++) {
    for (let a = 0; a <= n; a++) {
      const c = contour('あ'.repeat(n), a);
      assert.notEqual(c.morae[0].high, c.morae[1].high, `n=${n} accent=${a}`);
    }
  }
});

test('pitch never rises again after the downstep', () => {
  for (let n = 2; n <= 6; n++) {
    for (let a = 0; a <= n; a++) {
      const seq = contour('あ'.repeat(n), a).morae.map((m) => m.high);
      const firstLowAfterHigh = seq.findIndex((h, i) => i > 0 && !h && seq[i - 1]);
      if (firstLowAfterHigh > 0) {
        assert.ok(seq.slice(firstLowAfterHigh).every((h) => !h),
          `pitch rose after the drop: n=${n} accent=${a} ${seq}`);
      }
    }
  }
});

test('every dataset entry has a valid accent for its mora count', () => {
  const raw = rawPairs();
  for (const pair of raw.pairs) {
    const n = morae(pair.reading).length;
    for (const m of pair.members) {
      assert.ok(Number.isInteger(m.accent) && m.accent >= 0 && m.accent <= n,
        `${m.word} (${pair.reading}): accent ${m.accent} invalid for ${n} morae`);
    }
  }
  for (const g of raw.exemplars) {
    for (const w of g.words) {
      const n = morae(w.reading).length;
      assert.ok(w.accent >= 0 && w.accent <= n,
        `${w.word}: accent ${w.accent} invalid for ${n} morae`);
    }
  }
});

test('every minimal pair really is minimal: same reading, distinct accents', () => {
  for (const pair of rawPairs().pairs) {
    const accents = pair.members.map((m) => m.accent);
    assert.equal(new Set(accents).size, accents.length,
      `${pair.id} has two members with the same accent, so it is not a contrast`);
    assert.ok(pair.members.length >= 2, `${pair.id} needs at least two members`);
  }
});

test('the deck covers all four patterns', () => {
  const census = patternCensus(buildDeck(rawPairs()));
  for (const k of PATTERN_KEYS) {
    assert.ok(census[k] > 0, `no deck items for ${k}: ${JSON.stringify(census)}`);
  }
});

test('--pairs-only drops the exemplars and keeps every minimal pair word', () => {
  const raw = rawPairs();
  const full = buildDeck(raw);
  const only = buildDeck(raw, { pairsOnly: true });
  const pairWords = raw.pairs.reduce((n, p) => n + p.members.length, 0);
  assert.equal(only.length, pairWords);
  assert.ok(full.length > only.length);
  assert.ok(only.every((it) => !it.exemplar));
});

test('each pair member lists its siblings as contrasts', () => {
  const deck = buildDeck(rawPairs(), { pairsOnly: true });
  const hashi = deck.filter((it) => it.pairId === 'hashi');
  assert.equal(hashi.length, 3);
  for (const it of hashi) {
    assert.equal(it.contrasts.length, 2);
    assert.ok(!it.contrasts.some((c) => c.word === it.word));
  }
});
