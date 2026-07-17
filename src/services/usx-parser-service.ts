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
} from '../model/book';
import { TestamentVerseCounts } from '../model/bible-verse-counts';
import path from 'path';

const alwaysArray = ['usx.para'];

function getElemText(e: any, name: string): string {
  return e[name]?.[0]?.['#text'];
}

function getElemTextGuarded(child: any): string {
  return Array.isArray(child?.['char']) && child['char'].length > 0
    ? getElemText(child, 'char')
    : '';
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

function appendWord(acc: string, str: string): string {
  if (acc !== '' && startsWithLetter(str)) {
    return `${acc} ${str}`;
  }
  return `${acc}${str}`;
}

export default class UsxParserService {
  private parser: XMLParser;
  private usxChildren: any[] = [];

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

  public static getUsxFiles(
    moduleId: string,
    chapterVerseCounts: TestamentVerseCounts | undefined
  ): string[] {
    if (!chapterVerseCounts) {
      return fs.globSync(`./assets/${moduleId}/*.usx`);
    }

    return Object.keys(chapterVerseCounts).map((bookCode: string) =>
      path.resolve('assets', moduleId, `${bookCode.toLowerCase()}.usx`)
    );
  }

  public parseBook(filename: string): Book {
    const xml: string = fs.readFileSync(filename, 'utf-8');
    const contents = this.parser.parse(xml);
    const usxAttr = contents.find((x: { [x: string]: any }) => !!x[':@']);
    const version = usxAttr?.[':@']?.['@_version'];
    if (version !== '3.0') {
      throw new Error('Only USX version 3.0 files are supported');
    }

    this.usxChildren = usxAttr?.['usx'];
    if (!this.usxChildren) {
      throw new Error('No usx children found.');
    }

    const usxBook = this.usxChildren.find(
      (x: { [x: string]: any }) => !!x['book']
    );

    const chapters = this.getChapters(this.usxChildren);

    return {
      name: getElemText(usxBook, 'book'),
      code: getElemAttr(usxBook, 'code') ?? '',
      header: getChildText(this.usxChildren, 'para', 'h'),
      toc1: getChildText(this.usxChildren, 'para', 'toc1'),
      toc2: getChildText(this.usxChildren, 'para', 'toc2'),
      toc3: getChildText(this.usxChildren, 'para', 'toc3'),
      mt1: getChildText(this.usxChildren, 'para', 'mt1'),
      chapters,
    };
  }

  public getRawVerseText(): { sid: string; text: string }[] {
    const paragraphs: any[] = this.usxChildren.filter(
      (node) => getBookChildType(node) === 'para'
    );

    const verses: { sid: string; text: string }[] = [];

    for (const para of paragraphs) {
      const paraChildren = para?.['para'];
      let activeSid = '';
      let activeText = '';
      for (const paraChild of paraChildren) {
        switch (getParaChildType(paraChild)) {
          case 'verse':
            activeSid = getElemAttr(paraChild, 'sid') ?? '';
            break;
          case 'w':
            activeText = appendWord(activeText, getElemTextGuarded(paraChild));
            break;
          case 'add':
            activeText = appendWord(activeText, getElemTextGuarded(paraChild));
            break;
          case 'text':
            activeText = appendWord(activeText, paraChild['#text'] as string);
            break;
          case 'verse-end':
            verses.push({
              sid: activeSid,
              text: activeText,
            });
            activeSid = '';
            activeText = '';
            break;
        }
      }
    }

    return verses;
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
    const txt = getElemTextGuarded(child);
    return {
      style: 'w',
      strong,
      txt,
    };
  }

  getTranslatorsAddition(child: any): TranslatorsAddition {
    const txt = getElemTextGuarded(child);
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
