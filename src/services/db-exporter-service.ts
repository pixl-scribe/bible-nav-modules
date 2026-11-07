import { Book, Chapter, Heading, Verse } from '../model/book';
import Database from 'better-sqlite3';
import { ModuleConfig } from '../model/module-config';
import fs from 'fs';

/**
 * The version of the database layout and the verses.children JSON. Increase it
 * for any change that a module reader would have to know about.
 */
export const MODULE_FORMAT_VERSION = 1;

export class DbExporterService {
  private _db: Database.Database;

  constructor(dbFile: string) {
    fs.rmSync(dbFile, { force: true }); // Remove the file if it exists.

    // this._db = new Database(dbFile, { verbose: console.log });
    this._db = new Database(dbFile);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this.createTables();
  }

  public exportModule(
    config: ModuleConfig,
    checksum: number,
    signature: string
  ) {
    const insert = this._db.prepare(`
      INSERT INTO module (
        formatVersion,
        name,
        description,
        moduleType,
        year,
        fetchId,
        language,
        languageCode,
        license,
        version,
        checksum,
        signature
      ) VALUES (
        @formatVersion,
        @name,
        @description,
        @moduleType,
        @year,
        @fetchId,
        @language,
        @languageCode,
        @license,
        @version,
        @checksum,
        @signature
      )
    `);

    insert.run({
      ...config,
      formatVersion: MODULE_FORMAT_VERSION,
      checksum,
      signature,
    });
  }

  public exportTestament(testamentCode: 'OT' | 'NT', checksum: number): void {
    const insert = this._db.prepare(`
      INSERT INTO testaments (
        code,
        checksum
      ) VALUES (
        @testamentCode,
        @checksum
      )
    `);

    insert.run({ testamentCode, checksum });
  }

  public exportBook(
    testamentCode: string | undefined,
    book: Book,
    checksum: number | undefined
  ): number {
    const insert = this._db.prepare(`
      INSERT INTO books (
        testamentCode,
        name,
        code,
        header,
        toc1,
        toc2,
        toc3,
        mt1,
        mt2,
        checksum
      ) VALUES (
        @testamentCode,
        @name,
        @code,
        @header,
        @toc1,
        @toc2,
        @toc3,
        @mt1,
        @mt2,
        @checksum
      )
    `);

    const info = insert.run({
      testamentCode,
      checksum,
      ...book,
      mt2: book.mt2 ?? null,
    });
    return info.lastInsertRowid as number;
  }

  public exportChapter(
    bookId: number,
    chapter: Chapter,
    checksum: number | undefined
  ): void {
    const insert = this._db.prepare(`
      INSERT INTO chapters (
        bookId,
        nbr,
        sid,
        checksum
      ) VALUES (
        @bookId,
        @nbr,
        @sid,
        @checksum
      )
    `);

    insert.run({ bookId, checksum, ...chapter });
  }

  public exportParagraph(
    id: number,
    bookId: number,
    chapter: number,
    style: string
  ): void {
    const insert = this._db.prepare(`
      INSERT INTO paragraphs (
        id,
        bookId,
        chapter,
        style
      ) VALUES (
        @id,
        @bookId,
        @chapter,
        @style
      )
    `);

    insert.run({ id, bookId, chapter, style });
  }

  public exportVerse(
    bookId: number,
    chapter: number,
    paragraph: number,
    verse: Verse,
    checksum: number | undefined
  ): number {
    const insert = this._db.prepare(`
      INSERT INTO verses (
        bookId,
        chapter,
        nbr,
        paragraph,
        sid,
        children,
        raw,
        checksum
      ) VALUES (
        @bookId,
        @chapter,
        @nbr,
        @paragraph,
        @sid,
        @childrenJson,
        @raw,
        @checksum
      )
    `);

    const childrenJson = JSON.stringify(verse.children);
    const info = insert.run({
      bookId,
      chapter,
      paragraph,
      checksum,
      childrenJson,
      ...verse,
    });
    return info.lastInsertRowid as number;
  }

  /**
   * @param afterVerseId The verse this text follows, or 0 if it comes first.
   */
  public exportHeading(
    bookId: number,
    chapter: number,
    paragraph: number,
    afterVerseId: number,
    heading: Heading
  ): void {
    const insert = this._db.prepare(`
      INSERT INTO headings (
        bookId,
        chapter,
        paragraph,
        afterVerseId,
        style,
        children,
        raw
      ) VALUES (
        @bookId,
        @chapter,
        @paragraph,
        @afterVerseId,
        @style,
        @childrenJson,
        @raw
      )
    `);

    insert.run({
      bookId,
      chapter,
      paragraph,
      afterVerseId,
      style: heading.style,
      childrenJson: JSON.stringify(heading.children),
      raw: heading.raw,
    });
  }

  /**
   * Leaves WAL mode so the finished module is one self-contained file. Readers
   * then never need -wal or -shm files, which read-only media can't hold.
   */
  public close(): void {
    this._db.pragma('journal_mode = DELETE');
    this._db.close();
  }

