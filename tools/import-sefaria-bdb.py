#!/usr/bin/env python3
"""
Converts Sefaria's Brown-Driver-Briggs (assets/eng_bdb/source/bdb.json,
kept exactly as received) into the TEI file the generator reads,
assets/eng_bdb/eng_bdb.tei.xml (docs/lexicon-format.md).

    tools/venv/bin/python -I tools/import-sefaria-bdb.py

What it does, entry by entry, in BDB's order (Sefaria's ids, the Hebrew
part then the Aramaic):

- The headword, BDB's homograph number (Sefaria's `ordinal`), its dagger
  (`all_cited`), double dagger (`peculiar`), brackets (`brackets`) and
  occurrence count (`occurrences`), and Sefaria's `root` flag, become the
  entry's form and attributes. `headword_suffix` ("or ...") becomes a forms
  note; `alt_headwords`, other spellings printed on the headword line
  (some with their own count), become variant forms.
- Sefaria's nested senses are written flat, in reading order, each with its
  level (1 for the outermost), number, verb stem (`form`: Qal, Niph. ...),
  dagger, the words printed before its number (`pre_num`) and its count.
  A sense Sefaria marks as a note becomes a note.
- Sefaria's HTML becomes TEI: strong, em, sup, sub and big as hi; br as
  lb; a right-to-left span as foreign, its language from its script;
  scripture links as ref type="bible" with the verse BDB printed (bn:sid);
  links to other entries ("BDB, ...") as ref type="entry". Hebrew, Greek,
  Syriac, Arabic, Ethiopic and Samaritan words outside a span are marked
  as foreign too, so the app can choose a font and direction; nothing in
  the text changes.
- Strong's numbers (bn:strong) come from Open Scriptures' lexical index
  (assets/eng_bdb/source/oshb/LexicalIndex.xml), which gives them entry by
  entry; Sefaria's own `strong_numbers`, given to whole groups of related
  entries, are used only for numbers the index doesn't place.
- corrections.yaml, corrections-letters.yaml and corrections-meant.yaml
  are applied and marked
  with choice/sic/corr, bn:meant, or a note (see those files).

Left out: GK and TWOT numbers, Sefaria's `quotes`, `prev_hw`/`next_hw`,
`_id`, and links to books outside the Hebrew Bible (Ben Sira, Maccabees),
whose text is kept. It stops on any field, tag or attribute it doesn't
know, and on any correction that doesn't apply exactly.
"""
import hashlib
import html
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

HERE = Path('assets/eng_bdb')
SOURCE = HERE / 'source' / 'bdb.json'
INDEX = HERE / 'source' / 'oshb' / 'LexicalIndex.xml'
OUT = HERE / 'eng_bdb.tei.xml'
REVIEW = HERE / 'strongs-review.md'

HEBREW_PART = 'BDB Dictionary'
ARAMAIC_PART = 'BDB Aramaic Dictionary'

BOOKS = {
    'Genesis': 'GEN', 'Exodus': 'EXO', 'Leviticus': 'LEV', 'Numbers': 'NUM',
    'Deuteronomy': 'DEU', 'Joshua': 'JOS', 'Judges': 'JDG', 'Ruth': 'RUT',
    'I Samuel': '1SA', 'II Samuel': '2SA', 'I Kings': '1KI', 'II Kings': '2KI',
    'I Chronicles': '1CH', 'II Chronicles': '2CH', 'Ezra': 'EZR',
    'Nehemiah': 'NEH', 'Esther': 'EST', 'Job': 'JOB', 'Psalms': 'PSA',
    'Proverbs': 'PRO', 'Ecclesiastes': 'ECC', 'Song of Songs': 'SNG',
    'Isaiah': 'ISA', 'Jeremiah': 'JER', 'Lamentations': 'LAM',
    'Ezekiel': 'EZK', 'Daniel': 'DAN', 'Hosea': 'HOS', 'Joel': 'JOL',
    'Amos': 'AMO', 'Obadiah': 'OBA', 'Jonah': 'JON', 'Micah': 'MIC',
    'Nahum': 'NAM', 'Habakkuk': 'HAB', 'Zephaniah': 'ZEP', 'Haggai': 'HAG',
    'Zechariah': 'ZEC', 'Malachi': 'MAL',
}
ONE_CHAPTER = {'OBA'}
# Links to books outside the Hebrew Bible: their text is kept, the link not.
OTHER_BOOKS = ('Ben Sira', 'The Book of Maccabees')

ENTRY_FIELDS = {'_id', 'headword', 'parent_lexicon', 'content', 'rid', 'strong_numbers', 'quotes', 'GK',
                'TWOT', 'next_hw', 'prev_hw', 'all_cited', 'brackets', 'root', 'ordinal', 'alt_headwords',
                'occurrences', 'headword_suffix', 'peculiar'}
SENSE_FIELDS = {'senses', 'num', 'definition', 'form', 'note', 'all_cited', 'pre_num', 'occurrences'}

# Scripts, for the language of a foreign word.
SCRIPTS = (
    ('hbo', '\u0591-\u05f4\ufb1d-\ufb4f'),
    ('grc', '\u0370-\u03ff\u1f00-\u1fff'),
    ('syc', '\u0700-\u074f'),
    ('ar', '\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff'),
    ('gez', '\u1200-\u139f'),
    ('smp', '\u0800-\u083f'),
)
MARKS = '\u0300-\u036f'


def script_of(text):
    counts = {}
    for code, ranges in SCRIPTS:
        counts[code] = len(re.findall(f'[{ranges}]', text))
    best = max(counts, key=counts.get)
    return best if counts[best] else None


