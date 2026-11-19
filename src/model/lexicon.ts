/**
 * A lexicon module's content (docs/lexicon-format.md): its entries, and the
 * lookups that lead from a word in a Bible to an entry.
 */

/**
 * An item of an entry's body: text, or an element with a style, optional
 * string attributes, and children. Stored as JSON in entries.body, with
 * `style` first, attributes in name order, and `children` last.
 */
export type BodyItem = string | BodyElement;

export interface BodyElement {
  style: string;
  attributes: Record<string, string>;
  children: BodyItem[];
}

export interface LexiconEntry {
  /** Unique and stable between versions: "H7225", "G26", "BDB09078". */
  key: string;
  /** Exactly as the source gives it, never normalized. */
  headword: string;
  /** hbo, arc, or grc. */
  headwordLang: string;
  /** BDB's numbering of words spelled the same ("I.", "II."), or ''. */
  homograph: string;
  translit: string;
  pronunciation: string;
  /** BDB's dagger: every occurrence is cited. */
  allCited: boolean;
  body: BodyItem[];
}

export type LookupKind = 'strong' | 'lemma';

export interface Lookup {
  kind: LookupKind;
  value: string;
  entryKey: string;
}

export interface Lexicon {
  entries: LexiconEntry[];
  lookups: Lookup[];
}

/** The styles allowed at the top of a body, and anywhere inside one. */
export const TOP_STYLES = new Set([
  'deriv',
  'def',
  'kjv',
  'etym',
  'form',
  'note',
  'sense',
]);

/** Each inline style, with the attributes it may have. */
export const INLINE_STYLES: Record<string, string[]> = {
  em: [],
  tr: [],
  strong: [],
  sup: [],
  sub: [],
  usg: ['title'],
  foreign: ['lang'],
  ref: ['strong', 'key'],
  word: ['lang', 'translit', 'pronunciation'],
  bref: ['sid'],
};

/** Attributes allowed on top-level styles. */
export const TOP_ATTRIBUTES: Record<string, string[]> = {
  sense: ['n', 'level'],
};