  private createTables(): void {
    this._db
      .prepare(
        `
          CREATE TABLE module (
            formatVersion INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            moduleType TEXT NOT NULL,
            year INTEGER,
            fetchId TEXT,
            language TEXT NOT NULL,
            languageCode TEXT NOT NULL,
            license TEXT NOT NULL,
            version TEXT NOT NULL,
            checksum INTEGER,
            signature TEXT NOT NULL
          )
        `
      )
      .run();

    this._db
      .prepare(
        `
          CREATE TABLE testaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            checksum INTEGER
          )
        `
      )
      .run();

    /**
      toc1: string; // Long table of contents text.
      toc2: string; // Short table of contents text.
      toc3: string; // Book abbreviation.
      mt1: string; // Main title.
      mt2: string; // Secondary title.
     */
    this._db
      .prepare(
        `
          CREATE TABLE books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            testamentCode TEXT,
            name TEXT NOT NULL,
            code TEXT NOT NULL,
            header TEXT NOT NULL,
            toc1 TEXT NOT NULL,
            toc2 TEXT NOT NULL,
            toc3 TEXT NOT NULL,
            mt1 TEXT NOT NULL,
            mt2 TEXT,
            checksum INTEGER
          )
        `
      )
      .run();

    this._db
      .prepare(
        `
          CREATE TABLE chapters (
            bookId INTEGER,
            nbr INTEGER NOT NULL,
            sid TEXT NOT NULL,
            checksum INTEGER,
            PRIMARY KEY (bookId, nbr),
            FOREIGN KEY (bookId) REFERENCES books(id)
          )
        `
      )
      .run();

    this._db.prepare('CREATE INDEX chapter_sid_index ON chapters (sid)').run();

    /**
     * Every paragraph in reading order, including blank ones. id is global
     * across books, and style decides the layout (p: prose, q1: poetic line,
     * b: blank line). Verses and headings point here through their paragraph.
     */
    this._db
      .prepare(
        `
          CREATE TABLE paragraphs (
            id INTEGER PRIMARY KEY,
            bookId INTEGER NOT NULL,
            chapter INTEGER NOT NULL,
            style TEXT NOT NULL,
            FOREIGN KEY (bookId, chapter) REFERENCES chapters(bookId, nbr)
          )
        `
      )
      .run();

    this._db
      .prepare(
        `
          CREATE TABLE verses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bookId INTEGER,
            chapter INTEGER NOT NULL,
            nbr INTEGER NOT NULL,
            paragraph INTEGER NOT NULL,
            sid TEXT NOT NULL,
            children TEXT NOT NULL,
            raw TEXT NOT NULL,
            checksum INTEGER,
            UNIQUE (bookId, chapter, nbr),
            FOREIGN KEY (bookId) REFERENCES books(id)
            FOREIGN KEY (bookId, chapter) REFERENCES chapters(bookId, nbr)
            FOREIGN KEY (paragraph) REFERENCES paragraphs(id)
          )
        `
      )
      .run();

    this._db.prepare('CREATE INDEX verse_sid_index ON verses (sid)').run();
    this._db
      .prepare('CREATE INDEX paragraph_index ON verses (paragraph)')
      .run();

    /**
     * Text between verses, such as Psalm titles. To place it, show the headings
     * with afterVerseId = n - 1 before verse n, ordered by id.
     */
    this._db
      .prepare(
        `
          CREATE TABLE headings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bookId INTEGER NOT NULL,
            chapter INTEGER NOT NULL,
            paragraph INTEGER NOT NULL REFERENCES paragraphs(id),
            afterVerseId INTEGER NOT NULL,
            style TEXT NOT NULL,
            children TEXT NOT NULL,
            raw TEXT NOT NULL,
            FOREIGN KEY (bookId, chapter) REFERENCES chapters(bookId, nbr)
          )
        `
      )
      .run();

    this._db
      .prepare(
        'CREATE INDEX heading_after_verse_index ON headings (afterVerseId)'
      )
      .run();

    /**
     * How to do a full text search:
     * SELECT v.sid, v.raw, highlight(verses_fts, 0, '<em>', '</em>') AS MATCHED_TEXT
     * FROM verses v
     * JOIN verses_fts f ON v.id = f.rowid
     * WHERE verses_fts MATCH 'faith'
     * ORDER BY v.id;
     */
    this._db
      .prepare(
        `
        CREATE VIRTUAL TABLE verses_fts USING fts5(
          raw,
          content='verses',
          content_rowid='id',
          tokenize='porter'
        )
        `
      )
      .run();

    /**
     * We need a non porter tokenized virtual table in order
     * to generate non-stemmed words in the vocab table.
     */
    this._db
      .prepare(
        `
        CREATE VIRTUAL TABLE verses_fts_non_porter USING fts5(
          raw,
          content='verses',
          content_rowid='id'
        )
        `
      )
      .run();

    /**
     * Note: _ai stands for after insert.
     */
    this._db
      .prepare(
        `
        CREATE TRIGGER verses_ai AFTER INSERT ON verses
        BEGIN
          INSERT INTO verses_fts(rowid, raw)
          VALUES (new.id, new.raw);

          INSERT INTO verses_fts_non_porter(rowid, raw)
          VALUES (new.id, new.raw);
        END
        `
      )
      .run();

    /**
     * Note: _ai stands for after insert.
     */
    this._db
      .prepare(
        `
        CREATE VIRTUAL TABLE verses_vocab
        USING fts5vocab(verses_fts_non_porter, col);
        `
      )
      .run();
  }
}