# A run of one script's words outside a span: letters and marks, with
# spaces, maqaf, geresh and the like between words of the same script.
RUNS = re.compile('|'.join(
    f'(?P<{code}>[{ranges}][{ranges}{MARKS}]*(?:[ \u05be\u2019\'-]+[{ranges}][{ranges}{MARKS}]*)*)'
    for code, ranges in SCRIPTS))

TEI = 'http://www.tei-c.org/ns/1.0'
BN = 'https://biblenav.org/ns/lexicon/1'
XML = 'http://www.w3.org/XML/1998/namespace'
ET.register_namespace('', TEI)
ET.register_namespace('bn', BN)


def t(name):
    return f'{{{TEI}}}{name}'


def bn(name):
    return f'{{{BN}}}{name}'


def xml(name):
    return f'{{{XML}}}{name}'


class Fail(Exception):
    pass


# ---------------------------------------------------------------- corrections

SENTINEL = '\x00'


class Corrections:
    def __init__(self):
        main = yaml.safe_load((HERE / 'corrections.yaml').read_text(encoding='utf-8'))
        letters = yaml.safe_load((HERE / 'corrections-letters.yaml').read_text(encoding='utf-8'))
        nearby = yaml.safe_load((HERE / 'corrections-meant.yaml').read_text(encoding='utf-8'))
        self.items = []  # (sic, corr, label) for each choice, by number
        self.used = set()
        self.by_entry = {}
        for i, c in enumerate(main):
            c['_id'] = f'm{i}'
            self.by_entry.setdefault(c['entry'], []).append(c)
        for i, c in enumerate(letters):
            c['kind'] = 'letter'
            c['_id'] = f'l{i}'
            self.by_entry.setdefault(c['entry'], []).append(c)
        for i, c in enumerate(nearby):
            c['_id'] = f'n{i}'
            self.by_entry.setdefault(c['entry'], []).append(c)
        self.all = main + letters + nearby
        self.changes = []  # (entry, text) for the revisionDesc
        self.notes = {}    # entry -> [(link, note)]
        self.meant = {}    # (entry, link, text) -> sid

    def choice(self, sic, corr, label):
        self.items.append((sic, corr, label))
        return f'{SENTINEL}{len(self.items) - 1}{SENTINEL}'

    def apply(self, entry, fields):
        """Applies this entry's corrections to its HTML fields (a list of
        [field, text] pairs, changed in place)."""
        rid = entry['rid']
        # The letter corrections of one quotation are applied together.
        groups = {}
        for c in self.by_entry.get(rid, []):
            if c['kind'] == 'letter':
                groups.setdefault((c['quote'], c['ref']), []).append(c)
        for group in groups.values():
            self._letters(rid, group, fields)
        for c in self.by_entry.get(rid, []):
            kind = c['kind']
            if kind == 'letter':
                continue
            elif kind == 'ref':
                self._ref(rid, c, fields)
            elif kind == 'meant':
                if 'quote' in c:
                    self._meant_after_quote(rid, c, fields)
                    continue
                self._find_link(rid, c['link'], c['text'], fields)
                if (rid, c['link'], c['text']) in self.meant:
                    raise Fail(f"{rid}: two corrections for the reference \"{c['text']}\"")
                self.meant[(rid, c['link'], c['text'])] = c['meant']
                if True:
                    self.changes.append((rid, f"{rid}: the reference \"{c['text']}\" is BDB's own misprint, kept as "
                                              f"printed; it is linked to {c['meant']} (bn:meant). Evidence: 1906 "
                                              f"printing, {c['evidence']}; checked by the maintainer on 2026-11-21."))
                self.used.add(c['_id'])
            elif kind == 'homograph':
                if entry.get('ordinal') != c['sic']:
                    raise Fail(f"{rid}: homograph correction expects {c['sic']}, the source has {entry.get('ordinal')}")
                entry['ordinal'] = c['corr']
                self.changes.append((rid, f"{rid}: homograph number {c['corr']} for the source's {c['sic']}. Evidence: "
                                          f"1906 printing, {c['evidence']}; checked by the maintainer on 2026-11-21."))
                self.used.add(c['_id'])
            elif kind == 'markup':
                n = sum(f[1].count(c['find']) for f in fields)
                if n != 1:
                    raise Fail(f"{rid}: markup correction finds \"{c['find']}\" {n} times")
                for f in fields:
                    f[1] = f[1].replace(c['find'], c['replace'])
                self.changes.append((rid, f"{rid}: Sefaria's markup corrected ({c['reason']}); the wording is unchanged."))
                self.used.add(c['_id'])
            elif kind == 'count':
                if entry.get('occurrences') != c['sic'] or not fields or not fields[0][1].startswith(c['text']):
                    raise Fail(f'{rid}: count correction does not apply')
                entry['occurrences'] = c['corr']
                fields[0][1] = fields[0][1][len(c['text']):]
                self.changes.append((rid, f"{rid}: occurrence count \"{c['corr']}\" ({c['reason']})."))
                self.used.add(c['_id'])
            elif kind == 'note':
                self._find_link(rid, c['link'], None, fields)
                self.notes.setdefault(rid, []).append((c['link'], c['note']))
                self.used.add(c['_id'])
            else:
                raise Fail(f'{rid}: unknown correction kind {kind}')

    def _meant_after_quote(self, rid, c, fields):
        """A verse meant for the one link that follows a quotation: the
        link is marked in the source's HTML (data-meant), as the same
        reference may stand elsewhere in the entry, rightly."""
        pattern = re.compile(r'(<span dir="rtl">' + re.escape(c['quote']) + r'</span>\s*<a )([^>]*data-ref="' +
                             re.escape(c['link']) + r'"[^>]*>' + re.escape(c['text']) + '</a>)')
        n = sum(len(pattern.findall(f[1])) for f in fields)
        if n != 1:
            raise Fail(f"{rid}: the link to {c['link']} after the quotation is found {n} times")
        for f in fields:
            f[1] = pattern.sub(lambda m: m.group(1) + f'data-meant="{c["meant"]}" ' + m.group(2), f[1])
        self.changes.append((rid, f"{rid}: the reference \"{c['text']}\" after the quotation is kept as printed and "
                                  f"linked to {c['meant']} (bn:meant), the nearest verse with the quotation's words, "
                                  f"which are not in the verse cited (Westminster Leningrad Codex); not checked in "
                                  f"the print."))
        self.used.add(c['_id'])

    def _find_link(self, rid, link, text, fields):
        pattern = re.compile(r'<a [^>]*data-ref="' + re.escape(link) + r'"[^>]*>' +
                             (re.escape(text) if text is not None else r'[^<]*') + '</a>')
        n = sum(len(pattern.findall(f[1])) for f in fields)
        if n == 0:
            raise Fail(f'{rid}: no link to {link}' + (f' reading "{text}"' if text else ''))
        return pattern

    def _ref(self, rid, c, fields):
        pattern = self._find_link(rid, c['link'], c['sic'], fields)
        n = sum(len(pattern.findall(f[1])) for f in fields)
        if n != 1:
            raise Fail(f"{rid}: the link to {c['link']} reading \"{c['sic']}\" occurs {n} times")
        mark = self.choice(c['sic'], c['corr'], 'print')
        for f in fields:
            f[1] = pattern.sub(lambda m: m.group(0)[:m.group(0).rindex('>' + c['sic'])] + '>' + mark + '</a>', f[1])
        self.changes.append((rid, f"{rid}: the reference \"{c['corr']}\" for the source's \"{c['sic']}\". Evidence: "
                                  f"1906 printing, {c['evidence']}; checked by the maintainer on 2026-11-21."))
        self.used.add(c['_id'])

    def _letters(self, rid, group, fields):
        """One quotation's letter corrections: each word, as a whole word,
        replaced by its correction, then the quotation replaced wherever it
        stands before a link to the verse."""
        quote, ref = group[0]['quote'], group[0]['ref']
        new = quote
        for c in group:
            new = self._word(rid, c, quote, new)
        pattern = re.compile(r'(<span dir="rtl">)(' + re.escape(quote) + r')(</span>\s*<a [^>]*data-ref="' +
                             re.escape(ref) + '")')
        n = sum(len(pattern.findall(f[1])) for f in fields)
        if n == 0:
            raise Fail(f'{rid}: the quotation "{quote}" before a link to {ref} is not in the source')
        for f in fields:
            f[1] = pattern.sub(lambda m: m.group(1) + new + m.group(3), f[1])

    def _word(self, rid, c, quote, new):
        sic, corr = c['sic'], c['corr']
        # The word as a whole word: not inside a longer one.
        # Letters and marks only: not the maqaf (U+05BE) or punctuation.
        inside = r'\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u05d0-\u05ea'
        word = re.compile(r'(?<![' + inside + '])' + re.escape(sic) + r'(?![' + inside + '])')
        if len(word.findall(quote)) != 1:
            raise Fail(f'{rid}: "{sic}" occurs {len(word.findall(quote))} times in the quotation "{quote}"')
        label = 'print' if c['evidence'] == 'print' else 'wlc'
        mark = self.choice(sic, corr, label)
        new = word.sub(mark, new)
        how = ('checked in the 1906 printing by the maintainer on 2026-11-21 (print-checks.md)' if label == 'print'
               else "corrected against the Westminster Leningrad Codex: Sefaria's OCR (print-checks.md)")
        self.changes.append((rid, f"{rid}: in the quotation before {c['ref']}, {corr} for the source's {sic}, {how}."))
        self.used.add(c['_id'])
        return new

    def check_all_used(self):
        unused = [c for c in self.all if c['_id'] not in self.used]
        if unused:
            raise Fail(f'{len(unused)} corrections were not applied, e.g. {unused[0]}')


