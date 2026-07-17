import path from 'path';
import fs from 'fs';
import { parse } from 'yaml';
import { BibleVerseCounts } from '../model/bible-verse-counts';

export class VerseCountService {
  public static getVerseCounts(): BibleVerseCounts {
    const verseCountsFile = path.resolve('assets', 'bible-verse-counts.yaml');
    const verseCountsContent: string = fs.readFileSync(
      verseCountsFile,
      'utf-8'
    );
    return parse(verseCountsContent) as BibleVerseCounts;
  }
}
