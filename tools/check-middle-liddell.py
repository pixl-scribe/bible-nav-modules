#!/usr/bin/env python3
"""
Checks assets/eng_middle_liddell/eng_middle_liddell.tei.xml against its
source, independently of tools/import-middle-liddell.py: it shares no code
with that converter, reads both files with xml.dom.minidom (the converter
uses ElementTree), and applies the converter's documented rules its own
way. It shares only tools/betacode.py, the Beta Code converter, which is
tested on its own against every word of Strong's Greek Dictionary.

    tools/venv/bin/python -I tools/check-middle-liddell.py [--draft]

For every entry it compares the headword, the headword line (alt and infl
notes and extra forms, with the split words joined), each etymology and
each sense, as plain text; checks that every link leads to an entry with
the linked word as its headword, and every link by headword to two or
more; and recomputes each entry's Strong's numbers from Strong's Greek.
With --draft, text the converter left as Beta Code is accepted as such.
"""
import re
import sys
import unicodedata
from pathlib import Path
from xml.dom import minidom

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from betacode import BetaCodeError, beta_to_unicode  # noqa: E402

ASSETS = Path('assets') / 'eng_middle_liddell'
SOURCE = ASSETS / 'source' / 'Perseus_text_1999.04.0058.xml'
TEI = ASSETS / 'eng_middle_liddell.tei.xml'
GREEK_TEI = Path('assets') / 'eng_strongs_grc' / 'eng_strongs_grc.tei.xml'
BROKEN = 'failing on lembuf []'
DIAERESIS = unicodedata.lookup('COMBINING DIAERESIS')
DRAFT = '--draft' in sys.argv[1:]


def elements(node, name=None):
    return [c for c in node.childNodes if c.nodeType == c.ELEMENT_NODE and (name is None or c.tagName == name)]


def flat(text):
    return ' '.join(text.split())


def lookup_form(word):
    """How a headword is looked up: NFC, no breve or macron, no digits."""
    marks = {unicodedata.lookup('COMBINING MACRON'), unicodedata.lookup('COMBINING BREVE')}
    d = unicodedata.normalize('NFD', word)
    return unicodedata.normalize('NFC', ''.join(c for c in d if c not in marks and not c.isdigit())).strip()


