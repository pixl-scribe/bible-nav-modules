import fs from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import {
  BodyElement,
  BodyItem,
  Lexicon,
  LexiconEntry,
  Lookup,
} from '../model/lexicon';
import { normalizeStrong } from './strong-number';

/**
 * Reads a lexicon's TEI source file (docs/lexicon-format.md, "Source
 * files") into entries and lookups. Every element and attribute must be one
 * this reader knows, or it fails: nothing in the file is dropped unless
 * this code says so.
 *
 * Known so far, from the Strong's Hebrew converter:
 *   entry (xml:id, xml:lang="en")
 *     form type="lemma": orth (xml:lang), orth type="transliteration", pron
 *     etym                          -> body `deriv`
 *     sense: def                    -> body `def`
 *            note type="kjvRenderings" -> body `kjv`
 *     note type="sourceCorrection"  -> left out (the source editors' notes)
 *   inline: hi rend="italic" -> em; ref type="entry" target="#..." -> ref;
 *     mentioned -> word; choice -> its corr; note type="sourceCorrection"
 *     -> left out.
 */

/** A node from fast-xml-parser's ordered output. */
type XmlNode = { [name: string]: XmlNode[] | string | Attributes } & {
  ':@'?: Attributes;
};
type Attributes = Record<string, string>;

const TEXT = '#text';

function nameOf(node: XmlNode): string {
  const name = Object.keys(node).find((key) => key !== ':@');
  if (name === undefined) throw new Error('empty XML node');
  return name;
}

function childrenOf(node: XmlNode): XmlNode[] {
  return node[nameOf(node)] as XmlNode[];
}

function attrsOf(node: XmlNode): Attributes {
  return node[':@'] ?? {};
}

function isText(node: XmlNode): boolean {
  return nameOf(node) === TEXT;
}

function textOf(node: XmlNode): string {
  return node[TEXT] as string;
}

/** Elements only, failing on any text that isn't whitespace. */
function elements(node: XmlNode, where: string): XmlNode[] {
  return childrenOf(node).filter((child) => {
    if (!isText(child)) return true;
    if (textOf(child).trim() !== '') {
      throw new Error(`${where}: unexpected text "${textOf(child).trim()}"`);
    }
    return false;
  });
}

function expectAttrs(node: XmlNode, allowed: string[], where: string): void {
  for (const name of Object.keys(attrsOf(node))) {
    if (!allowed.includes(name)) {
      throw new Error(
        `${where}: <${nameOf(node)}> has unknown attribute ${name}`
      );
    }
  }
}

/** The text of an element that must hold text only. */
function plainText(node: XmlNode, where: string): string {
  return childrenOf(node)
    .map((child) => {
      if (!isText(child)) {
        throw new Error(`${where}: <${nameOf(node)}> must hold text only`);
      }
      return textOf(child);
    })
    .join('');
}

function element(
  style: string,
  attributes: Attributes,
  children: BodyItem[]
): BodyElement {
  return { style, attributes, children: joinText(children) };
}

/** Adjacent text joined into one item, empty text dropped. */
export function joinText(items: BodyItem[]): BodyItem[] {
  const joined: BodyItem[] = [];
  for (const item of items) {
    const last = joined[joined.length - 1];
    if (typeof item === 'string' && typeof last === 'string') {
      joined[joined.length - 1] = last + item;
    } else {
      joined.push(item);
    }
  }
  return joined.filter((item) => item !== '');
}

/** Links into another lexicon's file, which this lexicon can't check. */
const EXTERNAL = new WeakSet<BodyElement>();

function isSourceCorrection(node: XmlNode): boolean {
  return nameOf(node) === 'note' && attrsOf(node).type === 'sourceCorrection';
}

