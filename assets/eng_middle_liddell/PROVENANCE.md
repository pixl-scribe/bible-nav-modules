# Liddell and Scott, Intermediate Lexicon: where this text comes from

Converted and checked from 2026-11-19 to 2026-11-21. This is the record of
exactly which text `eng_middle_liddell` is, and how to check it. It's a
downloadable lexicon, not a locked or pinned text.

## The edition

**Henry George Liddell and Robert Scott, _An Intermediate Greek-English
Lexicon, founded upon the seventh edition of Liddell and Scott's
Greek-English Lexicon_ (Oxford: Clarendon Press, 1889),** the "Middle
Liddell". The page images used to check it are the Internet Archive's copy
of the Harper & Brothers printing of 1889, item `intermediategree00lidd`
(printed page = the viewer's page number minus 5).

The digital text is the Perseus Digital Library's TEI version (text
1999.04.0058, downloaded by Benjamin Linskey on 2015-01-01), as corrected by
Benjamin Linskey for his Greek Reference app.

## The source file

- `source/Perseus_text_1999.04.0058.xml`, unchanged, from
  https://github.com/blinskey/middle-liddell (mirror of git.linskey.org), commit
  `5db8d88a20066e182ca3fc6ee758c9f61ac60603` (2026-10-12), with its
  `LICENSE.md` and `README.md`.
- SHA-256 `1b0e2ed672ac23399fbdb031b06119e7736ccefc78c229f6c9302b7c6348c811`
  (also in `SHA256SUMS`, which the converter checks).

## License and attribution

"Text provided by Perseus Digital Library, with funding from The Annenberg
CPB/Project. Original version available for viewing and download at
http://www.perseus.tufts.edu/hopper/." Licensed under the [Creative Commons
Attribution-ShareAlike 3.0 United States License](http://creativecommons.org/licenses/by-sa/3.0/us/),
with the additional restriction that modifications are offered to Perseus.
The XML file's own header (1998) says "non-commercial"; Linskey's release
under CC BY-SA 3.0 US supersedes it. Bible Nav's version is converted and
corrected ("with corrections"), and stays under the same license. Neither
Perseus nor Benjamin Linskey endorses Bible Nav.

## What was kept, changed and left out

`tools/import-middle-liddell.py` converts the source to
`eng_middle_liddell.tei.xml` (TEI; see `docs/lexicon-format.md`, "Source
files"). Every entry keeps its Perseus id as its key, its headword, its
headword line (endings, article, principal parts), its etymologies, and its
numbered senses in order, with every translation (in italics in the print),
author label, Greek, Latin and English word, and cross-reference. Greek is
converted from Beta Code to Unicode (NFC) by `tools/betacode.py`, which is
tested against every word of Strong's Greek Dictionary.

| Left out | Count | Why |
|---|---|---|
| Perseus's stem analysis (`gramGrp` on an entry) | 1,008 groups | Made by machine; not Liddell and Scott's text |
| Notes left by Perseus's linking tool ("#skipped" and a word) | 24 | Not Liddell and Scott's text |
| Empty senses | 5 | No text (the others were restored, below) |
| Alphabet headings | all | Not entries |
| Breves and macrons no vowel can carry where they stand | 147 | Editors' length marks, misplaced |

Rules applied to the whole text, each checked against the print:

- **Split words.** Perseus's conversion tool broke 65 words of headword
  lines in two, leaving "failing on lembuf []" at the break. They are
  joined, and marked as corrections (checked on five cases).
- **LS's asterisk.** Perseus writes the asterisk Liddell and Scott print
  before a form not found in use (such as the root *ERA, "earth") after
  the headword. It is shown before it, as printed, and left out of lookups
  (confirmed on ERA, *ergo and *KIKO).
- **English in Greek notes.** Perseus left 936 English words ("fut.",
  "or", "and", "doric" and a few more, checked in context) in the bare text
  of notes it marked as Greek. They stay English.
- **A sigma cited as a letter** is a plain sigma, not a final one.
- **"Id."** is printed with a capital I, as in the print. Liddell and Scott
  also print "Ib." (the same passage), which Perseus writes the same way as
  "Id." (the same author), so every one is given as "Id."; by a count of
  the scan's text about one in five should read "Ib.". The TEI file's
  header says so.
- **Cross-references** link to the entry with that headword (15,946), or
  to every entry sharing it (393); a form that is no headword stays plain
  Greek (2,993). LS's compound hyphens (phil-anthropos) are ignored for
  this, and an entry never links to itself.
- **Strong's numbers** (4,259 on 4,252 entries) come from Strong's Greek
  Dictionary (`eng_strongs_grc`): an entry gets a number when its headword
  is that number's headword.

## Corrections

132 in all: the 65 joined words above, and 67 listed in
`corrections.yaml`, each with the printed page that shows it and applied
only while the source still matches exactly. Each appears in the TEI file
as `<choice><sic>…</sic><corr>…</corr></choice>` or, for a whole entry, in
the header's list of changes, which quotes the source and the correction.

| Kind | Count | What it is | Examples |
|---|---|---|---|
| Greek corrected | 24 | A piece of Greek, in Beta Code | Xerxes (three times), kydistos, beleon's accent, psi for upsilon (six) |
| Printed text | 2 | What Beta Code can't write | the Cretic foot, *Patrokleus |
| Entry rewritten | 34 | Perseus lost text or misplaced it | the letter articles for sigma and zeta, myops, soter, Iapyx |
| Duplicate removed | 1 | The same entry twice | *ergo (n13106) |
| Entry added | 3 | A printed entry Perseus lost | dikaiotes, dimoros, ana-molein |
| Entry folded | 3 | An entry Perseus made for another form of a printed headword | anablosko and anemolon into ana-molein; aizeios into aizeos |

Added entries take the key of the entry they follow plus ".1" (n8417.1).
Folded entries leave their headword as an inflected form of the printed
entry (`<form type="inflected">`), so a lookup by it still finds the entry.

These corrections are offered back to Perseus and Benjamin Linskey, as
the license asks.

## How to check it

    tools/venv/bin/python -I tools/import-middle-liddell.py
    tools/venv/bin/python -I tools/check-middle-liddell.py

The first checks the source's SHA-256 and rewrites the TEI file. The second
compares every entry of the TEI file with the source, applying the
documented rules and corrections its own way and sharing no code with the
converter except the Beta Code converter; on 2026-11-21 all 36,489 entries
matched, with 16,339 links and 4,317 Strong's numbers checked.