class Source:
    def __init__(self, corrections):
        self.corrections = corrections
        self.unconverted = 0

    def greek(self, text, entry):
        fix = self.corrections.get((entry, text))
        if fix is not None:
            text = fix
        if DRAFT and BROKEN in text:
            self.unconverted += 1
            return text
        try:
            return beta_to_unicode(text, drop_stray_length=True)
        except BetaCodeError:
            if DRAFT:
                self.unconverted += 1
                return text
            raise

    def plain(self, node, entry, greek=False):
        """Plain text of a source element, as Bible Nav shows it."""
        out = []
        for c in node.childNodes:
            if c.nodeType == c.TEXT_NODE:
                out.append(self.greek(c.data, entry) if greek and c.data.strip() else c.data)
                continue
            if c.nodeType != c.ELEMENT_NODE:
                continue
            tag = c.tagName
            lang = c.getAttribute('lang')
            if tag in ('usg', 'bibl'):
                t = ''.join(x.data for x in c.childNodes if x.nodeType == x.TEXT_NODE)
                # "id=..." is shown as "id."; a semicolon after it stays.
                out.append(('id.' + (';' if t.strip().endswith(';') else '')) if t.startswith('id=') else t)
            elif tag == 'ref':
                # Punctuation Perseus left at the end of a reference is
                # English punctuation, not Greek.
                raw = ''.join(x.data for x in c.childNodes)
                m = re.fullmatch(r'(\s*)(.*?)([.,;:]*)(\s*)', raw, flags=re.S)
                out.append(m.group(1) + self.greek(m.group(2), entry) + m.group(3) + m.group(4))
            elif tag == 'foreign':
                out.append(self.plain(c, entry, greek=(lang == 'greek')))
            elif tag == 'gramGrp':
                out.append(''.join(''.join(x.data for x in k.childNodes) for k in elements(c, 'colloc')))
            else:
                out.append(self.plain(c, entry, greek=greek))
        return ''.join(out)

    def forms(self, parts, entry):
        """The headword line from alt and infl notes and extra forms, in
        order, joining a word the conversion tool split in two."""
        texts = []
        i = 0
        while i < len(parts):
            p = parts[i]
            whole = ''.join(t.data for t in walk_text(p))
            if BROKEN in whole and i + 1 < len(parts) and re.match(r'[/=\\]', ''.join(t.data for t in walk_text(parts[i + 1]))):
                rest = ''.join(t.data for t in walk_text(parts[i + 1]))
                texts.append(self.joined(p, rest, entry))
                i += 2
                continue
            greek = p.tagName == 'orth' or p.getAttribute('type') == 'alt'
            texts.append(self.plain(p, entry, greek=greek))
            i += 1
        return flat(' '.join(flat(t) for t in texts))

    def joined(self, note, rest, entry):
        # The broken end is in the last text that has anything in it.
        nodes = [t for t in walk_text(note) if t.data.strip()]
        last = nodes[-1]
        out = []
        for c in note.childNodes:
            if c.nodeType == c.TEXT_NODE:
                data = c.data
                if c is last:
                    data = data.rstrip()[: -len(BROKEN)] + rest
                out.append(self.greek(data, entry) if data.strip() else data)
            elif c.nodeType == c.ELEMENT_NODE:
                inner = [t for t in walk_text(c)]
                if last in inner:
                    data = last.data.rstrip()[: -len(BROKEN)] + rest
                    out.append(self.greek(data, entry))
                elif c.getAttribute('lang') == 'en':
                    out.append(''.join(t.data for t in inner))
                else:
                    out.append(self.plain(c, entry, greek=True))
        return ''.join(out)


def walk_text(node):
    for c in node.childNodes:
        if c.nodeType == c.TEXT_NODE:
            yield c
        elif c.nodeType == c.ELEMENT_NODE:
            yield from walk_text(c)


def tei_plain(node):
    out = []
    for c in node.childNodes:
        if c.nodeType == c.TEXT_NODE:
            out.append(c.data)
        elif c.nodeType == c.ELEMENT_NODE and c.tagName != 'sic':
            out.append(tei_plain(c))
    return ''.join(out)


def read_source(corrections):
    src = Source(corrections)
    doc = minidom.parse(str(SOURCE))
    entries = {}
    order = []
    for e in doc.getElementsByTagName('entry'):
        entry = e.getAttribute('id')
        order.append(entry)
        forms_parts, parts, lemma = [], [], None
        for c in elements(e):
            if c.tagName == 'form' and not c.getAttribute('type'):
                lemma = elements(c, 'orth')[0]
            elif c.tagName == 'form':
                forms_parts.append(elements(c, 'orth')[0])
            elif c.tagName == 'note' and c.getAttribute('type') in ('alt', 'infl'):
                forms_parts.append(c)
            elif c.tagName in ('etym', 'sense'):
                text = flat(src.plain(c, entry))
                if text:  # empty senses are left out
                    parts.append((c.tagName, text))
        head_raw = re.sub(r'\d+$', '', flat(''.join(t.data for t in walk_text(lemma))))
        entries[entry] = {
            'headword': src.greek(head_raw, entry),
            'homograph': (re.search(r'(\d+)$', e.getAttribute('key')) or [None, ''])[1],
            'forms': src.forms(forms_parts, entry) if forms_parts else '',
            'parts': parts,
        }
    return order, entries, src


