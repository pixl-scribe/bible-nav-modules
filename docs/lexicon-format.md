# Bible Nav lexicon modules

Version 1, **draft**. Nothing here is final until the first lexicon is
signed with it; after that, this version never changes.

A lexicon module holds the entries of one dictionary of Hebrew or Greek
words, such as Strong's Hebrew Dictionary. It is packaged, signed and
checked like a Bible module (see `integrity-spec.md`): a read-only SQLite
file, a manifest, and a signature file. This document says what is
different.

## The first lexicons

| Id | Abbreviation | Lexicon | Source | License |
|---|---|---|---|---|
| `eng_strongs_heb` | SH | Strong's Hebrew and Chaldee Dictionary (1890) | Open Scriptures `strongs`, `hebrew/StrongHebrewG.xml` | Public domain |
| `eng_strongs_grc` | SG | Strong's Greek Dictionary (1890) | Ulrik Sandborg-Petersen's XML 1.9 (2019), MorphGNT `strongs-dictionary-xml`, `strongsgreek.xml` | Public domain (CC0) |
| `eng_middle_liddell` | LS | An Intermediate Greek-English Lexicon (Liddell and Scott, 1889) | Perseus 1999.04.0058, Benjamin Linskey's corrected copy | CC BY-SA 3.0 US |
| `eng_bdb` | BDB | A Hebrew and English Lexicon of the Old Testament (Brown, Driver and Briggs, 1906), with its Aramaic section | Sefaria's "BDB Dictionary" and "BDB Aramaic Dictionary", from Sefaria's database dump | Public domain |

The id starts with the language of the definitions (English), like a Bible
module's. BDB is built after the others, because its check needs the
Masoretic text module (see "Checking a build").

## Source files

Each lexicon is first converted from its source into one **TEI** file,
`assets/<id>/<id>.tei.xml`, and the module is generated from that file
alone, as Bible modules are generated from USX. The TEI file is published
with the module, so anyone can read, check, and reuse the text without Bible
Nav.

- **Why TEI.** There is no lexicon counterpart to USX. The nearest standard
  is the Dictionaries chapter of the Text Encoding Initiative Guidelines
  (TEI P5), which the Perseus Liddell and Scott already uses in an older
  form. TEI allows many ways to encode the same thing, so the files follow
  **TEI Lex-0**, a stricter subset made for exchanging dictionaries. OSIS,
  which the Open Scriptures Strong's Hebrew uses, was designed for Bibles,
  is no longer developed, and has little for dictionaries.
- **One file per lexicon**, with a TEI header giving the title, authors,
  edition, the exact source (address, date, SHA-256), the license, and the
  attribution.
- **Corrections are visible in the file** as TEI's
  `<choice><sic>itc.</sic><corr>etc.</corr></choice>`, with the evidence in
  a note, so a reader sees both what the source said and what we changed.
- **Converters** (`tools/import-<source>.py`) read the source exactly as
  received, kept unchanged in `assets/<id>/source/`, and write the TEI file.
  They fail on any markup they don't know. They are run again only when the
  source or a correction changes, and the TEI file is committed.

## What is kept from each source

Only the dictionary's own text is kept. Everything else is left out, and the
importer counts what it leaves out, so nothing is dropped by accident.

- **Strong's Hebrew.** Kept: the headword (`lemma`), transliteration
  (`xlit`), pronunciation (`POS`), and the three notes `exegesis` (From),
  `explanation` (Meaning) and `translation` (In the KJV), with their
  italics (`hi`), links to other entries (`w src`), and Hebrew words with
  no link (alternative spellings, `w` without `src`), each with its
  transliteration and pronunciation. Left out: the outline in `list`
  (Online Bible's abridged Brown-Driver-Briggs, not Strong's), the TWOT
  numbers (`gloss`), the Greek equivalents in `foreign`, and the
  part-of-speech codes (`morph`). The editors' own `x-typo` notes, which say
  what Open Scriptures corrected, are kept in the TEI file but not in the
  module. Done: `tools/import-strongs-hebrew.py` and its independent check
  `tools/check-strongs-hebrew.py`.
