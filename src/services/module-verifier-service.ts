import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { MODULE_FORMAT_VERSION } from './db-exporter-service';
import {
  collapse,
  ParagraphLayout,
  ScannedBlock,
  scanUsx,
} from './usx-scanner';

/**
 * Checks a generated module against its USX source, word for word.
 *
 * This deliberately shares no code with UsxParserService: it reads the USX with
 * the tag scanner in usx-scanner.ts and the module through SQL. A bug in the
 * parser can then only pass if the same bug is written a second time there.
 */

const MAX_REPORTED = 20;
const squeeze = (text: string): string => text.replace(/\s+/g, '');

/** A child as stored in verses.children or headings.children. */
type StoredChild =
  | string
  | { style: string; txt?: string; strong?: string; children?: StoredChild[] };

function storedText(children: StoredChild[]): string {
  return children
    .map((child) => {
      if (typeof child === 'string') return child;
      if (child.style === 'f') return '';
      if (child.style === 'w') return child.txt ?? '';
      return storedText(child.children ?? []);
    })
    .join('');
}

function storedMarkup(children: StoredChild[]): string {
  return children
    .map((child) => {
      if (typeof child === 'string') return child;
      const name =
        child.style === 'w' ? `w:${child.strong}` : (child.style as string);
      const inner =
        child.style === 'w'
          ? (child.txt ?? '')
          : storedMarkup(child.children ?? []);
      return `{${name}}${inner}{/${child.style}}`;
    })
    .join('');
}

function storedNotes(children: StoredChild[]): string[] {
  return children.flatMap((child) =>
    typeof child !== 'string' && child.style === 'f'
      ? (child.children ?? []).map((part) =>
          storedText(typeof part === 'string' ? [part] : (part.children ?? []))
        )
      : []
  );
}

/**
 * Compares a stored verse or heading with its source, adding any differences
 * to errors.
 */
function compareBlock(
  label: string,
  source: ScannedBlock,
  raw: string,
  childrenJson: string,
  errors: string[]
): void {
  const children = JSON.parse(childrenJson) as StoredChild[];
  const expected = collapse(source.text);
  if (raw !== expected) {
    errors.push(`${label}: raw is "${raw}" but the USX has "${expected}"`);
  }
  if (storedText(children) !== expected) {
    errors.push(`${label}: children text differs from the USX`);
  }
  if (squeeze(storedMarkup(children)) !== squeeze(source.markup)) {
    errors.push(`${label}: tags or Strong's numbers differ from the USX`);
  }
  const notes = storedNotes(children);
  if (JSON.stringify(notes) !== JSON.stringify(source.notes)) {
    errors.push(
      `${label}: footnote is ${JSON.stringify(notes)} but the USX has ${JSON.stringify(source.notes)}`
    );
  }
}

export interface VerifySummary {
  verses: number;
  headings: number;
  paragraphs: number;
  books: number;
}

/**
 * Throws an error listing every difference between the module and the USX.
 */
