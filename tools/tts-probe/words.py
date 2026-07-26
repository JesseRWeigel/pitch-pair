"""The probe word list, shared by analyze.py and report_md.py.

Each entry is name -> (label, expected accent, which way F0 should move across the word).
Atamadaka falls from mora 1. Heiban and odaka rise from mora 1 to mora 2.
"""

WORDS = {
    "hashi_chop":   ("箸 chopsticks", "atamadaka [1]", "fall"),
    "hashi_bridge": ("橋 bridge",     "odaka [2]",     "rise"),
    "ame_rain":     ("雨 rain",       "atamadaka [1]", "fall"),
    "ame_candy":    ("飴 candy",      "heiban [0]",    "rise"),
    "kaki_oyster":  ("牡蠣 oyster",   "atamadaka [1]", "fall"),
    "kaki_persim":  ("柿 persimmon",  "heiban [0]",    "rise"),
    "sake_salmon":  ("鮭 salmon",     "atamadaka [1]", "fall"),
    "sake_drink":   ("酒 alcohol",    "heiban [0]",    "rise"),
    "ame_rain_styled":  ("雨 rain (accent named in the prompt)",  "atamadaka [1]", "fall"),
    "ame_candy_styled": ("飴 candy (accent named in the prompt)", "heiban [0]",    "rise"),
}

PAIRS = [
    ("hashi_chop", "hashi_bridge"),
    ("ame_rain", "ame_candy"),
    ("kaki_oyster", "kaki_persim"),
    ("sake_salmon", "sake_drink"),
    ("ame_rain_styled", "ame_candy_styled"),
]
