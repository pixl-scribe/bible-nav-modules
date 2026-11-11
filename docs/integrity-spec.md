# Bible Nav module integrity and signing

Version 1, **draft**. Nothing here is final until the first module is signed
with it; after that, this version never changes, and any change becomes
version 2.

This document says exactly how a Bible Nav module is hashed and signed, so
that anyone can check a copy, with Bible Nav or without it. It's written to
be enough on its own: a programmer with only this file, the module, and the
source text should be able to write a checker.

## Why

Bible Nav exists to preserve the traditional text (the Masoretic Hebrew Old
Testament, the Greek Textus Receptus New Testament, and translations such as
the King James Version) and to let people confirm that a copy they were given
is unaltered. Copies may pass from hand to hand for years with no internet
and no way to reach the maintainer. So:

- **A text can be identified.** Every module carries a *text root*: one
  SHA-256 hash of its whole text, computed in a documented way. Two copies
  with the same text root have the same canonical text, word for word and
  mark for mark. The text root of a published edition can be written down, printed,
  and compared by eye.
- **A module can be trusted.** Every module comes with a manifest signed by
  the maintainer. Bible Nav release builds load only modules with a valid
  signature from a key built into the app.
- **Damage can be found.** Because the text root is a tree of hashes
  (testaments, books, chapters, verses), a damaged or altered
  copy can be compared with a good one to find exactly which verses differ.

A signature means the Bible Nav project vouches for the text. Anyone may fork
Bible Nav and use their own key, or none.

## Files

A signed module is three files with the same base name, kept together:

| File | What it is |
|---|---|
| `eng_kjv-1.0.0.db` | The module: a read-only SQLite database (see the module format). |
| `eng_kjv-1.0.0.manifest.json` | The manifest: what the module is, and its hashes. These exact bytes are what is signed. |
| `eng_kjv-1.0.0.manifest.sig` | One or more signatures of the manifest. |

The signature is outside the module, so the module stays a plain SQLite file
that any SQLite tool can open, and its hash covers every byte of it.

## Notation

- `u32(n)`: `n` as 4 bytes, big-endian.
- `str(s)`: `u32(byte length of s in UTF-8) || UTF-8 bytes of s`.
- `||`: joining byte strings.
- `H(x)`: SHA-256 of `x`, 32 bytes.
- Hashes are written as 64 lowercase hexadecimal digits.

**Text is hashed exactly as stored.** No Unicode normalization (NFC, NFD, or
any other), no trimming, no changes to spaces or line endings, no case
changes. Normalization can reorder Hebrew vowel points and accents, which
would make different texts look the same, or the same text look different.
The module stores each edition's own code points, and the generator must
never normalize them.

## The text tree

The text tree follows the shape of the text:

```
root
└── testament (OT, NT)
    └── book (GEN, EXO, ...)
        └── chapter (1, 2, ...)
            └── canonical headings and verses, in reading order
```

