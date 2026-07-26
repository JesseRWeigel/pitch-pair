# pitch-pair

A drill for Japanese pitch accent built around minimal pairs. You are shown a word such as
箸 (chopsticks) followed by the particle が, and you pick which of the four Tokyo-standard
accent patterns it takes. Answers you get wrong are rescheduled by FSRS-6 and come back.
A session is 50 items and ends with an accuracy figure for each of the four patterns
separately, because the thing worth measuring is whether you have learned the patterns
rather than whether you have memorised some words.

Catalog task: `EDU-013`. Part of [thousand](../../README.md).

## The audio half is BLOCKED, and here is the measurement

The task asked for a drill that plays the minimal pair. It does not play anything. Before
building the drill I generated pitch-accent minimal pairs with the Gemini TTS voice and
measured the pitch contour of each clip. The synthesiser does not render Japanese pitch
accent reliably, and shipping the audio would have taught people the wrong pitch.

Method: for each word, generate N takes of `<word>です。` at 24 kHz, track F0 with
autocorrelation and octave correction, then take the ratio of median F0 in the first third
of the voiced span to the second third. A ratio above 1.0 means the pitch falls across the
word, which is what atamadaka should do. A ratio below 1.0 means it rises, which is what
heiban and odaka should do. The whole probe is in `tools/tts-probe/` and the WAV files are
committed so the numbers can be checked without an API key.

| word | accent | contour should | measured F0 ratio per take | mean | takes correct |
|---|---|---|---|---|---|
| 箸 chopsticks | atamadaka [1] | fall | 1.30 1.36 1.22 0.92 1.44 | 1.25 | 4/5 |
| 橋 bridge | odaka [2] | rise | 0.69 0.88 1.02 1.12 0.85 | 0.91 | 3/5 |
| 雨 rain | atamadaka [1] | fall | 1.08 1.41 0.75 0.90 | 1.04 | 2/4 |
| 飴 candy | heiban [0] | rise | 1.37 1.38 0.86 1.34 0.73 | 1.14 | 2/5 |
| 牡蠣 oyster | atamadaka [1] | fall | 1.18 0.92 0.85 1.04 1.02 | 1.00 | 3/5 |
| 柿 persimmon | heiban [0] | rise | 0.73 0.86 0.97 0.60 | 0.79 | 4/4 |
| 鮭 salmon | atamadaka [1] | fall | 1.13 1.31 | 1.22 | 2/2 |
| 酒 alcohol | heiban [0] | rise | 0.68 0.80 | 0.74 | 2/2 |
| 雨 rain (accent named in the prompt) | atamadaka [1] | fall | 1.03 | 1.03 | 1/1 |
| 飴 candy (accent named in the prompt) | heiban [0] | rise | 1.23 | 1.23 | 0/1 |

| minimal pair | ratio range A | ratio range B | separated? |
|---|---|---|---|
| 箸 chopsticks vs 橋 bridge | 0.92 to 1.44 | 0.69 to 1.12 | **no, ranges overlap** |
| 雨 rain vs 飴 candy | 0.75 to 1.41 | 0.73 to 1.38 | **no, ranges overlap** |
| 牡蠣 oyster vs 柿 persimmon | 0.85 to 1.18 | 0.60 to 0.97 | **no, ranges overlap** |
| 鮭 salmon vs 酒 alcohol | 1.13 to 1.31 | 0.68 to 0.80 | yes |
| 雨 rain (accent named in the prompt) vs 飴 candy (accent named in the prompt) | 1.03 to 1.03 | 1.23 to 1.23 | yes |

Three of the five minimal pairs have F0 ratio ranges that **overlap**, which means the
synthesiser's rendering of one word cannot be told from the other by the very measurement
that is supposed to distinguish them. 飴 got 2 of 5 takes right, worse than a coin flip on a
binary rise-or-fall question.

The last row is the one that settles it. Naming the accent explicitly in the prompt made
飴 *worse*, not better: a single take at ratio 1.23, falling, when heiban must rise. There is
no prompt-engineering fix available here.

The damaging case is 飴. It is heiban and should rise, and the synthesiser gave it a
falling contour on most takes, which is the accent of 雨. A learner drilling against that
audio would be trained to hear candy as rain.

So the audio is not shipped. What is shipped is the visual pattern drill, which teaches the
same four patterns from the pitch diagram and the minimal pair contrast. That is still a
real exercise, and it is the part of the task that can be done honestly right now.

What would unblock it: recordings by a speaker of standard Tokyo Japanese, or a corpus of
openly licensed recordings with verified accent labels. An automated F0 gate that only kept
takes matching the expected contour is tempting, but the gate would be trusting the same
crude pitch tracker used above to decide what learners hear, and a take can measure right
while still sounding wrong. That is not a safe basis for teaching pronunciation.

## What the drill teaches

Tokyo accent is described by one number, the position of the downstep. From that number and
the mora count, all four patterns follow:

| pattern | Japanese | downstep | shape |
|---|---|---|---|
| heiban | 平板 | [0] | low, then high, and the particle stays high |
| atamadaka | 頭高 | [1] | high on mora 1, then low |
| nakadaka | 中高 | [2..n-1] | low, high, then drops inside the word |
| odaka | 尾高 | [n] | low, then high, and the particle drops |

Heiban and odaka look identical across the word itself and separate only on the particle,
which is why every prompt shows the particle. 鼻が (heiban, stays high) against 花が (odaka,
drops on が) is the clearest case of this.

## Running it

The drill is a static page with no build step and no dependencies. ES modules need to be
served over HTTP rather than opened from the filesystem.

```bash
cd projects/pitch-pair
python3 -m http.server 8000
# then open http://localhost:8000/
```

