# Literal Standard Version: where this text comes from

Imported on 2026-11-14. This is the record of exactly which text `eng_lsv`
is, and how to check it. The LSV isn't a locked or pinned text in Bible Nav:
it's offered as a download.

## The edition

**eBible.org englsv, 2026-10-30 release (Literal Standard Version, Covenant
Press, 2020).**

The Literal Standard Version is a modern, literal English translation by
Covenant Press, protocanon only. eBible.org's copyright page says:

> The Holy Bible in English, Literal Standard Version copyright © 2020
> Covenant Press. ... This translation is made available to you under the
> terms of the Creative Commons Attribution Share-Alike license 4.0.

The license (https://creativecommons.org/licenses/by-sa/4.0/) allows sharing
and redistributing it in any format, provided the copyright and source
information goes with it, any changes are marked, and anything built on it is
shared under the same license. Bible Nav changes nothing in the text, only
its format, and the module's `license` field carries the copyright, license,
and source, which the app shows with the module.

Its markup differs from the KJV's:

- Poetic line breaks are written in the text as `||`.
- Alternative renderings are given in the text as `[[or ...]]`, with the
  brackets in bold and "or" in italics, as are passages found in only some
  manuscripts (such as 1 John 5:7). The module keeps the bold (`bd`) and
  italic (`it`) as formatting.
- Many words carry Strong's numbers, but there are no footnotes or
  headings, and each chapter is one paragraph.
- It follows the KJV's verse numbering: 31,102 verses. eBible's files add
  two verses holding only a dash, 3 John 1:15 and Revelation 12:18, which
  are placeholders (other translations number verses there; the LSV keeps
  those words in 3 John 1:14 and Revelation 13:1). They hold no text, so
  `import-ebible.py` leaves them out, and `compare-ebible.py` skips them.

## The files

| File | What it is |
|---|---|
| `ebible/englsv_usfm.zip` | eBible's USFM release, downloaded 2026-11-14 from `https://ebible.org/Scriptures/englsv_usfm.zip` (Last-Modified 2026-10-30 06:45 GMT). The input. |
| `ebible/englsv_usfx.zip` | eBible's USFX release of the same text, downloaded the same day. The independent reference for `tools/compare-ebible.py`. |
| `*.usx` | The USFM converted to USX by `tools/import-ebible.py` with usfmtc 0.4.10. `SHA256SUMS` lists their hashes. |

```
SHA-256 b5fd551d49086785430ca4d670e2914b53c63fd65cb84717b7b200466305861f  englsv_usfm.zip
SHA-256 b3e24f9d6787e879a377b05b20592e511e2da1e3067c6160a59bbdb50af03528  englsv_usfx.zip
```

Each archive's `signature.txt.asc` is a list of the SHA-256 of its files,
PGP-signed by eBible's editors with the key whose fingerprint is
`54D7 14D7 6956 DA66 73DC 1EEA 5F62 009D 9350 5F26` (the same key as the
KJV's; see `assets/eng_kjv/PROVENANCE.md`). `import-ebible.py` checks that
signature and those hashes before converting.

## The conversion

The LSV's USFM writes its `||` line breaks as bare `|` characters. In USFM a
bare `|` begins a marker's attributes, so usfmtc read the words after each
one as attributes and dropped them: Joel 2:32 came out as "And it has come to
pass, YHWH is delivered, YHWH has said, YHWH is calling!". So
`import-ebible.py` escapes every `|` that isn't an attribute separator
(30,454 here, two for each of the 15,227 `||`) before converting, and the
generator now refuses any attribute it doesn't know, so no text can hide in
one again. It also leaves out the two placeholder verses described above,
and names them when it does.

## The comparison

On 2026-11-14 the generated module (`eng_lsv-1.0.0.db`) was compared with
eBible's USFX, which never went through the conversion, using
`tools/compare-ebible.py`. Leaving out the two placeholder verses and
treating runs of whitespace as one space, there were no differences in the
list and order of all 31,102 verses, their text
(every `||` included), the inline markup (each word's Strong's number, and
the bold and italic), the paragraphs, or the books' names and titles.

Text root `988d5ae656ab96b8daa9d83dd21a110513fafa3550aa39c5836f2163db72d3db`,
content root
`fe43a29977e4a3daca114a00d3798ff0e75542a48c26978b9544e04608a8c4fa`; the
generator, `tools/text-roots.py`, and Bible Nav's own check all give these.

## Checking it yourself

```
cd assets/eng_lsv
sha256sum -c SHA256SUMS                 # the USX files are unchanged
sha256sum ebible/*.zip                  # compare with the hashes above
cd ../..
tools/venv/bin/python tools/import-ebible.py convert eng_lsv   # checks eBible's signature, converts again
python3 tools/compare-ebible.py assets/eng_lsv/ebible/englsv_usfx.zip exports/eng_lsv-1.0.0.db
```
