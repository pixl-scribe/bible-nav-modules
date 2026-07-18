import UsxParserService from './services/usx-parser-service';
import { DbExporterService } from './services/db-exporter-service';
import { VerseCountService } from './services/verse-count-service';
import ModuleConfigService from './services/module-config-service';
import { TestamentVerseCounts } from './model/bible-verse-counts';
import { JwtTokenService } from './services/jwt-token-service';
import pkg from '../package.json' with { type: 'json' };
import { TestamentChecksum } from './model/checksum-config';

export default class ModuleFactory {
  public static async generate(moduleId: string): Promise<void> {
    const dbExporter = new DbExporterService(moduleId);

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
        // console.log(JSON.stringify(book, null, 2));
        const bookChecksum = testamentChecksum?.bookChecksums.find(
          (cs) => cs.bookCode === book.code
        );

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
          chapter.paragraphs.forEach((paragraph, paraIndex) => {
            for (const verse of paragraph.verses) {
              const verseChecksum = chapterChecksum?.verseChecksums.find(
                (cs) => cs.sid === verse.sid
              );
              dbExporter.exportVerse(
                bookId,
                chapter.nbr,
                paraIndex,
                verse,
                verseChecksum?.checksum
              );
            }
          });
        }
      }
    }

    dbExporter.close();
  }
}