# ---------------------------------------------------------------- strong's

def norm_headword(word):
    """For matching headwords between sources only: letters and vowel
    points, no cantillation, meteg or superscript digits."""
    word = re.sub('[\u0591-\u05af\u05bd\u00b9\u00b2\u00b3\u2070-\u2079]', '', word)
    return unicodedata.normalize('NFC', word).strip()


def strong_numbers(entries):
    """Each entry's Strong's numbers: from the lexical index where it places
    a number, else Sefaria's. Returns ({rid: [H123, ...]}, review lines)."""
    ns = {'o': 'http://openscriptures.github.com/morphhb/namespace'}
    index = []
    for part in ET.parse(INDEX).getroot().findall('o:part', ns):
        lexicon = HEBREW_PART if part.get(xml('lang')) == 'heb' else ARAMAIC_PART
        for e in part.findall('o:entry', ns):
            x = e.find('o:xref', ns)
            w = e.find('o:w', ns)
            if x is None or not x.get('strong') or w is None:
                continue
            for n in re.findall(r'\d+[a-z]?', x.get('strong')):
                index.append((lexicon, norm_headword(w.text or ''), 'H' + n.lstrip('0')))
    by_word = {}
    for e in entries:
        by_word.setdefault((e['parent_lexicon'], norm_headword(e['headword'])), []).append(e['rid'])
    sefaria = {}
    for e in entries:
        for n in e.get('strong_numbers') or []:
            # One value is a stray ", " (BDB entry with no number); skip it.
            if re.fullmatch(r'\d+[a-z]?', str(n)):
                sefaria.setdefault('H' + str(n).lstrip('0'), set()).add(e['rid'])
    placed = {}
    review = []
    for lexicon, word, number in index:
        candidates = by_word.get((lexicon, word), [])
        theirs = [r for r in candidates if r in sefaria.get(number, ())]
        if len(theirs) >= 1:
            chosen = theirs
        elif len(candidates) == 1:
            chosen = candidates
        else:
            continue
        placed.setdefault(number, set()).update(chosen)
    numbers = {}
    for number, rids in placed.items():
        for r in rids:
            numbers.setdefault(r, set()).add(number)
    kept = 0
    for number, rids in sefaria.items():
        if number not in placed:
            kept += 1
            for r in rids:
                numbers.setdefault(r, set()).add(number)
    order = lambda n: (int(re.match(r'H(\d+)', n).group(1)), n)  # noqa: E731
    # What changed from Sefaria, number by number: entries that gain it and
    # entries that lose it.
    final = {}
    for r, v in numbers.items():
        for n in v:
            final.setdefault(n, set()).add(r)
    review = []
    for n in sorted(set(final) | set(sefaria), key=order):
        gained = sorted(final.get(n, set()) - sefaria.get(n, set()))
        lost = sorted(sefaria.get(n, set()) - final.get(n, set()))
        if gained or lost:
            review.append((n, sorted(final.get(n, set())), gained, lost, sorted(sefaria.get(n, set()))))
    return {r: sorted(v, key=order) for r, v in numbers.items()}, review, len(placed), kept