def read_tei():
    doc = minidom.parse(str(TEI))
    entries = {}
    order = []
    links = []
    for e in doc.getElementsByTagName('entry'):
        entry = e.getAttribute('xml:id')
        order.append(entry)
        form = elements(e, 'form')[0]
        forms = [n for n in elements(e, 'note') if n.getAttribute('type') == 'forms']
        parts = [(c.tagName, flat(tei_plain(c))) for c in elements(e) if c.tagName in ('etym', 'sense')]
        entries[entry] = {
            'headword': flat(tei_plain(elements(form, 'orth')[0])),
            'homograph': e.getAttribute('n'),
            'forms': flat(tei_plain(forms[0])) if forms else '',
            'parts': parts,
            'strong': e.getAttribute('bn:strong').split(),
        }
        for r in e.getElementsByTagName('ref'):
            # A link inside a <sic> is the source's, not ours.
            parent, in_sic = r.parentNode, False
            while parent is not None and parent.nodeType == parent.ELEMENT_NODE:
                if parent.tagName == 'sic':
                    in_sic = True
                parent = parent.parentNode
            if not in_sic:
                links.append((entry, r.getAttribute('type'), r.getAttribute('target'), r.getAttribute('bn:lemma'), flat(tei_plain(r))))
    return order, entries, links


def main():
    corrections = {}
    for c in yaml.safe_load((ASSETS / 'corrections.yaml').read_text(encoding='utf-8')) or []:
        corrections[(c['entry'], c['source'])] = c['corr']
    src_order, src, source = read_source(corrections)
    tei_order, tei, links = read_tei()
    problems = []
    if src_order != tei_order:
        problems.append(f'entry order differs: {len(src_order)} in the source, {len(tei_order)} in TEI')
    for entry in src_order:
        s, t = src[entry], tei.get(entry)
        if t is None:
            continue
        for field in ('headword', 'homograph', 'forms', 'parts'):
            if s[field] != t[field]:
                problems.append(f'{entry} {field}: source {s[field]!r} != TEI {t[field]!r}')
    # Every link: one entry with that headword, or several by headword.
    heads = {}
    for entry, t in tei.items():
        heads.setdefault(lookup_form(t['headword']), []).append(entry)
    for entry, kind, target, lemma, shown in links:
        if kind == 'entry':
            word = lookup_form(re.sub(r'[.,;:]+$', '', shown))
            if heads.get(word) != [target.lstrip('#')]:
                problems.append(f'{entry}: link to {target} for {shown!r}, whose headword entries are {heads.get(word)}')
        elif kind == 'lemma':
            if len(heads.get(lemma, [])) < 2:
                problems.append(f'{entry}: link by headword {lemma!r}, which {len(heads.get(lemma, []))} entries have')
        else:
            problems.append(f'{entry}: link of unknown type {kind!r}')
    # Strong's numbers: recomputed from Strong's Greek.
    greek = minidom.parse(str(GREEK_TEI))
    numbers = {}
    no_diaeresis = {}
    for entry_word in heads:
        no_diaeresis[unicodedata.normalize('NFC', unicodedata.normalize('NFD', entry_word).replace(DIAERESIS, ''))] = entry_word
    for e in greek.getElementsByTagName('entry'):
        orth = e.getElementsByTagName('orth')[0]
        word = lookup_form(tei_plain(orth))
        if word not in heads:
            word = no_diaeresis.get(unicodedata.normalize('NFC', unicodedata.normalize('NFD', word).replace(DIAERESIS, '')))
        if word:
            for entry in heads[word]:
                numbers.setdefault(entry, []).append(e.getAttribute('xml:id'))
    for entry, t in tei.items():
        if sorted(t['strong']) != sorted(numbers.get(entry, [])):
            problems.append(f'{entry}: Strong\'s numbers {t["strong"]}, expected {numbers.get(entry, [])}')
    for p in problems[:40]:
        print(p)
    if problems:
        sys.exit(f'{len(problems)} differences')
    print(f'{len(tei)} entries match the source'
          + (f' ({source.unconverted} pieces of unsettled Greek accepted as a draft)' if DRAFT else '')
          + f'; {len(links)} links and {sum(len(t["strong"]) for t in tei.values())} Strong\'s numbers checked.')


if __name__ == '__main__':
    main()
