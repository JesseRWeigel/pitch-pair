// Turns pairs.json into a flat deck of drill items, each carrying its FSRS card.

import { classify, morae, contour } from './accent.js';

/**
 * @param {object} raw parsed pairs.json
 * @param {{pairsOnly?: boolean}} opts
 * @returns {Array<Item>} one item per word
 */
export function buildDeck(raw, { pairsOnly = false } = {}) {
  const items = [];
  for (const pair of raw.pairs) {
    const siblings = pair.members.map((m) => ({ word: m.word, gloss: m.gloss, accent: m.accent }));
    for (const m of pair.members) {
      items.push(makeItem({
        id: `${pair.id}:${m.word}`,
        word: m.word,
        reading: pair.reading,
        gloss: m.gloss,
        accent: m.accent,
        pairId: pair.id,
        note: pair.note ?? null,
        exemplar: false,
        // The other members of the minimal pair, shown as the contrast after answering.
        contrasts: siblings.filter((s) => s.word !== m.word),
      }));
    }
  }
  if (!pairsOnly) {
    for (const group of raw.exemplars ?? []) {
      for (const w of group.words) {
        items.push(makeItem({
          id: `exemplar:${w.word}`,
          word: w.word,
          reading: w.reading,
          gloss: w.gloss,
          accent: w.accent,
          pairId: null,
          note: null,
          exemplar: true,
          contrasts: [],
        }));
      }
    }
  }
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.id)) throw new Error(`duplicate deck item id: ${it.id}`);
    seen.add(it.id);
  }
  return items;
}

function makeItem(spec) {
  const ms = morae(spec.reading);
  if (spec.accent > ms.length) {
    throw new Error(`${spec.word}: accent ${spec.accent} exceeds ${ms.length} morae`);
  }
  return {
    ...spec,
    moraCount: ms.length,
    pattern: classify(spec.accent, ms.length),
    contour: contour(spec.reading, spec.accent),
  };
}

/** Count of deck items per accent pattern. Used by the README and by the tests. */
export function patternCensus(deck) {
  const out = { heiban: 0, atamadaka: 0, nakadaka: 0, odaka: 0 };
  for (const it of deck) out[it.pattern] += 1;
  return out;
}
