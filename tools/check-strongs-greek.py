#!/usr/bin/env python3
"""
Checks assets/eng_strongs_grc/eng_strongs_grc.tei.xml against its source,
independently of tools/import-strongs-greek.py: it shares no code with the
converter and reads both files another way (the source with regular
expressions, the TEI with xml.dom.minidom). Never make it share code with
the converter.

    tools/venv/bin/python -I tools/check-strongs-greek.py

For every entry it compares the headword, transliteration, pronunciation,
and the plain text of the alternative forms, derivation, definition, KJV
renderings and remarks, after the converter's documented rules (white
space, the ":--" before the KJV renderings, the `see` lists and unused
numbers left out) and corrections.yaml. A link's plain text is its
target's headword: the source's own for a Greek number, Strong's Hebrew's
(read from its OSIS source) for a Hebrew one. It also compares each Greek
word with its transliteration and pronunciation, and each link's target.
"""
import html
import re
import sys
from pathlib import Path
from xml.dom import minidom

import yaml

ASSETS = Path('assets') / 'eng_strongs_grc'
SOURCE = ASSETS / 'source' / 'strongsgreek.xml'
TEI = ASSETS / 'eng_strongs_grc.tei.xml'
HEBREW_SOURCE = Path('assets') / 'eng_strongs_heb' / 'source' / 'StrongHebrewG.xml'

FIELDS = {'strongs_derivation': 'etym', 'strongs_def': 'def', 'kjv_def': 'kjv'}


def attrs(text):
    return dict(re.findall(r'(\w+)="([^"]*)"', text))


def load_corrections():
    links, texts = {}, []
    for c in yaml.safe_load((ASSETS / 'corrections.yaml').read_text(encoding='utf-8')) or []:
        if 'link' in c:
            links[(c['entry'], c['link'])] = c['corr']
        else:
            texts.append(c)
    return links, texts


def hebrew_lemmas():
    text = HEBREW_SOURCE.read_text(encoding='utf-8-sig')
    return {m.group(2): m.group(1) for m in re.finditer(r'<w [^>]*lemma="([^"]*)"[^>]*ID="H(\d+)"', text)}


def read_source():
    text = SOURCE.read_text(encoding='utf-8')
    raw = re.findall(r'<entry strongs="(\d+)">(.*?)</entry>', text, flags=re.S)
    greek = {}
    for n, body in raw:
        m = re.search(r'<greek [^>]*unicode="([^"]*)"', body)
        if m:
            greek[str(int(n))] = m.group(1)
    return raw, greek


def plain_and_words(fragment, key, links, greek, hebrew):
    """The plain text of a source fragment, its words, and its links."""
    words, targets = [], []
    token = re.compile(
        r'<greek ([^>]*?)\s*/>(\s*<pronunciation strongs="([^"]*)"\s*/>)?'
        r'|<pronunciation strongs="([^"]*)"\s*/>'
        r'|<latin>([^<]*)</latin>'
        r'|<strongsref ([^>]*?)\s*/>'
    )

    def replace(m):
        if m.group(1) is not None:
            a = attrs(m.group(1))
            words.append(('grc', a['translit'], m.group(3) or '', a['unicode']))
            return a['unicode']
        if m.group(4) is not None:
            words.append(('grc', '', m.group(4), ''))
            return ''
        if m.group(5) is not None:
            return m.group(5)
        a = attrs(m.group(6))
        target = ('G' if a['language'] == 'GREEK' else 'H') + str(int(a['strongs']))
        target = links.get((key, target), target)
        targets.append(target)
        return greek[target[1:]] if target[0] == 'G' else hebrew[target[1:]]

    out = token.sub(replace, fragment)
    if '<' in out:
        raise SystemExit(f'{key}: unexpected markup left: {out[:120]}')
    out = html.unescape(out)
    out = re.sub(r'-\n\s*', '-', out)
    out = re.sub(r'\s+', ' ', out).strip()
    return out, words, targets


