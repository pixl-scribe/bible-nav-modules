import fs from 'node:fs';
import path from 'node:path';
import { ModuleConfig } from './model/module-config';
import { Lexicon } from './model/lexicon';
import { readTeiLexiconFile } from './services/tei-lexicon-reader';
import {
  exportLexicon,
  LEXICON_FORMAT_VERSION,
} from './services/lexicon-exporter-service';
import { verifyLexicon } from './services/lexicon-verifier-service';
import {
  LEXICON_TREE_VERSION,
  lexiconRoots,
} from './services/lexicon-tree-service';
import { checkVersionRule } from './services/version-rule';
import {
  buildLexiconManifest,
  fileSha256,
  LexiconManifest,
  MANIFEST_TYPE,
  moduleFiles,
} from './services/manifest-service';

/**
 * Lexicon modules (docs/lexicon-format.md): generated from the lexicon's
 * TEI file, assets/<id>/<id>.tei.xml, which tools/import-*.py write from
 * the untouched source.
 */

export function teiFile(moduleId: string): string {
  return path.resolve('assets', moduleId, `${moduleId}.tei.xml`);
}

/**
 * What the lexicon can be found by, for the manifest: "strong:H" for
 * Strong's Hebrew numbers, "strong:G", or "lemma:<language>".
 */
export function lookupKinds(lexicon: Lexicon): string[] {
  const languages = new Map(
    lexicon.entries.map((entry) => [entry.key, entry.headwordLang])
  );
  const kinds = new Set(
    lexicon.lookups.map((lookup) =>
      lookup.kind === 'strong'
        ? `strong:${lookup.value[0]}`
        : `lemma:${languages.get(lookup.entryKey)}`
    )
  );
  return [...kinds].sort();
}

/** Writes and verifies the module, and returns what its manifest needs. */
export function writeLexicon(
  moduleId: string,
  config: ModuleConfig,
  dbFile: string
) {
  const tei = teiFile(moduleId);
  console.log(`Generating lexicon ${moduleId} from ${path.basename(tei)}...`);
  console.log(`Name:    ${config.name}`);
  console.log(`Version: ${config.version}`);
  const lexicon = readTeiLexiconFile(tei);
  exportLexicon(dbFile, config, lexicon);
  const summary = verifyLexicon(dbFile, tei);
  console.log(
    `Verified ${summary.entries} entries and ${summary.lookups} lookups against the TEI file.`
  );
  const roots = lexiconRoots(dbFile);
  checkVersionRule(
    path.resolve('exports'),
    moduleId,
    config.version,
    roots.keysRoot,
    'keys'
  );
  console.log(`Keys root:    ${roots.keysRoot}`);
  console.log(`Content root: ${roots.contentRoot}`);
  return {
    formatVersion: LEXICON_FORMAT_VERSION,
    treeVersion: LEXICON_TREE_VERSION,
    lookups: lookupKinds(lexicon),
    count: summary.entries,
    ...roots,
  };
}

export function buildManifestFor(
  moduleId: string,
  config: ModuleConfig,
  dbFile: string,
  fileName: string,
  details: ReturnType<typeof writeLexicon>
): LexiconManifest {
  return buildLexiconManifest(
    moduleId,
    config,
    dbFile,
    fileName,
    details,
    new Date()
  );
}

/**
 * Checks an existing lexicon export against its TEI file, and its manifest
 * against the module: identity, file hash, and both roots.
 */
export function checkLexiconExport(
  moduleId: string,
  version: string
): LexiconManifest {
  const files = moduleFiles(path.resolve('exports'), moduleId, version);
  const summary = verifyLexicon(files.db, teiFile(moduleId));
  console.log(
    `Verified ${summary.entries} entries and ${summary.lookups} lookups against the TEI file.`
  );
  const manifest = JSON.parse(
    fs.readFileSync(files.manifest, 'utf8')
  ) as LexiconManifest;
  const roots = lexiconRoots(files.db);
  const problems: string[] = [];
  const expect = (what: string, actual: unknown, wanted: unknown) => {
    if (actual !== wanted) {
      problems.push(`${what} is ${String(actual)}, expected ${String(wanted)}`);
    }
  };
  expect('type', manifest.type, MANIFEST_TYPE);
  expect('manifestVersion', manifest.manifestVersion, 1);
  expect('module.id', manifest.module?.id, moduleId);
  expect('module.version', manifest.module?.version, version);
  expect('module.moduleType', manifest.module?.moduleType, 'lexicon');
  expect(
    'module.formatVersion',
    manifest.module?.formatVersion,
    LEXICON_FORMAT_VERSION
  );
  expect('file.name', manifest.file?.name, path.basename(files.db));
  expect('file.size', manifest.file?.size, fs.statSync(files.db).size);
  expect('file.sha256', manifest.file?.sha256, fileSha256(files.db));
  expect(
    'entries.treeVersion',
    manifest.entries?.treeVersion,
    LEXICON_TREE_VERSION
  );
  expect('entries.count', manifest.entries?.count, summary.entries);
  expect('entries.keysRoot', manifest.entries?.keysRoot, roots.keysRoot);
  expect(
    'entries.contentRoot',
    manifest.entries?.contentRoot,
    roots.contentRoot
  );
  if (problems.length > 0) {
    throw new Error(
      `The manifest doesn't match the module:\n  ${problems.join('\n  ')}`
    );
  }
  console.log(`The manifest matches the module (keys root ${roots.keysRoot}).`);
  return manifest;
}