- **Strong's Greek.** Kept: the headword (`unicode`), transliteration,
  pronunciation, alternative forms ("or ..."), `strongs_derivation`
  (From), `strongs_def` (Meaning), `kjv_def` (In the KJV), and Strong's
  remarks after the renderings, with their Greek and Latin words and links
  (`strongsref`), including links to Strong's Hebrew numbers. The Beta Code
  (`BETA`) is used only to test the Beta Code converter. The `see` lists
  repeat the links already in the text and are left out, and so are the
  101 numbers Strong left unused. Done: `tools/import-strongs-greek.py` and
  `tools/check-strongs-greek.py`; see its PROVENANCE.md for the two
  corrections version 1.9 still needs, both links.
- **Liddell and Scott.** Kept: every entry with its headword, etymology,
  numbered senses, translations, usage labels, Greek words, and links. The
  Greek is Beta Code and is converted to Unicode (NFC). All 36,490 entries
  are kept: 30,676 main entries and 5,814 compound verbs (`type="cv"`).
  The notes inside entries giving a word's forms (`type="alt"`, such as
  `diaba^te/os, h, on` in Beta Code) and inflections (`infl`, such as "fut.") are kept as
  `form` elements. The mapping of LS's other markup (`xr`, `ref`, `bibl`,
  `gramGrp`, `pos`) is settled when its importer is written, and added to
  the table below.
- **BDB.** Kept: every entry, Hebrew and Aramaic, with its headword, its
  numbering among words spelled the same (`ordinal`: I., II.), BDB's dagger
  (`all_cited`: every occurrence is cited), forms, numbered senses, notes,
  scripture references, and the Hebrew, Aramaic, Syriac, Arabic and other
  words in their own scripts. Left out: the GK and TWOT numbers (numbering
  systems still under copyright), Sefaria's `quotes`, `occurrences` and
  links between neighbouring headwords, and its `strong_numbers`, which are
  replaced by a finer mapping (see "Strong's numbers"). Sefaria's text
  spells out BDB's abbreviations and writes references in full, on purpose;
  that is kept, like Open Scriptures' editing of Strong's.

## The module file

The `module` table is the same as a Bible's, with `moduleType` set to
`lexicon`. As for Bibles, `license` holds the full license and attribution
text: the rights holder or "Public domain", the license name and link, the
source, and that the text was converted (and, where it was, corrected). The
app shows it at the foot of every entry, and in the Modules dialog.

Tables:

- `entries`: `id` (reading order: by number for Strong's, source order for
  LS), `key` (unique: `H7218`, `G26`, or LS's headword in Unicode, with the
  source's homograph number kept, such as `ἄγη1`; for BDB, Sefaria's entry
  id, such as `BDB09078`), `headword` (exactly as the source gives it,
  never normalized), `headwordLang` (`hbo`, `arc` for Aramaic, or `grc`),
  `homograph` (BDB's `I.`, `II.`, ...), `translit`, `pronunciation` (each
  may be empty), `allCited` (1 where BDB prints its dagger, else 0), and
  `body` (JSON, see below). There is no plain-text copy of the body, unlike
  a Bible's `raw`: nothing searches it, and the checks derive plain text
  from `body` themselves.
- `lookups`: `kind`, `value`, `entryId`, indexed on `(kind, value)`. This is
  how the app finds an entry from a word in a Bible:
  - `strong`: a Strong's number in normal form (below). Every Strong's entry
    has one. In LS, an entry gets one when its headword matches the lemma of
    a Strong's Greek entry (checked against CrossWire's `MLStrong`).
  - `lemma`: the headword as the TR or Masoretic text's lemma would give it.

There is no full-text search table (FTS5): an entry is only ever found by
an exact value, through `lookups`' index on `(kind, value)` or the unique
index on `entries.key`.

## Entry content

`body` is a JSON array of items, in the same shape as a Bible verse's
`children`: a string, or an element `{"style": ..., "children": [...]}`
with optional attributes as further string fields. The styles are:

