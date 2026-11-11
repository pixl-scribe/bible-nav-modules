import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ModuleConfig } from '../model/module-config';
import { MODULE_FORMAT_VERSION } from './db-exporter-service';
import { TextRoots, TREE_VERSION } from './text-tree-service';

/**
 * The module manifest from docs/integrity-spec.md. Its exact bytes are what
 * gets signed, so it is written once and never reformatted afterwards.
 */
export interface Manifest {
  type: 'bible-nav module manifest';
  manifestVersion: 1;
  module: {
    id: string;
    version: string;
    formatVersion: number;
    name: string;
    languageCode: string;
  };
  file: { name: string; size: number; sha256: string };
  text: {
    treeVersion: number;
    edition: string;
    source: string;
    textRoot: string;
    contentRoot: string;
  };
  createdAt: string;
}

export const MANIFEST_TYPE = 'bible-nav module manifest';

export function fileSha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function buildManifest(
  moduleId: string,
  config: ModuleConfig,
  dbFile: string,
  fileName: string,
  roots: TextRoots,
  createdAt: Date
): Manifest {
  if (!config.edition || !config.source) {
    throw new Error(
      `config.yaml for ${moduleId} needs an edition and a source for the manifest`
    );
  }
  return {
    // `type` comes first, so the signed bytes say what they are.
    type: MANIFEST_TYPE,
    manifestVersion: 1,
    module: {
      id: moduleId,
      version: config.version,
      formatVersion: MODULE_FORMAT_VERSION,
      name: config.name,
      languageCode: config.languageCode,
    },
    file: {
      name: fileName,
      size: fs.statSync(dbFile).size,
      sha256: fileSha256(dbFile),
    },
    text: {
      treeVersion: TREE_VERSION,
      edition: config.edition,
      source: config.source,
      ...roots,
    },
    createdAt: createdAt.toISOString().slice(0, 10),
  };
}

/** The manifest's bytes: two-space JSON, UTF-8, with a final newline. */
export function manifestBytes(manifest: Manifest): Buffer {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** The names of a module's three files, such as eng_kjv-1.0.0.db. */
export function moduleFiles(dir: string, moduleId: string, version: string) {
  const base = path.join(dir, `${moduleId}-${version}`);
  return {
    db: `${base}.db`,
    manifest: `${base}.manifest.json`,
    signatures: `${base}.manifest.sig`,
  };
}
