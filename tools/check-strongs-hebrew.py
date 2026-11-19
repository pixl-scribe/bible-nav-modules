#!/usr/bin/env python3
"""
Checks assets/eng_strongs_heb/eng_strongs_heb.tei.xml against its source,
independently of tools/import-strongs-hebrew.py: it shares no code with the
converter and reads both files another way (the source with regular
expressions, the TEI with xml.dom.minidom). Never make it share code with
the converter, or a mistake in one could hide in both.

    tools/venv/bin/python -I tools/check-strongs-hebrew.py

For every entry it compares the headword, transliteration, pronunciation,
and the plain text of the derivation, definition and KJV renderings, after
leaving out what the converter leaves out and applying corrections.yaml. It
also compares each Hebrew word in those notes (with its link,
transliteration and pronunciation), checks that every link leads to an
entry, and that nothing left out of the source appears in the TEI file.
Exits with an error on any difference.
"""
import html
import re
import sys
from pathlib import Path
from xml.dom import minidom

import yaml

ASSETS = Path('assets') / 'eng_strongs_heb'
SOURCE = ASSETS / 'source' / 'StrongHebrewG.xml'
TEI = ASSETS / 'eng_strongs_heb.tei.xml'

LANG = {'heb': 'hbo', 'arc': 'arc', 'x-pn': 'hbo'}
TEI_ELEMENTS = {
    'TEI', 'teiHeader', 'fileDesc', 'titleStmt', 'title', 'author', 'editor',
    'respStmt', 'resp', 'name', 'publicationStmt', 'publisher', 'availability',
    'licence', 'sourceDesc', 'bibl', 'encodingDesc', 'p', 'revisionDesc',
    'change', 'text', 'body', 'entry', 'form', 'orth', 'pron', 'etym', 'sense',
    'def', 'note', 'hi', 'ref', 'mentioned', 'seg', 'choice', 'sic', 'corr',
}


def attrs(text):
    return dict(re.findall(r'([\w:]+)="([^"]*)"', text))


def source_words(note):
    """Each <w .../> in a note, as (link, lemma, xlit, pron)."""
    words = []
    for m in re.finditer(r'<w ([^>]*)/>', note):
        a = attrs(m.group(1))
        words.append((a.get('src', ''), a.get('lemma', ''), a.get('xlit', ''), a.get('POS', '')))
    return words


def source_plain(note):
    note = re.sub(r'<w ([^>]*)/>', lambda m: attrs(m.group(1)).get('lemma', ''), note)
    note = re.sub(r'<hi>(.*?)</hi>', r'\1', note)
    if '<' in note:
        raise SystemExit(f'unexpected markup left in a source note: {note[:120]}')
    return html.unescape(note)


def read_source():
    text = SOURCE.read_text(encoding='utf-8-sig')
    # Open Scriptures' own correction notes are not part of the plain text;
    # they nest inside other notes, so they go first.
    text = re.sub(r'<note type="x-typo">.*?</note>', '', text, flags=re.S)
    entries = {}
    for m in re.finditer(r'<div type="entry" n="(\d+)">(.*?)</div>', text, flags=re.S):
        n, body = m.groups()
        head = attrs(re.search(r'<w ([^>]*ID="H\d+"[^>]*)>', body).group(1))
        notes = {k: v for k, v in re.findall(r'<note type="(\w+)">(.*?)</note>', body, flags=re.S)}
        entries['H' + n] = {
            'lemma': head['lemma'],
            'lang': LANG[head['xml:lang']],
            'xlit': head['xlit'],
            'pron': head['POS'],
            'etym': source_plain(notes['exegesis']) if 'exegesis' in notes else None,
            'def': source_plain(notes['explanation']),
            'kjv': source_plain(notes['translation']),
            'words': [w for k in ('exegesis', 'explanation', 'translation') for w in source_words(notes.get(k, ''))],
        }
    return entries


