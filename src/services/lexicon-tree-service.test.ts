import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import Database from 'better-sqlite3';
import { readTeiLexicon } from './tei-lexicon-reader';
import { entry, tei } from './tei-lexicon-reader.test';
import { exportLexicon } from './lexicon-exporter-service';
import { lexiconRoots } from './lexicon-tree-service';
import { verifyLexicon } from './lexicon-verifier-service';
import { ModuleConfig } from '../model/module-config';

const config: ModuleConfig = {
  name: 'Test Lexicon',
  abbreviation: 'TL',
  description: 'A test.',
  moduleType: 'lexicon',
  language: 'English',
  languageCode: 'eng',
  license: 'Public domain.',
  version: '1.0.0',
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-tree-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
let count = 0;

/** Writes a module and its TEI file from these TEI entries. */
function build(entries: string): { db: string; teiFile: string } {
  count += 1;
  const teiFile = path.join(dir, `test-${count}.tei.xml`);
  const db = path.join(dir, `test-${count}.db`);
  fs.writeFileSync(teiFile, tei(entries));
  exportLexicon(db, config, readTeiLexicon(fs.readFileSync(teiFile, 'utf8')));
  return { db, teiFile };
}

const base = entry('H1') + '\n' + entry('H2');

describe('lexicon tree', () => {
  test('the same lexicon gives the same file and roots', () => {
    const a = build(base);
    const b = build(base);
    assert.deepEqual(fs.readFileSync(a.db), fs.readFileSync(b.db));
    assert.deepEqual(lexiconRoots(a.db), lexiconRoots(b.db));
  });

  test('changed wording changes only the content root', () => {
    const before = lexiconRoots(build(base).db);
    const after = lexiconRoots(build(base.replace('rank,', 'rank;')).db);
    assert.equal(after.keysRoot, before.keysRoot);
    assert.notEqual(after.contentRoot, before.contentRoot);
  });

  test('a new entry changes the keys root', () => {
    const before = lexiconRoots(build(base).db);
    const after = lexiconRoots(build(base + '\n' + entry('H3')).db);
    assert.notEqual(after.keysRoot, before.keysRoot);
  });

  test('the module matches its TEI file, and a changed module does not', () => {
    const { db, teiFile } = build(base);
    assert.deepEqual(verifyLexicon(db, teiFile), { entries: 2, lookups: 2 });
    const handle = new Database(db);
    handle
      .prepare(
        `UPDATE entries SET body = replace(body, 'rank', 'rnak') WHERE key = 'H2'`
      )
      .run();
    handle.prepare(`UPDATE entries SET headword = 'X' WHERE key = 'H1'`).run();
    handle.close();
    assert.throws(
      () => verifyLexicon(db, teiFile),
      /H1 headword[\s\S]*H2 parts/
    );
  });

  test('the independent Python checker gives the same roots', (t) => {
    try {
      execFileSync('python3', ['--version']);
    } catch {
      t.skip('python3 is not installed');
      return;
    }
    const { db } = build(base);
    const output = execFileSync('python3', [
      '-I',
      path.resolve('tools', 'text-roots.py'),
      db,
    ]).toString();
    const found = JSON.parse(output) as { keys: string; content: string };
    assert.deepEqual(
      { keysRoot: found.keys, contentRoot: found.content },
      lexiconRoots(db)
    );
  });
});
