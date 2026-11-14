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
# Key statements, which revoke and replace a primary key (see keys/README.md)
npm start -- make-statement --sequence 1 --revoke <key id>:<reason> --add <public.pem>
npm start -- sign-statement --sequence 1
npm start -- check-statement --sequence 1
npm test
npm run lint
```

# Importing a text from eBible.org

eBible.org publishes USFM and USFX, each archive with a PGP-signed list of
its files' SHA-256 hashes. `tools/import-ebible.py` fetches a text's
archives into `assets/<module-id>/ebible/`, checks eBible's signature and the
hashes, and converts the USFM to USX with
[usfmtc](https://gh.ali360.cloudns.ch/usfm-bible/usfmtc), the USFM technical
committee's reference converter. It needs Python 3 and GnuPG:

```
python3 -m venv tools/venv
tools/venv/bin/pip install -r tools/requirements.txt
tools/venv/bin/python tools/import-ebible.py fetch englsv englsv
tools/venv/bin/python tools/import-ebible.py convert englsv
```

Then write `assets/<module-id>/config.yaml` and generate as usual. The
generator still refuses any USX content it doesn't know, so a new text shows
exactly which markers need supporting.

# Checking a module

Each module comes as three files, such as `eng_kjv-1.1.0.db`,
`eng_kjv-1.1.0.manifest.json`, and `eng_kjv-1.1.0.manifest.sig`.
[`docs/integrity-spec.md`](docs/integrity-spec.md) explains how they are
hashed and signed, and how to check a copy with standard tools.
`tools/text-roots.py` recomputes a module's text root with Python alone.

Each text's source is recorded in `assets/<module-id>/PROVENANCE.md`. For the
King James Version, `tools/compare-ebible.py` compares a module verse by verse
with eBible.org's signed release, kept in `assets/eng_kjv/ebible/`.
