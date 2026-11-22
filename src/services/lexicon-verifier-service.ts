import fs from 'node:fs';
import Database from 'better-sqlite3';

/**
 * Checks a lexicon module against its TEI source file, entry by entry. It
 * reads the TEI with regular expressions and shares no code with
 * tei-lexicon-reader.ts, so a mistake in the reader can't hide itself here.
 * Never merge the two.
 *
 * Compared for every entry: the key and order, headword, its language,
 * homograph number, transliteration, pronunciation; each part of the body
 * (forms, derivations, definition, KJV renderings, senses with their
 * number and level, comment) in order, as plain text, after leaving out
 * the source editors' notes and the <sic> of each correction; each link's
 * target (an entry, a Strong's number, or a headword); each unlinked
 * word's attributes, each usage label's title and each foreign word's
 * language. The lookups must be exactly those the TEI file implies: a
 * Strong's key's own number, or else the headword as a lemma and any
 * bn:strong numbers.
 */

interface ScannedEntry {
  key: string;
  headword: string;
  headwordLang: string;
  homograph: string;
  translit: string;
  pronunciation: string;
  parts: string[];
  links: string[];
  words: string[];
  titles: string[];
  langs: string[];
  strong: string[];
  inflected: string[];
  allCited: boolean;
  /** Scripture references: "sid" or "sid>meant", in order. */
  brefs: string[];
}

/** Top-level parts of an entry, in order: [TEI pattern, module style]. */
const PARTS = new RegExp(
  [
    '<note type="forms">([\\s\\S]*?)</note>',
    '<note type="comment"(?: n="([^"]*)")?>([\\s\\S]*?)</note>',
    '<etym>([\\s\\S]*?)</etym>',
    '<def>([\\s\\S]*?)</def>',
    '<note type="kjvRenderings">([\\s\\S]*?)</note>',
    '<sense((?: [^>]*?)?) />',
    '<note type="comment"(?: n="([^"]*)")? />',
    '<sense((?: [^>]*)?)>([\\s\\S]*?)</sense>',
  ].join('|'),
  'g'
);

/** A sense's attributes as the verifier compares them. */
function senseLabel(get: (name: string) => string): string {
  return ['n', 'level', 'stem', 'allCited', 'pre', 'count']
    .map((name) => get(name))
    .join('/');
}

function attrIn(attrs: string, name: string): string {
  return unescape(new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? '');
}

/**
 * How a headword is looked up, as docs/lexicon-format.md defines it:
 * Unicode NFC, without combining breve (U+0306) or macron (U+0304),
 * digits, or an asterisk.
 */
