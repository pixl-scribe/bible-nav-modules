export type ModuleType =
  'bible' | 'dictionary' | 'lexicon' | 'cross-reference' | 'commentary';

export interface ModuleConfig {
  name: string;
  description: string;
  moduleType: ModuleType;
  year?: number;
  fetchId?: string;
  language: string;
  languageCode: string;
  license: string;
  version: string;
  testamentsIncluded: string[];
}
