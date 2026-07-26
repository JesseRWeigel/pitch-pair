#!/usr/bin/env bash
# Generate the full TTS probe set. Skips files that already exist so it can be re-run.
cd "$(dirname "$0")"
mkdir -p probe

gen () { # gen <text> <name> <take>
  local f="probe/$2_t$3.wav"
  if [ -f "$f" ]; then return; fi
  python3 tts.py "$1" "$f" >/dev/null 2>&1 || echo "FAIL $f"
  sleep 3
}

for i in 1 2 3 4 5; do
  gen "箸です。"   hashi_chop   $i   # atamadaka [1] HL
  gen "橋です。"   hashi_bridge $i   # odaka     [2] LH
  gen "雨です。"   ame_rain     $i   # atamadaka [1] HL
  gen "飴です。"   ame_candy    $i   # heiban    [0] LH
  gen "牡蠣です。" kaki_oyster  $i   # atamadaka [1] HL
  gen "柿です。"   kaki_persim  $i   # heiban    [0] LH
  gen "鮭です。"   sake_salmon  $i   # atamadaka [1] HL
  gen "酒です。"   sake_drink   $i   # heiban    [0] LH
done

# Does an explicit style instruction fix the known-wrong heiban rendering?
for i in 1 2 3 4 5; do
  gen "Read with Tokyo-standard heiban pitch accent, starting low on the first mora and rising to stay high: 飴です。" ame_candy_styled $i
  gen "Read with Tokyo-standard atamadaka pitch accent, high on the first mora then dropping: 雨です。" ame_rain_styled $i
done
echo "done: $(ls probe/*.wav | wc -l) files"
