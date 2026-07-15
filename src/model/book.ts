/**
 * See https://ubsicap.github.io/usx/charstyles.html#add
 */
export interface TranslatorsAddition {
  style: 'add';
  txt: string;
}

/**
 * See https://ubsicap.github.io/usx/charstyles.html#w
 */
export interface GlossaryWord {
  style: 'w';
  txt: string;
  strong: string;
}

export type NoteSegmentStyle = 'fr' | 'ft' | 'fk' | 'fq' | 'fqa' | 'fl' | 'fw';

export interface NoteSegment {
  style: NoteSegmentStyle;
  txt: string;
}

export interface Note {
  style: 'f';
  children: NoteSegment[];
}

export type VerseChild = string | GlossaryWord | TranslatorsAddition | Note;

export interface Verse {
  nbr: number;
  sid: string;
  children: VerseChild[];
  raw: string;
}

export interface Paragraph {
  verses: Verse[];
}

export interface Chapter {
  nbr: number;
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
