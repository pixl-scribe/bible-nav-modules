#!/usr/bin/env python3
"""
Converts Open Scriptures' Strong's Hebrew Dictionary (OSIS) into the TEI
source file of the eng_strongs_heb lexicon (docs/lexicon-format.md, "Source
files").

    tools/venv/bin/python -I tools/import-strongs-hebrew.py

Reads assets/eng_strongs_heb/source/StrongHebrewG.xml, exactly as received,
after checking it against assets/eng_strongs_heb/SHA256SUMS, applies
assets/eng_strongs_heb/corrections.yaml, and writes
assets/eng_strongs_heb/eng_strongs_heb.tei.xml.

Kept: each entry's headword, transliteration and pronunciation; its three
notes (derivation, definition, KJV renderings) with their italics and their
Hebrew words, linked or not; and Open Scriptures' own notes on what they
corrected. Left out, and counted: the outline in `list` (Online Bible's
abridged Brown-Driver-Briggs, not Strong's), the TWOT numbers (`gloss`),
the Greek equivalents in `foreign`, and the part-of-speech codes (`morph`).

Any element, attribute, or note type not described here stops the
conversion: nothing is dropped unless this file says so.

tools/check-strongs-hebrew.py checks the result independently.
"""
import hashlib
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

MODULE = 'eng_strongs_heb'
ASSETS = Path('assets') / MODULE
SOURCE = ASSETS / 'source' / 'StrongHebrewG.xml'
OUTPUT = ASSETS / f'{MODULE}.tei.xml'
CORRECTIONS = ASSETS / 'corrections.yaml'

SOURCE_COMMIT = '0acd2f251c2d35ff8db2dece4e0593979d3ac223'
# The host is built from character codes (g-i-t-h-u-b-.-c-o-m): typed host
# names have been silently replaced by look-alike proxy hosts before.
GITHUB = ''.join(map(chr, [103, 105, 116, 104, 117, 98, 46, 99, 111, 109]))
SOURCE_URL = f'https://{GITHUB}/openscriptures/strongs/blob/{SOURCE_COMMIT}/hebrew/StrongHebrewG.xml'
SOURCE_DATE = '2021-07-15'

OSIS = '{http://www.bibletechnologies.net/2003/OSIS/namespace}'
XML_LANG = '{http://www.w3.org/XML/1998/namespace}lang'
TEI_NS = 'http://www.tei-c.org/ns/1.0'
BN_NS = 'https://biblenav.org/ns/lexicon/1'

# The headword's language. Open Scriptures marks proper names `x-pn`
# without a language; they are Hebrew script, so they count as Hebrew.
HEADWORD_LANG = {'heb': 'hbo', 'arc': 'arc', 'x-pn': 'hbo'}

# Source note type -> where it goes in TEI.
FIELDS = ('exegesis', 'explanation', 'translation')


class Stop(Exception):
    """The source holds something this converter doesn't know."""


def tag(element):
    return element.tag.replace(OSIS, '')


def check_source():
    expected = None
    for line in (ASSETS / 'SHA256SUMS').read_text(encoding='utf-8').splitlines():
        digest, name = line.split(maxsplit=1)
        if name == SOURCE.name:
            expected = digest
    actual = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    if actual != expected:
        raise Stop(f'{SOURCE} has SHA-256 {actual}, but SHA256SUMS says {expected}')
    return actual


# ---- Reading the source into items ---------------------------------------
#
# A field is a list of items:
#   str                                  text, exactly as in the source
#   ('hi', str)                          italic text
#   ('ref', {'src', 'lemma', 'xlit', 'pos'})   a linked Hebrew word
#   ('word', {'lemma', 'xlit', 'pos'})   a Hebrew word with no link
#   ('typo', [str | ('catch', str)])     an Open Scriptures correction note
#   ('choice', sic, corr, id)            one of our corrections


def only_attributes(element, allowed, where):
    names = {name.split('}')[-1] for name in element.attrib}
    extra = names - allowed
    if extra:
        raise Stop(f'{where}: <{tag(element)}> has unknown attributes {sorted(extra)}')


def read_typo(note, where):
    only_attributes(note, {'type'}, where)
    items = [note.text] if note.text else []
    for child in note:
        if tag(child) != 'catchWord' or len(child) or child.attrib:
            raise Stop(f'{where}: unexpected <{tag(child)}> in a typo note')
        items.append(('catch', child.text or ''))
        if child.tail:
            items.append(child.tail)
    return ('typo', items)


