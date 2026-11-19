# Strong's Hebrew Dictionary: where this text comes from

Converted on 2026-11-18. This is the record of exactly which text
`eng_strongs_heb` is, and how to check it. It's a downloadable lexicon, not a
locked or pinned text.

## The edition

**James Strong, _A Concise Dictionary of the Words in the Hebrew Bible; with
their Renderings in the King James Version_, in _The Exhaustive Concordance
of the Bible_ (New York: Hunt & Eaton, 1890), as edited by Open Scriptures.**

Open Scriptures' OSIS edition was prepared in 2008-2010 by David Troidl and
David Instone-Brewer, who say the electronic copies they started from "were
full of errors" and that they "cleaned them by comparing them to each other
and (where necessary) looking at the original". It is marked "Public
Domain", as is Strong's 1890 dictionary.

It is an edited text, not a strict transcription: it spells out Strong's
abbreviations ("par. mean." becomes "apparently meaning", "lit. or fig."
becomes "literal or figurative"), writes Strong's × as `[idiom]`, and gives
the Hebrew word, transliteration and pronunciation where Strong printed only
a number ("from 7218"). Bible Nav keeps that editing.

## The source file

- `source/StrongHebrewG.xml`, unchanged, from
  https://github.com/openscriptures/strongs (file `hebrew/StrongHebrewG.xml`,
  commit `0acd2f251c2d35ff8db2dece4e0593979d3ac223`, 2021-07-15).
- SHA-256 `1f9659ea208f4c498843a0280dacb1448627c33ca77712642d8705793ab66061` (also in `SHA256SUMS`, which the converter checks).

## What was kept and left out

`tools/import-strongs-hebrew.py` converts it to `eng_strongs_heb.tei.xml`
(TEI; see `docs/lexicon-format.md`, "Source files"). It keeps, for all 8,674
entries, the headword, transliteration, pronunciation, derivation,
definition, and KJV renderings, with their italics and Hebrew words, and
Open Scriptures' 217 notes on what they corrected. It leaves out:

| Left out | Count | Why |
|---|---|---|
| Outlines (`list`) | 8,674 | Online Bible's abridged Brown-Driver-Briggs (Larry Pierce), not Strong's |
| TWOT numbers (`gloss`) | 6,070 | They refer to the Theological Wordbook of the Old Testament (1980), still under copyright |
| Greek equivalents (`foreign`) | 3,686 | Not part of Strong's |
| Part-of-speech codes (`morph`) | 8,674 | Not part of Strong's |

2,628 headwords are marked `x-pn` (proper names, with no language) in the
source; they are Hebrew script and are tagged `hbo` (Hebrew).

## Corrections

Each correction is listed in `corrections.yaml` with its evidence, applied
by the converter, and marked in the TEI file as
`<choice><sic>…</sic><corr>…</corr></choice>`:

| Entry | Source | Corrected | Evidence |
|---|---|---|---|
| H7218 | "rank, itc.)" | "rank, etc.)" | Strong (1890), Hebrew and Chaldee Dictionary, p. 106 (Internet Archive, StrongsGreekAndHebrewDictionaries1890) |

## How to check it

    tools/venv/bin/python -I tools/import-strongs-hebrew.py
    tools/venv/bin/python -I tools/check-strongs-hebrew.py

The first checks the source's SHA-256 and rewrites the TEI file. The second
compares every entry of the TEI file with the source, sharing no code with
the converter; on 2026-11-18 all 8,674 entries matched, with 9,111 Hebrew
words in the notes compared.
