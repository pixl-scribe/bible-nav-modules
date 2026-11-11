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
    return parse(configContent) as ModuleConfig;
  }
}