def read_field(note, where):
    only_attributes(note, {'type'}, where)
    items = [note.text] if note.text else []
    for child in note:
        name = tag(child)
        if name == 'hi':
            if len(child) or child.attrib:
                raise Stop(f'{where}: <hi> with markup or attributes')
            items.append(('hi', child.text or ''))
        elif name == 'w':
            only_attributes(child, {'src', 'lemma', 'xlit', 'POS'}, where)
            if len(child) or child.text:
                raise Stop(f'{where}: <w> with content')
            word = {
                'lemma': child.get('lemma', ''),
                'xlit': child.get('xlit', ''),
                'pos': child.get('POS', ''),
            }
            if child.get('src') is not None:
                if not child.get('src').isdigit():
                    raise Stop(f'{where}: <w src="{child.get("src")}">')
                items.append(('ref', {'src': child.get('src'), **word}))
            else:
                items.append(('word', word))
        elif name == 'note' and child.get('type') == 'x-typo':
            items.append(read_typo(child, where))
        else:
            raise Stop(f'{where}: unexpected <{name}> in a note')
        if child.tail:
            items.append(child.tail)
    return items


def read_entries(root, counts):
    entries = []
    for div in root.iter(OSIS + 'div'):
        if div.get('type') != 'entry':
            continue
        number = div.get('n') or ''
        where = f'entry {number}'
        only_attributes(div, {'type', 'n'}, where)
        if (div.text or '').strip() or any((c.tail or '').strip() for c in div):
            raise Stop(f'{where}: text outside the entry\'s elements')
        entry = {'n': number, 'fields': {}, 'typos': []}
        for child in div:
            name = tag(child)
            if name == 'w':
                if 'w' in entry:
                    raise Stop(f'{where}: two headwords')
                only_attributes(child, {'gloss', 'lemma', 'morph', 'POS', 'xlit', 'ID', 'lang'}, where)
                if child.get('ID') != f'H{number}':
                    raise Stop(f'{where}: headword ID {child.get("ID")}')
                lang = child.get(XML_LANG)
                if lang not in HEADWORD_LANG:
                    raise Stop(f'{where}: headword language {lang}')
                for required in ('lemma', 'xlit', 'POS'):
                    if not child.get(required):
                        raise Stop(f'{where}: headword without {required}')
                entry['w'] = {
                    'lemma': child.get('lemma'),
                    'xlit': child.get('xlit'),
                    'pos': child.get('POS'),
                    'lang': HEADWORD_LANG[lang],
                }
                counts['proper names (x-pn)'] += lang == 'x-pn'
                counts['TWOT numbers (gloss) left out'] += child.get('gloss') is not None
                counts['part-of-speech codes (morph) left out'] += child.get('morph') is not None
            elif name == 'foreign':
                only_attributes(child, {'lang'}, where)
                for w in child:
                    if tag(w) != 'w' or set(w.attrib) != {'gloss'} or len(w) or w.text:
                        raise Stop(f'{where}: unexpected content in <foreign>')
                counts['Greek equivalents (foreign) left out'] += 1
            elif name == 'list':
                if child.attrib or any(tag(i) != 'item' or len(i) for i in child):
                    raise Stop(f'{where}: unexpected content in <list>')
                counts['outlines (list) left out'] += 1
            elif name == 'note':
                kind = child.get('type')
                if kind in FIELDS:
                    if kind in entry['fields']:
                        raise Stop(f'{where}: two {kind} notes')
                    entry['fields'][kind] = read_field(child, where)
                elif kind == 'x-typo':
                    entry['typos'].append(read_typo(child, where))
                else:
                    raise Stop(f'{where}: note type {kind}')
            else:
                raise Stop(f'{where}: unexpected <{name}>')
        if 'w' not in entry:
            raise Stop(f'{where}: no headword')
        for kind in ('explanation', 'translation'):
            if kind not in entry['fields']:
                raise Stop(f'{where}: no {kind} note')
        entries.append(entry)
    numbers = [int(e['n']) for e in entries]
    if numbers != list(range(1, len(numbers) + 1)):
        raise Stop('entries are not numbered 1, 2, 3, ... in order')
    return entries


# ---- Corrections ----------------------------------------------------------