| Style | Attributes | Meaning | Used by |
|---|---|---|---|
| `deriv` | | Derivation, shown as **From** | SH, SG |
| `def` | | Definition, shown as **Meaning** | SH, SG |
| `kjv` | | KJV renderings, shown as **In the KJV** | SH, SG |
| `etym` | | Etymology | LS |
| `sense` | `n`, `level` | A numbered sense, such as `n="II"` or `n="1"` | LS, BDB |
| `note` | | A note within an entry | BDB |
| `strong` | | Bold | BDB |
| `sup`, `sub` | | Superscript or subscript, such as BDB's citation details | BDB |
| `bref` | `sid` | A scripture reference, such as `sid="GEN 10:10"`; its children are the text shown | BDB |
| `em` | | Italic | all |
| `form` | | A word's forms or inflections | LS |
| `tr` | | A translation, in bold | LS |
| `usg` | `title` (optional) | A usage label, such as `NTest.`, with its meaning | LS |
| `foreign` | `lang` | A Hebrew or Greek word inside English text | all |
| `ref` | `strong` or `key` | A link to another entry; its children are the text shown. A Strong's number of another language (SG's links to Hebrew numbers) opens in that language's lexicon. In TEI such a link points into the other lexicon's file (`eng_strongs_heb.tei.xml#H85`) | all |
| `word` | `lang`, `translit`, `pronunciation` (each optional except `lang`) | A Hebrew or Greek word with no link, such as an alternative spelling; its children are the word, and may be empty when the dictionary gives only a pronunciation | SH |

A `foreign` element's `lang` is a language code (`hbo`, `arc`, `syc`,
`ar`, `grc`, ...), so the app can choose the font and text direction.

The top level holds only `deriv`, `def`, `kjv`, `etym`, `form`, `note` and
`sense` elements. In Strong's Greek, `form` holds the alternative forms
(TEI `note type="forms"`) and `note` Strong's remarks after the KJV
renderings (TEI `note type="comment"`). Any other style, or an attribute not listed, fails the
build, as unknown USX does for Bibles.

A lexicon holds dictionary forms only. The grammar of a word as it appears
in a text, such as a verb's tense and person, belongs to the Bible module
that holds the word, and reaches the lexicon through `lookups`.

## Strong's numbers

The normal form is `H` or `G`, then the number in decimal with no leading
zeros: `H430`, `G26`. A letter suffix, if a source ever has one, is kept in
lower case (`H1234a`).

Sources write numbers in other ways (`H0430` in the KJV, `00025` and `25` in
the Greek dictionary). The generator and the app both convert to the normal
form before comparing, with the same shared test cases. Bible modules keep
their numbers as their source wrote them.

One number may lead to several entries, and the app then lists them (for
example the four BDB entries spelled like rosh, H7218: head, poison, a son
of Benjamin, and the nation Rosh). For BDB, Sefaria attaches
numbers to groups of related entries, so 3,366 numbers sit on more than one
entry; the converter narrows this with Open Scriptures' `LexicalIndex.xml`
(CC BY 4.0, which then needs its own attribution), and lists in
PROVENANCE.md every number it couldn't narrow.

## The lexicon tree

A lexicon has two roots, like a Bible's text and content roots, using the
notation and `enc_list` of `integrity-spec.md`:

```
entry  = H(0x00 || str("entry") || str(key) || str(headword) || str(headwordLang)
              || str(homograph) || str(translit) || str(pronunciation)
              || u32(allCited) || enc_list(body))
lookup = H(0x00 || str("lookup") || str(kind) || str(value) || str(entry key))

keys root    = H(0x01 || str("bible-nav lexicon tree") || u32(1) || str("keys")
                    || u32(number of entries) || str(key) for each entry in id order
                    || u32(number of lookups) || lookup hashes in order)
content root = H(0x01 || str("bible-nav lexicon tree") || u32(1) || str("content")
                    || u32(number of entries) || entry hashes in id order
                    || u32(number of lookups) || lookup hashes in order)
```

Lookups are ordered by kind, then value, then entry key (UTF-8 byte order).
An empty field is the empty string.

- The **keys root** covers which entries exist and how they are found. If it
  is unchanged, every link and every Strong's number still opens the same
  entry.
- The **content root** covers everything the entries say.

## The manifest

A lexicon's manifest has `module.moduleType` and an `entries` section in
place of `text`:

