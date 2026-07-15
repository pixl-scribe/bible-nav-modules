import fs from 'fs';
import { parse } from 'yaml';
import UsxParser from './usx-parser';
import path from 'path';
import { DbExporter } from './db-exporter';
import { ModuleConfig } from './model/module-config';

export default class ModuleFactory {
  public static generate(moduleId: string) {
    const configFile = path.resolve('assets', moduleId, 'config.yaml');
    if (!fs.existsSync(configFile)) {
      console.error(`No module found for ${moduleId}`);
      return;
    }

    const dbFile = path.resolve('exports', `${moduleId}.db`);
    fs.rmSync(dbFile, { force: true }); // Remove export if it exists.
    const dbExporter = new DbExporter(dbFile);

    console.log(`Generating module ${moduleId}...`);
    const content: string = fs.readFileSync(configFile, 'utf-8');
    const config = parse(content) as ModuleConfig;
    console.log(`Name:    ${config.name}`);
    console.log(`Version: ${config.version}`);
    dbExporter.exportModule(config);

    const usxFiles = UsxParser.getUsxFiles(moduleId);
    const usxParser = new UsxParser();
    for (const usxFile of usxFiles) {
      console.log(`  importing ${usxFile}...`);
      const book = usxParser.parseBook(usxFile);
      // console.log(JSON.stringify(book, null, 2));
      dbExporter.exportBook(book);
    }

    dbExporter.close();
  }
}
