import { Book } from '../model/book';
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
    checksum: number | undefined,
    book: Book
  ): void {
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

    insert.run({ testamentCode, checksum, ...book });
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
            year NUMERIC,
            fetchId TEXT,
            language TEXT NOT NULL,
            languageCode TEXT NOT NULL,
            license TEXT NOT NULL,
            version TEXT NOT NULL,
            checksum NUMERIC,
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
            checksum NUMERIC
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
            checksum NUMERIC
          )
        `
      )
      .run();
  }
}
