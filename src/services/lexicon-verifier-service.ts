import fs from 'node:fs';
import Database from 'better-sqlite3';

/**
 * Checks a lexicon module against its TEI source file, entry by entry. It
 * reads the TEI with regular expressions and shares no code with
 * tei-lexicon-reader.ts, so a mistake in the reader can't hide itself here.
 * Never merge the two.
 *
 * Compared for every entry: the key and order, headword, its language,
 * transliteration, pronunciation, the plain text of the derivation,
 * definition and KJV renderings (after leaving out the source editors'
 * notes and the <sic> of each correction), and each link's target and
 * each unlinked word's attributes. Every Strong's key must have its lookup.
 */

interface ScannedEntry {
  key: string;
  headword: string;
  headwordLang: string;
  translit: string;
  pronunciation: string;
  parts: Record<string, string>;
  links: string[];
  words: string[];
}

function unescape(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function stripTags(text: string): string {
  return unescape(text.replace(/<[^>]*>/g, ''));
}

function one(pattern: RegExp, text: string, what: string, key: string): string {
  const match = pattern.exec(text);
  if (!match) throw new Error(`entry ${key}: no ${what} in the TEI file`);
  return match[1];
}

function scanTei(xml: string): ScannedEntry[] {
  const entries: ScannedEntry[] = [];
  const entryPattern = /<entry xml:id="([^"]+)"[^>]*>([\s\S]*?)<\/entry>/g;
  for (const match of xml.matchAll(entryPattern)) {
    const key = match[1];
    const body = match[2]
      .replace(/<note type="sourceCorrection"[^>]*>[\s\S]*?<\/note>/g, '')
      .replace(/<sic>[\s\S]*?<\/sic>/g, '');
    const part = (pattern: RegExp) => {
      const found = pattern.exec(body);
      return found ? stripTags(found[1]) : '';
    };
    const links = [
      // In this file ("#G25") or another lexicon's ("<file>#H5689").
      ...body.matchAll(/<ref type="entry" target="[^"#]*#([^"]+)"/g),
    ].map((m) => m[1].replace(/^([HG])0*/, '$1'));
    const words = [
      ...body.matchAll(/<mentioned ([^>]*)>([^<]*)<\/mentioned>/g),
    ].map((m) => {
      const attr = (name: string) =>
        unescape(new RegExp(`${name}="([^"]*)"`).exec(m[1])?.[1] ?? '');
      return [
        attr('xml:lang'),
        attr('bn:translit'),
        attr('bn:pron'),
        unescape(m[2]),
      ].join('|');
    });
    entries.push({
      key,
      headword: unescape(
        one(/<orth xml:lang="[^"]+">([^<]*)<\/orth>/, body, 'headword', key)
      ),
      headwordLang: one(
        /<orth xml:lang="([^"]+)">/,
        body,
        'headword language',
        key
      ),
      translit: unescape(
        one(
          /<orth type="transliteration">([^<]*)<\/orth>/,
          body,
          'transliteration',
          key
        )
      ),
      pronunciation: unescape(
        one(/<pron>([^<]*)<\/pron>/, body, 'pronunciation', key)
      ),
      parts: {
        form: part(/<note type="forms">([\s\S]*?)<\/note>/),
        note: part(/<note type="comment">([\s\S]*?)<\/note>/),
        deriv: part(/<etym>([\s\S]*?)<\/etym>/),
        def: part(/<def>([\s\S]*?)<\/def>/),
        kjv: part(/<note type="kjvRenderings">([\s\S]*?)<\/note>/),
      },
      links,
      words,
    });
  }
  return entries;
}

type Stored =
  string | { style: string; children: Stored[]; [name: string]: unknown };

function storedText(items: Stored[]): string {
  return items
    .map((item) =>
      typeof item === 'string' ? item : storedText(item.children)
    )
    .join('');
}

function collect(items: Stored[], style: string, out: Stored[] = []): Stored[] {
  for (const item of items) {
    if (typeof item === 'string') continue;
    if (item.style === style) out.push(item);
    collect(item.children, style, out);
  }
  return out;
}

export interface LexiconSummary {
  entries: number;
  lookups: number;
}

export function verifyLexicon(dbFile: string, teiFile: string): LexiconSummary {
  const scanned = scanTei(fs.readFileSync(teiFile, 'utf8'));
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  const problems: string[] = [];
  try {
    const rows = db
      .prepare(
        `SELECT key, headword, headwordLang, translit, pronunciation, body
         FROM entries ORDER BY id`
      )
      .all() as {
      key: string;
      headword: string;
      headwordLang: string;
      translit: string;
      pronunciation: string;
      body: string;
    }[];
    if (rows.length !== scanned.length) {
      problems.push(
        `${scanned.length} entries in the TEI file, ${rows.length} in the module`
      );
    }
    rows.forEach((row, index) => {
      const tei = scanned[index];
      if (!tei) return;
      const expect = (what: string, actual: string, wanted: string) => {
        if (actual !== wanted) {
          problems.push(
            `entry ${tei.key} ${what}: module ${JSON.stringify(actual)}, TEI ${JSON.stringify(wanted)}`
          );
        }
      };
      expect('key', row.key, tei.key);
      expect('headword', row.headword, tei.headword);
      expect('headword language', row.headwordLang, tei.headwordLang);
      expect('transliteration', row.translit, tei.translit);
      expect('pronunciation', row.pronunciation, tei.pronunciation);
      const body = JSON.parse(row.body) as Stored[];
      for (const style of ['form', 'deriv', 'def', 'kjv', 'note']) {
        const top = body.filter(
          (item) => typeof item !== 'string' && item.style === style
        );
        expect(style, storedText(top), tei.parts[style]);
      }
      expect(
        'links',
        collect(body, 'ref')
          .map((ref) =>
            String(
              (ref as { strong?: string }).strong ??
                (ref as { key?: string }).key
            )
          )
          .join(' '),
        tei.links.join(' ')
      );
      expect(
        'words',
        collect(body, 'word')
          .map((w) => {
            const word = w as {
              lang?: string;
              translit?: string;
              pronunciation?: string;
              children: Stored[];
            };
            return [
              word.lang ?? '',
              word.translit ?? '',
              word.pronunciation ?? '',
              storedText(word.children),
            ].join('|');
          })
          .join(' '),
        tei.words.join(' ')
      );
    });

    const lookups = db
      .prepare(
        `SELECT l.kind, l.value, e.key FROM lookups l JOIN entries e ON e.id = l.entryId`
      )
      .all() as { kind: string; value: string; key: string }[];
    const have = new Set(lookups.map((l) => `${l.kind} ${l.value} ${l.key}`));
    for (const tei of scanned) {
      if (
        /^[HG][1-9]\d*$/.test(tei.key) &&
        !have.has(`strong ${tei.key} ${tei.key}`)
      ) {
        problems.push(`entry ${tei.key} has no Strong's lookup`);
      }
    }
    if (problems.length > 0) {
      throw new Error(
        `The module doesn't match ${teiFile}:\n  ${problems.slice(0, 30).join('\n  ')}` +
          (problems.length > 30
            ? `\n  ... and ${problems.length - 30} more`
            : '')
      );
    }
    return { entries: rows.length, lookups: lookups.length };
  } finally {
    db.close();
  }
}
