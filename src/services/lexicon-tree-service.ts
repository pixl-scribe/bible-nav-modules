import Database from 'better-sqlite3';
import { encodeItems, Item, sha256, str, u32 } from './text-tree-service';

/**
 * The lexicon tree from docs/lexicon-format.md: a keys root (which entries
 * exist and how they are found) and a content root (everything they say).
 * Follow the spec, not this code: the spec is what other checkers are
 * written from. Items are encoded as in docs/integrity-spec.md.
 */

export const LEXICON_TREE_VERSION = 1;

export interface LexiconRoots {
  keysRoot: string;
  contentRoot: string;
}

/**
 * Turns a stored body into items: every key but `style` and `children` is
 * an attribute, and each must be a string. Anything else fails, so content
 * can't be left out of the hash by mistake.
 */
export function itemsFromBody(stored: unknown[]): Item[] {
  return stored.map((value): Item => {
    if (typeof value === 'string') return value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`unexpected body item: ${JSON.stringify(value)}`);
    }
    const record = value as Record<string, unknown>;
    if (typeof record.style !== 'string' || !Array.isArray(record.children)) {
      throw new Error(
        `a body element needs style and children: ${JSON.stringify(value)}`
      );
    }
    const attributes: [string, string][] = [];
    for (const [name, attr] of Object.entries(record)) {
      if (name === 'style' || name === 'children') continue;
      if (typeof attr !== 'string') {
        throw new Error(
          `attribute ${name} isn't text: ${JSON.stringify(value)}`
        );
      }
      attributes.push([name, attr]);
    }
    return {
      style: record.style,
      attributes,
      children: itemsFromBody(record.children as unknown[]),
    };
  });
}

export interface EntryRow {
  key: string;
  headword: string;
  headwordLang: string;
  homograph: string;
  translit: string;
  pronunciation: string;
  allCited: number;
  body: string;
}

export function entryLeaf(row: EntryRow): Buffer {
  return sha256(
    Buffer.concat([
      Buffer.from([0x00]),
      str('entry'),
      str(row.key),
      str(row.headword),
      str(row.headwordLang),
      str(row.homograph),
      str(row.translit),
      str(row.pronunciation),
      u32(row.allCited),
      encodeItems(itemsFromBody(JSON.parse(row.body) as unknown[])),
    ])
  );
}

export function lookupLeaf(
  kind: string,
  value: string,
  entryKey: string
): Buffer {
  return sha256(
    Buffer.concat([
      Buffer.from([0x00]),
      str('lookup'),
      str(kind),
      str(value),
      str(entryKey),
    ])
  );
}

function lexiconRoot(
  view: 'keys' | 'content',
  entries: Buffer[],
  lookups: Buffer[]
): Buffer {
  return sha256(
    Buffer.concat([
      Buffer.from([0x01]),
      str('bible-nav lexicon tree'),
      u32(LEXICON_TREE_VERSION),
      str(view),
      u32(entries.length),
      ...entries,
      u32(lookups.length),
      ...lookups,
    ])
  );
}

function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Both roots, computed from a lexicon module. */
export function lexiconRoots(dbFile: string): LexiconRoots {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const entries = db
      .prepare(
        `SELECT key, headword, headwordLang, homograph, translit,
           pronunciation, allCited, body FROM entries ORDER BY id`
      )
      .all() as EntryRow[];
    const lookups = (
      db
        .prepare(
          `SELECT l.kind, l.value, e.key FROM lookups l
           JOIN entries e ON e.id = l.entryId`
        )
        .all() as { kind: string; value: string; key: string }[]
    ).sort(
      (a, b) =>
        compareUtf8(a.kind, b.kind) ||
        compareUtf8(a.value, b.value) ||
        compareUtf8(a.key, b.key)
    );
    const lookupLeaves = lookups.map((l) => lookupLeaf(l.kind, l.value, l.key));
    return {
      keysRoot: lexiconRoot(
        'keys',
        entries.map((row) => str(row.key)),
        lookupLeaves
      ).toString('hex'),
      contentRoot: lexiconRoot(
        'content',
        entries.map(entryLeaf),
        lookupLeaves
      ).toString('hex'),
    };
  } finally {
    db.close();
  }
}
