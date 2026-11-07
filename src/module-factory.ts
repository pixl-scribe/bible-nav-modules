import fs from 'fs';
import path from 'path';
import UsxParserService from './services/usx-parser-service';
import { DbExporterService } from './services/db-exporter-service';
import { VerseCountService } from './services/verse-count-service';
import ModuleConfigService from './services/module-config-service';
import { verifyModule } from './services/module-verifier-service';
import { TestamentVerseCounts } from './model/bible-verse-counts';
import { JwtTokenService } from './services/jwt-token-service';
import pkg from '../package.json' with { type: 'json' };
import { BookChecksum, TestamentChecksum } from './model/checksum-config';
import { Book } from './model/book';

/**
 * Tracks position across books while exporting. paragraph numbers are global,
 * and each heading records the verse it follows.
 */
export interface ExportPosition {
  paragraph: number;
  lastVerseId: number;
}

export default class ModuleFactory {
  /**
   * Writes the module to a temporary file and replaces the real export only
   * after it matches the USX, so a failure can't leave a bad export behind.
   */
  public static async generate(moduleId: string): Promise<void> {
    const dbFile = path.resolve('exports', `${moduleId}.db`);
    const tempFile = `${dbFile}.tmp`;

    try {
      await ModuleFactory.writeModule(moduleId, tempFile);
      const summary = verifyModule(tempFile, path.resolve('assets', moduleId));
      console.log(
        `Verified ${summary.books} books, ${summary.paragraphs} paragraphs, ${summary.verses} verses, and ${summary.headings} headings against the USX.`
      );
      fs.renameSync(tempFile, dbFile);
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        fs.rmSync(`${tempFile}${suffix}`, { force: true });
      }
    }
  }

  /**
   * Checks an existing export against the USX without changing it.
   */
  public static verify(moduleId: string): void {
    const summary = verifyModule(
      path.resolve('exports', `${moduleId}.db`),
      path.resolve('assets', moduleId)
    );
    console.log(
      `Verified ${summary.books} books, ${summary.paragraphs} paragraphs, ${summary.verses} verses, and ${summary.headings} headings against the USX.`
    );
  }

  private static async writeModule(
    moduleId: string,
    dbFile: string
  ): Promise<void> {
    const dbExporter = new DbExporterService(dbFile);

    console.log(`Generating module ${moduleId}...`);
    const config = ModuleConfigService.getModuleConfig(moduleId);
    const checksum = ModuleConfigService.getModuleChecksum(moduleId);
    console.log(`Name:    ${config.name}`);
    console.log(`Version: ${config.version}`);
    console.log(`Checksum: ${checksum.checksum}`);
    const jwtToken = await JwtTokenService.generateToken({
      application: 'Bible Nav',
      applicationVersion: pkg.version,
      moduleId,
      moduleName: config.name,
      moduleVersion: config.version,
      checksum: checksum.checksum,
    });
    dbExporter.exportModule(config, checksum.checksum, jwtToken);

    const verseCounts = VerseCountService.getVerseCounts();
    const position: ExportPosition = { paragraph: 0, lastVerseId: 0 };

    for (const testament of config.testamentsIncluded) {
      let chapters: TestamentVerseCounts | undefined = undefined;
      switch (testament) {
        case 'OT':
          chapters = verseCounts.OT;
          break;
        case 'NT':
          chapters = verseCounts.NT;
          break;
      }

      let testamentChecksum: TestamentChecksum | undefined;
      if (testament === 'OT' || testament === 'NT') {
        testamentChecksum = checksum.testamentChecksums.find(
          (cs) => cs.testament === testament
        );
        if (testamentChecksum?.checksum) {
          dbExporter.exportTestament(testament, testamentChecksum.checksum);
        }
      }
      const usxFiles = UsxParserService.getUsxFiles(moduleId, chapters);

      const usxParser = new UsxParserService();
      for (const usxFile of usxFiles) {
        console.log(`  importing ${usxFile}...`);
        const book = usxParser.parseBook(usxFile);
        const bookChecksum = testamentChecksum?.bookChecksums.find(
          (cs) => cs.bookCode === book.code
        );
        ModuleFactory.exportBook(
          dbExporter,
          testament,
          book,
          bookChecksum,
          position
        );
      }
    }

    dbExporter.close();
  }

  public static exportBook(
    dbExporter: DbExporterService,
    testament: string | undefined,
    book: Book,
    bookChecksum: BookChecksum | undefined,
    position: ExportPosition
  ): void {
    const bookId = dbExporter.exportBook(
      testament,
      book,
      bookChecksum?.checksum
    );
    for (const chapter of book.chapters) {
      const chapterChecksum = bookChecksum?.chapterChecksums.find(
        (cs) => cs.sid === chapter.sid
      );
      dbExporter.exportChapter(bookId, chapter, chapterChecksum?.checksum);
      for (const paragraph of chapter.paragraphs) {
        dbExporter.exportParagraph(
          position.paragraph,
          bookId,
          chapter.nbr,
          paragraph.style
        );
        if (paragraph.heading) {
          dbExporter.exportHeading(
            bookId,
            chapter.nbr,
            position.paragraph,
            position.lastVerseId,
            paragraph.heading
          );
        }
        for (const verse of paragraph.verses) {
          const verseChecksum = chapterChecksum?.verseChecksums.find(
            (cs) => cs.sid === verse.sid
          );
          position.lastVerseId = dbExporter.exportVerse(
            bookId,
            chapter.nbr,
            position.paragraph,
            verse,
            verseChecksum?.checksum
          );
        }
        position.paragraph += 1;
      }
    }
  }
}
