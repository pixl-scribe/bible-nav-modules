# Webster Bible (1833): where this text comes from

Imported on 2026-11-16. This is the record of exactly which text
`eng_webster` is, and how to check it. The Webster Bible isn't a locked or
pinned text in Bible Nav: it's offered as a download.

## The edition

**eBible.org engwebster, 2026-10-30 release (Noah Webster's 1833 revision of
the King James Version).**

eBible.org's title page reads: "The Holy Bible, Containing the Old and New
Testaments, in the Common Version, with Amendments of the language by Noah
Webster, LL.D." Webster kept the King James Version but replaced words that
had become obsolete or misleading. eBible's copyright page says the text is
**public domain**, and that its files were made "from source files dated
12 Dec 2025".

Its markup is simpler than the KJV's:

- Translator's additions (`add`, shown in italics) are marked: 21,352 of them.
- There are no footnotes, headings, or words of Jesus, and each chapter is
  one paragraph; the module's paragraphs are the KJV's (see "Paragraphs"
  below). It has no Strong's numbers of its own: those in this module are
  the KJV's, carried over (see "Strong's numbers" below).
- **Psalm titles are part of verse 1**, not separate headings: Psalm 3:1
  reads "A Psalm of David, when he fled from Absalom his son. LORD, how are
  they multiplied that trouble me? ...". This is how the source has it, so
  the module keeps it, and the titles count as text.
- The epistles' closing notes ("Written to the Romans from Corinthus ...")
  aren't in this edition.
- "LORD" is written in capitals in the text, not marked as the divine name.
- It follows the KJV's verse numbering: 31,102 verses.
- The source has a few spaces before punctuation after an addition, such as
  3 John 1:12, "all *men* , and by the truth". The module keeps the source's
  spacing exactly, as it does for every text.

## The files

| File | What it is |
|---|---|
| `ebible/engwebster_usfm.zip` | eBible's USFM release, downloaded 2026-11-16 from `https://ebible.org/Scriptures/engwebster_usfm.zip` (Last-Modified 2026-10-30 04:24 GMT). The input. |
| `ebible/engwebster_usfx.zip` | eBible's USFX release of the same text, downloaded the same day. The independent reference for `tools/compare-ebible.py`. |
| `*.usx` | The USFM converted to USX by `tools/import-ebible.py` with usfmtc 0.4.10 (`SHA256SUMS.converted` lists those files' hashes), then given the KJV's paragraphs by `tools/layout-webster-from-kjv.py` and its Strong's numbers by `tools/tag-webster-strongs.py` (`SHA256SUMS` lists the final files' hashes). `tools/check-webster.py` checks both steps. |

```
SHA-256 0f3c1122422adba66cf1e0c98e11db117beebbe40994d2d8afb5e80cc84942cf  engwebster_usfm.zip
SHA-256 5c3cd24a7749a2e8e1d8713549f565afcacb9ab6cbbeabdba98ce28e50c12c81  engwebster_usfx.zip
```

