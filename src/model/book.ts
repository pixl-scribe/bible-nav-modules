export interface Chapter {
  number: number;
  sid: string;
}

export interface Paragraph {
  style: string;
  text: string;
}

/*
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
  children: (Paragraph | Chapter)[];
}
