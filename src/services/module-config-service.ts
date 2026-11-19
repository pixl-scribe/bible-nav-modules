import { ModuleConfig } from '../model/module-config';
import fs from 'fs';
import { parse } from 'yaml';
import path from 'path';

export default class ModuleConfigService {
  public static getModuleConfig(moduleId: string): ModuleConfig {
    const configFile = path.resolve('assets', moduleId, 'config.yaml');
    if (!fs.existsSync(configFile)) {
      throw new Error(`No config.yaml file found for module ${moduleId}.`);
    }
    const configContent: string = fs.readFileSync(configFile, 'utf-8');
    const config = parse(configContent) as ModuleConfig;
    ModuleConfigService.check(config, configFile);
    return config;
  }

  /** Fails on settings a module can't be built without. */
  public static check(config: ModuleConfig, source: string): void {
    if (config.moduleType === 'bible') {
      if (
        !Array.isArray(config.testamentsIncluded) ||
        config.testamentsIncluded.length === 0
      ) {
        throw new Error(
          `${source}: a Bible needs testamentsIncluded (OT, NT).`
        );
      }
    } else if (config.moduleType === 'lexicon') {
      if (config.testamentsIncluded !== undefined) {
        throw new Error(`${source}: a lexicon has no testamentsIncluded.`);
      }
    } else {
      throw new Error(
        `${source}: moduleType ${String(config.moduleType)} can't be generated yet (bible or lexicon).`
      );
    }
    const abbreviation = config.abbreviation;
    if (
      typeof abbreviation !== 'string' ||
      abbreviation.trim() !== abbreviation ||
      [...abbreviation].length < 1 ||
      [...abbreviation].length > 12
    ) {
      throw new Error(
        `${source}: abbreviation must be 1 to 12 characters with no spaces at either end, such as "KJV".`
      );
    }
  }
}