def apply_corrections(entries, corrections):
    by_number = {e['n']: e for e in entries}
    applied = []
    for index, c in enumerate(corrections, start=1):
        fields = {'entry', 'find', 'sic', 'corr', 'evidence'}
        if set(c) != fields:
            raise Stop(f'correction {index} must have exactly {sorted(fields)}')
        key = c['entry']
        if not (key.startswith('H') and key[1:] in by_number):
            raise Stop(f'correction {index}: no entry {key}')
        find, sic = c['find'], c['sic']
        if find.count(sic) != 1:
            raise Stop(f'correction {index}: "{sic}" must occur exactly once in "{find}"')
        entry = by_number[key[1:]]
        hits = [
            (kind, i)
            for kind, items in entry['fields'].items()
            for i, item in enumerate(items)
            if isinstance(item, str) and item.count(find) == 1
        ]
        total = sum(
            item.count(find)
            for items in entry['fields'].values()
            for item in items
            if isinstance(item, str)
        )
        if len(hits) != 1 or total != 1:
            raise Stop(
                f'correction {index}: "{find}" must occur exactly once in {key}\'s text '
                f'(found {total}); if the source was fixed, remove the correction'
            )
        kind, i = hits[0]
        text = entry['fields'][kind][i]
        start = text.index(find) + find.index(sic)
        ident = f'corr{index}'
        pieces = [text[:start], ('choice', sic, c['corr'], ident), text[start + len(sic):]]
        entry['fields'][kind][i:i + 1] = [p for p in pieces if p != '']
        applied.append((ident, key, c))
    return applied


# ---- Writing TEI ----------------------------------------------------------


