/**
 * See https://ubsicap.github.io/usx/charstyles.html#add
 */
export interface TranslatorsAddition {
  style: 'add';
  text: string;
}

/**
 * See https://ubsicap.github.io/usx/charstyles.html#w
 */
export interface GlossaryWord {
  style: 'w';
  text: string;
  strong: string;
}

export interface Note {
  style: 'f';
  // TODO: work on this.
}

export type VerseChild = string | GlossaryWord | TranslatorsAddition | Note;

export interface Verse {
  verseNumber: number;
  sid: string;
  children: VerseChild[];
  rawText: string;
}

export interface Paragraph {
  verses: Verse[];
}

export interface Chapter {
  chapterNumber: number;
  sid: string;
  paragraphs: Paragraph[];
}

/**
 * See https://ubsicap.github.io/usx/parastyles.html for more info.
 */
export interface Book {
  name: string;
  code: string;
  header: string;
  toc1: string; // Long table of contents text.
  toc2: string; // Short table of contents text.
  toc3: string; // Book abbreviation.
  mt1: string; // Main title.
  chapters: Chapter[];
}
