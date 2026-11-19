export type ModuleType =
  'bible' | 'dictionary' | 'lexicon' | 'cross-reference' | 'commentary';

export interface ModuleConfig {
  name: string;
  /**
   * The short name shown in tabs and menus, such as "KJV": 1 to 12
   * characters, any script, no spaces at either end.
   */
  abbreviation: string;
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
  /** Bibles only: the testaments to read, OT and/or NT. */
  testamentsIncluded?: string[];
  /**
   * Where this text's numbering differs from assets/bible-verse-counts.yaml
   * (the KJV's), each one deliberate: "3JN 1": 15 means 3 John 1 has 15
   * verses, and "MAL": 3 means Malachi has 3 chapters. Anything else that
   * differs still fails, and so does a listed difference that isn't one.
   */
  verseCountDifferences?: Record<string, number>;
}
