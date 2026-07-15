/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import {
  Book,
  Chapter,
  GlossaryWord,
  Note,
  NoteSegment,
  Paragraph,
  TranslatorsAddition,
  Verse,
  VerseChild,
} from './model/book';

const alwaysArray = ['usx.para'];

function getElemText(e: any, name: string): string {
  return e[name]?.[0]?.['#text'];
}

function getElemAttr(e: any, attr: string): string | undefined {
  return e?.[':@']?.[`@_${attr}`];
}

function getChildText(nodes: any[], name: string, withStyle: string) {
  const elem = nodes.find(
    (x: { [x: string]: any }) => !!x[name] && x[':@']?.['@_style'] === withStyle
  );
  return getElemText(elem, name);
}

function getBookChildType(child: any): 'chapter' | 'para' | null {
  if (child?.['chapter'] !== undefined && child?.[':@']?.['@_style'] === 'c') {
    return 'chapter';
  }
  if (child?.['para'] !== undefined) return 'para';
  return null;
}

function getParaChildType(
  child: any
): 'text' | 'w' | 'add' | 'verse' | 'verse-end' | 'note' | null {
  if (child?.['char'] !== undefined && getElemAttr(child, 'style') === 'w') {
    return 'w';
  }
  if (child?.['char'] !== undefined && getElemAttr(child, 'style') === 'add') {
    return 'add';
  }
  if (child?.['#text'] !== undefined) return 'text';
  if (child?.['verse'] !== undefined) {
    if (getElemAttr(child, 'eid') !== undefined) return 'verse-end';
    return 'verse';
  }
  if (child?.['note'] !== undefined) return 'note';
  return null;
}

function startsWithLetter(str: string): boolean {
  return /^[a-zA-Z]/.test(str);
}

export default class UsxParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      ignoreDeclaration: true, // removes '?xml' declarations
      preserveOrder: true,
      trimValues: true,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      isArray: (_tagName, jPathOrMatcher, _isLeafNode, _isAttribute) => {
        return alwaysArray.indexOf(jPathOrMatcher as string) !== -1;
      },
    });
  }

  public static getUsxFiles(moduleId: string): string[] {
    return fs.globSync(`./assets/${moduleId}/*.usx`);
  }

  public parseBook(filename: string): Book {
    const xml: string = fs.readFileSync(filename, 'utf-8');
    const contents = this.parser.parse(xml);
    const usxAttr = contents.find((x: { [x: string]: any }) => !!x[':@']);
    const version = usxAttr?.[':@']?.['@_version'];
    if (version !== '3.0') {
      throw new Error('Only USX version 3.0 files are supported');
    }

    const usxChildren: any[] = usxAttr?.['usx'];
    if (!usxChildren) {
      throw new Error('No usx children found.');
    }

    const usxBook = usxChildren.find((x: { [x: string]: any }) => !!x['book']);

    const chapters = this.getChapters(usxChildren);

    return {
      name: getElemText(usxBook, 'book'),
      code: getElemAttr(usxBook, 'code') ?? '',
      header: getChildText(usxChildren, 'para', 'h'),
      toc1: getChildText(usxChildren, 'para', 'toc1'),
      toc2: getChildText(usxChildren, 'para', 'toc2'),
      toc3: getChildText(usxChildren, 'para', 'toc3'),
      mt1: getChildText(usxChildren, 'para', 'mt1'),
      chapters,
    };
  }

  private getChapters(bookChildren: any[]): Chapter[] {
    // console.log(JSON.stringify(bookChildren, null, 2));
    const chapters: Chapter[] = [];
    let currentChapter: Chapter | undefined = undefined;
    let paragraphs: Paragraph[] = [];
    for (const bookChild of bookChildren) {
      switch (getBookChildType(bookChild)) {
        case 'para':
          paragraphs.push(this.getParagraph(bookChild));
          break;
        case 'chapter':
          if (currentChapter) {
            currentChapter.paragraphs = paragraphs;
            chapters.push(currentChapter);
          }
          currentChapter = this.getChapter(bookChild);
          paragraphs = [];
          break;
      }
    }
    if (currentChapter) {
      currentChapter.paragraphs = paragraphs;
      chapters.push(currentChapter);
    }
    return chapters;
  }

  getChapter(chapterNode: any): Chapter {
    const nbr = parseInt(getElemAttr(chapterNode, 'number') ?? '');
    const sid = getElemAttr(chapterNode, 'sid') ?? '';
    return {
      nbr,
      sid,
      paragraphs: [],
    };
  }

  getParagraph(para: any): Paragraph {
    const paraChildren = para?.['para'];
    const paragraph: Paragraph = { verses: [] };
    let verseChildren: VerseChild[] = [];
    let activeVerse: Verse | undefined;
    for (const paraChild of paraChildren) {
      switch (getParaChildType(paraChild)) {
        case 'verse':
          activeVerse = this.initVerse(paraChild);
          break;
        case 'w':
          verseChildren.push(this.getGlossaryWord(paraChild));
          break;
        case 'add':
          verseChildren.push(this.getTranslatorsAddition(paraChild));
          break;
        case 'text':
          verseChildren.push(paraChild['#text'] as string);
          break;
        case 'note':
          verseChildren.push(this.getNote(paraChild));
          break;
        case 'verse-end':
          if (activeVerse) {
            activeVerse = this.decorateVerse(activeVerse, verseChildren);
            paragraph.verses.push(activeVerse);
          }
          activeVerse = undefined;
          verseChildren = [];
          break;
      }
    }
    return paragraph;
  }

  getGlossaryWord(child: any): GlossaryWord {
    const strong = getElemAttr(child, 'strong') ?? '';
    const txt =
      Array.isArray(child?.['char']) && child['char'].length > 0
        ? getElemText(child, 'char')
        : '';
    return {
      style: 'w',
      strong,
      txt,
    };
  }

  getTranslatorsAddition(child: any): TranslatorsAddition {
    const txt =
      Array.isArray(child?.['char']) && child['char'].length > 0
        ? getElemText(child, 'char')
        : '';
    return {
      style: 'add',
      txt,
    };
  }

  getNote(child: any): Note {
    const children: NoteSegment[] =
      child?.['note'].map((n: any) => ({
        style: getElemAttr(n, 'style'),
        txt: getElemText(n, 'char'),
      })) ?? [];
    return {
      style: 'f',
      children,
    };
  }

  initVerse(verseNode: any): Verse {
    const nbr = parseInt(getElemAttr(verseNode, 'number') ?? '');
    const sid = getElemAttr(verseNode, 'sid') ?? '';

    return {
      nbr,
      sid,
      children: [],
      raw: '',
    };
  }

  decorateVerse(verse: Verse, children: VerseChild[]): Verse {
    const raw = children
      .reduce((acc: string, child: VerseChild) => {
        if (typeof child === 'string') {
          const sep = startsWithLetter(child) ? ' ' : '';
          return `${acc}${sep}${child}`;
        }
        if (child.style === 'add' || child.style === 'w') {
          return `${acc} ${child.txt}`;
        }
        return acc;
      }, '')
      .trim();

    verse.children = children;
    verse.raw = raw;
    return verse;
  }
}
