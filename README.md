# bible-nav-modules

This repository contains all source files used to create
Bible Nav Modules.

Source file are mostly in [USX](https://ubsicap.github.io/usx/index.html) format.
The below described CLI tool is used to generate SQLite DB files to be
imported into Bible Nav.

# Dev Setup
```
npm i
# Generates the module for eng_kjv and saves it in the exports directory
npm start -- generate --id eng_kjv
npm run lint
```