def apply_corrections(entries):
    for c in yaml.safe_load((ASSETS / 'corrections.yaml').read_text(encoding='utf-8')) or []:
        e = entries[c['entry']]
        fixed = c['find'].replace(c['sic'], c['corr'])
        hits = [k for k in ('etym', 'def', 'kjv') if e[k] and c['find'] in e[k]]
        if len(hits) != 1 or e[hits[0]].count(c['find']) != 1:
            raise SystemExit(f'correction for {c["entry"]} does not match the source exactly once')
        e[hits[0]] = e[hits[0]].replace(c['find'], fixed)


def tei_plain(node):
    """Text of a node, without Open Scriptures' notes and without <sic>."""
    out = []
    for child in node.childNodes:
        if child.nodeType == child.TEXT_NODE:
            out.append(child.data)
        elif child.nodeType == child.ELEMENT_NODE:
            if child.tagName == 'sic':
                continue
            if child.tagName == 'note' and child.getAttribute('type') == 'sourceCorrection':
                continue
            out.append(tei_plain(child))
    return ''.join(out)


def tei_words(node):
    words = []
    for el in node.getElementsByTagName('*'):
        if el.tagName in ('ref', 'mentioned'):
            target = el.getAttribute('target')
            words.append((
                str(int(target[2:])) if target else '',
                tei_plain(el),
                el.getAttribute('bn:translit'),
                el.getAttribute('bn:pron'),
            ))
    return words


def child(node, name, **attrs_):
    found = [
        c for c in node.childNodes
        if c.nodeType == c.ELEMENT_NODE and c.tagName == name
        and all(c.getAttribute(k) == v for k, v in attrs_.items())
    ]
    return found[0] if found else None


def read_tei():
    doc = minidom.parse(str(TEI))
    for el in doc.getElementsByTagName('*'):
        if el.tagName not in TEI_ELEMENTS:
            raise SystemExit(f'unexpected TEI element <{el.tagName}>')
    entries = {}
    for entry in doc.getElementsByTagName('entry'):
        form = child(entry, 'form')
        orths = [o for o in form.getElementsByTagName('orth')]
        sense = child(entry, 'sense')
        etym = child(entry, 'etym')
        words = []
        for part in (etym, child(sense, 'def'), child(sense, 'note', type='kjvRenderings')):
            if part is not None:
                words += tei_words(part)
        entries[entry.getAttribute('xml:id')] = {
            'lemma': tei_plain(orths[0]),
            'lang': orths[0].getAttribute('xml:lang'),
            'xlit': tei_plain(orths[1]),
            'pron': tei_plain(child(form, 'pron')),
            'etym': tei_plain(etym) if etym is not None else None,
            'def': tei_plain(child(sense, 'def')),
            'kjv': tei_plain(child(sense, 'note', type='kjvRenderings')),
            'words': words,
        }
    return doc, entries


def main():
    source = read_source()
    apply_corrections(source)
    doc, tei = read_tei()
    problems = []
    if list(source) != list(tei):
        problems.append(f'entry lists differ: {len(source)} in the source, {len(tei)} in TEI')
    for key in source:
        if key not in tei:
            continue
        for field in source[key]:
            if source[key][field] != tei[key][field]:
                problems.append(f'{key} {field}: source {source[key][field]!r} != TEI {tei[key][field]!r}')
    for key, e in tei.items():
        for link, *_ in e['words']:
            if link and f'H{link}' not in tei:
                problems.append(f'{key}: link to missing entry H{link}')
    whole = TEI.read_text(encoding='utf-8')
    for leftover in ('gloss=', 'morph=', '<list', '<item', 'G:'):
        if leftover in whole:
            problems.append(f'TEI contains "{leftover}", which should have been left out')
    unpointed = sum(
        1 for e in tei.values() for link, lemma, *_ in e['words']
        if link and lemma != tei[f'H{link}']['lemma']
    )
    for p in problems[:50]:
        print(p)
    if problems:
        sys.exit(f'{len(problems)} differences')
    print(f'{len(tei)} entries match the source exactly '
          f'({sum(len(e["words"]) for e in tei.values())} Hebrew words in the notes compared).')
    print(f'Note: {unpointed} links show a form that differs from the linked headword '
          '(the source writes the word as it appears in the derivation).')


if __name__ == '__main__':
    main()
