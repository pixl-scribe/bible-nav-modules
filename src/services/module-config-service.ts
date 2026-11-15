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
