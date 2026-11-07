import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import {
  Book,
  Chapter,
  Heading,
  Inline,
  Note,
  NoteSegment,
  NoteSegmentStyle,
  Paragraph,
  StyledText,
  Verse,
  VerseChild,
} from '../model/book';
import { TestamentVerseCounts } from '../model/bible-verse-counts';

/**
 * A node from fast-xml-parser's preserveOrder output: a tag name mapped to its
 * child nodes, '#text' mapped to a string, and ':@' mapped to the attributes.
 */
type XmlNode = Record<string, unknown>;

const STYLED_TEXT = new Set<string>(['add', 'nd', 'tl', 'wj']);
const NOTE_SEGMENTS = new Set<string>([
  'fr',
  'ft',
  'fk',
  'fq',
  'fqa',
  'fl',
  'fw',
]);
const FRONT_MATTER = new Set(['h', 'toc1', 'toc2', 'toc3', 'mt1', 'mt2']);
const VERSE_PARAGRAPHS = new Set(['p', 'q1']);
const HEADING_PARAGRAPHS = new Set(['d', 's1']);
// b is a blank line, such as between stanzas. It holds no text.
const EMPTY_PARAGRAPHS = new Set(['b']);

function attr(node: XmlNode, name: string): string | undefined {
  const attrs = node[':@'] as Record<string, string> | undefined;
  return attrs?.[`@_${name}`];
}

function tagOf(node: XmlNode): string {
  const tag = Object.keys(node).find((key) => key !== ':@');
  return tag ?? '';
}

function childrenOf(node: XmlNode): XmlNode[] {
  return node[tagOf(node)] as XmlNode[];
}

function isBlankText(node: XmlNode): boolean {
  return tagOf(node) === '#text' && (node['#text'] as string).trim() === '';
}

function isNote(child: VerseChild): child is Note {
  return typeof child === 'object' && child.style === 'f';
}

/**
 * The reading text of inline content, without footnotes. This is the only
 * source of verse text: both verses.raw and the checksums come from it.
 */
export function plainText(children: VerseChild[]): string {
  return children
    .map((child) => {
      if (typeof child === 'string') return child;
      if (isNote(child)) return '';
      if (child.style === 'w') return child.txt;
      return plainText(child.children);
    })
    .join('');
}

/**
 * Collapses whitespace so the pieces can be joined directly, with one space
 * between words, no matter which nesting level the space came from.
 */
function normalizeInlines<T extends VerseChild>(
  children: T[],
  state: { atSpace: boolean } = { atSpace: true }
): T[] {
  const collapse = (text: string): string => {
    const collapsed = text.replace(/\s+/g, ' ');
    const result =
      state.atSpace && collapsed.startsWith(' ')
        ? collapsed.slice(1)
        : collapsed;
    if (result !== '') state.atSpace = result.endsWith(' ');
    return result;
  };

  const normalized: T[] = [];
  for (const item of children) {
    const child: VerseChild = item;
    if (typeof child === 'string') {
      const text = collapse(child);
      if (text !== '') normalized.push(text as T);
    } else if (isNote(child)) {
      normalized.push(child as T);
    } else if (child.style === 'w') {
      normalized.push({ ...child, txt: collapse(child.txt) } as T);
    } else {
      normalized.push({
        ...child,
        children: normalizeInlines(child.children, state),
      } as T);
    }
  }
  return normalized;
}

/**
 * Removes trailing whitespace, looking through footnotes and nested content.
 */
function trimEnd<T extends VerseChild>(children: T[]): T[] {
  const result = [...children];
  for (let i = result.length - 1; i >= 0; i--) {
    const child: VerseChild = result[i];
    if (typeof child === 'string') {
      const text = child.trimEnd();
      if (text === '') {
        result.splice(i, 1);
        continue;
      }
      result[i] = text as T;
    } else if (isNote(child)) {
      continue;
    } else if (child.style === 'w') {
      result[i] = { ...child, txt: child.txt.trimEnd() } as T;
    } else {
      const inner = trimEnd(child.children);
      if (inner.length === 0) {
        result.splice(i, 1);
        continue;
      }
      result[i] = { ...child, children: inner } as T;
    }
    break;
  }
  return result;
}

function normalize<T extends VerseChild>(children: T[]): T[] {
  return trimEnd(normalizeInlines(children));
}

