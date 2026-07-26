#!/usr/bin/env python3
"""Capture FSRS-6 reference outputs from py-fsrs 6.3.1 so the JS port can be checked."""
import json, itertools
from datetime import datetime, timezone, timedelta
from fsrs import Scheduler, Card, Rating, State

EPOCH = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
DAY_MS = 86400000

# Rating sequences paired with the day offsets at which each review happens.
# Mix same-day repeats (short-term path) with multi-day gaps (forgetting-curve path).
SEQS = [
    ([3, 3, 3, 3], [0, 0, 1, 5]),
    ([1, 3, 3, 4], [0, 0, 0, 2]),
    ([4, 4, 4], [0, 3, 20]),
    ([2, 2, 2, 2], [0, 0, 1, 2]),
    ([3, 1, 3, 3, 1], [0, 1, 1, 4, 30]),
    ([1, 1, 1], [0, 0, 0]),
    ([3, 4, 1, 2, 3], [0, 0, 7, 7, 9]),
    ([2, 3, 4, 1], [0, 2, 40, 100]),
]
# Every 3-rating sequence at fixed offsets, to exercise all state transitions.
for combo in itertools.product([1, 2, 3, 4], repeat=3):
    SEQS.append((list(combo), [0, 0, 3]))

# Graduate the card, lapse it into Relearning, then rate it again from there. Both the
# same-day short-term path and the multi-day path out of Relearning, for every rating.
for r in [1, 2, 3, 4]:
    for gap in [0, 2]:
        SEQS.append(([3, 3, 1, r], [0, 0, 5, 5 + gap]))
        SEQS.append(([4, 1, r, r], [0, 3, 3 + gap, 3 + gap + 4]))
# Longer relearning walks, so a card leaves Relearning and lapses a second time.
SEQS.append(([3, 3, 1, 3, 3, 1, 2], [0, 0, 5, 5, 9, 20, 21]))
SEQS.append(([4, 1, 2, 2, 3, 4], [0, 1, 1, 2, 8, 40]))
SEQS.append(([3, 3, 1, 1, 1, 3], [0, 0, 4, 4, 4, 6]))

out = []
sched = Scheduler(enable_fuzzing=False)
for ratings, offsets in SEQS:
    card = Card(card_id=1, due=EPOCH)
    steps = []
    for r, off in zip(ratings, offsets):
        when = EPOCH + timedelta(days=off)
        card, _ = sched.review_card(card, Rating(r), review_datetime=when)
        steps.append({
            "rating": r,
            "atDay": off,
            "stability": card.stability,
            "difficulty": card.difficulty,
            "state": int(card.state),
            "step": card.step,
            "dueMsFromEpoch": int((card.due - EPOCH).total_seconds() * 1000),
        })
    out.append({"ratings": ratings, "offsets": offsets, "steps": steps})

# Also capture raw _next_interval over a stability sweep, the pure interval logic.
intervals = []
for retention in [0.7, 0.8, 0.9, 0.95]:
    s2 = Scheduler(desired_retention=retention, enable_fuzzing=False)
    for stab in [0.1, 0.5, 1.0, 2.0, 3.5, 10.0, 47.3, 365.0, 5000.0]:
        intervals.append({
            "desiredRetention": retention,
            "stability": stab,
            "days": s2._next_interval(stability=stab),
        })

# And retrievability over an elapsed-days sweep.
retr = []
for stab in [1.0, 5.0, 50.0]:
    for days in [0, 1, 2, 5, 10, 50, 200]:
        c = Card(card_id=1)
        c.stability = stab
        c.last_review = EPOCH
        retr.append({
            "stability": stab, "elapsedDays": days,
            "r": sched.get_card_retrievability(c, current_datetime=EPOCH + timedelta(days=days)),
        })

print(json.dumps({
    "generatedBy": "py-fsrs 6.3.1, enable_fuzzing=False, default parameters",
    "epochIso": EPOCH.isoformat(),
    "parameters": list(sched.parameters),
    "sequences": out,
    "intervals": intervals,
    "retrievability": retr,
}, indent=1))