# ---------------------------------------------------------------- html

# Sefaria sometimes puts a comma between attributes (href="...", dir="rtl")
# or writes a stray ,="" attribute; ATTR reads the real ones, which are
# then checked one by one.
# Only Sefaria's own tags are markup: BDB's text uses < and > as signs
# ("> Others think ...", "but < Qr"), once directly before a name ("<Th").
TAG = re.compile(r'<(/?)(a|span|em|strong|sup|sub|big|br)\b((?:\s|,)[^>]*?)?\s*(/?)>')
ATTR = re.compile(r'([^\s=,]+)="([^"]*)"')
PRINTED = re.compile(r'(?:.*?\b(\d+):)?(\d+)')


class Converter:
    def __init__(self, entries, corrections):
        self.entries = entries
        self.corr = corrections
        self.by_headword = {}
        self.by_norm = {}
        for e in entries:
            self.by_headword.setdefault(e['headword'], []).append(e)
            self.by_norm.setdefault(norm_headword(e['headword']), []).append(e)
        self.unlinked = []
        self.counts = {'bible refs': 0, 'entry refs': 0, 'other books': 0, 'sid from link': 0,
                       'chapter from sup': 0, 'foreign added': 0}
        self.rid = None

    # -- links
    def bible_sid(self, link, text, after):
        """Where the reference BDB printed starts: the book from Sefaria's
        link, chapter and verse from the printed text (the chapter from the
        link if the text gives only a verse; a bare chapter followed by a
        superscript verse, as Sefaria sometimes leaves BDB's, read as
        chapter and verse). A whole chapter, or a range of chapters, gives
        the chapter alone ("2SA 1"). A range gives where it starts."""
        m = re.fullmatch(r'(.+?) (\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?', link)
        if not m or m.group(1) not in BOOKS:
            raise Fail(f'{self.rid}: scripture link "{link}" not understood')
        book, chapter = BOOKS[m.group(1)], int(m.group(2))
        verse = int(m.group(3)) if m.group(3) else None
        shown = re.sub(r'\x00\d+\x00', lambda x: self.corr.items[int(x.group(0)[1:-1])][1], text)
        shown = re.sub(r'<[^>]+>', '', shown).strip()
        numbers = re.sub(r'^\D*?(?=\d)', '', shown) if re.search(r'\d', shown) else ''
        if verse is None:
            # A chapter: the printed number is the chapter.
            p = re.match(r'(\d+)', numbers)
            return f'{book} {int(p.group(1)) if p else chapter}'
        sup = re.match(r'<sup>(\d+)', after)
        if re.fullmatch(r'\d+', shown) and sup and book not in ONE_CHAPTER:
            self.counts['chapter from sup'] += 1
            return f'{book} {int(shown)}:{int(sup.group(1))}'
        p = PRINTED.match(numbers)
        if not p:
            self.counts['sid from link'] += 1
            return f'{book} {chapter}:{verse}'
        if p.group(1):
            return f'{book} {int(p.group(1))}:{int(p.group(2))}'
        if book in ONE_CHAPTER:
            return f'{book} 1:{int(p.group(2))}'
        return f'{book} {chapter}:{int(p.group(2))}'

    def entry_target(self, name, shown):
        """The entry a "BDB, <headword>" link leads to."""
        found = self.by_headword.get(name, [])
        if not found:
            found = self.by_norm.get(norm_headword(name), [])
        if len(found) > 1:
            ordinal = re.match(r'\s*([IVX]+\.)', re.sub(r'<[^>]+>', '', shown))
            if ordinal:
                found = [e for e in found if (e.get('ordinal') or '') == ordinal.group(1)] or found
        if len(found) > 1:
            here = next(e for e in self.entries if e['rid'] == self.rid)['parent_lexicon']
            found = [e for e in found if e['parent_lexicon'] == here] or found
        if len(found) != 1:
            return None
        return found[0]['rid']

    # -- inline
    def inline(self, parent, html_text, lang_default):
        """Appends Sefaria's HTML, converted, to the element `parent`."""
        stack = [parent]
        pos = 0
        pending_link = None
        for m in TAG.finditer(html_text):
            self.text(stack[-1], html_text[pos:m.start()], lang_default)
            pos = m.end()
            closing, name, attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
            attrs = attrs or ''
            a = dict(ATTR.findall(attrs))
            if re.sub(r'([^\s=,]+)="[^"]*"|,=""|[\s,]', '', attrs):
                raise Fail(f'{self.rid}: <{name}> with attributes not understood: {attrs}')
            if closing:
                if name == 'br':
                    continue
                top = stack.pop()
                if top.get('_tag') != name:
                    raise Fail(f'{self.rid}: </{name}> closes <{top.get("_tag")}>')
                del top.attrib['_tag']
                if name == 'a' and top.get('_drop') == '1':
                    # A link to a book outside the canon: keep its text only.
                    del top.attrib['_drop']
                    self.unwrap(top, stack[-1])
                continue
            if name == 'br':
                ET.SubElement(stack[-1], t('lb'))
                continue
            if name in ('strong', 'em', 'sup', 'sub', 'big'):
                if a:
                    raise Fail(f'{self.rid}: <{name}> with attributes {a}')
                rend = {'strong': 'bold', 'em': 'italic', 'sup': 'sup', 'sub': 'sub', 'big': 'large'}[name]
                el = ET.SubElement(stack[-1], t('hi'), {'rend': rend, '_tag': name})
            elif name == 'span':
                if a != {'dir': 'rtl'}:
                    raise Fail(f'{self.rid}: <span> with attributes {a}')
                end = html_text.index('</span>', m.end())
                lang = script_of(html_text[m.end():end]) or 'hbo'
                if lang == 'hbo':
                    lang = lang_default
                el = ET.SubElement(stack[-1], t('foreign'), {xml('lang'): lang, '_tag': name, '_rtl': '1'})
            elif name == 'a':
                unknown = set(a) - {'data-ref', 'href', 'dir', 'data-meant'}
                if unknown or 'data-ref' not in a:
                    raise Fail(f'{self.rid}: <a> with attributes {a}')
                ref = html.unescape(a['data-ref'])
                end = html_text.index('</a>', m.end())
                shown = html_text[m.end():end]
                after = html_text[end + 4:end + 20]
                if ref.startswith('BDB'):
                    name_ = ref.split(', ', 1)[1] if ', ' in ref else None
                    target = self.entry_target(name_, shown) if name_ else None
                    if target is None:
                        # Kept as text; listed for review.
                        self.unlinked.append((self.rid, ref, re.sub(r'<[^>]+>', '', shown)))
                        el = ET.SubElement(stack[-1], t('seg'), {'_tag': 'a', '_drop': '1'})
                    else:
                        el = ET.SubElement(stack[-1], t('ref'), {'type': 'entry', 'target': '#' + target, '_tag': 'a'})
                        self.counts['entry refs'] += 1
                elif ref.startswith(OTHER_BOOKS):
                    el = ET.SubElement(stack[-1], t('seg'), {'_tag': 'a', '_drop': '1'})
                    self.counts['other books'] += 1
                else:
                    sid = self.bible_sid(ref, shown, after)
                    el = ET.SubElement(stack[-1], t('ref'), {'type': 'bible', bn('sid'): sid, '_tag': 'a'})
                    plain = re.sub(r'<[^>]+>', '', shown)
                    meant = a.get('data-meant') or self.corr.meant.get((self.rid, ref, plain))
                    if meant:
                        el.set(bn('meant'), meant)
                    if (self.rid, ref, plain) in self.corr.meant:
                        self.corr.meant_used = getattr(self.corr, 'meant_used', set()) | {(self.rid, ref, plain)}
                    for link, note in self.corr.notes.get(self.rid, []):
                        if link == ref:
                            self.pending_notes.append((el, note))
                    self.counts['bible refs'] += 1
            else:
                raise Fail(f'{self.rid}: unknown tag <{name}>')
            if selfclose:
                raise Fail(f'{self.rid}: self-closing <{name}>')
            stack.append(el)
        self.text(stack[-1], html_text[pos:], lang_default)
        if len(stack) != 1:
            raise Fail(f'{self.rid}: <{stack[-1].get("_tag")}> not closed')

    def unwrap(self, el, parent):
        """Replaces el by its content in parent."""
        i = list(parent).index(el)
        prev = parent[i - 1] if i else None
        def add_text(s):
            nonlocal prev
            if not s:
                return
            if prev is None:
                parent.text = (parent.text or '') + s
            else:
                prev.tail = (prev.tail or '') + s
        parent.remove(el)
        add_text(el.text)
        for k, child in enumerate(list(el)):
            parent.insert(i + k, child)
            prev = child
            el.remove(child) if child in list(el) else None
        add_text(el.tail)

    def text(self, el, s, lang_default):
        """Adds text to el, marking corrections and words in other scripts."""
        if not s:
            return
        s = html.unescape(s)
        in_foreign = el.tag == t('foreign') or any(True for _ in [])
        parts = re.split(r'(\x00\d+\x00)', s)
        for part in parts:
            if not part:
                continue
            m = re.fullmatch(r'\x00(\d+)\x00', part)
            if m:
                sic, corr, label = self.corr.items[int(m.group(1))]
                choice = ET.SubElement(el, t('choice'))
                ET.SubElement(choice, t('sic')).text = sic
                ET.SubElement(choice, t('corr')).text = corr
                continue
            if in_foreign or el.get('_rtl'):
                self.append(el, part)
                continue
            pos = 0
            for r in RUNS.finditer(part):
                if r.lastgroup == 'grc' and set(r.group(0)) <= {'\u03c8'}:
                    continue  # BDB's psi, its abbreviation for the Psalms
                self.append(el, part[pos:r.start()])
                code = r.lastgroup
                lang = lang_default if code == 'hbo' else code
                f = ET.SubElement(el, t('foreign'), {xml('lang'): lang})
                f.text = r.group(0)
                self.counts['foreign added'] += 1
                pos = r.end()
            self.append(el, part[pos:])

    @staticmethod
    def append(el, s):
        if not s:
            return
        if len(el):
            el[-1].tail = (el[-1].tail or '') + s
        else:
            el.text = (el.text or '') + s

    # -- entries
    def convert(self, e, strong):
        self.rid = e['rid']
        self.pending_notes = []
        unknown = set(e) - ENTRY_FIELDS
        if unknown:
            raise Fail(f'{self.rid}: unknown fields {sorted(unknown)}')
        lang = 'hbo' if e['parent_lexicon'] == HEBREW_PART else 'arc'
        fields = []
        self.collect(e['content']['senses'], fields)
        if e.get('headword_suffix'):
            fields.append(['suffix', e['headword_suffix']])
        self.corr.apply(e, fields)
        texts = iter(fields)

        entry = ET.Element(t('entry'), {xml('id'): self.rid, xml('lang'): 'en'})
        if e.get('ordinal'):
            entry.set('n', e['ordinal'])
        if strong.get(self.rid):
            entry.set(bn('strong'), ' '.join(strong[self.rid]))
        if e.get('all_cited'):
            entry.set(bn('allCited'), '1')
        if e.get('peculiar'):
            entry.set(bn('peculiar'), '1')
        if e.get('brackets'):
            entry.set(bn('brackets'), {'first_word': 'first', 'all': 'all'}[e['brackets']])
        if e.get('occurrences'):
            count = e['occurrences']
            if not re.fullmatch(r'\d+|c\. \d+', count):
                raise Fail(f'{self.rid}: occurrence count "{count}"')
            entry.set(bn('count'), count)
        if e.get('root'):
            entry.set(bn('root'), '1')
        form = ET.SubElement(entry, t('form'), {'type': 'lemma'})
        ET.SubElement(form, t('orth'), {xml('lang'): lang}).text = e['headword']
        # Other spellings printed on the headword line, some with their own
        # count (Sefaria spells that field "occurences"). Sefaria sometimes
        # gives a spelling's count as an item of its own with no word: it
        # belongs to the spelling before it.
        alts = []
        for alt in e.get('alt_headwords') or []:
            if set(alt) - {'word', 'occurences'}:
                raise Fail(f'{self.rid}: alt_headwords item {alt}')
            if alt.get('word'):
                alts.append(dict(alt))
            elif alts and not alts[-1].get('occurences') and re.fullmatch(r'\d+', alt.get('occurences') or ''):
                alts[-1]['occurences'] = alt['occurences']
            else:
                raise Fail(f'{self.rid}: a count with no word to belong to, {alt}')
        for alt in alts:
            f = ET.SubElement(entry, t('form'), {'type': 'variant'})
            if alt.get('occurences'):
                if not re.fullmatch(r'\d+', alt['occurences']):
                    raise Fail(f"{self.rid}: count {alt['occurences']}")
                f.set(bn('count'), alt['occurences'])
            ET.SubElement(f, t('orth'), {xml('lang'): lang}).text = alt['word']

        suffix = [f for f in fields if f[0] == 'suffix']
        if suffix:
            note = ET.SubElement(entry, t('note'), {'type': 'forms'})
            self.inline(note, suffix[0][1], lang)
        self.write_senses(entry, e['content']['senses'], 1, fields, lang)
        if e['content'].keys() - {'senses'}:
            raise Fail(f'{self.rid}: unknown content fields')
        for el, note in self.pending_notes:
            n = ET.SubElement(entry, t('note'), {'type': 'sourceCorrection'})
            n.text = f"At {el.get(bn('sid'))}: {note}"
        return entry

    def collect(self, senses, out):
        for s in senses:
            if s.get('definition') is not None:
                out.append(['definition', s['definition']])
                s['_field'] = out[-1]
            if 'senses' in s:
                self.collect(s['senses'], out)

    def write_senses(self, entry, senses, level, fields, lang):
        for s in senses:
            unknown = set(s) - SENSE_FIELDS - {'_field'}
            if unknown:
                raise Fail(f'{self.rid}: unknown sense fields {sorted(unknown)}')
            text = s['_field'][1] if '_field' in s else ''
            if s.get('note'):
                # BDB's notes ("Note.", sometimes numbered, a few with
                # numbered parts of their own, written after them).
                el = ET.SubElement(entry, t('note'), {'type': 'comment'})
                if s.get('num'):
                    el.set('n', re.sub(r'\.$', '', s['num'].strip()))
                if s.get('form') or s.get('all_cited') or s.get('pre_num') or s.get('occurrences'):
                    raise Fail(f'{self.rid}: a note with a stem, dagger or count')
            else:
                el = ET.SubElement(entry, t('sense'))
                if s.get('num'):
                    el.set('n', re.sub(r'\.$', '', s['num'].strip()))
                el.set(bn('level'), str(level))
                if s.get('form'):
                    el.set(bn('stem'), s['form'])
                if s.get('all_cited'):
                    el.set(bn('allCited'), '1')
                if s.get('pre_num'):
                    el.set(bn('pre'), s['pre_num'])
                if s.get('occurrences'):
                    el.set(bn('count'), s['occurrences'])
            self.inline(el, text, lang)
            if 'senses' in s:
                self.write_senses(entry, s['senses'], level + 1, fields, lang)