/** Inline content: text and the inline elements listed above. */
function inline(nodes: XmlNode[], where: string): BodyItem[] {
  const items: BodyItem[] = [];
  for (const node of nodes) {
    if (isText(node)) {
      items.push(textOf(node));
      continue;
    }
    const name = nameOf(node);
    const attrs = attrsOf(node);
    if (isSourceCorrection(node)) continue;
    if (name === 'hi') {
      if (attrs.rend !== 'italic' || Object.keys(attrs).length !== 1) {
        throw new Error(`${where}: <hi> must have rend="italic" only`);
      }
      items.push(element('em', {}, inline(childrenOf(node), where)));
    } else if (name === 'gloss') {
      expectAttrs(node, [], where);
      items.push(element('tr', {}, inline(childrenOf(node), where)));
    } else if (name === 'usg') {
      expectAttrs(node, ['bn:title'], where);
      const title = attrs['bn:title'];
      items.push(
        element('usg', title ? { title } : {}, inline(childrenOf(node), where))
      );
    } else if (name === 'ref' && attrs.type === 'lemma') {
      // A link to every entry with this headword (LS's homographs).
      expectAttrs(node, ['type', 'xml:lang', 'bn:lemma'], where);
      if (!attrs['bn:lemma']) {
        throw new Error(`${where}: <ref type="lemma"> without bn:lemma`);
      }
      items.push(
        element(
          'ref',
          { lemma: attrs['bn:lemma'] },
          inline(childrenOf(node), where)
        )
      );
    } else if (name === 'ref') {
      expectAttrs(
        node,
        ['type', 'target', 'xml:lang', 'bn:translit', 'bn:pron'],
        where
      );
      const hash = attrs.target?.indexOf('#') ?? -1;
      if (attrs.type !== 'entry' || hash < 0) {
        throw new Error(
          `${where}: <ref> must be type="entry" with target="#..." or "<file>#..."`
        );
      }
      const target = attrs.target.slice(hash + 1);
      const strong = normalizeStrong(target);
      const external = hash > 0;
      // A link into another lexicon's file must be a Strong's number, which
      // the app opens in a lexicon that has it.
      if (external && strong !== target) {
        throw new Error(
          `${where}: a link into another lexicon must be to a Strong's number`
        );
      }
      const ref = element(
        'ref',
        strong === target ? { strong } : { key: target },
        inline(childrenOf(node), where)
      );
      if (external) EXTERNAL.add(ref);
      items.push(ref);
    } else if (name === 'foreign') {
      expectAttrs(node, ['xml:lang'], where);
      if (!attrs['xml:lang']) {
        throw new Error(`${where}: <foreign> without xml:lang`);
      }
      items.push(
        element(
          'foreign',
          { lang: attrs['xml:lang'] },
          inline(childrenOf(node), where)
        )
      );
    } else if (name === 'mentioned') {
      expectAttrs(node, ['xml:lang', 'bn:translit', 'bn:pron'], where);
      if (!attrs['xml:lang']) {
        throw new Error(`${where}: <mentioned> without xml:lang`);
      }
      const wordAttrs: Attributes = { lang: attrs['xml:lang'] };
      if (attrs['bn:pron']) wordAttrs.pronunciation = attrs['bn:pron'];
      if (attrs['bn:translit']) wordAttrs.translit = attrs['bn:translit'];
      items.push(element('word', wordAttrs, inline(childrenOf(node), where)));
    } else if (name === 'choice') {
      expectAttrs(node, ['xml:id'], where);
      const parts = elements(node, where);
      const sic = parts.filter((part) => nameOf(part) === 'sic');
      const corr = parts.filter((part) => nameOf(part) === 'corr');
      if (sic.length !== 1 || corr.length !== 1 || parts.length !== 2) {
        throw new Error(
          `${where}: <choice> must hold one <sic> and one <corr>`
        );
      }
      items.push(...inline(childrenOf(corr[0]), where));
    } else {
      throw new Error(`${where}: unexpected <${name}> in the text`);
    }
  }
  return joinText(items);
}