Each archive's `signature.txt.asc` is a list of the SHA-256 of its files,
PGP-signed by eBible's editors with the key whose fingerprint is
`54D7 14D7 6956 DA66 73DC 1EEA 5F62 009D 9350 5F26` (the same key as the
KJV's; see `assets/eng_kjv/PROVENANCE.md`). `import-ebible.py` checked that
signature and those hashes before converting.

## The conversion

Nothing needed special handling: the source has no literal `|` characters
and no placeholder verses, and every book converted without change.

## The comparison

On 2026-11-16 the generated module (`eng_webster-1.0.0.db`) was compared with
eBible's USFX, which never went through the conversion, using
`tools/compare-ebible.py`. There were **no differences** in the list and
order of all 31,102 verses, their text, the inline markup (the translator's
additions), the paragraphs, or the books' names and titles. Its spacing
matched exactly, without treating runs of whitespace as one.

`tools/text-roots.py`, written independently of the generator, gave the same
roots:

```
Text root:    cfaeb2002114f0ab086ecac84123e3df015738cef95b52dbbc359a1e039d5d57
Content root: 047279374242ef567f7684f56c98c258b8452f16b28715a4bf61cd2c061a8be8
```

That comparison was of the text before the Strong's numbers were added.
`compare-ebible.py` now reports them as differences, since eBible's Webster
has none; the text itself is unchanged, as the text root shows (below).

## Paragraphs

Added 2026-11-22 (decided with the maintainer). eBible's Webster has one
paragraph per chapter. Webster's 1833 printing, set from a King James
Bible (the Collins quarto revised under John Witherspoon), kept the KJV's
paragraph marks (the scan at Internet Archive `ENGWBR_DBS_HS` shows
"24 ¶ And God said"), and Webster's verses line up one for one with the KJV's. So
`tools/layout-webster-from-kjv.py` gives each chapter the paragraphs of the
KJV's source USX (`assets/eng_kjv`): 4,635 prose paragraphs, 2,461 poetic
lines in the Psalms and 209 blank lines between stanzas, each holding the
same verses as in the KJV. This is the KJV module's layout, not a
transcription of Webster's printing. The KJV's headings are not copied:
Webster's Psalm titles are part of verse 1, and it has no closing notes.
Nor are the paragraph marks (¶) themselves, which would change the
text. Only whole verses move into new paragraphs, so the text root is
unchanged.

The 1833 printing also has chapter summaries and marginal notes, which no
electronic edition found has (eBible, CrossWire, Open Bible Data); they
would have to be transcribed from the scan.

## Strong's numbers

Added 2026-11-22 (decided with the maintainer). Webster revised the King
James Version word by word, so most of the KJV's Strong's numbers apply to
Webster's words too. `tools/tag-webster-strongs.py` compares each verse of
Webster with the same verse of the KJV (`assets/eng_kjv/*.usx`, eBible.org
eng-kjv2006 of 2026-11-10, whose Strong's numbers are CrossWire's: Old
Testament from the Bible Foundation, New Testament from Maurice Robinson's
Textus Receptus tagging; see `assets/eng_kjv/PROVENANCE.md`), and gives a
KJV phrase's number to the Webster words that stand for it:

| Kind | KJV phrases | |
|---|---|---|
| The same words in the same place | 334,219 | 95.68% |
| Words replaced one for one (Webster's updates: "unto" to "to", "spake" to "spoke") | 10,147 | 2.90% |
| A change within the one phrase ("did eat" to "ate", "round about" to "around") | 2,167 | 0.62% |
| A compound written apart ("firstborn", "first born") | 863 | 0.25% |
| A particle dropped, the main word kept ("flew up" to "flew") | 128 | 0.04% |
| **Carried** | **347,524 of 349,308** | **99.49%** |

The other 1,784 KJV phrases have no counterpart in Webster: mostly words
Webster removed that the KJV tags on their own ("up", "together", "forth",
a pronoun), and changes that run across two tagged phrases, where which
number belongs where can't be told. Those Webster words have no number;
none is guessed. Psalm titles, a heading in the KJV and part of verse 1
here, carry their numbers too. Three verses have none, as in the KJV
(Mark 9:43, Luke 6:41 and 17:36). Where a phrase spans an italic word, it
is tagged piece by piece with the same number.

`tools/check-webster.py`, sharing no code with the layout tool or the
tagger, checks that the text is unchanged (with the tags removed and each
chapter's paragraphs joined back into one, every file has the hash in
`SHA256SUMS.converted`), that the paragraphs are the KJV's, and that in
every verse Webster's numbers are the KJV's, in the KJV's order. With the numbers added, the module's text root
is unchanged and only its content root changed (both confirmed by
`tools/text-roots.py`):

```
Text root:    cfaeb2002114f0ab086ecac84123e3df015738cef95b52dbbc359a1e039d5d57
Content root: 4eaf32331891e7d2f76ef65df92ee74ac30dc51b519da5f8cb2cea2c2acbae2a
```
