# bible-nav-modules

This repository contains all source files used to create
Bible Nav Modules.

Source file are mostly in [USX](https://ubsicap.github.io/usx/index.html) format.
The below described CLI tool is used to generate SQLite DB files to be
imported into Bible Nav.

# Dev Setup
```
npm i
# Generates the module for eng_kjv, checks it against the USX files, and
# saves it in the exports directory only if it matches, with its manifest
# and a development signature
npm start -- generate --id eng_kjv
# Checks an existing module against the USX files, and its manifest and
# signatures against the module
npm start -- verify --id eng_kjv
# Adds a signature with a private key read from standard input
npm start -- sign --id eng_kjv
npm test
npm run lint
```

# Checking a module

Each module comes as three files, such as `eng_kjv-1.1.0.db`,
`eng_kjv-1.1.0.manifest.json`, and `eng_kjv-1.1.0.manifest.sig`.
[`docs/integrity-spec.md`](docs/integrity-spec.md) explains how they are
hashed and signed, and how to check a copy with standard tools.
`tools/text-roots.py` recomputes a module's text root with Python alone.

Each text's source is recorded in `assets/<module-id>/PROVENANCE.md`. For the
King James Version, `tools/compare-ebible.py` compares a module verse by verse
with eBible.org's signed release, kept in `assets/eng_kjv/ebible/`.
