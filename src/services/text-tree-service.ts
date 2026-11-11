import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

/**
 * The text tree from docs/integrity-spec.md: SHA-256 hashes of every verse
 * and canonical heading, combined chapter by chapter, book by book, and
 * testament by testament into one root. Follow the spec, not this code: the
 * spec is what other checkers are written from.
 */

/** Which root: the canonical text alone, or everything as stored. */
export type View = 'text' | 'content';

/** This document version of the spec, hashed into every root. */
export const TREE_VERSION = 1;

/** An inline item: text, or an element with a style, attributes, and children. */
export type Item = string | Element;

export interface Element {
  style: string;
  /** Name and value pairs. */
  attributes: [string, string][];
  children: Item[];
}

/** Content as stored in verses.children and headings.children. */
type StoredChild =
  | string
  | { style: string; strong?: string; txt?: string; children?: StoredChild[] };

/** Headings that are part of the canonical text, such as Psalm titles. */
const CANONICAL_HEADING_STYLES = new Set(['d']);

/** Elements whose content is kept in the text view, without the element. */
const UNWRAPPED_IN_TEXT_VIEW = new Set(['w', 'wj']);

/**
 * Turns stored content into items. Unknown keys fail, so that content added to
 * the module format later can't be left out of the hash by mistake.
 */
export function itemsFromStored(children: StoredChild[]): Item[] {
  return children.map((child): Item => {
    if (typeof child === 'string') return child;
    const keys = Object.keys(child).sort().join(',');
    if (child.style === 'w') {
      if (keys !== 'strong,style,txt') {
        throw new Error(`unexpected word content: ${JSON.stringify(child)}`);
      }
      return {
        style: 'w',
        attributes: [['strong', child.strong ?? '']],
        children: [child.txt ?? ''],
      };
    }
    if (keys !== 'children,style') {
      throw new Error(`unexpected inline content: ${JSON.stringify(child)}`);
    }
    return {
      style: child.style,
      attributes: [],
      children: itemsFromStored(child.children ?? []),
    };
  });
}

/**
 * The text view of inline content: footnotes removed, words of Jesus and
 * words with Strong's numbers replaced by their words, attributes removed,
 * and adjacent text joined, with empty text dropped.
 */
export function textView(items: Item[]): Item[] {
  const changed: Item[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      changed.push(item);
    } else if (item.style === 'f') {
      continue;
    } else if (UNWRAPPED_IN_TEXT_VIEW.has(item.style)) {
      changed.push(...textView(item.children));
    } else {
      changed.push({
        style: item.style,
        attributes: [],
        children: textView(item.children),
      });
    }
  }
  const joined: Item[] = [];
  for (const item of changed) {
    const last = joined[joined.length - 1];
    if (typeof item === 'string' && typeof last === 'string') {
      joined[joined.length - 1] = last + item;
    } else {
      joined.push(item);
    }
  }
  return joined.filter((item) => item !== '');
}

// Encoding (spec: "Notation" and "Inline content").

export function u32(n: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(n);
  return bytes;
}

/** A string's UTF-8 bytes, exactly as given, after its byte length. */
export function str(s: string): Buffer {
  const bytes = Buffer.from(s, 'utf8');
  return Buffer.concat([u32(bytes.length), bytes]);
}

function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function encodeItem(item: Item): Buffer {
  if (typeof item === 'string') {
    return Buffer.concat([Buffer.from([0x74]), str(item)]);
  }
  const attributes = [...item.attributes].sort(([a], [b]) => compareUtf8(a, b));
  return Buffer.concat([
    Buffer.from([0x65]),
    str(item.style),
    u32(attributes.length),
    ...attributes.flatMap(([name, value]) => [str(name), str(value)]),
    u32(item.children.length),
    ...item.children.map(encodeItem),
  ]);
}

export function encodeItems(items: Item[]): Buffer {
  return Buffer.concat([u32(items.length), ...items.map(encodeItem)]);
}

export function sha256(bytes: Buffer): Buffer {
  return createHash('sha256').update(bytes).digest();
}

// Leaves and nodes (spec: "Leaves" and "Nodes").

export function verseLeaf(verseNumber: string, items: Item[]): Buffer {
  return sha256(
    Buffer.concat([
      Buffer.from([0x00]),
      str('verse'),
      str(verseNumber),
      encodeItems(items),
    ])
  );
}

export function headingLeaf(style: string, items: Item[]): Buffer {
  return sha256(
    Buffer.concat([
      Buffer.from([0x00]),
      str('heading'),
      str(style),
      encodeItems(items),
    ])
  );
}

/** A chapter, book, or testament node: its type, its label, its children. */
export function node(type: string, label: string, children: Buffer[]): Buffer {
  return sha256(
    Buffer.concat([
      Buffer.from([0x01]),
      str(type),
      str(label),
      u32(children.length),
      ...children,
    ])
  );
}