export function verifyModule(dbFile: string, usxDir: string): VerifySummary {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  const errors: string[] = [];
  const summary: VerifySummary = {
    verses: 0,
    headings: 0,
    paragraphs: 0,
    books: 0,
  };

  try {
    const { formatVersion } = db
      .prepare('SELECT formatVersion FROM module')
      .get() as { formatVersion: number };
    if (formatVersion !== MODULE_FORMAT_VERSION) {
      errors.push(`module has format version ${formatVersion}`);
    }

    const books = db.prepare('SELECT * FROM books ORDER BY id').all() as Record<
      string,
      string | number | null
    >[];
    const verseRows = db.prepare(
      'SELECT sid, raw, children FROM verses WHERE bookId = ? ORDER BY id'
    );
    const headingRows = db.prepare(
      `SELECT h.style, h.raw, h.children, COALESCE(v.sid, '') AS afterSid
       FROM headings h LEFT JOIN verses v ON v.id = h.afterVerseId
       WHERE h.bookId = ? ORDER BY h.id`
    );
    const paragraphRows = db.prepare(
      `SELECT p.id, p.style, p.chapter,
         (SELECT json_group_array(sid) FROM
           (SELECT v.sid FROM verses v WHERE v.paragraph = p.id ORDER BY v.id)
         ) AS sids,
         EXISTS (SELECT 1 FROM headings h WHERE h.paragraph = p.id) AS heading
       FROM paragraphs p WHERE p.bookId = ? ORDER BY p.id`
    );

    let lastSid = '';
    let nextParagraphId = 0;
    for (const row of books) {
      const code = row.code as string;
      const xml = fs.readFileSync(
        path.join(usxDir, `${code.toLowerCase()}.usx`),
        'utf-8'
      );
      const source = scanUsx(xml, lastSid, errors);
      summary.books += 1;

      const stored: [string, string | number | null][] = [
        ['name', row.name],
        ['h', row.header],
        ['toc1', row.toc1],
        ['toc2', row.toc2],
        ['toc3', row.toc3],
        ['mt1', row.mt1],
        ['mt2', row.mt2],
      ];
      for (const [field, value] of stored) {
        if ((value ?? '') !== collapse(source.fields[field] ?? '')) {
          errors.push(`${code}: ${field} is "${value}" in the module`);
        }
      }

      const verses = verseRows.all(row.id) as {
        sid: string;
        raw: string;
        children: string;
      }[];
      const sourceSids = [...source.verses.keys()];
      const storedSids = verses.map((verse) => verse.sid);
      if (JSON.stringify(sourceSids) !== JSON.stringify(storedSids)) {
        errors.push(
          `${code}: the list or order of verses differs from the USX`
        );
      }
      for (const verse of verses) {
        const block = source.verses.get(verse.sid);
        if (!block) continue;
        compareBlock(verse.sid, block, verse.raw, verse.children, errors);
      }
      summary.verses += verses.length;
      lastSid = sourceSids[sourceSids.length - 1] ?? lastSid;

      const headings = headingRows.all(row.id) as {
        style: string;
        raw: string;
        children: string;
        afterSid: string;
      }[];
      if (headings.length !== source.headings.length) {
        errors.push(
          `${code}: ${headings.length} headings but the USX has ${source.headings.length}`
        );
      }
      headings.forEach((heading, index) => {
        const block = source.headings[index];
        if (!block) return;
        const label = `${code} heading ${index + 1}`;
        compareBlock(label, block, heading.raw, heading.children, errors);
        if (
          heading.style !== block.style ||
          heading.afterSid !== block.afterSid
        ) {
          errors.push(`${label}: wrong style or position`);
        }
      });
      summary.headings += headings.length;

      const paragraphs = paragraphRows.all(row.id) as {
        id: number;
        style: string;
        chapter: number;
        sids: string;
        heading: number;
      }[];
      if (paragraphs.length !== source.paragraphs.length) {
        errors.push(
          `${code}: ${paragraphs.length} paragraphs but the USX has ${source.paragraphs.length}`
        );
      }
      paragraphs.forEach((paragraph, index) => {
        if (paragraph.id !== nextParagraphId) {
          errors.push(
            `${code}: paragraph ${paragraph.id} should be numbered ${nextParagraphId}`
          );
        }
        nextParagraphId = paragraph.id + 1;
        const block = source.paragraphs[index];
        if (!block) return;
        const stored: ParagraphLayout = {
          style: paragraph.style,
          chapter: paragraph.chapter,
          sids: JSON.parse(paragraph.sids) as string[],
          heading: paragraph.heading === 1,
        };
        if (JSON.stringify(stored) !== JSON.stringify(block)) {
          errors.push(
            `${code}: paragraph ${paragraph.id} is ${JSON.stringify(stored)} but the USX has ${JSON.stringify(block)}`
          );
        }
      });
      summary.paragraphs += paragraphs.length;
    }
  } finally {
    db.close();
  }

  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_REPORTED).join('\n  ');
    throw new Error(
      `Module verification failed with ${errors.length} differences:\n  ${shown}`
    );
  }
  return summary;
}
