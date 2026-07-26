// FSRS-6 (Free Spaced Repetition Scheduler), ported to plain JavaScript.
//
// This is a real port of FSRS-6, not SM-2. It follows the reference implementation
// py-fsrs 6.3.1 (https://github.com/open-spaced-repetition/py-fsrs, MIT), including the
// 21 default parameters, the short-term stability path, linear damping and mean reversion
// in the difficulty update, and the Learning / Review / Relearning state machine.
//
// test/fsrs_vectors.json holds outputs captured from py-fsrs 6.3.1 itself, and
// test/run.js asserts this port reproduces them. See README for how those were generated.
//
// Fuzzing is deliberately not implemented. py-fsrs enables it by default, but it draws on
// a random number generator, which would make the port impossible to check against fixed
// vectors. Every scheduler here behaves as py-fsrs does with enable_fuzzing=False.

export const Rating = Object.freeze({ Again: 1, Hard: 2, Good: 3, Easy: 4 });
export const State = Object.freeze({ Learning: 1, Review: 2, Relearning: 3 });

// py-fsrs 6.3.1 DEFAULT_PARAMETERS. Index 20 is the decay term.
export const DEFAULT_PARAMETERS = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
]);

const STABILITY_MIN = 0.001;
const MIN_DIFFICULTY = 1.0;
const MAX_DIFFICULTY = 10.0;
const DAY_MS = 86400000;
const MINUTE_MS = 60000;

const clampD = (d) => Math.min(Math.max(d, MIN_DIFFICULTY), MAX_DIFFICULTY);
const clampS = (s) => Math.max(s, STABILITY_MIN);

/** A single review item. Times are epoch milliseconds so the whole thing JSON round-trips. */
export function newCard(id, due = null) {
  return {
    id,
    state: State.Learning,
    step: 0,
    stability: null,
    difficulty: null,
    due: due === null ? Date.now() : due,
    lastReview: null,
  };
}

export class Scheduler {
  constructor({
    parameters = DEFAULT_PARAMETERS,
    desiredRetention = 0.9,
    learningSteps = [1 * MINUTE_MS, 10 * MINUTE_MS],
    relearningSteps = [10 * MINUTE_MS],
    maximumInterval = 36500,
  } = {}) {
    if (parameters.length !== 21) {
      throw new Error(`FSRS-6 needs 21 parameters, got ${parameters.length}`);
    }
    this.w = [...parameters];
    this.desiredRetention = desiredRetention;
    this.learningSteps = [...learningSteps];
    this.relearningSteps = [...relearningSteps];
    this.maximumInterval = maximumInterval;
    this.DECAY = -this.w[20];
    this.FACTOR = Math.pow(0.9, 1 / this.DECAY) - 1;
  }

  /** Predicted probability of recall right now. 0 for a card never reviewed. */
  retrievability(card, now = Date.now()) {
    if (card.lastReview === null || card.stability === null) return 0;
    // py-fsrs uses timedelta.days, which truncates toward zero, then clamps at 0.
    const elapsedDays = Math.max(0, Math.floor((now - card.lastReview) / DAY_MS));
    return Math.pow(1 + (this.FACTOR * elapsedDays) / card.stability, this.DECAY);
  }

  _initialStability(rating) {
    return clampS(this.w[rating - 1]);
  }

  _initialDifficulty(rating, clamp) {
    const d = this.w[4] - Math.exp(this.w[5] * (rating - 1)) + 1;
    return clamp ? clampD(d) : d;
  }

  /** Days until the next review, given a stability, at the configured desired retention. */
  _nextInterval(stability) {
    const raw =
      (stability / this.FACTOR) * (Math.pow(this.desiredRetention, 1 / this.DECAY) - 1);
    // Python's round() is banker's rounding; JS Math.round is not. Match Python.
    const days = bankersRound(raw);
    return Math.min(Math.max(days, 1), this.maximumInterval);
  }

  /** Same-day re-review path: stability moves without a forgetting-curve term. */
  _shortTermStability(stability, rating) {
    let inc =
      Math.exp(this.w[17] * (rating - 3 + this.w[18])) * Math.pow(stability, -this.w[19]);
    if (rating === Rating.Good || rating === Rating.Easy) inc = Math.max(inc, 1.0);
    return clampS(stability * inc);
  }

  _nextDifficulty(difficulty, rating) {
    const deltaD = -(this.w[6] * (rating - 3));
    const damped = difficulty + ((10.0 - difficulty) * deltaD) / 9.0;
    const target = this._initialDifficulty(Rating.Easy, false);
    return clampD(this.w[7] * target + (1 - this.w[7]) * damped);
  }

