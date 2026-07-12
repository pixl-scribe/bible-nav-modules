import fs from 'fs';
import { parse } from 'yaml';
import UsxParser from './usx-parser';

interface ModuleConfig {
  name: string;
  description: string;
  year: number;
  fetchId: string;
  language: string;
  languageCode: string;
  license: string;
  version: string;
}

export default class ModuleFactory {
  public static generate(moduleId: string) {
    const configFile = `./assets/${moduleId}/config.yaml`;
    if (!fs.existsSync(configFile)) {
      console.error(`No module found for ${moduleId}`);
      return;
    }

    console.log(`Generating module ${moduleId}...`);
    const content: string = fs.readFileSync(configFile, 'utf-8');
    const config = parse(content) as ModuleConfig;
    console.log(`Name:    ${config.name}`);
    console.log(`Version: ${config.version}`);
    const usxFiles = UsxParser.getUsxFiles(moduleId);
    const usxParser = new UsxParser();
    usxFiles.forEach((usxFile) => {
      console.log(`  importing ${usxFile}...`);
      const book = usxParser.parseBook(usxFile);
      console.log({ book });
    });
  }
}