function readEntry(node: XmlNode): LexiconEntry {
  const attrs = attrsOf(node);
  const key = attrs['xml:id'];
  const where = `entry ${key}`;
  if (!key) throw new Error('an entry has no xml:id');
  expectAttrs(node, ['xml:id', 'xml:lang', 'n', 'bn:strong'], where);
  if (attrs['xml:lang'] !== 'en') {
    throw new Error(`${where}: xml:lang must be "en"`);
  }
  const entry: LexiconEntry = {
    key,
    headword: '',
    headwordLang: '',
    homograph: attrs.n ?? '',
    translit: '',
    pronunciation: '',
    allCited: false,
    body: [],
  };
  /** The body's parts, in the order the TEI file gives them. */
  const parts: BodyElement[] = [];
  let haveForm = false;

  for (const child of elements(node, where)) {
    const name = nameOf(child);
    if (name === 'form') {
      if (haveForm || attrsOf(child).type !== 'lemma') {
        throw new Error(`${where}: one <form type="lemma"> expected`);
      }
      haveForm = true;
      for (const part of elements(child, where)) {
        const partAttrs = attrsOf(part);
        if (nameOf(part) === 'orth' && partAttrs.type === undefined) {
          expectAttrs(part, ['xml:lang'], where);
          // A corrected headword holds a <choice>; its text is the <corr>.
          entry.headword = inline(childrenOf(part), where)
            .map((item) => (typeof item === 'string' ? item : ''))
            .join('');
          entry.headwordLang = partAttrs['xml:lang'] ?? '';
        } else if (
          nameOf(part) === 'orth' &&
          partAttrs.type === 'transliteration'
        ) {
          expectAttrs(part, ['type'], where);
          entry.translit = plainText(part, where);
        } else if (nameOf(part) === 'pron') {
          expectAttrs(part, [], where);
          entry.pronunciation = plainText(part, where);
        } else {
          throw new Error(`${where}: unexpected <${nameOf(part)}> in <form>`);
        }
      }
    } else if (name === 'etym') {
      expectAttrs(child, [], where);
      parts.push(element('deriv', {}, inline(childrenOf(child), where)));
    } else if (name === 'sense' && isStrongsSense(child)) {
      // Strong's: a definition and the KJV renderings.
      expectAttrs(child, [], where);
      for (const part of elements(child, where)) {
        if (nameOf(part) === 'def') {
          expectAttrs(part, [], where);
          parts.push(element('def', {}, inline(childrenOf(part), where)));
        } else if (
          nameOf(part) === 'note' &&
          attrsOf(part).type === 'kjvRenderings'
        ) {
          expectAttrs(part, ['type'], where);
          parts.push(element('kjv', {}, inline(childrenOf(part), where)));
        } else {
          throw new Error(`${where}: unexpected <${nameOf(part)}> in <sense>`);
        }
      }
    } else if (name === 'sense') {
      // Liddell and Scott: a numbered sense holding its text.
      expectAttrs(child, ['n', 'bn:level'], where);
      const senseAttrs: Attributes = {};
      if (attrsOf(child).n) senseAttrs.n = attrsOf(child).n;
      if (attrsOf(child)['bn:level']) {
        senseAttrs.level = attrsOf(child)['bn:level'];
      }
      parts.push(
        element('sense', senseAttrs, inline(childrenOf(child), where))
      );
    } else if (isSourceCorrection(child)) {
      continue;
    } else if (name === 'note' && attrsOf(child).type === 'forms') {
      expectAttrs(child, ['type'], where);
      parts.push(element('form', {}, inline(childrenOf(child), where)));
    } else if (name === 'note' && attrsOf(child).type === 'comment') {
      expectAttrs(child, ['type'], where);
      parts.push(element('note', {}, inline(childrenOf(child), where)));
    } else {
      throw new Error(`${where}: unexpected <${name}> in an entry`);
    }
  }
  if (!entry.headword || !entry.headwordLang) {
    throw new Error(`${where}: no headword`);
  }
  entry.body = parts;
  STRONG_ATTRS.set(
    entry,
    (attrs['bn:strong'] ?? '').split(/\s+/).filter(Boolean)
  );
  return entry;
}

/** Strong's own bn:strong numbers, kept for lookupsFor. */
const STRONG_ATTRS = new WeakMap<LexiconEntry, string[]>();

/** Strong's senses hold only <def> and <note type="kjvRenderings">. */
function isStrongsSense(node: XmlNode): boolean {
  return (
    Object.keys(attrsOf(node)).length === 0 &&
    childrenOf(node).every((child) =>
      isText(child)
        ? textOf(child).trim() === ''
        : nameOf(child) === 'def' ||
          (nameOf(child) === 'note' && attrsOf(child).type === 'kjvRenderings')
    )
  );
}

