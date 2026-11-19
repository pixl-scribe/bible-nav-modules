# Strong's Greek Dictionary: where this text comes from

Converted on 2026-11-19. This is the record of exactly which text
`eng_strongs_grc` is, and how to check it. It's a downloadable lexicon, not a
locked or pinned text.

## The edition

**James Strong, _A Concise Dictionary of the Words in the Greek Testament;
with their Renderings in the Authorized English Version_, in _The
Exhaustive Concordance of the Bible_ (New York: Hunt & Eaton, 1890).**

The digital text is Michael Grier's e-text of 1996 (transliterated Greek, in
ASCII), turned into XML with real Unicode Greek by Ulrik Sandborg-Petersen
(formerly Petersen) from 2006, and proofread by him through 2019. **Version
1.9 (2019-02-05)**, published by MorphGNT, is the source: it fixes many
mistakes of the earlier versions (1.4 is the one Open Scriptures keeps),
including links whose language the plain-text e-text had guessed wrongly, a
conversion tool's error message in place of a Greek word (G3179), "comp."
wrongly spelled out as "comparative" where Strong meant "compound", and
Greek words left in transliteration. Its author released it under the
Creative Commons CC0 waiver.

## The source file

- `source/strongsgreek.xml`, unchanged, from
  https://github.com/morphgnt/strongs-dictionary-xml (file `strongsgreek.xml`,
  commit `dd6758b82f46b620804a8ea677d715844679eea1`, 2019-02-05, version 1.9).
- SHA-256 `91474213b208a4e487d35f85c10e5c90737acc69082dad15dec5431406003545` (also in `SHA256SUMS`, which the converter checks).

## What was kept and left out

`tools/import-strongs-greek.py` converts it to `eng_strongs_grc.tei.xml`
(TEI; see `docs/lexicon-format.md`, "Source files"). It keeps, for each of
the 5,523 entries Strong used, the headword, transliteration, pronunciation,
alternative forms (80 entries), derivation, definition, KJV renderings, and
Strong's remarks after them (154 entries), with every Greek and Latin word
and every link (7,063, including links to Strong's Hebrew numbers, which
point into the Strong's Hebrew lexicon).

| Left out | Count | Why |
|---|---|---|
| Numbers Strong left unused (G2717, G3203 to G3302) | 101 | They hold only "Not Used" |
| Beta Code spellings (`BETA`) | all | Kept in the source, to test the Beta Code converter |
| ":--" before the KJV renderings | 5,522 | It's the section heading in Bible Nav |

The e-text was wrapped at 72 columns: its line breaks become single spaces,
and the one word hyphenated at a line end ("pre-eminently", G5236) is
joined.

Note for later: the source writes accented Greek with the oxia forms (such
as U+1F71), not the NFC tonos forms (U+03AC) the TR uses. Looking up a TR
word by lemma must compare normalized forms.

## Corrections

In the 1890 printing, "the numbers not in italics refer to the words in the
Hebrew Dictionary" (page 7). The plain-text e-text lost the italics, so
whoever tagged each link had to guess its language. Version 1.9 fixed most
of the wrong guesses (G25, G137, G3160, G4460) and mistyped numbers (G3304,
G3305, G3642 and others), which Bible Nav had found and checked against the
scans independently before switching to it. Two remain, each listed in
`corrections.yaml` with its evidence, applied by the converter, and marked
in the TEI file as `<choice><sic>…</sic><corr>…</corr></choice>`:

| Entry | Source | Corrected | Printed |
|---|---|---|---|
| G912 Barabbas | link to H5 | G5 (Abba) | "[1347 and 5]", the 5 in italics (p. 18) |
| G4567 Satanas | link to H4566 | G4566 (Satan) | "corresp. to 4566", in italics (p. 64) |

G912's 1347 is roman (Hebrew) in print and kept as printed, though Hebrew
1347 means "arrogance" and the Aramaic "bar" (son) is H1247; it may be a
misprint in the 1890 edition itself.

Wrong-language links can only occur in this dictionary: Strong's Hebrew
never refers to Greek.

## How to check it

    tools/venv/bin/python -I tools/import-strongs-greek.py
    tools/venv/bin/python -I tools/check-strongs-greek.py

The first checks the source's SHA-256 and rewrites the TEI file. The second
compares every entry of the TEI file with the source, sharing no code with
the converter; on 2026-11-19 all 5,523 entries matched, with 616 Greek words
and 7,063 links compared.