function lemmaOf(word: string): string {
  return [...word.normalize('NFD')]
    .filter(
      (c) => c !== '\u0304' && c !== '\u0306' && c !== '*' && !/[0-9]/.test(c)
    )
    .join('')
    .normalize('NFC')
    .trim();
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
    const entryAttrs = /^<entry ([^>]*)>/.exec(match[0])?.[1] ?? '';
    const body = match[2]
      .replace(/<note type="sourceCorrection"[^>]*>[\s\S]*?<\/note>/g, '')
      .replace(/<sic>[\s\S]*?<\/sic>/g, '');
    // Strong's senses only wrap a definition and KJV renderings.
    const unwrapped = body.replace(
      /<sense>(\s*<(?:def>|note type="kjvRenderings">)[\s\S]*?)<\/sense>/g,
      '$1'
    );
    const parts = [...unwrapped.matchAll(PARTS)].map((m) => {
      if (m[1] !== undefined) return `form: ${stripTags(m[1])}`;
      if (m[3] !== undefined) return `note ${m[2] ?? ''}: ${stripTags(m[3])}`;
      if (m[4] !== undefined) return `deriv: ${stripTags(m[4])}`;
      if (m[5] !== undefined) return `def: ${stripTags(m[5])}`;
      if (m[6] !== undefined) return `kjv: ${stripTags(m[6])}`;
      // An empty note (one that only heads its numbered parts).
      if (m[0].startsWith('<note')) return `note ${m[8] ?? ''}: `;
      const attrs = m[7] ?? m[9] ?? '';
      const text = m[7] !== undefined ? '' : stripTags(m[10]);
      const label = senseLabel((name) =>
        attrIn(attrs, name === 'n' ? 'n' : `bn:${name}`)
      );
      return `sense ${label}: ${text}`;
    });
    // BDB's headword line: its marks, then any other spellings.
    const variants = [
      ...body.matchAll(
        /<form type="variant"( bn:count="[^"]*")?>\s*<orth xml:lang="([^"]+)">([^<]*)<\/orth>\s*<\/form>/g
      ),
    ].map((v) => `${v[2]}|${attrIn(v[1] ?? '', 'bn:count')}|${unescape(v[3])}`);
    const marks = ['bn:peculiar', 'bn:brackets', 'bn:count'].map((name) =>
      attrIn(entryAttrs, name)
    );
    if (marks.some(Boolean) || variants.length > 0) {
      parts.unshift(`hwline ${marks.join('/')}: ${variants.join(' ')}`);
    }
    const links = [
      // In this file ("#G25") or another lexicon's ("<file>#H5689"), or
      // every entry with a headword.
      ...body.matchAll(
        /<ref type="entry" target="[^"#]*#([^"]+)"|<ref type="lemma" [^>]*bn:lemma="([^"]*)"/g
      ),
    ].map((m) =>
      m[1] !== undefined
        ? m[1].replace(/^([HG])0*/, '$1')
        : `lemma:${unescape(m[2])}`
    );
    const titles = [...body.matchAll(/<usg( [^>]*)?>/g)].map((m) =>
      attrIn(m[1] ?? '', 'bn:title')
    );
    // An empty foreign word (BDB's Hebrew lost in transcription) is written
    // <foreign ... />.
    const langs = [...body.matchAll(/<foreign xml:lang="([^"]*)"\s*\/?>/g)].map(
      (m) => m[1]
    );
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
      headword: stripTags(
        one(/<orth xml:lang="[^"]+">([\s\S]*?)<\/orth>/, body, 'headword', key)
      ),
      headwordLang: one(
        /<orth xml:lang="([^"]+)">/,
        body,
        'headword language',
        key
      ),
      homograph: attrIn(entryAttrs, 'n'),
      translit: unescape(
        /<orth type="transliteration">([^<]*)<\/orth>/.exec(body)?.[1] ?? ''
      ),
      pronunciation: unescape(/<pron>([^<]*)<\/pron>/.exec(body)?.[1] ?? ''),
      parts,
      links,
      words,
      titles,
      langs,
      strong: attrIn(entryAttrs, 'bn:strong').split(/\s+/).filter(Boolean),
      allCited: attrIn(entryAttrs, 'bn:allCited') === '1',
      brefs: [
        ...body.matchAll(
          /<ref type="bible" bn:sid="([^"]*)"(?: bn:meant="([^"]*)")?>/g
        ),
      ].map((r) => (r[2] ? `${r[1]}>${r[2]}` : r[1])),
      inflected: [
        ...body.matchAll(
          /<form type="inflected"><orth xml:lang="[^"]+">([^<]*)<\/orth><\/form>/g
        ),
      ].map((m) => unescape(m[1])),
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
        `SELECT key, headword, headwordLang, homograph, translit,
                pronunciation, allCited, body
         FROM entries ORDER BY id`
      )
      .all() as {
      key: string;
      headword: string;
      headwordLang: string;
      homograph: string;
      translit: string;
      pronunciation: string;
      allCited: number;
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
      expect('homograph', row.homograph, tei.homograph);
      expect('transliteration', row.translit, tei.translit);
      expect('pronunciation', row.pronunciation, tei.pronunciation);
      expect('dagger', String(row.allCited), tei.allCited ? '1' : '0');
      const body = JSON.parse(row.body) as Stored[];
      const attr = (item: Stored, name: string) =>
        typeof item === 'string' ? '' : String(item[name] ?? '');
      const parts = body.map((item) => {
        if (typeof item === 'string') return `text: ${item}`;
        if (item.style === 'sense') {
          const label = senseLabel((name) => attr(item, name));
          return `sense ${label}: ${storedText(item.children)}`;
        }
        if (item.style === 'note') {
          return `note ${attr(item, 'n')}: ${storedText(item.children)}`;
        }
        if (item.style === 'hwline') {
          const marks = ['peculiar', 'brackets', 'count']
            .map((name) => attr(item, name))
            .join('/');
          const words = item.children
            .map(
              (w) =>
                `${attr(w, 'lang')}|${attr(w, 'count')}|${storedText(typeof w === 'string' ? [w] : w.children)}`
            )
            .join(' ');
          return `hwline ${marks}: ${words}`;
        }
        return `${item.style}: ${storedText(item.children)}`;
      });
      expect('parts', parts.join('\n'), tei.parts.join('\n'));
      expect(
        'scripture references',
        collect(body, 'bref')
          .map((r) =>
            attr(r, 'meant')
              ? `${attr(r, 'sid')}>${attr(r, 'meant')}`
              : attr(r, 'sid')
          )
          .join(' '),
        tei.brefs.join(' ')
      );
      expect(
        'usage titles',
        collect(body, 'usg')
          .map((u) => String((u as { title?: string }).title ?? ''))
          .join('|'),
        tei.titles.join('|')
      );
      expect(
        'foreign languages',
        collect(body, 'foreign')
          .map((f) => String((f as { lang?: string }).lang ?? ''))
          .join(' '),
        tei.langs.join(' ')
      );
      expect(
        'links',
        collect(body, 'ref')
          .map((ref) =>
            (ref as { lemma?: string }).lemma !== undefined
              ? `lemma:${String((ref as { lemma?: string }).lemma)}`
              : String(
                  (ref as { strong?: string }).strong ??
                    (ref as { key?: string }).key
                )
          )
          .join(' '),
        tei.links.join(' ')
      );
      expect(
        'words',
        // Not the other spellings on BDB's headword line, compared above.
        collect(
          body.filter(
            (item) => typeof item === 'string' || item.style !== 'hwline'
          ),
          'word'
        )
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
    const wanted = new Set<string>();
    for (const tei of scanned) {
      if (/^[HG][1-9]\d*$/.test(tei.key)) {
        wanted.add(`strong ${tei.key} ${tei.key}`);
        continue;
      }
      // Lemma lookups are Greek only (docs/lexicon-format.md).
      if (tei.headwordLang === 'grc') {
        wanted.add(`lemma ${lemmaOf(tei.headword)} ${tei.key}`);
        for (const form of tei.inflected) {
          wanted.add(`lemma ${lemmaOf(form)} ${tei.key}`);
        }
      }
      for (const n of tei.strong) wanted.add(`strong ${n} ${tei.key}`);
    }
    for (const w of wanted) {
      if (!have.has(w)) problems.push(`missing lookup: ${w}`);
    }
    for (const h of have) {
      if (!wanted.has(h)) problems.push(`unexpected lookup: ${h}`);
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
