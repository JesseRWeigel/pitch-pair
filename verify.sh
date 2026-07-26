#!/usr/bin/env bash
# The verify command for EDU-013. Exit 0 means the drill and the scheduler both work.
#
# Three things are checked, in order:
#   1. The test suite: FSRS-6 against reference vectors from py-fsrs 6.3.1, the accent
#      model, and the session/report logic including the 50 item acceptance test.
#   2. A real 50 item simulated session, whose printed output must carry a per-pattern
#      accuracy line for each of the four patterns with a non-zero asked count.
#   3. The scheduler's interval logic end to end from the command line.
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 1. test suite ==================================================="
node --test --test-reporter=spec "test/*.test.js"

echo
echo "=== 2. simulated 50 item session ===================================="
OUT=$(node bin/simulate.js --length 50 --accuracy 0.7 --seed 7)
echo "$OUT"

echo
echo "=== 3. assertions on the session report ============================="
fail() { echo "FAIL: $1" >&2; exit 1; }

grep -q "Per-pattern accuracy" <<<"$OUT" || fail "no per-pattern accuracy section"
grep -qE "^Session: [0-9]+/50 correct" <<<"$OUT" || fail "session did not report 50 items"

# Only the accuracy table, not the confusion matrix that follows it.
TABLE=$(sed -n '/^Per-pattern accuracy$/,/^Confusion/p' <<<"$OUT")

for p in heiban atamadaka nakadaka odaka; do
  line=$(grep -E "^  ${p} " <<<"$TABLE") || fail "no report line for pattern ${p}"
  asked=$(awk '{print $2}' <<<"$line")
  acc=$(awk '{print $4}' <<<"$line")
  [ "$asked" -gt 0 ] 2>/dev/null || fail "${p} was never asked (asked=${asked})"
  grep -qE '^[0-9]+\.[0-9]%$' <<<"$acc" || fail "${p} accuracy is not a percentage: ${acc}"
  echo "  ok  ${p}: asked ${asked}, accuracy ${acc}"
done

total=$(grep -E "^  (heiban|atamadaka|nakadaka|odaka) " <<<"$TABLE" | awk '{s+=$2} END{print s}')
[ "$total" -eq 50 ] || fail "per-pattern asked counts sum to ${total}, expected 50"
echo "  ok  per-pattern counts sum to 50"

grep -q "FSRS rescheduled" <<<"$OUT" || fail "misses were not rescheduled"
echo "  ok  FSRS rescheduled the missed items"

echo
echo "=== 4. scheduler interval logic ====================================="
node -e '
import("./src/fsrs.js").then(({Scheduler, Rating, State, newCard}) => {
  const s = new Scheduler();
  const assert = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exit(1); } };

  // Stability is defined as the interval at 90% desired retention.
  for (const stab of [1, 7, 50, 365]) {
    assert(s._nextInterval(stab) === stab, `interval at S=${stab} was ${s._nextInterval(stab)}`);
  }
  console.log("  ok  interval equals stability at the default 0.9 retention");

  // Raising desired retention must shorten the interval.
  const days = [0.7, 0.8, 0.9, 0.95].map(r => new Scheduler({desiredRetention: r})._nextInterval(50));
  assert(days.every((d, i) => i === 0 || d < days[i-1]), `retention sweep: ${days}`);
  console.log("  ok  higher retention gives shorter intervals: " + days.join(" > "));

  // Clamps.
  assert(s._nextInterval(0.0001) === 1, "minimum interval is not 1 day");
  assert(new Scheduler({maximumInterval: 30})._nextInterval(1e9) === 30, "maximum interval not clamped");
  console.log("  ok  intervals clamped to [1, maximumInterval]");

  // A lapse must shorten, a success must lengthen.
  const T = Date.parse("2026-01-01T00:00:00Z"), DAY = 86400000;
  let c = newCard(1, T);
  c = s.review(c, Rating.Good, T);
  c = s.review(c, Rating.Good, T);
  assert(c.state === State.Review, "card did not graduate");
  const good = s.review(c, Rating.Good, T + 10*DAY);
  const again = s.review(c, Rating.Again, T + 10*DAY);
  assert(good.stability > c.stability, "a correct review did not raise stability");
  assert(again.stability < c.stability, "a lapse did not lower stability");
  assert(again.state === State.Relearning, "a lapse did not enter relearning");
  console.log(`  ok  S ${c.stability.toFixed(2)} -> ${good.stability.toFixed(2)} on Good, ` +
              `-> ${again.stability.toFixed(2)} on Again`);
});
'

echo
echo "ALL CHECKS PASSED"
