import UsxParserService from './services/usx-parser-service';
import { DbExporterService } from './services/db-exporter-service';
import { VerseCountService } from './services/verse-count-service';
import ModuleConfigService from './services/module-config-service';
import { TestamentVerseCounts } from './model/bible-verse-counts';

export default class ModuleFactory {
  public static generate(moduleId: string) {
    const dbExporter = new DbExporterService(moduleId);

    console.log(`Generating module ${moduleId}...`);
    const config = ModuleConfigService.getModuleConfig(moduleId);
    const checksum = ModuleConfigService.getModuleChecksum(moduleId);
    console.log(`Name:    ${config.name}`);
    console.log(`Version: ${config.version}`);
    console.log(`Checksum: ${checksum.checksum}`);
    dbExporter.exportModule(config, checksum.checksum, 'aaa');

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
      const usxFiles = UsxParserService.getUsxFiles(moduleId, chapters);

      const usxParser = new UsxParserService();
      for (const usxFile of usxFiles) {
        console.log(`  importing ${usxFile}...`);
        const book = usxParser.parseBook(usxFile);
        // console.log(JSON.stringify(book, null, 2));
        dbExporter.exportBook(book);
      }
    }

    dbExporter.close();
  }
}