def clean(el):
    """Removes the converter's working attributes."""
    for x in el.iter():
        for k in [k for k in x.attrib if k.startswith('_')]:
            del x.attrib[k]


# Elements that hold only other elements: indented. Everything else holds
# text (mixed content), and is written exactly, with no added whitespace.
STRUCTURE = {t(n) for n in ('TEI', 'teiHeader', 'fileDesc', 'titleStmt', 'respStmt', 'publicationStmt',
                            'availability', 'sourceDesc', 'encodingDesc', 'revisionDesc', 'text', 'body',
                            'entry', 'form')}


def indent(el, depth=0):
    if el.tag not in STRUCTURE or not len(el):
        return
    if el.text and el.text.strip():
        raise Fail(f'text directly inside <{el.tag}>')
    el.text = '\n' + '  ' * (depth + 1)
    for child in el:
        if child.tail and child.tail.strip():
            raise Fail(f'text after <{child.tag}> inside <{el.tag}>')
        child.tail = '\n' + '  ' * (depth + 1)
        indent(child, depth + 1)
    el[-1].tail = '\n' + '  ' * depth


def header(source_sha, count, corrections):
    root = ET.Element(t('TEI'), {xml('lang'): 'en'})
    h = ET.SubElement(root, t('teiHeader'))
    fd = ET.SubElement(h, t('fileDesc'))
    ts = ET.SubElement(fd, t('titleStmt'))
    ET.SubElement(ts, t('title')).text = 'A Hebrew and English Lexicon of the Old Testament'
    ET.SubElement(ts, t('title'), {'type': 'sub'}).text = ('with an Appendix containing the Biblical Aramaic, '
                                                          'based on the Lexicon of William Gesenius as translated by Edward Robinson')
    for a in ('Francis Brown', 'Samuel Rolles Driver', 'Charles Augustus Briggs'):
        ET.SubElement(ts, t('author')).text = a
    rs = ET.SubElement(ts, t('respStmt'))
    ET.SubElement(rs, t('resp')).text = 'Converted to TEI for Bible Nav (module eng_bdb)'
    ET.SubElement(rs, t('name')).text = 'Bible Nav'
    ps = ET.SubElement(fd, t('publicationStmt'))
    ET.SubElement(ps, t('publisher')).text = 'Bible Nav'
    av = ET.SubElement(ps, t('availability'))
    ET.SubElement(av, t('licence')).text = (
        "Public domain. Text of Brown, Driver and Briggs (Oxford, 1906) from Sefaria's BDB Dictionary and BDB "
        "Aramaic Dictionary, which Sefaria marks as public domain. Strong's numbers from the Open Scriptures "
        "Hebrew Bible Project's lexical index, licensed under the Creative Commons Attribution 4.0 International "
        "License (http://creativecommons.org/licenses/by/4.0/). Converted to TEI by Bible Nav, with corrections "
        "listed below.")
    sd = ET.SubElement(fd, t('sourceDesc'))
    ET.SubElement(sd, t('bibl'), {xml('id'): 'source'}).text = (
        "Sefaria, \"BDB Dictionary\" and \"BDB Aramaic Dictionary\" (lexicon_entry collection of Sefaria's public "
        "database dump, https://storage.googleapis.com/sefaria-mongo-backup/dump_small.tar.gz, Last-Modified "
        "2026-11-21, SHA-256 a0213cabe5351121c157c437d5cf2cd7a4425c67367d4b29c8ed41b3cb887583), extracted as "
        f"assets/eng_bdb/source/bdb.json, SHA-256 {source_sha}. Sefaria names its source as the National "
        "Library of Israel's record of the 1906 edition, NNL_ALEPH990019502310205171; it does not say who "
        "transcribed it.")
    ET.SubElement(sd, t('bibl'), {xml('id'): 'index'}).text = (
        "Open Scriptures Hebrew Bible Project, HebrewLexicon, LexicalIndex.xml (commit "
        "21c9add13bc727d3a951361778e97e3ff7afd1ce, 2019-09-02), for Strong's numbers.")
    ET.SubElement(sd, t('bibl')).text = (
        'Francis Brown, with the co-operation of S. R. Driver and Charles A. Briggs, A Hebrew and English '
        'Lexicon of the Old Testament (Oxford: Clarendon Press, 1906).')
    ed = ET.SubElement(h, t('encodingDesc'))
    for p in (
        f"Each of the {count} entries keeps Sefaria's id as its xml:id: BDB00001 onwards for the Hebrew part, "
        "BDBA0001 onwards for the Aramaic. n is BDB's homograph number (I., II. ...). On the entry, bn:allCited "
        "is BDB's dagger (every occurrence is cited), bn:peculiar its double dagger (a word found only in "
        "Biblical Aramaic), bn:brackets its square brackets around the headword (first) or the whole headword "
        "line (all), marking a form that does not itself occur, bn:count the number of occurrences BDB prints "
        "under the headword, and bn:root Sefaria's mark of a root or verb entry (BDB prints nothing for it).",
        "Senses are written flat in reading order; bn:level is the depth of nesting (1 the outermost), n the "
        "number (BDB's trailing stop left out), bn:stem the verb stem that heads it (Qal, Niph. ...), "
        "bn:allCited BDB's dagger before the number, bn:pre the words BDB prints before the number, and bn:count "
        "an occurrence count. A note of type comment is a passage BDB prints as a note. A note of type forms is "
        "the rest of the headword line (\"or ...\"); a form of type variant is another spelling BDB prints on "
        "the headword line, with its own count in bn:count where BDB gives one.",
        "hi marks bold, italic, superscript, subscript and large type as Sefaria gives them; lb a line break. A "
        "ref of type bible is a scripture reference: bn:sid the verse BDB printed (Hebrew numbering; the book "
        "from Sefaria's link, chapter and verse from the printed text), and bn:meant, where BDB misprinted the "
        "number, the verse meant. A ref of type entry links to another entry. foreign marks words in Hebrew "
        "(hbo; arc in the Aramaic part), Greek, Syriac, Arabic, Ethiopic and Samaritan scripts.",
        "Sefaria's text spells out BDB's abbreviations and writes references in full (\"Je 26:1\" for Je 26\u00b9); "
        "that editing is kept. Strong's numbers (bn:strong) are from the Open Scriptures lexical index where it "
        "places a number, otherwise Sefaria's, which it gives to whole groups of related entries.",
        "Left out: the GK and TWOT numbers, Sefaria's empty quotation lists and links between neighbouring "
        "headwords, and the links (not the text) of references to Ben Sira and Maccabees.",
    ):
        ET.SubElement(ed, t('p')).text = p
    rd = ET.SubElement(h, t('revisionDesc'))
    for rid, text in corrections.changes:
        ET.SubElement(rd, t('change'), {'target': '#' + rid}).text = text
    return root


