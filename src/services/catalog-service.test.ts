import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { after, describe, test } from 'node:test';
import {
  CatalogEntry,
  RELEASE_BASE,
  entryIdentity,
  gzipModule,
  readCatalog,
  sha256,
  statementsIn,
  withEntry,
} from './catalog-service';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));

function entry(id: string, version: string): CatalogEntry {
  return {
    manifest: JSON.stringify({ module: { id, version } }),
    signatures: '',
    download: { name: `${id}-${version}.db.gz`, size: 1, sha256: '', urls: [] },
    about: { description: '', language: '', license: '' },
  };
}

describe('the catalog', () => {
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('compressing the same module twice gives the same bytes', () => {
    const db = path.join(dir, 'tst-1.0.0.db');
    fs.writeFileSync(db, Buffer.alloc(100_000, 'In the beginning '));
    const one = gzipModule(db, path.join(dir, 'one.gz'));
    const two = gzipModule(db, path.join(dir, 'two.gz'));
    assert.equal(sha256(one), sha256(two));
    assert.deepEqual(zlib.gunzipSync(one), fs.readFileSync(db));
  });

  test('a new version is added, the same version replaced, in order', () => {
    let catalog = readCatalog(path.join(dir, 'missing.json'));
    catalog = withEntry(catalog, entry('eng_lsv', '1.0.0'));
    catalog = withEntry(catalog, entry('eng_kjv', '1.10.0'));
    catalog = withEntry(catalog, entry('eng_kjv', '1.9.0'));
    const replaced = { ...entry('eng_kjv', '1.9.0'), signatures: 'new' };
    catalog = withEntry(catalog, replaced);
    assert.deepEqual(
      catalog.modules.map((e) => Object.values(entryIdentity(e)).join('-')),
      ['eng_kjv-1.9.0', 'eng_kjv-1.10.0', 'eng_lsv-1.0.0']
    );
    assert.equal(catalog.modules[0].signatures, 'new');
  });

  test('only signed key statements are listed, by sequence', () => {
    const keys = path.join(dir, 'keys');
    fs.mkdirSync(keys);
    for (const [n, sig] of [
      [10, 'ed25519 a b\n'],
      [2, 'ed25519 c d\n'],
      [3, ''],
    ] as const) {
      fs.writeFileSync(
        path.join(keys, `bible-nav-keys-${n}.json`),
        `{"n":${n}}`
      );
      fs.writeFileSync(path.join(keys, `bible-nav-keys-${n}.sig`), sig);
    }
    assert.deepEqual(
      statementsIn(keys).map((s) => s.statement),
      ['{"n":2}', '{"n":10}']
    );
  });
});

/**
 * The hosts modules may be downloaded from. On 2026-11-16 the release
 * address and every download in catalog.json were found pointing at a
 * third-party GitHub proxy: the full addresses had been rewritten on their
 * way into the code. These tests catch that; keep this list short and
 * readable, so a strange host stands out in review. Add biblenav.org when it
 * serves modules.
 */
const trustedHosts = ['github.com'];

describe('download addresses', () => {
  test('the release address is on a trusted host', () => {
    assert.ok(trustedHosts.includes(new URL(RELEASE_BASE).host), RELEASE_BASE);
  });

  test('every download in catalog.json is on a trusted host', () => {
    const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8')) as {
      modules: { download: { urls: string[] } }[];
    };
    const urls = catalog.modules.flatMap((module) => module.download.urls);
    assert.ok(urls.length > 0);
    for (const url of urls) {
      assert.ok(trustedHosts.includes(new URL(url).host), url);
    }
  });
});
