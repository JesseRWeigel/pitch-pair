#!/usr/bin/env node
// Runs a simulated drill session and prints the per-pattern accuracy report.
//
//   node bin/simulate.js [--length 50] [--accuracy 0.7] [--seed 7] [--pairs-only]
//   node bin/simulate.js --perfect        a learner who gets everything right
//   node bin/simulate.js --weak nakadaka  a learner who fails one pattern every time

import { Session } from '../src/session.js';
import { buildDeck, patternCensus } from '../src/deck.js';
import { PATTERN_KEYS } from '../src/accent.js';
import { mulberry32 } from '../src/session.js';
import { rawPairs } from '../test/helpers.js';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const length = Number(flag('length', 50));
const seed = Number(flag('seed', 7));
const accuracy = Number(flag('accuracy', 0.7));
const weak = flag('weak', null);

const deck = buildDeck(rawPairs(), { pairsOnly: has('pairs-only') });
const census = patternCensus(deck);
console.log(`Deck: ${deck.length} items ` +
  `(${PATTERN_KEYS.map((k) => `${k} ${census[k]}`).join(', ')})`);
console.log(`Simulating a ${length} item session, seed ${seed}, ` +
  (has('perfect') ? 'perfect learner'
    : weak ? `learner who always misses ${weak}`
    : `learner with a ${(accuracy * 100).toFixed(0)}% hit rate`) + '\n');

const rng = mulberry32(seed + 1000);
const session = new Session({ deck, length, now: Date.parse('2026-01-01T00:00:00Z'), seed });
let item;
while ((item = session.next()) !== null) {
  let choice = item.pattern;
  const shouldMiss = has('perfect') ? false
    : weak ? item.pattern === weak
    : rng() > accuracy;
  if (shouldMiss) {
    const wrong = PATTERN_KEYS.filter((k) => k !== item.pattern);
    choice = wrong[Math.floor(rng() * wrong.length)];
  }
  session.answer(choice);
}

console.log(Session.formatReport(session.report()));
