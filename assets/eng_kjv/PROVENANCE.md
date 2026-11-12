# King James Version: where this text comes from

Locked on 2026-11-11. This is the record of exactly which text `eng_kjv` is,
and how to check it.

## The edition

**eBible.org eng-kjv2006, 2026-11-10 release (CrossWire KJV: an electronic
edition of Benjamin Blayney's 1769 Oxford text, with Strong's numbers).**

eBible.org builds `eng-kjv2006` from the CrossWire Bible Society's KJV.
CrossWire's aim is a faithful electronic edition of Benjamin Blayney's 1769
Oxford edition, checked against a facsimile of it. By CrossWire's own account
(https://wiki.crosswire.org/CrossWire_KJV) it isn't yet identical to that
printing:

- Some Cambridge spellings are still being converted to Blayney's Oxford
  spellings.
- The words of Jesus are marked in red following Louis Klopsch's 1901
  edition; the 1769 edition has no red letters.
- Strong's numbers were added: Old Testament from The Bible Foundation, New
  Testament from Dr. Maurice A. Robinson's Textus Receptus.
- The Old Testament marginal notes are still under review; up to 22 may be
  missing.
- A few canonical colophons (Job 31:40, Psalm 72:20, Habakkuk 3:19) aren't
  yet marked as such.

So this module's text root identifies this electronic edition, not the
printed book. A future corrected edition would be a new edition, with its
own text root.

eBible.org states the text is in the public domain (outside the United
Kingdom, where the Crown's letters patent restrict printing).

## The files

| File | What it is |
|---|---|
| `*.usx` | The input the generator reads: one USX file per book, downloaded from `https://v1.fetch.bible/bibles/eng_kjv/usx/{book}.usx` (fetch.bible commit `7f36064`, 2026-07-15). `SHA256SUMS` lists their hashes. |
| `ebible/eng-kjv2006_usfx.zip` | eBible.org's own release of the same text, downloaded 2026-11-11 from `https://ebible.org/Scriptures/eng-kjv2006_usfx.zip` (Last-Modified 2026-11-10 06:31 GMT), kept unchanged as the signed reference. |

`ebible/eng-kjv2006_usfx.zip` has these hashes:

```
SHA-256 ba858bf2c029179c7bd23ebd3888ed32280ab6c78ae1fe5b043ee7885038af84
```

Inside it, `signature.txt.asc` is a PGP-signed list of the SHA-256 of every
file in the archive, signed on 2026-11-10 by "World English Bible editors
<editors@eBible.org>", key fingerprint

```
54D7 14D7 6956 DA66 73DC  1EEA 5F62 009D 9350 5F26
```

(a DSA key, signing with SHA-1). The key is included in the archive as
`keys.asc`; the copy eBible's instructions point to,
`https://ebible.org/web/keys.asc`, returned "not found" on 2026-11-11.

## The comparison

On 2026-11-11 the module generated from the USX was compared with eBible's
release, verse by verse, with `tools/compare-ebible.py`. Treating runs of
whitespace as one space, there were no differences at all in:

- the list and order of all 31,102 verses, and their text;
- the inline markup: every word's Strong's number, the translator's italics
  (`add`), the divine name (`nd`), the words of Jesus (`wj`), and
  transliterated words (`tl`);
- all 6,959 footnotes;
- all 152 headings (Psalm titles, Psalm 119's letters, and the closing notes
  of the epistles), with their positions;
- the paragraph and poetry layout, and the books' names and titles.

So the fetch.bible copy and eBible's signed release hold the same text.

## Checking it yourself

```
cd assets/eng_kjv
sha256sum -c SHA256SUMS                 # the USX files are unchanged
sha256sum ebible/eng-kjv2006_usfx.zip   # compare with the hash above

# eBible's signature (needs GnuPG); use a separate keyring
mkdir -p /tmp/ebible && cd /tmp/ebible && unzip -o <path>/eng-kjv2006_usfx.zip
export GNUPGHOME=$(mktemp -d)
gpg --import keys.asc
gpg --verify signature.txt.asc          # "Good signature", fingerprint as above
grep -E '^[0-9a-f]{64}  ' signature.txt.asc | sha256sum -c

# then, from the repository root, compare it with a generated module
python3 tools/compare-ebible.py assets/eng_kjv/ebible/eng-kjv2006_usfx.zip \
  exports/eng_kjv-1.1.0.db
```
