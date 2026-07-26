#!/usr/bin/env python3
"""Group the probe takes by word and report whether the two members of each minimal
pair are separated by the measured pitch contour."""
import sys, glob, os, statistics as st
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from f0 import shape

from words import WORDS, PAIRS

def main():
    vals = {}
    print(f"{'word':30s} {'expected':16s} {'h1/h2 per take':32s} {'mean':>6s}  verdict")
    print("-" * 100)
    for name, (label, pat, direction) in WORDS.items():
        files = sorted(glob.glob(f"probe/{name}_t*.wav"))
        rs = [shape(f) for f in files]
        rs = [r for r in rs if r]
        if not rs:
            continue
        h = [r["h1_h2"] for r in rs]
        vals[name] = h
        mean = st.mean(h)
        # >1 means the first third is higher than the second, i.e. a falling onset
        want_fall = direction == "fall"
        ok = sum(1 for x in h if (x > 1.0) == want_fall)
        print(f"{label:30s} {pat:16s} {' '.join(f'{x:5.2f}' for x in h):32s} {mean:6.2f}  "
              f"{ok}/{len(h)} takes in the expected direction")

    print()
    print("Pair separation (does the TTS render the two members differently?)")
    print("-" * 100)
    for a, b in PAIRS:
        if a not in vals or b not in vals:
            continue
        ha, hb = vals[a], vals[b]
        overlap = not (min(ha) > max(hb) or min(hb) > max(ha))
        print(f"{WORDS[a][0]:26s} {st.mean(ha):5.2f} [{min(ha):.2f}-{max(ha):.2f}]   vs   "
              f"{WORDS[b][0]:26s} {st.mean(hb):5.2f} [{min(hb):.2f}-{max(hb):.2f}]   "
              f"-> ranges {'OVERLAP, not separated' if overlap else 'DISJOINT, separated'}")


if __name__ == "__main__":
    main()
