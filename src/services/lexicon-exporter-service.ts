import fs from 'node:fs';
import Database from 'better-sqlite3';
import { ModuleConfig } from '../model/module-config';
import { BodyItem, Lexicon } from '../model/lexicon';

/**
 * The version of a lexicon module's layout and body JSON. It counts
 * separately from a Bible's format version (docs/lexicon-format.md, "The
 * manifest"). Increase it for any change a reader would have to know about.
 */
export const LEXICON_FORMAT_VERSION = 1;

/**
 * An entry body as stored: `style` first, then its attributes in name
 * order, then `children`.
 */
export type StoredBodyItem = string | { [name: string]: unknown };

export function storedBody(items: BodyItem[]): StoredBodyItem[] {
  return items.map((item) => {
    if (typeof item === 'string') return item;
    const stored: { [name: string]: unknown } = { style: item.style };
    for (const name of Object.keys(item.attributes).sort()) {
      stored[name] = item.attributes[name];
    }
    stored.children = storedBody(item.children);
    return stored;
  });
}

/** Writes a lexicon module (tables from docs/lexicon-format.md). */
export function exportLexicon(
  dbFile: string,
  config: ModuleConfig,
  lexicon: Lexicon
): void {
  fs.rmSync(dbFile, { force: true });
  const db = new Database(dbFile);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE module (
        formatVersion INTEGER NOT NULL,
        name TEXT NOT NULL,
        abbreviation TEXT NOT NULL,
        description TEXT NOT NULL,
        moduleType TEXT NOT NULL,
        year INTEGER,
        fetchId TEXT,
        language TEXT NOT NULL,
        languageCode TEXT NOT NULL,
        license TEXT NOT NULL,
        version TEXT NOT NULL
      );
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        headword TEXT NOT NULL,
        headwordLang TEXT NOT NULL,
        homograph TEXT NOT NULL,
        translit TEXT NOT NULL,
        pronunciation TEXT NOT NULL,
        allCited INTEGER NOT NULL CHECK (allCited IN (0, 1)),
        body TEXT NOT NULL
      );
      -- Found by an exact value: a Strong's number in normal form, or a lemma.
      CREATE TABLE lookups (
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        entryId INTEGER NOT NULL REFERENCES entries (id),
        PRIMARY KEY (kind, value, entryId)
      ) WITHOUT ROWID;
    `);

    db.prepare(
      `INSERT INTO module VALUES (@formatVersion, @name, @abbreviation,
        @description, @moduleType, @year, @fetchId, @language, @languageCode,
        @license, @version)`
    ).run({
      formatVersion: LEXICON_FORMAT_VERSION,
      name: config.name,
      abbreviation: config.abbreviation,
      description: config.description,
      moduleType: config.moduleType,
      year: config.year ?? null,
      fetchId: config.fetchId ?? null,
      language: config.language,
      languageCode: config.languageCode,
      license: config.license,
      version: config.version,
    });

    const insertEntry = db.prepare(
      `INSERT INTO entries VALUES (@id, @key, @headword, @headwordLang,
        @homograph, @translit, @pronunciation, @allCited, @body)`
    );
    const insertLookup = db.prepare(
      'INSERT INTO lookups VALUES (@kind, @value, @entryId)'
    );
    const ids = new Map<string, number>();
    db.transaction(() => {
      lexicon.entries.forEach((entry, index) => {
        const id = index + 1;
        ids.set(entry.key, id);
        insertEntry.run({
          id,
          key: entry.key,
          headword: entry.headword,
          headwordLang: entry.headwordLang,
          homograph: entry.homograph,
          translit: entry.translit,
          pronunciation: entry.pronunciation,
          allCited: entry.allCited ? 1 : 0,
          body: JSON.stringify(storedBody(entry.body)),
        });
      });
      for (const lookup of lexicon.lookups) {
        const entryId = ids.get(lookup.entryKey);
        if (entryId === undefined) {
          throw new Error(`a lookup leads to missing entry ${lookup.entryKey}`);
        }
        insertLookup.run({ kind: lookup.kind, value: lookup.value, entryId });
      }
    })();
    db.pragma('journal_mode = DELETE');
  } finally {
    db.close();
  }
}
