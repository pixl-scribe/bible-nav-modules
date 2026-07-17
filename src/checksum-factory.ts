import fs from 'fs';
import { stringify } from 'yaml';
import UsxParserService from './services/usx-parser-service';
import path from 'path';
import { TestamentVerseCounts } from './model/bible-verse-counts';
import { Paragraph } from './model/book';
import {
  BookChecksum,
  ChapterChecksum,
  ModuleChecksum,
  TestamentChecksum,
} from './model/checksum-config';
import { xxHash32 } from 'js-xxhash';
import { VerseCountService } from './services/verse-count-service';
import ModuleConfigService from './services/module-config-service';

export default class ChecksumFactory {
  public static generate(moduleId: string) {
    console.log(`Generating checksums for ${moduleId}...`);
    const config = ModuleConfigService.getModuleConfig(moduleId);
    console.log(`Name:    ${config.name}`);
    console.log(`Version: ${config.version}`);

    const verseCounts = VerseCountService.getVerseCounts();
    const testamentChecksums: TestamentChecksum[] = [];

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
      const usxFiles = UsxParserService.getUsxFiles(moduleId, chapters);
      if (testament === 'OT' || testament === 'NT') {
        const bookChecksums = ChecksumFactory.checksumTestament(
          usxFiles,
          chapters
        );
        const bookJoinedChecksums = bookChecksums
          .map((bcs) => bcs.checksum)
          .join();
        testamentChecksums.push({
          testament,
          checksum: xxHash32(bookJoinedChecksums),
          bookChecksums,
        });
      }
    }

    if (testamentChecksums.length > 0) {
      const testamentJoinedChecksums = testamentChecksums
        .map((tcs) => tcs.checksum)
        .join();
      const moduleChecksum: ModuleChecksum = {
        checksum: xxHash32(testamentJoinedChecksums),
        testamentChecksums,
      };
      const checksumYaml = stringify(moduleChecksum);
      ChecksumFactory.writeChecksums(moduleId, checksumYaml);
    }
  }

  private static checksumTestament(
    usxFiles: string[],
    chapters: TestamentVerseCounts | undefined
  ): BookChecksum[] {
    const usxParser = new UsxParserService();
    const bookChecksums: BookChecksum[] = [];
    for (const usxFile of usxFiles) {
      console.log(`  parsing ${usxFile}...`);
      const book = usxParser.parseBook(usxFile);
      const rawBookVerses = usxParser.getRawVerseText();
      const chapterChecksums = ChecksumFactory.getVerseChecksums(rawBookVerses);
      const chapterJoinedChecksums = chapterChecksums
        .map((ccs) => ccs.checksum)
        .join();
      bookChecksums.push({
        bookCode: book.code,
        checksum: xxHash32(chapterJoinedChecksums),
        chapterChecksums,
      });

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
    }

    return bookChecksums;
  }

  private static getVerseChecksums(
    rawBookVerses: { sid: string; text: string }[]
  ): ChapterChecksum[] {
    const chapters = Object.groupBy(
      rawBookVerses,
      (verse) => verse.sid.split(':')[0]
    );
    return Object.keys(chapters).map((sid: string) => {
      const rawVerses = chapters[sid] as { sid: string; text: string }[];
      const verseChecksums = rawVerses.map(
        ({ sid, text }: { sid: string; text: string }) => ({
          sid,
          checksum: xxHash32(`${sid}|${text}`),
        })
      );
      const verseJoinedChecksums = verseChecksums
        .map((vcs) => vcs.checksum)
        .join();
      return {
        sid,
        checksum: xxHash32(verseJoinedChecksums),
        verseChecksums,
      };
    });
  }

  private static writeChecksums(moduleId: string, yaml: string) {
    const checksumFile = path.resolve('assets', moduleId, 'checksum.yaml');
    try {
      fs.writeFileSync(checksumFile, yaml, 'utf8');
      console.log('  Checksum file written successfully!');
    } catch (error) {
      console.error('Error writing checksum file:', error);
    }
  }
}
