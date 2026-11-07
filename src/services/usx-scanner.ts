/**
 * Reads USX with a simple tag scanner, for ModuleVerifierService to compare
 * against a generated module.
 *
 * This deliberately shares no code with UsxParserService, and should never be
 * merged with it. A bug in the parser can only pass verification if the same
 * bug is written a second time here.
 */

export interface ScannedBlock {
  text: string; // Reading text, without footnotes.
  markup: string; // Every tag and word, including footnotes, without spaces.
  notes: string[]; // The text of each footnote part.
}

export interface ScannedHeading extends ScannedBlock {
  style: string;
  afterSid: string; // The verse this text follows, '' if it comes first.
}

/** A paragraph's place in the layout. */
export interface ParagraphLayout {
  style: string;
  chapter: number;
  sids: string[]; // The verses that start in this paragraph.
  heading: boolean;
}

export interface ScannedBook {
  verses: Map<string, ScannedBlock>;
  headings: ScannedHeading[];
  paragraphs: ParagraphLayout[];
  fields: Record<string, string>;
}

const FIELD_PARAGRAPHS = new Set(['h', 'toc1', 'toc2', 'toc3', 'mt1', 'mt2']);
const HEADING_PARAGRAPHS = new Set(['d', 's1']);

export const collapse = (text: string): string =>
  text.replace(/\s+/g, ' ').trim();

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readAttr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

function newBlock(): ScannedBlock {
  return { text: '', markup: '', notes: [] };
}

/**
 * Reads one USX file. Text must be in a verse, a heading, or a known field,
 * otherwise an error is reported instead of the text being ignored.
 */
export function scanUsx(
  xml: string,
  previousSid: string,
  errors: string[]
): ScannedBook {
  const book: ScannedBook = {
    verses: new Map(),
    headings: [],
    paragraphs: [],
    fields: {},
  };
  let chapter: number | undefined;
  let layout: ParagraphLayout | undefined;
  let paraStyle: string | undefined;
  let field = '';
  let inBookTag = false;
  let verse: ScannedBlock | undefined;
  let heading: ScannedHeading | undefined;
  let lastSid = previousSid;
  let noteDepth = 0;
  let segment = '';
  const charStack: string[] = [];

  for (const [token] of xml.matchAll(/<[^>]+>|[^<]+/g)) {
    if (!token.startsWith('<')) {
      const text = decodeXml(token);
      const target = verse ?? heading;
      if (inBookTag) {
        book.fields.name = (book.fields.name ?? '') + text;
      } else if (target) {
        target.markup += text;
        if (noteDepth > 0) segment += text;
        else target.text += text;
      } else if (paraStyle && FIELD_PARAGRAPHS.has(paraStyle)) {
        field += text;
      } else if (text.trim() !== '') {
        errors.push(`USX text outside any known place: "${text.trim()}"`);
      }
      continue;
    }
    if (token.startsWith('<?') || token.startsWith('<!')) continue;

    const closing = token.startsWith('</');
    const selfClosing = token.endsWith('/>');
    const name = /^<\/?([\w-]+)/.exec(token)?.[1] ?? '';
    const style = readAttr(token, 'style') ?? '';
    const target = verse ?? heading;

    if (name === 'book') {
      inBookTag = !closing;
    } else if (name === 'chapter') {
      const number = readAttr(token, 'number');
      if (number !== undefined) chapter = parseInt(number);
    } else if (name === 'para') {
      if (!closing && chapter !== undefined) {
        layout = {
          style,
          chapter,
          sids: [],
          heading: HEADING_PARAGRAPHS.has(style),
        };
        book.paragraphs.push(layout);
      }
      if (closing || selfClosing) {
        if (paraStyle && FIELD_PARAGRAPHS.has(paraStyle)) {
          book.fields[paraStyle] = collapse(field);
        }
        if (heading) book.headings.push(heading);
        heading = undefined;
        paraStyle = undefined;
        field = '';
      } else {
        paraStyle = style;
        if (HEADING_PARAGRAPHS.has(style)) {
          heading = { ...newBlock(), style, afterSid: lastSid };
        }
      }
    } else if (name === 'verse') {
      const sid = readAttr(token, 'sid');
      if (sid !== undefined) {
        verse = newBlock();
        book.verses.set(sid, verse);
        layout?.sids.push(sid);
        lastSid = sid;
      } else {
        verse = undefined;
      }
    } else if (name === 'note') {
      if (closing) {
        noteDepth = 0;
        if (target) target.markup += '{/f}';
      } else {
        noteDepth = 1;
        if (target) target.markup += '{f}';
      }
    } else if (name === 'char') {
      if (closing) {
        const open = charStack.pop() ?? '';
        if (target) target.markup += `{/${open}}`;
        if (noteDepth > 0 && charStack.length === 0) {
          target?.notes.push(collapse(segment));
          segment = '';
        }
      } else {
        charStack.push(style);
        const strong = readAttr(token, 'strong');
        if (target) target.markup += `{${style}${strong ? `:${strong}` : ''}}`;
      }
    }
  }
  return book;
}
