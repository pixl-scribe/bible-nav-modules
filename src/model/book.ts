/**
 * A word with a Strong's number.
 * See https://ubsicap.github.io/usx/charstyles.html#w
 */
export interface GlossaryWord {
  style: 'w';
  txt: string;
  strong: string;
}

/**
 * Styled text that can nest other inline content.
 * add: translator's addition, nd: name of deity,
 * tl: transliterated word, wj: words of Jesus.
 * See https://ubsicap.github.io/usx/charstyles.html
 */
export interface StyledText {
  style: 'add' | 'nd' | 'tl' | 'wj';
  children: Inline[];
}

export type Inline = string | GlossaryWord | StyledText;

export type NoteSegmentStyle = 'fr' | 'ft' | 'fk' | 'fq' | 'fqa' | 'fl' | 'fw';

export interface NoteSegment {
  style: NoteSegmentStyle;
  children: Inline[];
}

export interface Note {
  style: 'f';
  children: NoteSegment[];
}

export type VerseChild = Inline | Note;

export interface Verse {
  nbr: number;
  sid: string;
  children: VerseChild[];
  raw: string;
}

/**
 * Text between verses. d: Psalm title, s1: section heading or closing note.
 * See https://ubsicap.github.io/usx/parastyles.html
 */
export interface Heading {
  style: 'd' | 's1';
  children: Inline[];
  raw: string;
}

/**
 * style is the USX paragraph style. It decides the layout, for example
 * p: prose, q1: poetic line, b: blank line between stanzas.
 * See https://ubsicap.github.io/usx/parastyles.html
 */
export interface Paragraph {
  style: string;
  verses: Verse[];
  heading?: Heading;
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
  mt2?: string; // Secondary title.
  chapters: Chapter[];
}
