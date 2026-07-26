#!/usr/bin/env python3
"""Retrying wrapper around genkit's TTS path, prints finishReason on failure."""
import sys, os, time, json, base64, struct, urllib.request, urllib.error

KEY = os.environ["GEMINI_API_KEY"]
MODEL = "gemini-2.5-flash-preview-tts"
BASE = "https://generativelanguage.googleapis.com/v1beta/models"


def wav_header(nbytes, rate, bits=16, channels=1):
    block = channels * bits // 8
    return (b"RIFF" + struct.pack("<I", 36 + nbytes) + b"WAVEfmt " +
            struct.pack("<IHHIIHH", 16, 1, channels, rate, rate * block, block, bits) +
            b"data" + struct.pack("<I", nbytes))


def tts(text, out, voice="Kore", tries=5):
    payload = {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    url = f"{BASE}/{MODEL}:generateContent?key={KEY}"
    for i in range(tries):
        req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=300))
        except urllib.error.HTTPError as e:
            print(f"  http {e.code}: {e.read()[:200]}", file=sys.stderr)
            time.sleep(8 * (i + 1))
            continue
        cand = d.get("candidates", [{}])[0]
        if "content" not in cand:
            print(f"  no content, finishReason={cand.get('finishReason')} "
                  f"full={json.dumps(d)[:300]}", file=sys.stderr)
            time.sleep(8 * (i + 1))
            continue
        p = cand["content"]["parts"][0]
        pcm = base64.b64decode(p["inlineData"]["data"])
        rate = 24000
        for tok in p["inlineData"]["mimeType"].split(";"):
            if tok.strip().startswith("rate="):
                rate = int(tok.split("=")[1])
        with open(out, "wb") as f:
            f.write(wav_header(len(pcm), rate) + pcm)
        return out, len(pcm), rate
    raise RuntimeError(f"tts failed after {tries} tries: {text!r}")


if __name__ == "__main__":
    text, out = sys.argv[1], sys.argv[2]
    voice = sys.argv[3] if len(sys.argv) > 3 else "Kore"
    print(tts(text, out, voice))