```json
{
  "type": "bible-nav module manifest",
  "manifestVersion": 1,
  "module": {
    "id": "eng_strongs_heb",
    "version": "1.0.0",
    "moduleType": "lexicon",
    "formatVersion": 1,
    "name": "Strong's Hebrew Dictionary",
    "abbreviation": "SH",
    "languageCode": "eng"
  },
  "file": { "name": "eng_strongs_heb-1.0.0.db", "size": 0, "sha256": "..." },
  "entries": {
    "treeVersion": 1,
    "edition": "...",
    "source": "...",
    "lookups": ["strong:H"],
    "count": 8674,
    "keysRoot": "...",
    "contentRoot": "..."
  },
  "createdAt": "2026-11-18"
}
```

- A manifest without `moduleType` is a Bible. `formatVersion` counts
  separately for each type: lexicon format 1, Bible format 2.
- `lookups` says what the lexicon can be found by: `strong:H` (Strong's
  Hebrew numbers), `strong:G`, or `lemma:grc`. The app uses it to offer the
  right download when no lexicon for a word is installed, without
  downloading anything first.
- The app computes both roots itself and checks them, as it does for
  Bibles. Lexicons are never pinned.

## Versions

- **Major:** the keys root changed (an entry added, removed or renamed, or a
  lookup changed).
- **Minor:** only the content root changed, such as a correction.
- **Patch:** only what neither root covers, such as the license text.

`generate` enforces this against earlier exports, as for Bibles.

## Corrections

Errors in a source, such as OCR mistakes, are listed in a corrections file,
`assets/<id>/corrections.yaml`, never made by editing the source. The
converter applies them and marks each in the TEI file (see "Source
files"):

```yaml
- entry: H7218
  find: "rank, itc.)"
  replace: "rank, etc.)"
  evidence: >-
    Strong (1890), Hebrew and Chaldee Dictionary, page 106, entry 7218:
    Internet Archive, StrongsGreekAndHebrewDictionaries1890.
```

- A link correction gives `link` (the number linked to) and `corr` (the
  right number) instead of `find` and `sic`; the link must occur exactly
  once in the entry.
- `find` must occur exactly once in one text item of that entry, or the
  build fails. So if the source is fixed upstream, the build says so and the
  correction can be removed.
- Correct only real errors against the printed edition. The Open Scriptures
  text spells out Strong's abbreviations on purpose; that is not an error.
- PROVENANCE.md lists every correction. A CC BY-SA lexicon's license text
  says it was changed ("with corrections").
- Offer each correction upstream.

## Checking a build

As with Bibles, the build fails unless an independent reader, sharing no
code with the converter or the generator, gives the same plain text for
every entry: once from the source to the TEI file (after leaving out the
same parts and applying the corrections), and once from the TEI file to the
module. `tools/text-roots.py` computes the lexicon tree too, sharing no code with
the generator.

For BDB, the converter also checks the Hebrew and Aramaic it quotes from
Scripture: where a quotation sits beside a single reference, its words
should appear in that verse of the Masoretic text module, in order. Spot
checks against the 1906 printing found a wrong letter and Hebrew words out
of order, both of which this catches. Each flagged quotation is checked
against the printed page and either corrected (with the page as evidence)
or marked as checked, so the list shrinks to nothing before the first
release.

The Beta Code converter is tested on the 6,129 Greek words in Strong's Greek
Dictionary that are given both in Beta Code and in Unicode. The Middle
Liddell also marks vowel length (`^` short, `_` long), which Strong's never
does, so those need test cases of their own.

## Not decided yet

- Search inside lexicons (an English word, such as "love", to entries).
  It would need a full-text table, and so a new format version.
- How LS abbreviations (`NTest.`, `id.`) are expanded in `usg` titles:
  the Middle Liddell's list of abbreviations isn't in the Perseus file.
- Which TEI Lex-0 release to follow (0.9.x, not yet 1.0), and whether a
  schema check of each TEI file runs in the build.
- Whether the WLC module's Hebrew must match BDB's quotations exactly, or
  by consonants only: BDB often quotes without accents, or with a
  different pointing.
