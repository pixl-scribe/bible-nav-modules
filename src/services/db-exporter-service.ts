import {Book, Chapter, Verse} from '../model/book';
import Database from 'better-sqlite3';
import { ModuleConfig } from '../model/module-config';
import path from 'path';
import fs from 'fs';

export class DbExporterService {
  private _db: Database.Database;

  constructor(moduleId: string) {
    const dbFile = path.resolve('exports', `${moduleId}.db`);
    fs.rmSync(dbFile, { force: true }); // Remove export if it exists.

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

    insert.run({ ...config, checksum, signature });
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
        @checksum
      )
    `);

    const info = insert.run({ testamentCode, checksum, ...book });
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

  public exportVerse(
    bookId: number,
    chapter: number,
    paragraph: number,
    verse: Verse,
    checksum: number | undefined
  ): void {
    const insert = this._db.prepare(`
      INSERT INTO verses (
        bookId,
        chapter,
        nbr,
        paragraph,
        sid,
        raw,
        checksum
      ) VALUES (
        @bookId,
        @chapter,
        @nbr,
        @paragraph,
        @sid,
        @raw,
        @checksum
      )
    `);

    insert.run({ bookId, chapter, paragraph, checksum, ...verse });
  }

  public close(): void {
    this._db.close();
  }

  private createTables(): void {
    this._db
      .prepare(
        `
          CREATE TABLE module (
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

    this._db
      .prepare(
        `
          CREATE TABLE verses (
            bookId INTEGER,
            chapter INTEGER NOT NULL,
            nbr INTEGER NOT NULL,
            paragraph INTEGER NOT NULL,
            sid TEXT NOT NULL,
            raw TEXT NOT NULL,
            checksum INTEGER,
            PRIMARY KEY (bookId, chapter, nbr),
            FOREIGN KEY (bookId) REFERENCES books(id)
            FOREIGN KEY (bookId, chapter) REFERENCES chapters(bookId, nbr)
          )
        `
      )
      .run();
  }
}