The tree holds the text itself: the words of every verse, with the
translator's italics and the divine name, its verse, chapter, and book
numbering, and the **canonical headings**: headings that are part of the
text, such as the Psalm titles (style `d`, for example "A Psalm of David,
when he fled from Absalom his son." before Psalm 3:1).

Presentation isn't part of the text, so it isn't in the tree: paragraph and
poetry layout, book titles, navigation names (`toc1`, `toc2`, `toc3`,
`header`), module metadata, the search index, and plain-text copies (`raw`).
The file hash covers all of them. Layout and titles can then be corrected
without changing the text root, as long as no word changes.

### Two views: text and content

The tree is computed twice, giving two roots:

- **Text root**: the canonical text alone. It leaves out what editors and
  publishers added around the text: Strong's numbers, footnotes, the red
  letters marking the words of Jesus, and headings that aren't canonical
  (such as the section heading style `s1`, used for Psalm 119's Hebrew
  letters and the closing notes after the epistles). An edition with
  Strong's numbers and red letters, and the same edition without them, have
  the same text root, so it identifies the edition.
- **Content root**: everything the tree holds, as stored, including those
  additions. It identifies this exact module's text and annotations.

### Inline content

A verse or heading holds a list of inline items. Each item is either **text**
(a string) or an **element** with a style name, attributes, and a list of
child items. Stored content (the `children` column, a JSON array) maps to
items like this:

| Stored JSON | Item |
|---|---|
| `"..."` | text |
| `{"style": "w", "strong": S, "txt": T}` | element `w`, attribute `strong` = S, children: one text item T |
| `{"style": X, "children": [...]}` | element X, no attributes, those children |

So a footnote, `{"style": "f", "children": [...]}`, is element `f`, and its
parts (`fr`, `ft`, ...) are its child elements.

An item is encoded as:

```
enc(text s)    = 0x74 || str(s)
enc(element)   = 0x65 || str(style)
                      || u32(number of attributes)
                      || for each attribute, sorted by name (UTF-8 byte order):
                           str(name) || str(value)
                      || u32(number of children)
                      || enc(child) for each child, in order
enc_list(items) = u32(number of items) || enc(item) for each item, in order
```

(`0x74` is `t`, and `0x65` is `e`.)

**The content view** encodes the items as stored.

**The text view** first changes the items:

1. Remove every `f` element (footnotes), with everything inside it.
2. Replace every `w` element (a word with its Strong's number) and every `wj`
   element (words of Jesus, printed in red) with its children, keeping the
   words.
3. Remove all attributes from the remaining elements.
4. Join adjacent text items into one, and remove empty text items.
5. Do the same inside every remaining element.

What remains are the words, with the elements that are part of the edition
itself: `add` (the translator's italics), `nd` (the divine name, such as
LORD), and `tl` (a transliterated word).

Step 4 means the text view doesn't depend on how the source happened to split
the text: `"In the "`, `"beginning"` and `"In the beginning"` encode the same.

### Leaves

```
verse   = H(0x00 || str("verse")   || str(verse number) || enc_list(items))
heading = H(0x00 || str("heading") || str(style)        || enc_list(items))
```

- The verse number is written in decimal with no leading zeros (`"16"`). It's
  a string so that combined verses such as `"1-2"` can be added later.
- The style is the heading's paragraph style, such as `d` (a Psalm title).
- The text view keeps only canonical headings (style `d`). The content view
  keeps every heading.

### Nodes

```
chapter   = H(0x01 || str("chapter") || str(chapter number)
                   || u32(number of items) || heading and verse hashes in order)
book      = H(0x01 || str("book") || str(book code)
                   || u32(number of chapters) || chapter hashes in order)
testament = H(0x01 || str("testament") || str(code)
                   || u32(number of books) || book hashes in order)
root      = H(0x01 || str("bible-nav text tree") || u32(1) || str(view)
                   || u32(number of testaments) || testament hashes in order)
```

- A chapter's items are its headings and verses in reading order. Most
  headings come before a verse (a Psalm title before verse 1), but some come
  after one (an epistle's closing note after its last verse).
- The book code is the USX code, such as `GEN` or `JHN`.
- The testament code is `OT` or `NT`. A module with only one testament (such
  as the Greek New Testament) has only that one.
- `u32(1)` is this document's version. `view` is `"text"` or `"content"`.
- Every list is in reading order: testaments as in the canon, books by
  `books.id`, chapters by number, and a chapter's headings and verses in
  order.

The `0x00` and `0x01` prefixes, the type names, and the length prefixes make
sure no leaf can be mistaken for a node, and no two different trees can give
the same bytes to hash.

### Reading the tree from a module

From a format 2 module (see "Module format changes" below):

- Testaments: `testaments`, in canonical order (`OT`, then `NT`).
- Books: `books` with that `testamentCode`, ordered by `id`.
- Chapters: `chapters` for that book, ordered by `nbr`.
- A chapter's items: the `verses` and `headings` rows with that book and
  chapter, in reading order. A heading comes right after the verse whose id is
  its `afterVerseId`, so order the items by position: a verse's position is
  its `id`, and a heading's is its `afterVerseId` plus one half, with headings
  of the same position kept in `id` order. A heading at the start of a
  chapter, such as a Psalm title, has the previous chapter's last verse as its
  `afterVerseId`, so it comes first.

Every heading and verse belongs to exactly one chapter. The generator rejects
any source that doesn't fit this shape.

## The manifest

The manifest is a UTF-8 JSON file. Its exact bytes are signed, so it is
never reformatted after signing. For example:

```json
{
  "type": "bible-nav module manifest",
  "manifestVersion": 1,
  "module": {
    "id": "eng_kjv",
    "version": "1.0.0",
    "formatVersion": 2,
    "name": "King James Version (1769)",
    "languageCode": "en"
  },
  "file": {
    "name": "eng_kjv-1.0.0.db",
    "size": 0,
    "sha256": "..."
  },
  "text": {
    "treeVersion": 1,
    "edition": "...",
    "source": "...",
    "textRoot": "...",
    "contentRoot": "..."
  },
  "createdAt": "2026-11-11"
}
```

- `type` comes first, so the signed bytes say what they are. A signature over
  a manifest can't be mistaken for a signature over anything else.
- `file.sha256` is the SHA-256 of the whole module file, uncompressed. It
  covers everything in it, including what the text tree leaves out.
- `text.edition` names the exact edition and `text.source` says where the
  source text came from, precisely enough to fetch it again (for example a
  snapshot's address and date).
- `createdAt` is the date the manifest was written. Signatures are added to
  the `.sig` file later without changing the manifest, so it isn't the date
  of any signature. Like every date in a manifest, it is written by whoever
  made the manifest, so it proves nothing.
- The manifest is written as JSON with two-space indentation and a final
  newline, though a checker must not depend on that: it checks the bytes as
  they are.

## Signatures

Signatures use **Ed25519**, with no other algorithm allowed, so there's
nothing to negotiate or downgrade.

The `.manifest.sig` file is UTF-8 text, one line per signature:

```
ed25519 <key id> <signature>
```

- `<key id>` is the first 16 hexadecimal digits of the SHA-256 of the 32-byte
  raw public key.
- `<signature>` is the 64-byte Ed25519 signature of the manifest's bytes, in
  standard Base64.

A manifest may be signed by more than one key, one line each.

## Keys and revocation

### The keys and their jobs

Bible Nav embeds public keys with fixed roles. Each role may sign only
certain things, and the app enforces this:

| Key | Signs | Kept |
|---|---|---|
| **Primary** | Module manifests, for everyday publishing. Nothing else. | By the maintainer, for regular use. |
| **Backup** | Key statements only (below). Never a module. | By the maintainer, offline only, apart from the primary key, so that whatever exposes the primary key can't also expose it. |
| **Development** | Module manifests, for testing. | With the source. Only development builds accept it; release builds reject it. |

- Signing keys are never stored in the repository, in CI, or with the module
  files.
- Publishing a module or a new version of one uses only the primary key. The
  backup key signs nothing at all unless the primary key must be replaced.
- Both the primary and backup public keys are built into the app, so neither
  needs to vouch for the other at setup.
- The public keys are kept in one obvious place in the app's source, so a
  fork can replace them.
- The maintainer should check now and then, on a computer that is offline,
  that the backup key still opens and that its public key matches the one in
  the app, so it's known to work before it's needed.

### Key statements

A **key statement** revokes a primary key and names the key that replaces it.
It's needed when the primary key is stolen, lost, or retired. Only a backup
key can sign one.

A statement is two files, like a manifest and its signatures, for example
`bible-nav-keys-1.json` and `bible-nav-keys-1.sig`. The `.sig` file has the
same form as a manifest's. The JSON's exact bytes are signed:

```json
{
  "type": "bible-nav key statement",
  "statementVersion": 1,
  "sequence": 1,
  "issuedAt": "2027-01-01",
  "revoke": [
    { "keyId": "...", "reason": "stolen" }
  ],
  "add": [
    { "keyId": "...", "role": "primary", "publicKey": "..." }
  ],
  "keepModules": [
    "..."
  ]
}
```

- `type` comes first, so a signature over a statement can't be mistaken for
  a signature over a manifest, or the other way round.
- `sequence` numbers the maintainer's statements 1, 2, 3, ..., for naming
  and for people comparing copies. Statements don't replace each other: the
  app applies every valid statement it has seen.
- `revoke` lists primary keys that are no longer trusted. `reason` is for
  people; the app treats every reason the same way.
- `add` lists new primary keys. `publicKey` is the 32-byte raw Ed25519 public
  key in standard Base64, and `keyId` must match it.
- `keepModules` lists modules a revoked key signed legitimately, by the
  SHA-256 of their manifest files, so they stay trusted. It can be empty, in
  which case the maintainer signs those modules again with the new key.

The app accepts a statement only if:

1. Its signature is valid, from a backup key built into the app. A statement
   signed by any other key, even a valid primary key, is ignored.
2. Its `type` and `statementVersion` are known.
3. It revokes and adds only primary keys. A statement can never revoke or add
   a backup key, so a stolen primary key can't be used to undo the backup.

Once accepted, a statement is permanent. Nothing un-revokes a key. A revoked
key's signatures are ignored, except on a manifest listed in `keepModules`.
An added key is trusted as a primary key.

The dates in a manifest are written by whoever signs it, so a thief can
backdate them. That's why the app never trusts "everything signed before the
theft". It trusts only the modules listed in `keepModules`.

### How statements reach the app

A statement is signed by the backup key, so the app can check it whatever
route it took, including untrusted ones such as a mirror website or a
stranger's thumb drive. It is small, so it should go everywhere:

1. **With new modules.** A module signed by a new primary key is published
   with the statements that introduce that key, in a `keys` folder beside
   it. The app can't trust the new key without them, so anyone who receives
   any new module also receives the revocation.
2. **The modules folder.** The app reads statements from the `keys` folder in
   its modules folder whenever it scans for modules, so copying a modules
   folder copies its statements too.
3. **Copied onward.** The app keeps every statement it accepts in its own
   settings, and copies it into the modules folder's `keys` folder if that
   folder can be written to. Anyone who later copies that folder gets it.
4. **Built into releases.** Each Bible Nav release includes every statement
   known when it was built.
5. **Downloads.** The module catalog and its mirrors list current
   statements, and the app reads them whenever it fetches the catalog. The
   app goes online only when the reader asks it to, never in the background:
   in some places, being seen to use Bible Nav is itself a risk. The
   thumb-drive edition never goes online.
6. **By hand.** Copies on thumb drives include the `keys` folder, and the
   `README.txt` beside the modules says to keep it with them.

### Limits

- A thief with a primary key can't forge, change, or cancel a statement, but
  can withhold it: hand out copies of the app or modules without it. A copy
  that never meets the statement keeps trusting the stolen key. Route 1
  limits this, because no new module from the maintainer works without the
  statement.
- Pinned editions cover the rest: a copy of Bible Nav that knows an
  edition's text root refuses a module claiming that edition with a
  different root, whatever key signed it. A stolen key can't replace a
  locked text, even in a copy that never sees the revocation.
- If a backup key itself is ever exposed, no statement can fix that. Only a
  new release of Bible Nav with new built-in keys can, and older copies keep
  relying on the pinned editions and on people checking copies outside the
  app.

## How Bible Nav checks a module

Before SQLite opens the file:

1. Read the manifest and its signatures. At least one signature must be
   valid, from a key the app trusts for modules: a built-in primary key that
   hasn't been revoked, or one added by an accepted key statement. A
   revoked key's signature counts only if this manifest is listed in a
   statement's `keepModules`. (See "Keys and revocation".)
2. Check the manifest: its `type` and `manifestVersion` are known, and its
   `formatVersion` is one the app reads.
3. Check that the module file's size and SHA-256 match the manifest.

Then:

4. Open the module read-only, and check that its `module` table's id,
   version, and format version match the manifest.
5. If the app knows the edition named by `text.edition`, check that
   `text.textRoot` is the root the app has for it. This protects a published
   edition even against a stolen key.

A module that fails any check isn't loaded, and the reader is told why.

## Checking a copy without Bible Nav

The file hash needs only standard tools:

```
sha256sum eng_kjv-1.0.0.db
```

and compare it with `file.sha256` in the manifest.

The signature can be checked with OpenSSL 3 (the same commands check a key
statement and its `.sig` file) and the maintainer's public key
(`public-key.pem`), taking the signature from the `.sig` line:

```
cut -d' ' -f3 eng_kjv-1.0.0.manifest.sig | head -n1 | base64 -d > signature.bin
openssl pkeyutl -verify -pubin -inkey public-key.pem -rawin \
  -in eng_kjv-1.0.0.manifest.json -sigfile signature.bin
```

The text root and content root can be recomputed from the module with
`tools/text-roots.py`, a short program that needs only Python 3:

```
python3 tools/text-roots.py eng_kjv-1.1.0.db
```

It follows this document and shares no code with the generator, so a mistake
in the generator can't hide itself. Computing the text root from the source
text itself, without the module, is still to be written.

## Module format changes (format version 2)

- Remove the `checksum` columns (xxHash32) from `module`, `testaments`,
  `books`, `chapters`, and `verses`, and the `signature` column from
  `module`. The text tree and the manifest replace them, and a signature
  can't be stored inside the file it signs.
- Readers reject format 1 modules in release builds.

## Not decided yet

- A signed list of every verse's hash, kept with the module, so a damaged
  copy can be checked verse by verse even when no good copy is at hand.
- What Bible Nav does with a damaged copy of a trusted module: refuse it, or
  show it with the damaged verses marked.
- How a defective signed module is withdrawn, such as a list of minimum
  versions signed with the primary key. That's not a key statement, so it
  doesn't need the backup key.
- Test vectors: worked examples of leaves, nodes, and roots, to be added with
  the reference implementation.