export function root(view: View, testaments: Buffer[]): Buffer {
  return sha256(
    Buffer.concat([
      Buffer.from([0x01]),
      str('bible-nav text tree'),
      u32(TREE_VERSION),
      str(view),
      u32(testaments.length),
      ...testaments,
    ])
  );
}

// Reading the tree from a module (spec: "Reading the tree from a module").

interface VerseRow {
  id: number;
  bookId: number;
  chapter: number;
  nbr: number;
  children: string;
}

interface HeadingRow {
  id: number;
  bookId: number;
  chapter: number;
  afterVerseId: number;
  style: string;
  children: string;
}

/** A chapter's verses and headings in reading order. */
type ChapterItem =
  | { kind: 'verse'; position: number; order: number; row: VerseRow }
  | { kind: 'heading'; position: number; order: number; row: HeadingRow };

export interface TextRoots {
  textRoot: string;
  contentRoot: string;
}

/** Both roots of a module file, as hexadecimal. */
export function moduleRoots(dbFile: string): TextRoots {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    return {
      textRoot: treeRoot(db, 'text').toString('hex'),
      contentRoot: treeRoot(db, 'content').toString('hex'),
    };
  } finally {
    db.close();
  }
}

const TESTAMENT_ORDER = ['OT', 'NT'];

function treeRoot(db: Database.Database, view: View): Buffer {
  const present = new Set(
    (db.prepare('SELECT code FROM testaments').all() as { code: string }[]).map(
      (row) => row.code
    )
  );
  for (const code of present) {
    if (!TESTAMENT_ORDER.includes(code)) {
      throw new Error(`unknown testament ${code}`);
    }
  }

  const items = chapterItems(db);
  const used = new Set<string>();
  const books = db.prepare(
    'SELECT id, code FROM books WHERE testamentCode = ? ORDER BY id'
  );
  const chapters = db.prepare(
    'SELECT nbr FROM chapters WHERE bookId = ? ORDER BY nbr'
  );

  const testaments = TESTAMENT_ORDER.filter((code) => present.has(code)).map(
    (testament) => {
      const bookHashes = (
        books.all(testament) as { id: number; code: string }[]
      ).map((book) => {
        const chapterHashes = (chapters.all(book.id) as { nbr: number }[]).map(
          ({ nbr }) => {
            used.add(`${book.id}:${nbr}`);
            const leaves = (items.get(`${book.id}:${nbr}`) ?? []).flatMap(
              (item) => leaf(item, view)
            );
            return node('chapter', String(nbr), leaves);
          }
        );
        return node('book', book.code, chapterHashes);
      });
      return node('testament', testament, bookHashes);
    }
  );
  // Every verse and heading must be in the tree: one whose book or chapter
  // the tree didn't reach would otherwise go unhashed.
  const missed = [...items.keys()].filter((key) => !used.has(key));
  if (missed.length > 0) {
    throw new Error(
      `verses or headings outside the module's books and chapters: ${missed.join(', ')}`
    );
  }
  return root(view, testaments);
}

/** A verse's or heading's leaf, or none for a heading the view leaves out. */
function leaf(item: ChapterItem, view: View): Buffer[] {
  const stored = itemsFromStored(JSON.parse(item.row.children));
  const items = view === 'text' ? textView(stored) : stored;
  if (item.kind === 'verse') {
    return [verseLeaf(String(item.row.nbr), items)];
  }
  if (view === 'text' && !CANONICAL_HEADING_STYLES.has(item.row.style)) {
    return [];
  }
  return [headingLeaf(item.row.style, items)];
}

/**
 * Every chapter's verses and headings, keyed by "bookId:chapter". A verse's
 * position is its id; a heading's is its afterVerseId plus one half, so it
 * comes right after the verse it follows, with headings at the same position
 * kept in id order.
 */
function chapterItems(db: Database.Database): Map<string, ChapterItem[]> {
  const byChapter = new Map<string, ChapterItem[]>();
  const add = (item: ChapterItem) => {
    const key = `${item.row.bookId}:${item.row.chapter}`;
    byChapter.set(key, [...(byChapter.get(key) ?? []), item]);
  };
  for (const row of db
    .prepare('SELECT id, bookId, chapter, nbr, children FROM verses')
    .all() as VerseRow[]) {
    add({ kind: 'verse', position: row.id, order: 0, row });
  }
  for (const row of db
    .prepare(
      'SELECT id, bookId, chapter, afterVerseId, style, children FROM headings'
    )
    .all() as HeadingRow[]) {
    add({
      kind: 'heading',
      position: row.afterVerseId + 0.5,
      order: row.id,
      row,
    });
  }
  for (const items of byChapter.values()) {
    items.sort((a, b) => a.position - b.position || a.order - b.order);
  }
  return byChapter;
}
