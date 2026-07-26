// Tokyo-standard pitch accent: mora segmentation, pattern classification, pitch contours.
//
// Japanese accent is described by a single "downstep" position, written [n] in
// dictionaries. n = 0 means no downstep. n > 0 means pitch drops immediately after mora n.
// Everything below follows from that one number plus the mora count.

export const PATTERNS = Object.freeze({
  heiban: { key: 'heiban', ja: '平板', en: 'flat', hint: 'no downstep, particle stays high' },
  atamadaka: { key: 'atamadaka', ja: '頭高', en: 'head-high', hint: 'drops after mora 1' },
  nakadaka: { key: 'nakadaka', ja: '中高', en: 'middle-high', hint: 'drops inside the word' },
  odaka: { key: 'odaka', ja: '尾高', en: 'tail-high', hint: 'drops on the particle' },
});
export const PATTERN_KEYS = Object.freeze(['heiban', 'atamadaka', 'nakadaka', 'odaka']);

// Small kana bind to the preceding mora (きょ is one mora, not two). Everything else,
// including っ, ん and the long vowel mark ー, counts as its own mora.
const SMALL_KANA = new Set([...'ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ']);

/** Split a kana reading into morae. */
export function morae(kana) {
  const out = [];
  for (const ch of kana) {
    if (SMALL_KANA.has(ch) && out.length > 0) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/**
 * Classify a downstep position into one of the four named patterns.
 * A one-mora word accented [1] is both atamadaka and odaka by the geometry; Japanese
 * pedagogy calls it atamadaka, so atamadaka is checked first.
 */
export function classify(accent, moraCount) {
  if (!Number.isInteger(accent) || accent < 0 || accent > moraCount) {
    throw new Error(`accent ${accent} out of range for ${moraCount} morae`);
  }
  if (accent === 0) return 'heiban';
  if (accent === 1) return 'atamadaka';
  if (accent === moraCount) return 'odaka';
  return 'nakadaka';
}

/**
 * High/low value per mora, plus the following particle.
 * Returns { morae: [{kana, high}], particleHigh }.
 *
 * The rules: mora 1 and mora 2 always differ in pitch. With a downstep at n, morae
 * 1..n are high except that mora 1 is low when n > 1. After n, everything is low.
 */
export function contour(kana, accent, particle = 'が') {
  const ms = morae(kana);
  const n = ms.length;
  if (accent > n) throw new Error(`accent ${accent} exceeds ${n} morae in ${kana}`);
  const high = ms.map((m, i) => {
    const pos = i + 1; // 1-indexed mora position
    if (accent === 0) return pos !== 1; // heiban: L then all H
    if (accent === 1) return pos === 1; // atamadaka: H then all L
    return pos !== 1 && pos <= accent; // drop after mora `accent`
  });
  return {
    morae: ms.map((m, i) => ({ kana: m, high: high[i] })),
    particle,
    // The particle is high only for heiban. Odaka is exactly the case where the word
    // itself looks like heiban but the particle drops, which is the whole reason a
    // trainer has to show the particle.
    particleHigh: accent === 0,
    pattern: classify(accent, n),
  };
}
