# The module catalog

Version 1, **draft**.

Bible Nav lists the modules it can download from a catalog: one JSON file,
`catalog.json`. Bible Nav reads it only when the reader asks it to look for
modules, never in the background.

The catalog needs no signature of its own. Each entry carries the module's
signed manifest and its signatures, so Bible Nav checks every entry exactly
as it checks a module in the modules folder (see
[`integrity-spec.md`](integrity-spec.md)), before offering it, and again,
with the file itself, after downloading it. A catalog from any website or
mirror is therefore as trustworthy as the signatures in it; the worst a bad
copy can do is leave modules out.

## Where it is

The catalog is published at these addresses, tried in order:

1. `https://github.com/pixl-scribe/bible-nav-modules/raw/master/catalog.json`
2. `https://raw.githubusercontent.com/pixl-scribe/bible-nav-modules/master/catalog.json`

Some networks can't look up `raw.githubusercontent.com`, so GitHub's own
address comes first.

More addresses, such as one on `biblenav.org`, will be added. Any copy of the
file works, from anywhere, including a thumb drive.

## Format

```json
{
  "type": "bible-nav module catalog",
  "catalogVersion": 1,
  "modules": [
    {
      "manifest": "{\n  \"type\": \"bible-nav module manifest\", ...}\n",
      "signatures": "ed25519 447d4fa16f501391 ...\n",
      "download": {
        "name": "eng_kjv-1.1.0.db.gz",
        "size": 9071234,
        "sha256": "...",
        "urls": [
          "https://github.com/pixl-scribe/bible-nav-modules/releases/download/eng_kjv-1.1.0/eng_kjv-1.1.0.db.gz"
        ]
      },
      "about": {
        "description": "...",
        "language": "English",
        "license": "Public Domain"
      }
    }
  ],
  "statements": [
    { "statement": "{...}\n", "signatures": "ed25519 ...\n" }
  ]
}
```

- `manifest` is the module's `.manifest.json`, byte for byte, as a string;
  `signatures` is its `.manifest.sig`. Bible Nav offers an entry only if the
  manifest is validly signed by a key it trusts for modules, is a kind and
  format it reads, and, for a pinned module, has a pinned major version and
  text root.
- `download` is the module file compressed with gzip: its name, size, and
  SHA-256, and one or more addresses for it, tried in order. The size and
  hash catch a broken download early. What makes the module trusted is the
  signed manifest: after unpacking, Bible Nav checks the file's size,
  SHA-256, and roots against it, as for any module.
- `about` holds what to show before downloading. It isn't signed, so it's
  for display only. Once a module is installed, Bible Nav shows the
  description and license stored in the module itself, which the signed
  file hash covers.
- `statements` holds key statements, each the statement's JSON and its
  `.sig` file as strings. Bible Nav checks and applies them as it does
  statements in the modules folder, before checking any entry.

Entries Bible Nav can't use (unknown kinds, failed signatures, formats it
doesn't read) are skipped, so older copies of Bible Nav keep working with
newer catalogs.

## Publishing a module

From `bible-nav-modules`:

```
npm start -- package --id eng_lsv
```

checks the module and its signatures, writes `dist/<id>-<version>.db.gz`
with the module's manifest and signatures beside it, and adds or replaces
the module's entry in `catalog.json`. Then the files in `dist/` are uploaded
as a GitHub Release tagged `<id>-<version>`, and `catalog.json` is
committed.