def source_entries():
    links, texts = load_corrections()
    hebrew = hebrew_lemmas()
    raw, greek = read_source()
    entries = {}
    for n, body in raw:
        key = 'G' + str(int(n))
        if re.fullmatch(r'\s*<strongs>\d+</strongs>\s*Not Used\s*', body):
            continue
        head = re.search(r'<greek ([^>]*?)\s*/>\s*<pronunciation strongs="([^"]*)"\s*/>', body)
        a = attrs(head.group(1))
        after_head = body[head.end():]
        first = re.search(r'<(strongs_derivation|strongs_def|kjv_def)>', after_head)
        last = list(re.finditer(r'</(strongs_derivation|strongs_def|kjv_def)>', after_head))[-1]
        # In reading order: forms, the three fields, remarks.
        parts = {'forms': after_head[:first.start()]}
        for tag, name in FIELDS.items():
            m = re.search(rf'<{tag}>(.*?)</{tag}>', after_head, flags=re.S)
            parts[name] = m.group(1) if m else None
        parts['remark'] = re.sub(r'<see [^>]*/>', '', after_head[last.end():])
        entry = {'lemma': a['unicode'], 'xlit': a['translit'], 'pron': head.group(2), 'words': [], 'links': []}
        for name, fragment in parts.items():
            if fragment is None:
                entry[name] = ''
                continue
            text, words, targets = plain_and_words(fragment, key, links, greek, hebrew)
            if name == 'kjv':
                text = re.sub(r'^:?--\s*', '', text)
            entry[name] = text
            entry['words'] += words
            entry['links'] += targets
        entries[key] = entry
    for c in texts:
        e = entries[c['entry']]
        hits = [k for k in ('forms', 'etym', 'def', 'kjv', 'remark') if c['find'] in e[k]]
        if len(hits) != 1:
            raise SystemExit(f'correction for {c["entry"]} does not match exactly once')
        e[hits[0]] = e[hits[0]].replace(c['find'], c['find'].replace(c['sic'], c['corr']))
    return entries


def text_of(node):
    out = []
    for child in node.childNodes:
        if child.nodeType == child.TEXT_NODE:
            out.append(child.data)
        elif child.nodeType == child.ELEMENT_NODE and child.tagName != 'sic':
            out.append(text_of(child))
    return ''.join(out)


def kids(node, name, **want):
    return [
        c for c in node.childNodes
        if c.nodeType == c.ELEMENT_NODE and c.tagName == name
        and all(c.getAttribute(k) == v for k, v in want.items())
    ]


def outside_sic(node, name):
    found = []
    for c in node.childNodes:
        if c.nodeType != c.ELEMENT_NODE or c.tagName == 'sic':
            continue
        if c.tagName == name:
            found.append(c)
        found += outside_sic(c, name)
    return found


def tei_entries():
    doc = minidom.parse(str(TEI))
    entries = {}
    for entry in doc.getElementsByTagName('entry'):
        form = kids(entry, 'form')[0]
        orth = kids(form, 'orth')
        sense = (kids(entry, 'sense') or [None])[0]
        parts = {
            'forms': (kids(entry, 'note', type='forms') or [None])[0],
            'etym': (kids(entry, 'etym') or [None])[0],
            'def': (kids(sense, 'def') or [None])[0] if sense else None,
            'kjv': (kids(sense, 'note', type='kjvRenderings') or [None])[0] if sense else None,
            'remark': (kids(entry, 'note', type='comment') or [None])[0],
        }
        e = {
            'lemma': text_of(orth[0]),
            'xlit': text_of(orth[1]),
            'pron': text_of(kids(form, 'pron')[0]),
            'words': [],
            'links': [],
        }
        for name, node in parts.items():
            e[name] = text_of(node) if node is not None else ''
            if node is None:
                continue
            for w in outside_sic(node, 'mentioned'):
                e['words'].append((w.getAttribute('xml:lang'), w.getAttribute('bn:translit'), w.getAttribute('bn:pron'), text_of(w)))
            for r in outside_sic(node, 'ref'):
                e['links'].append(r.getAttribute('target').split('#')[1])
        entries[entry.getAttribute('xml:id')] = e
    return entries


def main():
    source = source_entries()
    tei = tei_entries()
    problems = []
    if list(source) != list(tei):
        problems.append(f'entry lists differ: {len(source)} in the source, {len(tei)} in TEI')
    for key, e in source.items():
        t = tei.get(key)
        if t is None:
            continue
        for field in e:
            # White space at a part's ends isn't text: the converter keeps a
            # space before a word given only as a pronunciation.
            norm = (lambda v: v.strip()) if isinstance(e[field], str) else (lambda v: v)
            if norm(e[field]) != norm(t[field]):
                problems.append(f'{key} {field}: source {e[field]!r} != TEI {t[field]!r}')
    for p in problems[:40]:
        print(p)
    if problems:
        sys.exit(f'{len(problems)} differences')
    print(f'{len(tei)} entries match the source exactly '
          f'({sum(len(e["words"]) for e in tei.values())} Greek words and '
          f'{sum(len(e["links"]) for e in tei.values())} links compared).')


if __name__ == '__main__':
    main()