def main():
    raw = SOURCE.read_bytes()
    entries = json.loads(raw)
    corrections = Corrections()
    strong, review, placed, kept = strong_numbers(entries)
    conv = Converter(entries, corrections)
    out = []
    try:
        for e in entries:
            out.append(conv.convert(e, strong))
        corrections.check_all_used()
        missing = set(corrections.meant) - getattr(corrections, 'meant_used', set())
        if missing:
            raise Fail(f'meant corrections not placed: {sorted(missing)}')
    except Fail as f:
        sys.exit(f'failed: {f}')
    root = header(hashlib.sha256(raw).hexdigest(), len(out), corrections)
    text_el = ET.SubElement(root, t('text'))
    body = ET.SubElement(text_el, t('body'))
    for el in out:
        clean(el)
        body.append(el)
    indent(root)
    OUT.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding='unicode') + '\n',
                   encoding='utf-8')
    gloss = {e['rid']: re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', ' '.join(
        s.get('definition') or '' for s in e['content']['senses'][:2]))).strip()[:70] for e in entries}
    heads = {e['rid']: e['headword'] for e in entries}
    show = lambda r: f'{r} {heads[r]}: {gloss[r]}'  # noqa: E731
    moved = [x for x in review if x[4] and not set(x[1]) & set(x[4])]
    mixed = [x for x in review if x[2] and x[3] and set(x[1]) & set(x[4])]
    narrowed = [x for x in review if x[3] and not x[2] and x[1]]
    added = [x for x in review if x[2] and not x[3]]
    lines = ['# Strong\'s numbers to review', '',
             'Where the module\'s Strong\'s numbers differ from Sefaria\'s. The module follows the Open '
             'Scriptures index, which places numbers entry by entry; Sefaria gives them to whole groups of '
             'related entries. Each entry is shown with its first words.', '',
             f'## Moved: on none of the entries Sefaria gives it to ({len(moved)})', '',
             'The likeliest to be wrong. Check against a Strong\'s dictionary.', '',
             '| Number | Now on | Sefaria had it on |', '|---|---|---|']
    for n, now, gained, lost, before in moved:
        lines.append(f"| {n} | {'; '.join(map(show, now))} | {'; '.join(map(show, before))} |")
    lines += ['', f'## Mixed: kept on some of Sefaria\'s entries, moved from others ({len(mixed)})', '',
              '| Number | Now on | Taken from |', '|---|---|---|']
    for n, now, gained, lost, before in mixed:
        lines.append(f"| {n} | {'; '.join(map(show, now))} | {'; '.join(map(show, lost))} |")
    lines += ['', f'## Narrowed: kept on some of Sefaria\'s entries, taken from the rest ({len(narrowed)})', '',
              'The expected case: Sefaria gave the number to a root and the words formed from it.', '',
              '| Number | Kept on | Taken from |', '|---|---|---|']
    for n, now, gained, lost, before in narrowed:
        lines.append(f"| {n} | {'; '.join(map(show, now))} | {'; '.join(map(show, lost))} |")
    lines += ['', f'## Added: numbers Sefaria lacks, or gives to fewer entries ({len(added)})', '',
              '| Number | Now on | Added to |', '|---|---|---|']
    for n, now, gained, lost, before in added:
        lines.append(f"| {n} | {'; '.join(map(show, now))} | {'; '.join(map(show, gained))} |")
    review_counts = (len(moved), len(mixed), len(narrowed), len(added))
    lines += ['', '# Links to entries that lead to no single entry', '',
              'Kept as text, without a link.', '', '| In entry | Sefaria\'s link | Text shown |', '|---|---|---|']
    for rid, ref, shown in conv.unlinked:
        lines.append(f'| {rid} | {ref} | {shown} |')
    REVIEW.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'{len(out)} entries written to {OUT}; {len(corrections.changes)} corrections; '
          f"Strong's: {placed} numbers placed by the index, {kept} kept from Sefaria; changes from Sefaria: "
          f"{review_counts[0]} moved, {review_counts[1]} mixed, {review_counts[2]} narrowed, {review_counts[3]} added; "f'{len(conv.unlinked)} entry links unresolved')
    print(conv.counts)


if __name__ == '__main__':
    main()
