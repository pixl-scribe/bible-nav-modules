# Brown-Driver-Briggs: the source as received

`bdb.json` holds every entry of Sefaria's "BDB Dictionary" (11,015 entries,
ids BDB00001 to BDB11015) and "BDB Aramaic Dictionary" (863, BDBA0001 to
BDBA0863), exactly as stored in Sefaria's database (every field, in order),
sorted by those ids. Nothing in it has been changed.

## Where it came from

Sefaria publishes its whole database as a MongoDB dump, replaced from time
to time, so this copy is the locked input:

- Address: https://storage.googleapis.com/sefaria-mongo-backup/dump_small.tar.gz
- Last-Modified: Sat, 21 Nov 2026 01:12:05 GMT (downloaded 2026-11-21)
- Size: 2669409256 bytes
- SHA-256: `a0213cabe5351121c157c437d5cf2cd7a4425c67367d4b29c8ed41b3cb887583`
- MD5: `ab307f0cd5fa82d933239e66e86c2ca1` (equal to the MD5 Google's storage publishes for the file)

The entries are in the dump's `lexicon_entry` collection
(`dump/sefaria/lexicon_entry.bson`). `bdb.json` was made from it by

    tools/venv/bin/python -I tools/extract-sefaria-bdb.py dump/sefaria/lexicon_entry.bson bdb.json

which reads the BSON itself (no MongoDB software) and keeps only the two
BDB lexicons. Its SHA-256 is `ccd51c2e93845d413ecc7ff34ebf152276f9853f00afa8675c9a2bbf6a45998b`.

`sefaria-metadata.json` holds what Sefaria states about the text, fetched
from its public API on 2026-11-21: the edition ("A Hebrew and English
lexicon of the Old Testament, by Francis Brown. With the co-operation of S.
R. Driver and Charles A. Briggs. Oxford, 1906"), the attribution, the
licence ("Public Domain"), and the version's source, a National Library of
Israel record of the 1906 edition
(https://www.nli.org.il/he/books/NNL_ALEPH990019502310205171/NLI). Sefaria
doesn't say who transcribed it.

## Strong's numbers: Open Scriptures' lexical index

`oshb/LexicalIndex.xml` maps BDB's entries to Strong's numbers one entry at
a time, where Sefaria's `strong_numbers` sit on whole groups of related
entries. It is from the Open Scriptures Hebrew Bible Project's
`HebrewLexicon` repository, kept unchanged with that repository's
`readme.md`, which states the licence:

- Address: https://github.com/openscriptures/HebrewLexicon (`LexicalIndex.xml` and `readme.md`)
- Commit: `21c9add13bc727d3a951361778e97e3ff7afd1ce` (2019-09-02, the latest on 2026-11-21)
- Licence: Creative Commons Attribution 4.0 International; "For attribution purposes, credit the Open Scriptures Hebrew Bible Project." (The text of BDB and of Strong's dictionary remain in the public domain.)

Only the index's Strong's numbers are used, never its glosses; its TWOT
numbers are left out, as Sefaria's are.