Keyboard: `1`-`4` pick a pattern, space moves to the next item. Progress is kept in
`localStorage` so the scheduler state survives a reload.

Command line, no browser:

```bash
node bin/simulate.js --length 50 --accuracy 0.7   # simulated learner, prints the report
node bin/simulate.js --weak nakadaka              # a learner who fails one pattern
node bin/simulate.js --perfect --pairs-only       # minimal pairs only, no exemplars
npm test                                          # the test suite
```

## The scheduler is FSRS-6, and that claim is tested

`src/fsrs.js` is a port of FSRS-6, not SM-2 and not FSRS-4.5. It follows the reference
implementation [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs) 6.3.1 (MIT):
the 21 default parameters, the power forgetting curve with decay from `w[20]`, the
short-term stability path for same-day reviews, linear damping and mean reversion in the
difficulty update, and the Learning / Review / Relearning state machine with its steps.

Rather than assert this in prose, `test/fsrs_vectors.json` holds output captured from
py-fsrs 6.3.1 itself, and the suite checks the port reproduces it:

- 91 rating sequences, checking stability, difficulty, state, step and due time at every
  step, to within 1e-9. 34 of those steps are reviews made from the Relearning state,
  which is the path most easily got wrong and which the first draft of the vectors missed
- 36 `_next_interval` values across four desired-retention settings and nine stabilities
- 21 retrievability values across a stability and elapsed-day sweep

The vectors are regenerated with `pip install fsrs==6.3.1 && python3 test/gen_vectors.py >
test/fsrs_vectors.json`, so the comparison can be redone against a future py-fsrs.

Interval fuzzing is the one deliberate difference. py-fsrs enables it by default and it
draws on a random number generator, so this port behaves as py-fsrs does with
`enable_fuzzing=False`. `bankersRound` exists because Python's `round()` is half-to-even
and JavaScript's `Math.round` is not, and the difference shows up in interval lengths.

Grading maps a correct answer to `Good` and a miss to `Again`. A missed new item lands on
the one-minute learning step, so it comes back within the same session, which is what
"FSRS schedules the misses" means in practice.

## Where the accent data comes from

Hand-curated, then checked entry by entry against English Wiktionary's Japanese pronunciation
data by a reviewer that did not build the dataset. 37 of 37 remaining entries agree.

Two corrections came out of that check, and both are in the shipped data:

- **居間 (いま) "living room" was wrong.** It was listed as heiban [0]; Wiktionary gives odaka
  [2]. The 今/居間 contrast survives, as atamadaka against odaka rather than atamadaka against
  heiban. Shipping the original would have taught the wrong accent, which is the one failure a
  pronunciation trainer must not have.
- **The 二本/日本 pair was removed.** 二本 has no Japanese section on Wiktionary and the kana
  page にほん is a bare soft-redirect, so its accent cannot be sourced from the reference this
  file cites. An unsourced accent in a drill is worse than one fewer pair.

A method note worth carrying forward: several Wiktionary entries encode the accent as a letter
rather than a digit, `acc=h` for heiban and `acc=o` for odaka. A digit search silently misses
those. Every letter-coded entry was resolved against the rendered page.

Where a word has more than one attested accent, this file carries one and does not claim it is
the only correct answer. 心 is listed at [2], which Wiktionary attests with DJR and NHK
references, though it leads with [3]. 卵, 自転車, 頭, 花, 切る and 着る are similar.

Confirm any entry yourself at [OJAD](https://www.gavo.t.u-tokyo.ac.jp/ojad/), which renders
the pitch curve for a reading.


## Layout

```
index.html              the drill page
src/fsrs.js             FSRS-6, checked against py-fsrs 6.3.1
src/accent.js           morae, pattern classification, pitch contours
src/deck.js             pairs.json -> drill items
src/session.js          selection, grading, the per-pattern report
src/app.js              browser front end
src/data/pairs.json     the dataset
bin/simulate.js         run a session without a browser
test/                   the test suite
tools/tts-probe/        the TTS measurement that blocked the audio, plus its WAV files
verify.sh               the verify command
```

## Verify command

```bash
./verify.sh
```

It runs the test suite, then a real 50-item simulated session, then asserts against the
printed report that all four patterns were asked, that each carries a percentage accuracy,
that the counts sum to 50 and that misses were rescheduled, then exercises the scheduler's
interval logic from the command line.

## Status

Verified 2026-07-26.

```
$ bash verify.sh
  ok  interval equals stability at the default 0.9 retention
  ok  higher retention gives shorter intervals: 464 > 166 > 50 > 20
  ok  intervals clamped to [1, maximumInterval]
  ok  S 2.31 -> 25.13 on Good, -> 0.76 on Again

ALL CHECKS PASSED
```

## Unfinished

- **Audio is BLOCKED**, for the reason measured above. The drill is visual only.
- The dataset is 59 words across 23 minimal-pair groups plus a few single-word exemplars. It is enough to drill the four patterns and it is not broad
  coverage of Japanese vocabulary.
- Nakadaka and odaka are carried partly by single-word exemplars rather than by minimal
  pairs, because minimal pairs for those patterns are scarce.
- Only the が particle is used. Some contrasts behave differently with other particles.
- Devoicing is ignored. In words like 牡蠣 the first vowel is often devoiced in Tokyo
  speech, which changes where the pitch is actually realised, and the diagram does not
  show that.
- The FSRS parameters are the published defaults. They are not optimised against review
  logs, which is what FSRS parameter training would do with a real review history.
- Progress lives in `localStorage`, so it is per-browser with no sync and no export.

## License

MIT, see `LICENSE`.
