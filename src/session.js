// A drill session: item selection, grading, FSRS scheduling, per-pattern accuracy report.

import { Scheduler, Rating, newCard } from './fsrs.js';
import { PATTERN_KEYS } from './accent.js';

/** Small deterministic PRNG so a session can be replayed exactly in tests. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Session {
  /**
   * @param {object} o
   * @param {Array} o.deck        items from buildDeck()
   * @param {object} [o.cards]    itemId -> FSRS card, carried over between sessions
   * @param {number} [o.length]   how many items the session asks
   * @param {number} [o.now]      epoch ms the session starts at
   * @param {number} [o.secondsPerItem] how far the clock advances per answer
   */
  constructor({
    deck,
    scheduler = new Scheduler(),
    cards = null,
    length = 50,
    now = Date.now(),
    seed = 1,
    secondsPerItem = 20,
  }) {
    if (!deck.length) throw new Error('empty deck');
    this.deck = deck;
    this.byId = new Map(deck.map((it) => [it.id, it]));
    this.scheduler = scheduler;
    // Fill in any deck item the caller did not supply a card for. Saved progress from an
    // older version of the dataset will be missing cards for words added since.
    this.cards = Object.fromEntries(
      deck.map((it) => [it.id, cards?.[it.id] ?? newCard(it.id, now)]));
    this.length = length;
    this.clock = now;
    this.secondsPerItem = secondsPerItem;
    this.rng = mulberry32(seed);
    this.answers = [];
    this.current = null;
    this.lastAskedId = null;
    this.askedCount = Object.fromEntries(PATTERN_KEYS.map((k) => [k, 0]));
  }

  get finished() {
    return this.answers.length >= this.length;
  }

  /** The next item to show, or null once the session is over. */
  next() {
    if (this.finished) {
      this.current = null;
      return null;
    }
    this.current = this._select();
    this.lastAskedId = this.current.id;
    return this.current;
  }

  _select() {
    const pool = this.deck.filter((it) => it.id !== this.lastAskedId);
    const candidates = pool.length ? pool : this.deck;

    // 1. Anything FSRS says is due right now. This covers two cases with one rule: an item
    //    missed earlier in this session went back to learning step 0 and is due a minute
    //    later, and an item studied in a previous session has come round again. The test
    //    is lastReview rather than "seen this session", otherwise a returning learner's
    //    due backlog would be treated as new material and the schedule would be ignored.
    const due = candidates
      .filter((it) => this.cards[it.id].lastReview !== null && this.cards[it.id].due <= this.clock)
      .sort((a, b) => this.cards[a.id].due - this.cards[b.id].due);
    if (due.length) return due[0];

    // 2. Otherwise introduce an item never studied, favouring whichever pattern has been
    //    asked least so far. Per-pattern accuracy needs a spread of patterns to mean much.
    const unseen = candidates.filter((it) => this.cards[it.id].lastReview === null);
    if (unseen.length) {
      const min = Math.min(...unseen.map((it) => this.askedCount[it.pattern]));
      const tier = unseen.filter((it) => this.askedCount[it.pattern] === min);
      return tier[Math.floor(this.rng() * tier.length)];
    }

    // 3. Deck exhausted and nothing due yet. Take whatever is due soonest.
    return [...candidates].sort((a, b) => this.cards[a.id].due - this.cards[b.id].due)[0];
  }

  /**
   * Grade an answer. `chosen` is one of PATTERN_KEYS.
   * `rating` optionally overrides the default grading so a UI can offer Hard/Easy.
   */
  answer(chosen, rating = null) {
    if (!this.current) throw new Error('answer() called with no current item, call next() first');
    if (!PATTERN_KEYS.includes(chosen)) throw new Error(`unknown pattern: ${chosen}`);
    const item = this.current;
    const correct = chosen === item.pattern;
    const r = rating ?? (correct ? Rating.Good : Rating.Again);

    this.cards[item.id] = this.scheduler.review(this.cards[item.id], r, this.clock);
    this.askedCount[item.pattern] += 1;
    this.answers.push({
      itemId: item.id,
      word: item.word,
      expected: item.pattern,
      chosen,
      correct,
      rating: r,
      at: this.clock,
      nextDue: this.cards[item.id].due,
    });

    this.clock += this.secondsPerItem * 1000;
    this.current = null;
    return { correct, expected: item.pattern, card: this.cards[item.id] };
  }

  /**
   * Per-pattern accuracy plus a confusion matrix.
   * Patterns never asked report asked: 0 and accuracy: null rather than a fake 0%,
   * because 0% and "not measured" are different things.
   */
  report() {
    const perPattern = {};
    for (const k of PATTERN_KEYS) {
      perPattern[k] = { asked: 0, correct: 0, accuracy: null };
    }
    const confusion = {};
    for (const k of PATTERN_KEYS) {
      confusion[k] = Object.fromEntries(PATTERN_KEYS.map((j) => [j, 0]));
    }
    for (const a of this.answers) {
      const p = perPattern[a.expected];
      p.asked += 1;
      if (a.correct) p.correct += 1;
      confusion[a.expected][a.chosen] += 1;
    }
    for (const k of PATTERN_KEYS) {
      const p = perPattern[k];
      if (p.asked > 0) p.accuracy = p.correct / p.asked;
    }
    const correct = this.answers.filter((a) => a.correct).length;
    const missed = [...new Set(this.answers.filter((a) => !a.correct).map((a) => a.itemId))];
    return {
      total: this.answers.length,
      correct,
      accuracy: this.answers.length ? correct / this.answers.length : null,
      perPattern,
      confusion,
      // What FSRS decided to do with the items that were missed.
      scheduledMisses: missed.map((id) => ({
        itemId: id,
        word: this.byId.get(id).word,
        state: this.cards[id].state,
        stability: this.cards[id].stability,
        difficulty: this.cards[id].difficulty,
        dueInMinutes: (this.cards[id].due - this.clock) / 60000,
      })).sort((a, b) => a.dueInMinutes - b.dueInMinutes),
    };
  }

  /** Human-readable version of report(), used by the CLI harness and the web UI. */
  static formatReport(rep) {
    const pct = (x) => (x === null ? '  n/a' : `${(x * 100).toFixed(1).padStart(5)}%`);
    const lines = [
      `Session: ${rep.correct}/${rep.total} correct (${pct(rep.accuracy).trim()})`,
      '',
      'Per-pattern accuracy',
      '  pattern      asked  correct  accuracy',
    ];
    for (const k of PATTERN_KEYS) {
      const p = rep.perPattern[k];
      lines.push(
        `  ${k.padEnd(12)}${String(p.asked).padStart(5)}${String(p.correct).padStart(9)}` +
        `${pct(p.accuracy).padStart(10)}`);
    }
    lines.push('', 'Confusion (rows = correct pattern, columns = what was picked)');
    lines.push('              ' + PATTERN_KEYS.map((k) => k.slice(0, 8).padStart(9)).join(''));
    for (const k of PATTERN_KEYS) {
      lines.push('  ' + k.padEnd(12) +
        PATTERN_KEYS.map((j) => String(rep.confusion[k][j]).padStart(9)).join(''));
    }
    if (rep.scheduledMisses.length) {
      lines.push('', `FSRS rescheduled ${rep.scheduledMisses.length} missed item(s):`);
      for (const m of rep.scheduledMisses.slice(0, 10)) {
        lines.push(`  ${m.word.padEnd(6)} state=${m.state} ` +
          `S=${m.stability.toFixed(3)} D=${m.difficulty.toFixed(2)} ` +
          `due in ${m.dueInMinutes.toFixed(1)} min`);
      }
      if (rep.scheduledMisses.length > 10) {
        lines.push(`  ... and ${rep.scheduledMisses.length - 10} more`);
      }
    }
    return lines.join('\n');
  }
}
