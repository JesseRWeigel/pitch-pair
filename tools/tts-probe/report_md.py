#!/usr/bin/env python3
"""Emit the probe results as the markdown table and JSON that the README carries."""
import sys, os, glob, json, statistics as st
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from f0 import shape
from words import WORDS, PAIRS

rows, vals = [], {}
for name, (label, pat, direction) in WORDS.items():
    rs = [shape(f) for f in sorted(glob.glob(f"probe/{name}_t*.wav"))]
    rs = [r for r in rs if r]
    if not rs:
        continue
    h = [r["h1_h2"] for r in rs]
    vals[name] = h
    want_fall = direction == "fall"
    ok = sum(1 for x in h if (x > 1.0) == want_fall)
    rows.append({
        "word": label, "expected": pat,
        "shouldDo": "fall" if want_fall else "rise",
        "takes": [round(x, 2) for x in h],
        "mean": round(st.mean(h), 2),
        "takesCorrectDirection": ok, "nTakes": len(h),
    })

pairs = []
for a, b in PAIRS:
    if a in vals and b in vals:
        ha, hb = vals[a], vals[b]
        pairs.append({
            "a": WORDS[a][0], "b": WORDS[b][0],
            "aRange": [round(min(ha), 2), round(max(ha), 2)],
            "bRange": [round(min(hb), 2), round(max(hb), 2)],
            "separated": bool(min(ha) > max(hb) or min(hb) > max(ha)),
        })

if "--json" in sys.argv:
    print(json.dumps({"perWord": rows, "pairSeparation": pairs}, ensure_ascii=False, indent=1))
    sys.exit()

print("| word | accent | contour should | measured F0 ratio per take | mean | takes correct |")
print("|---|---|---|---|---|---|")
for r in rows:
    print(f"| {r['word']} | {r['expected']} | {r['shouldDo']} | "
          f"{' '.join(f'{x:.2f}' for x in r['takes'])} | {r['mean']:.2f} | "
          f"{r['takesCorrectDirection']}/{r['nTakes']} |")
print()
print("| minimal pair | ratio range A | ratio range B | separated? |")
print("|---|---|---|---|")
for p in pairs:
    print(f"| {p['a']} vs {p['b']} | {p['aRange'][0]:.2f} to {p['aRange'][1]:.2f} | "
          f"{p['bRange'][0]:.2f} to {p['bRange'][1]:.2f} | "
          f"{'yes' if p['separated'] else '**no, ranges overlap**'} |")