/**
 * How a headword is looked up (docs/lexicon-format.md): Unicode NFC,
 * without breve or macron (editors' marks of vowel length), and without a
 * homograph number.
 */
export function lemmaForm(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[\u0304\u0306\d]/g, '')
    .normalize('NFC')
    .trim();
}

/**
 * An entry's lookups: its key, if that is a Strong's number (Strong's own
 * dictionaries); otherwise its headword, as a lemma, and the Strong's
 * numbers the TEI file gives it (bn:strong, in Liddell and Scott).
 * Strong's dictionaries get no lemma lookups, so their published keys
 * roots stay as they are.
 */
function lookupsFor(entry: LexiconEntry): Lookup[] {
  const strong = normalizeStrong(entry.key);
  if (strong === entry.key) {
    return [{ kind: 'strong', value: strong, entryKey: entry.key }];
  }
  const lookups: Lookup[] = [
    { kind: 'lemma', value: lemmaForm(entry.headword), entryKey: entry.key },
  ];
  for (const number of STRONG_ATTRS.get(entry) ?? []) {
    const normal = normalizeStrong(number);
    if (normal !== number) {
      throw new Error(
        `entry ${entry.key}: "${number}" is not a Strong's number`
      );
    }
    lookups.push({ kind: 'strong', value: normal, entryKey: entry.key });
  }
  return lookups;
}

/** Every link in a body leads to an entry, or this fails. */
function checkLinks(lexicon: Lexicon): void {
  const keys = new Set(lexicon.entries.map((entry) => entry.key));
  const strongs = new Set(
    lexicon.lookups.filter((l) => l.kind === 'strong').map((l) => l.value)
  );
  const lemmas = new Set(
    lexicon.lookups.filter((l) => l.kind === 'lemma').map((l) => l.value)
  );
  const visit = (items: BodyItem[], where: string) => {
    for (const item of items) {
      if (typeof item === 'string') continue;
      const { strong, key } = item.attributes;
      if (
        item.style === 'ref' &&
        strong !== undefined &&
        !EXTERNAL.has(item) &&
        !strongs.has(strong)
      ) {
        throw new Error(`${where}: link to ${strong}, which no entry has`);
      }
      if (item.style === 'ref' && key !== undefined && !keys.has(key)) {
        throw new Error(`${where}: link to entry ${key}, which doesn't exist`);
      }
      const { lemma } = item.attributes;
      if (item.style === 'ref' && lemma !== undefined && !lemmas.has(lemma)) {
        throw new Error(
          `${where}: link to headword ${lemma}, which no entry has`
        );
      }
      visit(item.children, where);
    }
  };
  for (const entry of lexicon.entries) visit(entry.body, `entry ${entry.key}`);
}

export function readTeiLexicon(xml: string): Lexicon {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    // Keep every space exactly, and every value as text.
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
  });
  const document = parser.parse(xml) as XmlNode[];
  const tei = document.find((node) => !isText(node) && nameOf(node) === 'TEI');
  if (!tei) throw new Error('not a TEI file');
  const text = elements(tei, 'TEI').find((node) => nameOf(node) === 'text');
  const body = text && elements(text, 'text').find((n) => nameOf(n) === 'body');
  if (!body) throw new Error('the TEI file has no <text><body>');

  const entries: LexiconEntry[] = [];
  const keys = new Set<string>();
  for (const node of elements(body, 'body')) {
    if (nameOf(node) !== 'entry') {
      throw new Error(`unexpected <${nameOf(node)}> in <body>`);
    }
    const entry = readEntry(node);
    if (keys.has(entry.key)) throw new Error(`two entries ${entry.key}`);
    keys.add(entry.key);
    entries.push(entry);
  }
  const lexicon = { entries, lookups: entries.flatMap(lookupsFor) };
  checkLinks(lexicon);
  return lexicon;
}

export function readTeiLexiconFile(file: string): Lexicon {
  return readTeiLexicon(fs.readFileSync(file, 'utf8'));
}
