import { Book } from './model/book';
import Database from 'better-sqlite3';
import { ModuleConfig } from './model/module-config';

export class DbExporter {
  private _db: Database.Database;

  constructor(path: string) {
    this._db = new Database(path, { verbose: console.log });
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this.createTables();
  }

  public exportModule(config: ModuleConfig) {
    const insert = this._db.prepare(`
      INSERT INTO module (
        name,
        description,
        year,
        fetchId,
        language,
        languageCode,
        license,
        version
      ) VALUES (
        @name,
        @description,
        @year,
        @fetchId,
        @language,
        @languageCode,
        @license,
        @version
      )
    `);

    insert.run(config);
  }

  public exportBook(book: Book): void {
    console.log({ book });
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
            year NUMERIC,
            fetchId TEXT,
            language TEXT NOT NULL,
            languageCode TEXT NOT NULL,
            license TEXT NOT NULL,
            version TEXT NOT NULL
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
            name TEXT NOT NULL,
            code TEXT NOT NULL,
            header TEXT NOT NULL,
            toc1 TEXT NOT NULL,
            toc2 TEXT NOT NULL,
            toc3 TEXT NOT NULL,
            mt1 TEXT NOT NULL,
            signature TEXT NOT NULL
          )
        `
      )
      .run();
  }
}
