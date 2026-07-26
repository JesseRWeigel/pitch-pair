#!/usr/bin/env python3
"""F0 tracker with octave-error correction, plus accent-shape scalars.

The scalars are chosen to separate the two patterns in each pair:
  peak_pos   position of the F0 maximum as a fraction of the voiced span (atamadaka -> early)
  h1_h2      median F0 of first third over median of second third (HL -> >1, LH -> <1)
  tail       median F0 of the final third over the utterance median (heiban stays up)
"""
import sys, wave, json, numpy as np


def read_wav(path):
    with wave.open(path) as w:
        rate = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64)
    return x / 32768.0, rate


def f0_track(x, rate, fmin=80, fmax=350, hop=0.005, win=0.045):
    n_hop, n_win = int(hop * rate), int(win * rate)
    lo, hi = int(rate / fmax), int(rate / fmin)
    freqs, rms = [], []
    for s in range(0, len(x) - n_win, n_hop):
        fr = x[s:s + n_win] - x[s:s + n_win].mean()
        rms.append(np.sqrt((fr ** 2).mean()))
        w = fr * np.hanning(len(fr))
        ac = np.correlate(w, w, "full")[len(w) - 1:]
        if ac[0] <= 1e-12:
            freqs.append(0.0); continue
        nac = ac / ac[0]
        seg = nac[lo:hi]
        k = int(np.argmax(seg)) + lo
        peak = nac[k]
        # Octave correction: prefer the longest lag (lowest f0) whose normalised
        # autocorrelation is within 85% of the global peak. Halving errors pick a
        # sub-multiple lag, which this walks back to the true period.
        for kk in range(hi - 1, k, -1):
            if nac[kk] > 0.85 * peak and nac[kk] > nac[kk - 1] and nac[kk] > nac[kk + 1 if kk + 1 < len(nac) else kk]:
                k, peak = kk, nac[kk]
                break
        freqs.append(rate / k if peak > 0.35 else 0.0)
    f, e = np.array(freqs), np.array(rms)
    # median-smooth over 5 frames (25 ms) to kill isolated doubling errors
    fs = f.copy()
    for i in range(2, len(f) - 2):
        w5 = f[i - 2:i + 3]
        w5 = w5[w5 > 0]
        if len(w5):
            fs[i] = np.median(w5)
    return fs, e


def shape(path):
    x, rate = read_wav(path)
    f, e = f0_track(x, rate)
    thr = max(e.max() * 0.12, 1e-4)
    m = (f > 0) & (e > thr)
    idx = np.flatnonzero(m)
    if len(idx) < 12:
        return None
    a, b = idx[0], idx[-1]
    fv = f[a:b + 1]
    fv = fv[fv > 0]
    n = len(fv)
    thirds = [fv[:n // 3], fv[n // 3:2 * n // 3], fv[2 * n // 3:]]
    med = [float(np.median(t)) for t in thirds]
    return {
        "n": n,
        "peak_pos": float(np.argmax(fv)) / n,
        "h1_h2": med[0] / med[1],
        "tail": med[2] / float(np.median(fv)),
        "thirds": [round(v, 1) for v in med],
    }


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        path, label = arg.split("=")
        s = shape(path)
        print(f"{label:30s} {json.dumps(s) if s else 'UNVOICED'}")
