import fs from 'fs';
import { parse } from 'yaml';
import UsxParser from './usx-parser';
import path from 'path';
import { ModuleConfig } from './model/module-config';
import {
  BibleVerseCounts,
  TestamentVerseCounts,
} from './model/bible-verse-counts';
import { Paragraph } from './model/book';

export default class ChecksumFactory {
  public static generate(moduleId: string) {
    const verseCountsFile = path.resolve('assets', 'bible-verse-counts.yaml');
    const configFile = path.resolve('assets', moduleId, 'config.yaml');
    if (!fs.existsSync(configFile)) {
      console.error(`No module found for ${moduleId}`);
      return;
    }

    console.log(`Generating checksums for ${moduleId}...`);
    const configContent: string = fs.readFileSync(configFile, 'utf-8');
    const config = parse(configContent) as ModuleConfig;
    console.log(`Name:    ${config.name}`);
    console.log(`Version: ${config.version}`);

    const verseCountsContent: string = fs.readFileSync(
      verseCountsFile,
      'utf-8'
    );
    const verseCounts = parse(verseCountsContent) as BibleVerseCounts;

    for (const testament of config.testamentsIncluded) {
      let chapters: TestamentVerseCounts | undefined = undefined;
      switch (testament) {
        case 'OT':
          chapters = verseCounts.OT;
          break;
        case 'NT':
          chapters = verseCounts.NT;
          break;
      }
      const usxFiles = UsxParser.getUsxFiles(moduleId, chapters);
      ChecksumFactory.checksumTestament(usxFiles, chapters);
    }
  }

  private static checksumTestament(
    usxFiles: string[],
    chapters: TestamentVerseCounts | undefined
  ): void {
    const usxParser = new UsxParser();
    for (const usxFile of usxFiles) {
      console.log(`  parsing ${usxFile}...`);
      const book = usxParser.parseBook(usxFile);
      const rawVerses = usxParser.getRawVerseText();
      // TODO: stopped here. Need to construct checksum yaml file containing hashes.
      console.log({ rawVerses });

      const bookVerseCounts = chapters?.[book.code];

      // Verify chapter count of the book.
      if (
        bookVerseCounts !== undefined &&
        book.chapters.length !== bookVerseCounts.length
      ) {
        throw new Error(
          `Book ${book.code} chapter count of ${book.chapters.length} did not match the expected count of ${bookVerseCounts.length}.`
        );
      }

      // Verify verse count of each chapter.
      book.chapters.forEach((chapter, index) => {
        const chapterVerseCount = bookVerseCounts?.[index];
        const parsedVerseCount = chapter.paragraphs.reduce(
          (acc: number, paragraph: Paragraph) => acc + paragraph.verses.length,
          0
        );
        if (
          chapterVerseCount !== undefined &&
          chapterVerseCount !== parsedVerseCount
        ) {
          throw new Error(
            `Chapter ${chapter.sid} verse count of ${parsedVerseCount} did not match the expected count of ${chapterVerseCount}.`
          );
        }
      });
      console.log(`  ${book.name} verse counts were correct.`);
      // TODO: remove this
      break;
    }
  }
}
