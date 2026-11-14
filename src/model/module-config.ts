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
  /**
   * Where this text's numbering differs from assets/bible-verse-counts.yaml
   * (the KJV's), each one deliberate: "3JN 1": 15 means 3 John 1 has 15
   * verses, and "MAL": 3 means Malachi has 3 chapters. Anything else that
   * differs still fails, and so does a listed difference that isn't one.
   */
  verseCountDifferences?: Record<string, number>;
}
