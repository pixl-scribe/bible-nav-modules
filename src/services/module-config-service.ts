import { ModuleConfig } from '../model/module-config';
import fs from 'fs';
import { parse } from 'yaml';
import path from 'path';
import { ModuleChecksum } from '../model/checksum-config';

export default class ModuleConfigService {
  public static getModuleConfig(moduleId: string): ModuleConfig {
    const configFile = path.resolve('assets', moduleId, 'config.yaml');
    if (!fs.existsSync(configFile)) {
      throw new Error(`No config.yaml file found for module ${moduleId}.`);
    }
    const configContent: string = fs.readFileSync(configFile, 'utf-8');
    return parse(configContent) as ModuleConfig;
  }

  public static getModuleChecksum(moduleId: string): ModuleChecksum {
    const configFile = path.resolve('assets', moduleId, 'checksum.yaml');
    if (!fs.existsSync(configFile)) {
      throw new Error(
        `No checksum.yaml file found for module ${moduleId}. Be sure to run checksum cli command first.`
      );
    }
    const configContent: string = fs.readFileSync(configFile, 'utf-8');
    return parse(configContent) as ModuleChecksum;
  }
}
