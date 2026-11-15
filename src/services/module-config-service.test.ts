import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import ModuleConfigService from './module-config-service';
import { ModuleConfig } from '../model/module-config';

function config(abbreviation: unknown): ModuleConfig {
  return {
    name: 'Test',
    abbreviation,
    description: '',
    moduleType: 'bible',
    language: 'English',
    languageCode: 'eng',
    license: 'Public Domain',
    version: '1.0.0',
    testamentsIncluded: ['NT'],
  } as ModuleConfig;
}

describe('module config', () => {
  test('the real modules have abbreviations', () => {
    assert.equal(
      ModuleConfigService.getModuleConfig('eng_kjv').abbreviation,
      'KJV'
    );
    assert.equal(
      ModuleConfigService.getModuleConfig('eng_lsv').abbreviation,
      'LSV'
    );
  });

  test('an abbreviation is 1 to 12 characters, in any script', () => {
    for (const ok of ['KJV', 'WLC', 'ΚΔ', 'TR1894']) {
      ModuleConfigService.check(config(ok), 'test');
    }
    for (const bad of [undefined, '', ' KJV', 'KJV ', 'ABCDEFGHIJKLM']) {
      assert.throws(
        () => ModuleConfigService.check(config(bad), 'test'),
        /abbreviation/
      );
    }
  });
});
