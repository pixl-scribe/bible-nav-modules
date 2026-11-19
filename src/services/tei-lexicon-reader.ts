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
    } else if (name === 'ref') {
      expectAttrs(
        node,
        ['type', 'target', 'xml:lang', 'bn:translit', 'bn:pron'],
        where
      );
      if (attrs.type !== 'entry' || !attrs.target?.startsWith('#')) {
        throw new Error(
          `${where}: <ref> must be type="entry" with target="#..."`
        );
      }
      const target = attrs.target.slice(1);
      const strong = normalizeStrong(target);
      items.push(
        element(
          'ref',
          strong === target ? { strong } : { key: target },
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
  expectAttrs(node, ['xml:id', 'xml:lang'], where);
  if (attrs['xml:lang'] !== 'en') {
    throw new Error(`${where}: xml:lang must be "en"`);
  }
  const entry: LexiconEntry = {
    key,
    headword: '',
    headwordLang: '',
    homograph: '',
    translit: '',
    pronunciation: '',
    allCited: false,
    body: [],
  };
  let deriv: BodyElement | undefined;
  let def: BodyElement | undefined;
  let kjv: BodyElement | undefined;
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
          entry.headword = plainText(part, where);
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
      if (deriv) throw new Error(`${where}: two <etym>`);
      deriv = element('deriv', {}, inline(childrenOf(child), where));
    } else if (name === 'sense') {
      expectAttrs(child, [], where);
      for (const part of elements(child, where)) {
        if (nameOf(part) === 'def' && !def) {
          expectAttrs(part, [], where);
          def = element('def', {}, inline(childrenOf(part), where));
        } else if (
          nameOf(part) === 'note' &&
          attrsOf(part).type === 'kjvRenderings' &&
          !kjv
        ) {
          expectAttrs(part, ['type'], where);
          kjv = element('kjv', {}, inline(childrenOf(part), where));
        } else {
          throw new Error(`${where}: unexpected <${nameOf(part)}> in <sense>`);
        }
      }
    } else if (isSourceCorrection(child)) {
      continue;
    } else {
      throw new Error(`${where}: unexpected <${name}> in an entry`);
    }
  }
  if (!entry.headword || !entry.headwordLang) {
    throw new Error(`${where}: no headword`);
  }
  entry.body = [deriv, def, kjv].filter(
    (part): part is BodyElement => part !== undefined
  );
  return entry;
}

/** The lookups an entry gets from its key: its Strong's number, if it is one. */
function lookupsFor(entry: LexiconEntry): Lookup[] {
  const strong = normalizeStrong(entry.key);
  return strong === entry.key
    ? [{ kind: 'strong', value: strong, entryKey: entry.key }]
    : [];
}

/** Every link in a body leads to an entry, or this fails. */
function checkLinks(lexicon: Lexicon): void {
  const keys = new Set(lexicon.entries.map((entry) => entry.key));
  const strongs = new Set(
    lexicon.lookups.filter((l) => l.kind === 'strong').map((l) => l.value)
  );
  const visit = (items: BodyItem[], where: string) => {
    for (const item of items) {
      if (typeof item === 'string') continue;
      const { strong, key } = item.attributes;
      if (
        item.style === 'ref' &&
        strong !== undefined &&
        !strongs.has(strong)
      ) {
        throw new Error(`${where}: link to ${strong}, which no entry has`);
      }
      if (item.style === 'ref' && key !== undefined && !keys.has(key)) {
        throw new Error(`${where}: link to entry ${key}, which doesn't exist`);
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