export default class UsxParserService {
  private parser: XMLParser;
  private location = '';

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      ignoreDeclaration: true, // removes '?xml' declarations
      preserveOrder: true,
      // Keep the source's spacing, and keep text such as 'false' and '4.10'
      // as text instead of converting it to a boolean or number.
      trimValues: false,
      parseTagValue: false,
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
    return this.parseBookXml(fs.readFileSync(filename, 'utf-8'), filename);
  }

  public parseBookXml(xml: string, source: string = 'USX'): Book {
    this.location = source;
    const contents = this.parser.parse(xml) as XmlNode[];
    const usx = contents.find((node) => tagOf(node) === 'usx');
    if (!usx) this.fail('no usx element found');
    if (attr(usx, 'version') !== '3.0') {
      this.fail('only USX version 3.0 files are supported');
    }

    const book: Book = {
      name: '',
      code: '',
      header: '',
      toc1: '',
      toc2: '',
      toc3: '',
      mt1: '',
      chapters: [],
    };
    let chapter: Chapter | undefined;

    for (const node of childrenOf(usx)) {
      if (isBlankText(node)) continue;
      const tag = tagOf(node);
      if (tag === 'book') {
        book.code = attr(node, 'code') ?? this.fail('book has no code');
        this.location = book.code;
        book.name = this.plainElementText(node);
      } else if (tag === 'chapter') {
        if (attr(node, 'eid') !== undefined) continue;
        chapter = this.parseChapter(node);
        book.chapters.push(chapter);
        this.location = chapter.sid;
      } else if (tag === 'para') {
        if (chapter) {
          chapter.paragraphs.push(this.parseParagraph(node));
        } else {
          this.parseFrontMatter(node, book);
        }
      } else {
        this.fail(`unknown element <${tag}> in the book body`);
      }
    }
    return book;
  }

  private parseChapter(node: XmlNode): Chapter {
    const sid = attr(node, 'sid');
    const nbr = parseInt(attr(node, 'number') ?? '');
    if (!sid || Number.isNaN(nbr)) this.fail('chapter needs a sid and number');
    return { nbr, sid, paragraphs: [] };
  }

  private parseFrontMatter(node: XmlNode, book: Book): void {
    const style = attr(node, 'style') ?? '';
    if (!FRONT_MATTER.has(style)) {
      this.fail(`paragraph style "${style}" before the first chapter`);
    }
    const text = this.plainElementText(node);
    if (style === 'h') book.header = text;
    else book[style as 'toc1' | 'toc2' | 'toc3' | 'mt1' | 'mt2'] = text;
  }

  /**
   * Reads an element that must contain nothing but text.
   */
  private plainElementText(node: XmlNode): string {
    return childrenOf(node)
      .map((child) => {
        if (tagOf(child) !== '#text') {
          this.fail(`unexpected <${tagOf(child)}> in <${tagOf(node)}>`);
        }
        return child['#text'] as string;
      })
      .join('')
      .trim();
  }

  private parseParagraph(node: XmlNode): Paragraph {
    const style = attr(node, 'style') ?? '';
    if (VERSE_PARAGRAPHS.has(style)) {
      return { style, verses: this.parseVerses(node) };
    }
    if (HEADING_PARAGRAPHS.has(style)) {
      return { style, verses: [], heading: this.parseHeading(node, style) };
    }
    if (EMPTY_PARAGRAPHS.has(style)) {
      if (childrenOf(node).some((child) => !isBlankText(child))) {
        this.fail(`paragraph style "${style}" should be empty`);
      }
      return { style, verses: [] };
    }
    this.fail(`unknown paragraph style "${style}"`);
  }

  private parseHeading(node: XmlNode, style: string): Heading {
    const children = normalize(
      childrenOf(node).map((child) => this.parseInline(child))
    );
    return {
      style: style as Heading['style'],
      children,
      raw: plainText(children),
    };
  }

  private parseVerses(para: XmlNode): Verse[] {
    const verses: Verse[] = [];
    let active: Verse | undefined;
    let children: VerseChild[] = [];

    for (const node of childrenOf(para)) {
      const tag = tagOf(node);
      if (tag === 'verse') {
        const eid = attr(node, 'eid');
        if (eid !== undefined) {
          if (!active || active.sid !== eid) {
            this.fail(`verse end "${eid}" has no matching start`);
          }
          const normalized = normalize(children);
          active.children = normalized;
          active.raw = plainText(normalized);
          verses.push(active);
          active = undefined;
          children = [];
        } else {
          if (active) this.fail(`verse started inside "${active.sid}"`);
          active = this.startVerse(node);
          this.location = active.sid;
        }
      } else if (isBlankText(node) && !active) {
        continue;
      } else if (!active) {
        this.fail(`text or <${tag}> outside of a verse`);
      } else if (tag === 'note') {
        children.push(this.parseNote(node));
      } else {
        children.push(this.parseInline(node));
      }
    }
    if (active) this.fail(`verse "${active.sid}" spans two paragraphs`);
    return verses;
  }

  private startVerse(node: XmlNode): Verse {
    const sid = attr(node, 'sid');
    const nbr = parseInt(attr(node, 'number') ?? '');
    if (!sid || Number.isNaN(nbr)) this.fail('verse needs a sid and number');
    return { nbr, sid, children: [], raw: '' };
  }

  private parseInline(node: XmlNode): Inline {
    const tag = tagOf(node);
    if (tag === '#text') return node['#text'] as string;
    if (tag !== 'char') this.fail(`unknown inline element <${tag}>`);

    const style = attr(node, 'style') ?? '';
    if (style === 'w') {
      const strong = attr(node, 'strong');
      const txt = this.plainElementText(node);
      if (!strong || txt === '') this.fail('word needs a strong and text');
      return { style: 'w', strong, txt };
    }
    if (STYLED_TEXT.has(style)) {
      return {
        style: style as StyledText['style'],
        children: childrenOf(node).map((child) => this.parseInline(child)),
      };
    }
    this.fail(`unknown character style "${style}"`);
  }

  private parseNote(node: XmlNode): Note {
    const style = attr(node, 'style');
    if (style !== 'f') this.fail(`unknown note style "${style}"`);
    const children: NoteSegment[] = [];
    for (const child of childrenOf(node)) {
      if (isBlankText(child)) continue;
      const segment = attr(child, 'style') ?? '';
      if (tagOf(child) !== 'char' || !NOTE_SEGMENTS.has(segment)) {
        this.fail(`unknown footnote content "${tagOf(child)} ${segment}"`);
      }
      children.push({
        style: segment as NoteSegmentStyle,
        children: normalize(
          childrenOf(child).map((inner) => this.parseInline(inner))
        ),
      });
    }
    return { style: 'f', children };
  }

  private fail(message: string): never {
    throw new Error(`${this.location}: ${message}`);
  }
}
