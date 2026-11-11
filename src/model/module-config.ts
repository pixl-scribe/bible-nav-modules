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
  /**
   * The exact edition the text is, and where its source came from, precisely
   * enough to fetch it again. Both go into the signed manifest.
   */
  edition?: string;
  source?: string;
  testamentsIncluded: string[];
}