def esc(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def attr(text):
    return esc(text).replace('"', '&quot;')


def word_attrs(word):
    out = ''
    if word['xlit']:
        out += f' bn:translit="{attr(word["xlit"])}"'
    if word['pos']:
        out += f' bn:pron="{attr(word["pos"])}"'
    return out


def inline(items):
    out = []
    for item in items:
        if isinstance(item, str):
            out.append(esc(item))
        elif item[0] == 'hi':
            out.append(f'<hi rend="italic">{esc(item[1])}</hi>')
        elif item[0] == 'ref':
            w = item[1]
            out.append(
                f'<ref type="entry" target="#H{int(w["src"])}" xml:lang="hbo"{word_attrs(w)}>'
                f'{esc(w["lemma"])}</ref>'
            )
        elif item[0] == 'word':
            w = item[1]
            out.append(f'<mentioned xml:lang="hbo"{word_attrs(w)}>{esc(w["lemma"])}</mentioned>')
        elif item[0] == 'typo':
            out.append(typo_note(item))
        elif item[0] == 'choice':
            _, sic, corr, ident = item
            out.append(
                f'<choice xml:id="{ident}"><sic>{esc(sic)}</sic><corr>{esc(corr)}</corr></choice>'
            )
        else:
            raise Stop(f'unknown item {item[0]}')
    return ''.join(out)


def typo_note(item):
    parts = []
    for piece in item[1]:
        if isinstance(piece, str):
            parts.append(esc(piece))
        else:
            parts.append(f'<seg type="catchWord">{esc(piece[1])}</seg>')
    return f'<note type="sourceCorrection" resp="#openscriptures">{"".join(parts)}</note>'


def entry_tei(entry):
    w = entry['w']
    n = entry['n']
    lines = [
        f'      <entry xml:id="H{n}" xml:lang="en">',
        '        <form type="lemma">',
        f'          <orth xml:lang="{w["lang"]}">{esc(w["lemma"])}</orth>',
        f'          <orth type="transliteration">{esc(w["xlit"])}</orth>',
        f'          <pron>{esc(w["pos"])}</pron>',
        '        </form>',
    ]
    fields = entry['fields']
    # An empty derivation note (H5223 has one) means there is no derivation.
    if fields.get('exegesis'):
        lines.append(f'        <etym>{inline(fields["exegesis"])}</etym>')
    lines.append('        <sense>')
    lines.append(f'          <def>{inline(fields["explanation"])}</def>')
    lines.append(f'          <note type="kjvRenderings">{inline(fields["translation"])}</note>')
    lines.append('        </sense>')
    for typo in entry['typos']:
        lines.append(f'        {typo_note(typo)}')
    lines.append('      </entry>')
    return '\n'.join(lines)


def header(source_sha, applied, counts):
    changes = '\n'.join(
        f'      <change target="#{ident}">{key}: "{esc(c["sic"])}" corrected to '
        f'"{esc(c["corr"])}". Evidence: {esc(c["evidence"].strip())}</change>'
        for ident, key, c in applied
    )
    left_out = '; '.join(
        f'{name.replace(" left out", "")}: {count}'
        for name, count in counts.items()
        if name.endswith('left out')
    )
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="{TEI_NS}" xmlns:bn="{BN_NS}" xml:lang="en">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title>Strong's Hebrew Dictionary</title>
        <title type="sub">A Concise Dictionary of the Words in the Hebrew Bible, with their Renderings in the King James Version</title>
        <author>James Strong</author>
        <editor>David Troidl</editor>
        <editor>David Instone-Brewer</editor>
        <respStmt>
          <resp>Converted to TEI for Bible Nav (module {MODULE})</resp>
          <name>Bible Nav</name>
        </respStmt>
      </titleStmt>
      <publicationStmt>
        <publisher>Bible Nav</publisher>
        <availability>
          <licence>Public domain. James Strong's dictionary (1890) is in the public domain, and so is Open Scriptures' edition ("Public Domain"). Converted to TEI by Bible Nav, with the corrections listed below.</licence>
        </availability>
      </publicationStmt>
      <sourceDesc>
        <bibl xml:id="openscriptures">Open Scriptures, Strong's Hebrew Dictionary in OSIS, edited 2008-2010 by David Troidl and David Instone-Brewer from several public-domain sources and the 1890 original: {SOURCE_URL} (commit {SOURCE_COMMIT}, {SOURCE_DATE}), file SHA-256 {source_sha}.</bibl>
        <bibl>James Strong, A Concise Dictionary of the Words in the Hebrew Bible, in The Exhaustive Concordance of the Bible (New York: Hunt &amp; Eaton, 1890).</bibl>
      </sourceDesc>
    </fileDesc>
    <encodingDesc>
      <p>Each entry is one of Strong's numbered entries; its xml:id is the Strong's number (H1 to H8674). The headword (orth) is Open Scriptures' pointed lemma, followed by Strong's transliteration and pronunciation. etym holds Strong's derivation, def his definition, and the note of type kjvRenderings his list of renderings in the King James Version. A ref links to another entry by number; mentioned is a Hebrew word with no number, such as an alternative spelling. Both carry Strong's transliteration (bn:translit) and pronunciation (bn:pron) where the source gives them. Notes of type sourceCorrection are Open Scriptures' own notes on what they corrected. Headwords marked x-pn (proper names, with no language) in the source are tagged hbo here.</p>
      <p>Left out from the source, as not part of Strong's dictionary or not free to copy: {left_out}.</p>
    </encodingDesc>
    <revisionDesc>
{changes}
    </revisionDesc>
  </teiHeader>
  <text>
    <body>
'''


def main():
    source_sha = check_source()
    root = ET.parse(SOURCE).getroot()
    counts = {
        'proper names (x-pn)': 0,
        'outlines (list) left out': 0,
        'TWOT numbers (gloss) left out': 0,
        'Greek equivalents (foreign) left out': 0,
        'part-of-speech codes (morph) left out': 0,
    }
    entries = read_entries(root, counts)
    corrections = yaml.safe_load(CORRECTIONS.read_text(encoding='utf-8')) or []
    applied = apply_corrections(entries, corrections)
    numbers = {e['n'] for e in entries}
    for entry in entries:
        for items in entry['fields'].values():
            for item in items:
                if isinstance(item, tuple) and item[0] == 'ref' and str(int(item[1]['src'])) not in numbers:
                    raise Stop(f'entry {entry["n"]}: link to missing entry {item[1]["src"]}')
    body = '\n'.join(entry_tei(e) for e in entries)
    text = header(source_sha, applied, counts) + body + '\n    </body>\n  </text>\n</TEI>\n'
    ET.fromstring(text.encode('utf-8'))  # well-formed, or stop before writing
    tmp = OUTPUT.with_suffix('.xml.tmp')
    tmp.write_text(text, encoding='utf-8')
    tmp.replace(OUTPUT)
    print(f'{len(entries)} entries written to {OUTPUT}')
    for name, count in counts.items():
        print(f'  {name}: {count}')
    print(f'  typo notes kept: {sum(len(e["typos"]) for e in entries)} entry-level')
    print(f'  corrections applied: {len(applied)}')


if __name__ == '__main__':
    try:
        main()
    except Stop as stop:
        sys.exit(f'Stopped: {stop}')