  _nextForgetStability(difficulty, stability, retrievability) {
    const longTerm =
      this.w[11] *
      Math.pow(difficulty, -this.w[12]) *
      (Math.pow(stability + 1, this.w[13]) - 1) *
      Math.exp((1 - retrievability) * this.w[14]);
    const shortTerm = stability / Math.exp(this.w[17] * this.w[18]);
    return Math.min(longTerm, shortTerm);
  }

  _nextRecallStability(difficulty, stability, retrievability, rating) {
    const hardPenalty = rating === Rating.Hard ? this.w[15] : 1;
    const easyBonus = rating === Rating.Easy ? this.w[16] : 1;
    return (
      stability *
      (1 +
        Math.exp(this.w[8]) *
          (11 - difficulty) *
          Math.pow(stability, -this.w[9]) *
          (Math.exp((1 - retrievability) * this.w[10]) - 1) *
          hardPenalty *
          easyBonus)
    );
  }

  _nextStability(difficulty, stability, retrievability, rating) {
    const s =
      rating === Rating.Again
        ? this._nextForgetStability(difficulty, stability, retrievability)
        : this._nextRecallStability(difficulty, stability, retrievability, rating);
    return clampS(s);
  }

  /**
   * Apply a rating and return the updated card. The input card is not mutated.
   * `now` is epoch ms.
   */
  review(card, rating, now = Date.now()) {
    if (![1, 2, 3, 4].includes(rating)) throw new Error(`unknown rating: ${rating}`);
    const c = { ...card };
    const daysSince =
      c.lastReview === null ? null : Math.floor((now - c.lastReview) / DAY_MS);
    let nextIntervalMs;

    if (c.state === State.Learning) {
      if (c.stability === null || c.difficulty === null) {
        c.stability = this._initialStability(rating);
        c.difficulty = this._initialDifficulty(rating, true);
      } else if (daysSince !== null && daysSince < 1) {
        c.stability = this._shortTermStability(c.stability, rating);
        c.difficulty = this._nextDifficulty(c.difficulty, rating);
      } else {
        c.stability = this._nextStability(
          c.difficulty, c.stability, this.retrievability(c, now), rating);
        c.difficulty = this._nextDifficulty(c.difficulty, rating);
      }
      nextIntervalMs = this._stepInterval(c, rating, this.learningSteps);
    } else if (c.state === State.Review) {
      if (daysSince !== null && daysSince < 1) {
        c.stability = this._shortTermStability(c.stability, rating);
      } else {
        c.stability = this._nextStability(
          c.difficulty, c.stability, this.retrievability(c, now), rating);
      }
      c.difficulty = this._nextDifficulty(c.difficulty, rating);

      if (rating === Rating.Again && this.relearningSteps.length > 0) {
        c.state = State.Relearning;
        c.step = 0;
        nextIntervalMs = this.relearningSteps[0];
      } else {
        nextIntervalMs = this._nextInterval(c.stability) * DAY_MS;
      }
    } else if (c.state === State.Relearning) {
      if (daysSince !== null && daysSince < 1) {
        c.stability = this._shortTermStability(c.stability, rating);
      } else {
        c.stability = this._nextStability(
          c.difficulty, c.stability, this.retrievability(c, now), rating);
      }
      c.difficulty = this._nextDifficulty(c.difficulty, rating);
      nextIntervalMs = this._stepInterval(c, rating, this.relearningSteps);
    } else {
      throw new Error(`unknown card state: ${c.state}`);
    }

    c.due = now + nextIntervalMs;
    c.lastReview = now;
    return c;
  }

  /**
   * Shared step logic for the Learning and Relearning states. Mutates `c.state`/`c.step`
   * and returns the next interval in ms. Mirrors py-fsrs, which duplicates this block.
   */
  _stepInterval(c, rating, steps) {
    const graduate = () => {
      c.state = State.Review;
      c.step = null;
      return this._nextInterval(c.stability) * DAY_MS;
    };
    if (steps.length === 0 || (c.step >= steps.length && rating !== Rating.Again)) {
      return graduate();
    }
    if (rating === Rating.Again) {
      c.step = 0;
      return steps[0];
    }
    if (rating === Rating.Hard) {
      if (c.step === 0 && steps.length === 1) return steps[0] * 1.5;
      if (c.step === 0 && steps.length >= 2) return (steps[0] + steps[1]) / 2.0;
      return steps[c.step];
    }
    if (rating === Rating.Good) {
      if (c.step + 1 === steps.length) return graduate();
      c.step += 1;
      return steps[c.step];
    }
    return graduate(); // Easy
  }
}

/** Python's round(): half-to-even. JS Math.round is half-up, which drifts from py-fsrs. */
export function bankersRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
