# bible-nav-modules

This repository contains all source files used to create
Bible Nav Modules.

Source file are mostly in [USX](https://ubsicap.github.io/usx/index.html) format.
The below described CLI tool is used to generate SQLite DB files to be
imported into Bible Nav.

# Dev Setup
```
npm i
# Generates the checksum file for eng_kjv and saves it in the assets directory
npm start -- checksum --id eng_kjv
# Generates the module for eng_kjv, checks it against the USX files,
# and saves it in the exports directory only if it matches
npm start -- generate --id eng_kjv
# Checks an existing module against the USX files
npm start -- verify --id eng_kjv
npm test
npm run lint
```
