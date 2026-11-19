#!/usr/bin/env python3
"""
Converts Strong's Greek Dictionary (Ulrik Sandborg-Petersen's XML,
version 1.9, from MorphGNT's strongs-dictionary-xml repository) into the
TEI source file of the eng_strongs_grc lexicon (docs/lexicon-format.md,
"Source files").

    tools/venv/bin/python -I tools/import-strongs-greek.py

Reads assets/eng_strongs_grc/source/strongsgreek.xml, exactly as received,
after checking it against assets/eng_strongs_grc/SHA256SUMS, applies
assets/eng_strongs_grc/corrections.yaml, and writes
assets/eng_strongs_grc/eng_strongs_grc.tei.xml.

Each entry becomes:
  - the headword (`greek unicode`), its transliteration (`translit`) and
    pronunciation (`pronunciation`);
  - its alternative forms ("or ..."), when the source gives some between
    the headword and the derivation, as a note of type forms;
  - Strong's derivation, definition and KJV renderings
    (`strongs_derivation`, `strongs_def`, `kjv_def`);
  - Strong's own remarks after the KJV renderings ("Compare 2570.") as a
    note of type comment.

Inside them, a Greek word (`greek`, with the `pronunciation` that follows
it, if any) becomes `mentioned`; a pronunciation alone becomes an empty
`mentioned` with that pronunciation; a Latin word becomes `foreign`; and a
link to another entry (`strongsref`) becomes a `ref` whose text is that
entry's headword. Links to Strong's Hebrew numbers point into
eng_strongs_heb.tei.xml, and show its pointed headword.

The 1996 e-text was wrapped at 72 columns, and its line breaks mean
nothing: runs of white space become one space, each part is trimmed, and
a word hyphenated at a line end ("pre-" / "eminently") is joined. The ":--"
that introduces the KJV renderings in print is the section's heading in
Bible Nav, so it's left out of the text.

Left out, and counted: the Beta Code spelling of each Greek word (`BETA`,
kept in the source and used to test the Beta Code converter), and the 101
numbers Strong's left unused (G2717, G3203 to G3302), which hold only
"Not Used". (Version 1.9 has no `see` lists; earlier versions repeated the
text's links in them.)

Any element or attribute not described here stops the conversion.
tools/check-strongs-greek.py checks the result independently.
"""
import hashlib
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

MODULE = 'eng_strongs_grc'
ASSETS = Path('assets') / MODULE
SOURCE = ASSETS / 'source' / 'strongsgreek.xml'
OUTPUT = ASSETS / f'{MODULE}.tei.xml'
CORRECTIONS = ASSETS / 'corrections.yaml'
HEBREW_TEI = Path('assets') / 'eng_strongs_heb' / 'eng_strongs_heb.tei.xml'
HEBREW_FILE = 'eng_strongs_heb.tei.xml'

SOURCE_COMMIT = 'dd6758b82f46b620804a8ea677d715844679eea1'
# The host is built from character codes (g-i-t-h-u-b-.-c-o-m): typed host
# names have been silently replaced by look-alike proxy hosts before.
GITHUB = ''.join(map(chr, [103, 105, 116, 104, 117, 98, 46, 99, 111, 109]))
SOURCE_URL = (
    f'https://{GITHUB}/morphgnt/strongs-dictionary-xml/blob/{SOURCE_COMMIT}'
    '/strongsgreek.xml'
)
SOURCE_DATE = '2019-02-05'

TEI_NS = 'http://www.tei-c.org/ns/1.0'
BN_NS = 'https://biblenav.org/ns/lexicon/1'
FIELDS = ('strongs_derivation', 'strongs_def', 'kjv_def')
INLINE = {'greek', 'pronunciation', 'latin', 'strongsref'}


class Stop(Exception):
    """The source holds something this converter doesn't know."""


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


def number(raw, where):
    if not raw.isdigit() or int(raw) == 0:
        raise Stop(f'{where}: bad Strong\'s number "{raw}"')
    return str(int(raw))


def expect_attrs(element, allowed, where):
    extra = set(element.attrib) - set(allowed)
    if extra:
        raise Stop(f'{where}: <{element.tag}> has unknown attributes {sorted(extra)}')


# ---- Reading the source into items ---------------------------------------
#
# A part is a list of items:
#   str                                      text
#   ('word', {'lemma', 'xlit', 'pron'})      a Greek word, or a pronunciation alone
#   ('latin', str)                           a Latin word
#   ('ref', 'G' | 'H', number)               a link to another entry
#   ('choice', sic, corr, id)                one of our corrections


def inline_item(element, where):
    """One inline element as an item."""
    if element.tag == 'greek':
        expect_attrs(element, {'BETA', 'unicode', 'translit'}, where)
        if len(element) or (element.text or '').strip():
            raise Stop(f'{where}: <greek> with content')
        return ('word', {'lemma': element.get('unicode'), 'xlit': element.get('translit'), 'pron': ''})
    if element.tag == 'pronunciation':
        expect_attrs(element, {'strongs'}, where)
        return ('word', {'lemma': '', 'xlit': '', 'pron': element.get('strongs')})
    if element.tag == 'latin':
        if element.attrib or len(element):
            raise Stop(f'{where}: <latin> with attributes or markup')
        return ('latin', element.text or '')
    if element.tag == 'strongsref':
        expect_attrs(element, {'language', 'strongs'}, where)
        language = {'GREEK': 'G', 'HEBREW': 'H'}.get(element.get('language'))
        if not language:
            raise Stop(f'{where}: <strongsref language="{element.get("language")}">')
        return ('ref', language, number(element.get('strongs'), where))
    raise Stop(f'{where}: unexpected <{element.tag}>')


def pair_pronunciations(items):
    """A Greek word followed (across white space only) by a pronunciation
    becomes one word with that pronunciation."""
    out = []
    for item in items:
        if (
            isinstance(item, tuple) and item[0] == 'word' and not item[1]['lemma']
        ):
            # Look back past white space for a Greek word without one.
            back = len(out) - 1
            while back >= 0 and isinstance(out[back], str) and not out[back].strip():
                back -= 1
            target = out[back] if back >= 0 else None
            if (
                isinstance(target, tuple) and target[0] == 'word'
                and target[1]['lemma'] and not target[1]['pron']
            ):
                target[1]['pron'] = item[1]['pron']
                del out[back + 1:]
                continue
        out.append(item)
    return out


def tidy(items):
    """White space from the e-text's line wrapping: a hyphen at a line end
    joins its word; any other run becomes one space; the part is trimmed."""
    out = []
    for item in items:
        if isinstance(item, str):
            item = re.sub(r'-\n\s*', '-', item)
            item = re.sub(r'\s+', ' ', item)
            if out and isinstance(out[-1], str):
                out[-1] += item
                continue
        out.append(item)
    if out and isinstance(out[0], str):
        out[0] = out[0].lstrip()
    if out and isinstance(out[-1], str):
        out[-1] = out[-1].rstrip()
    return [i for i in out if i != '']


def read_part(element, where):
    expect_attrs(element, set(), where)
    items = [element.text] if element.text else []
    for child in element:
        items.append(inline_item(child, where))
        if child.tail:
            items.append(child.tail)
    return tidy(pair_pronunciations(items))


def read_entries(root, counts):
    entries = []
    unused = []
    for entry in root.find('entries'):
        if entry.tag != 'entry':
            raise Stop(f'unexpected <{entry.tag}> in <entries>')
        n = number(entry.get('strongs', ''), 'an entry')
        where = f'entry G{n}'
        expect_attrs(entry, {'strongs'}, where)
        children = list(entry)
        if not children or children[0].tag != 'strongs' or number(children[0].text or '', where) != n:
            raise Stop(f'{where}: its <strongs> number is missing or different')
        if len(children) == 1:
            tail = (children[0].tail or '').strip()
            if tail != 'Not Used':
                raise Stop(f'{where}: no headword, and not marked "Not Used"')
            unused.append(n)
            continue
        if children[1].tag != 'greek' or children[2].tag != 'pronunciation':
            raise Stop(f'{where}: the headword and pronunciation must come first')
        head = inline_item(children[1], where)[1]
        head['pron'] = inline_item(children[2], where)[1]['pron']
        for between in (children[0].tail, children[1].tail):
            if (between or '').strip():
                raise Stop(f'{where}: text inside the headword')

        # Everything after the headword, in order: loose items (forms before
        # the fields, remarks after them), the fields, and `see` lists.
        forms, remark, fields = [], [], {}
        loose = forms
        if children[2].tail:
            loose.append(children[2].tail)
        for child in children[3:]:
            if child.tag in FIELDS:
                if child.tag in fields or (fields and FIELDS.index(child.tag) < max(FIELDS.index(f) for f in fields)):
                    raise Stop(f'{where}: <{child.tag}> out of order or repeated')
                fields[child.tag] = read_part(child, where)
                loose = remark
            elif child.tag in INLINE:
                loose.append(inline_item(child, where))
            else:
                raise Stop(f'{where}: unexpected <{child.tag}>')
            if child.tail:
                loose.append(child.tail)
        if not fields:
            raise Stop(f'{where}: no derivation, definition or KJV renderings')
        forms = tidy(pair_pronunciations(forms))
        remark = tidy(pair_pronunciations(remark))
        if 'kjv_def' in fields:
            kjv = fields['kjv_def']
            if kjv and isinstance(kjv[0], str):
                stripped = re.sub(r'^:?--\s*', '', kjv[0])
                if stripped != kjv[0]:
                    counts['":--" before KJV renderings left out'] += 1
                kjv[0] = stripped
            fields['kjv_def'] = [i for i in kjv if i != '']
        entries.append({'n': n, 'head': head, 'forms': forms, 'fields': fields, 'remark': remark})
    counts['unused numbers left out'] = len(unused)
    return entries, unused


# ---- Corrections (as for Strong's Hebrew) ---------------------------------


def parts_of(entry):
    named = {'forms': entry['forms'], 'remark': entry['remark']}
    named.update(entry['fields'])
    return named


def apply_corrections(entries, corrections):
    """Text corrections (find, sic, corr) as for Strong's Hebrew, and link
    corrections (link, corr): a link to the wrong number, such as a Hebrew
    reference the e-text marked Greek."""
    by_number = {e['n']: e for e in entries}
    applied = []
    for index, c in enumerate(corrections, start=1):
        text_fields = {'entry', 'find', 'sic', 'corr', 'evidence'}
        link_fields = {'entry', 'link', 'corr', 'evidence'}
        if set(c) not in (text_fields, link_fields):
            raise Stop(f'correction {index} must have exactly {sorted(text_fields)} or {sorted(link_fields)}')
        key = c['entry']
        if not (key.startswith('G') and key[1:] in by_number):
            raise Stop(f'correction {index}: no entry {key}')
        parts = parts_of(by_number[key[1:]])
        ident = f'corr{index}'
        if 'link' in c:
            wanted = parse_link(c['link'], index)
            corr = parse_link(c['corr'], index)
            hits = [
                (items, i) for items in parts.values() for i, item in enumerate(items)
                if isinstance(item, tuple) and item[0] == 'ref' and (item[1], item[2]) == wanted
            ]
            if len(hits) != 1:
                raise Stop(
                    f'correction {index}: {key} must link to {c["link"]} exactly once '
                    f'(found {len(hits)}); if the source was fixed, remove the correction'
                )
            items, i = hits[0]
            items[i] = ('choice-link', items[i], ('ref', *corr), ident)
            applied.append((ident, key, {'sic': c['link'], 'corr': c['corr'], 'evidence': c['evidence']}))
            continue
        find, sic = c['find'], c['sic']
        if find.count(sic) != 1:
            raise Stop(f'correction {index}: "{sic}" must occur exactly once in "{find}"')
        hits = [
            (items, i) for items in parts.values() for i, item in enumerate(items)
            if isinstance(item, str) and item.count(find) == 1
        ]
        total = sum(
            item.count(find) for items in parts.values() for item in items
            if isinstance(item, str)
        )
        if len(hits) != 1 or total != 1:
            raise Stop(f'correction {index}: "{find}" must occur exactly once in {key} (found {total})')
        items, i = hits[0]
        text = items[i]
        start = text.index(find) + find.index(sic)
        pieces = [text[:start], ('choice', sic, c['corr'], ident), text[start + len(sic):]]
        items[i:i + 1] = [p for p in pieces if p != '']
        applied.append((ident, key, c))
    return applied


def parse_link(text, index):
    m = re.fullmatch(r'([GH])([1-9]\d*)', str(text))
    if not m:
        raise Stop(f'correction {index}: "{text}" is not a Strong\'s number such as G25 or H5689')
    return (m.group(1), m.group(2))


# ---- Writing TEI ----------------------------------------------------------


def esc(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def attr(text):
    return esc(text).replace('"', '&quot;')


def hebrew_headwords():
    """Strong's Hebrew headwords, from its TEI file, for links into it."""
    text = HEBREW_TEI.read_text(encoding='utf-8')
    found = {}
    for m in re.finditer(r'<entry xml:id="H(\d+)"[^>]*>\s*<form type="lemma">\s*<orth xml:lang="(\w+)">([^<]*)</orth>', text):
        found[m.group(1)] = (m.group(2), m.group(3))
    return found


def inline(items, greek, hebrew, where):
    out = []
    for item in items:
        if isinstance(item, str):
            out.append(esc(item))
        elif item[0] == 'word':
            w = item[1]
            attrs = ''
            if w['xlit']:
                attrs += f' bn:translit="{attr(w["xlit"])}"'
            if w['pron']:
                attrs += f' bn:pron="{attr(w["pron"])}"'
            out.append(f'<mentioned xml:lang="grc"{attrs}>{esc(w["lemma"])}</mentioned>')
        elif item[0] == 'latin':
            out.append(f'<foreign xml:lang="la">{esc(item[1])}</foreign>')
        elif item[0] == 'ref':
            _, language, n = item
            if language == 'G':
                if n not in greek:
                    raise Stop(f'{where}: link to G{n}, which has no entry')
                out.append(f'<ref type="entry" target="#G{n}" xml:lang="grc">{esc(greek[n])}</ref>')
            else:
                if n not in hebrew:
                    raise Stop(f'{where}: link to H{n}, which Strong\'s Hebrew lacks')
                lang, word = hebrew[n]
                out.append(f'<ref type="entry" target="{HEBREW_FILE}#H{n}" xml:lang="{lang}">{esc(word)}</ref>')
        elif item[0] == 'choice':
            _, sic, corr, ident = item
            out.append(f'<choice xml:id="{ident}"><sic>{esc(sic)}</sic><corr>{esc(corr)}</corr></choice>')
        elif item[0] == 'choice-link':
            # The source's link, to a number with no entry, kept as <sic>
            # with no text; the corrected link as <corr>.
            _, wrong, right, ident = item
            _, language, n = wrong
            target = f'#G{n}' if language == 'G' else f'{HEBREW_FILE}#H{n}'
            out.append(
                f'<choice xml:id="{ident}"><sic><ref type="entry" target="{target}"/></sic>'
                f'<corr>{inline([right], greek, hebrew, where)}</corr></choice>'
            )
        else:
            raise Stop(f'unknown item {item[0]}')
    return ''.join(out)


def entry_tei(entry, greek, hebrew):
    n, h = entry['n'], entry['head']
    where = f'entry G{n}'
    lines = [
        f'      <entry xml:id="G{n}" xml:lang="en">',
        '        <form type="lemma">',
        f'          <orth xml:lang="grc">{esc(h["lemma"])}</orth>',
        f'          <orth type="transliteration">{esc(h["xlit"])}</orth>',
        f'          <pron>{esc(h["pron"])}</pron>',
        '        </form>',
    ]
    if entry['forms']:
        lines.append(f'        <note type="forms">{inline(entry["forms"], greek, hebrew, where)}</note>')
    fields = entry['fields']
    if fields.get('strongs_derivation'):
        lines.append(f'        <etym>{inline(fields["strongs_derivation"], greek, hebrew, where)}</etym>')
    sense = []
    if fields.get('strongs_def'):
        sense.append(f'          <def>{inline(fields["strongs_def"], greek, hebrew, where)}</def>')
    if fields.get('kjv_def'):
        sense.append(f'          <note type="kjvRenderings">{inline(fields["kjv_def"], greek, hebrew, where)}</note>')
    if sense:
        lines += ['        <sense>', *sense, '        </sense>']
    if entry['remark']:
        lines.append(f'        <note type="comment">{inline(entry["remark"], greek, hebrew, where)}</note>')
    lines.append('      </entry>')
    return '\n'.join(lines)


def number_ranges(numbers):
    """"G2717, G3203 to G3302" for those numbers."""
    values = sorted(int(n) for n in numbers)
    runs = []
    for value in values:
        if runs and value == runs[-1][1] + 1:
            runs[-1][1] = value
        else:
            runs.append([value, value])
    return ', '.join(f'G{a}' if a == b else f'G{a} to G{b}' for a, b in runs)


def header(source_sha, applied, counts, unused):
    changes = '\n'.join(
        f'      <change target="#{ident}">{key}: "{esc(c["sic"])}" corrected to '
        f'"{esc(c["corr"])}". Evidence: {esc(c["evidence"].strip())}</change>'
        for ident, key, c in applied
    ) or '      <change>No corrections yet.</change>'
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="{TEI_NS}" xmlns:bn="{BN_NS}" xml:lang="en">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title>Strong's Greek Dictionary</title>
        <title type="sub">A Concise Dictionary of the Words in the Greek Testament, with their Renderings in the Authorized English Version</title>
        <author>James Strong</author>
        <editor>Michael Grier (e-text, 1996)</editor>
        <editor>Ulrik Sandborg-Petersen (XML with Unicode Greek, 2006-2019)</editor>
        <respStmt>
          <resp>Converted to TEI for Bible Nav (module {MODULE})</resp>
          <name>Bible Nav</name>
        </respStmt>
      </titleStmt>
      <publicationStmt>
        <publisher>Bible Nav</publisher>
        <availability>
          <licence>Public domain. James Strong's dictionary (1890) is in the public domain, and Ulrik Sandborg-Petersen released this edition under the Creative Commons CC0 waiver (https://creativecommons.org/publicdomain/zero/1.0/). Converted to TEI by Bible Nav, with the corrections listed below.</licence>
        </availability>
      </publicationStmt>
      <sourceDesc>
        <bibl xml:id="source">Strong's Greek Dictionary in XML with real Greek, version 1.9 (2019-02-05), prepared by Ulrik Sandborg-Petersen from Michael Grier's 1996 e-text, with Unicode Greek corrected against the printed edition and later proofreading, as published by MorphGNT: {SOURCE_URL} (commit {SOURCE_COMMIT}, {SOURCE_DATE}), file SHA-256 {source_sha}.</bibl>
        <bibl>James Strong, A Concise Dictionary of the Words in the Greek Testament, in The Exhaustive Concordance of the Bible (New York: Hunt &amp; Eaton, 1890).</bibl>
      </sourceDesc>
    </fileDesc>
    <encodingDesc>
      <p>Each entry is one of Strong's numbered entries; its xml:id is the Strong's number (G1 to G5624). The headword (orth) is the source's Unicode Greek, followed by its transliteration and Strong's pronunciation. A note of type forms gives alternative forms of the headword; etym holds Strong's derivation, def his definition, the note of type kjvRenderings his renderings in the King James Version, and a note of type comment his remarks after them. A ref links to another entry by number and shows that entry's headword (a link into Strong's Hebrew points into {HEBREW_FILE}); mentioned is a Greek word, with its transliteration (bn:translit) and pronunciation (bn:pron), or a pronunciation alone; foreign xml:lang="la" is a Latin word.</p>
      <p>The source's line breaks, from a 1996 e-text wrapped at 72 columns, are not kept: white space runs are one space, each part is trimmed, and a word hyphenated at a line end is joined. The ":--" before the KJV renderings is left out; it is the section's heading in Bible Nav.</p>
      <p>Left out from the source: the Beta Code spellings (BETA), and the {len(unused)} numbers Strong's left unused ({number_ranges(unused)}), which hold only "Not Used".</p>
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
    counts = {'":--" before KJV renderings left out': 0}
    entries, unused = read_entries(root, counts)
    corrections = yaml.safe_load(CORRECTIONS.read_text(encoding='utf-8')) or []
    applied = apply_corrections(entries, corrections)
    greek = {e['n']: e['head']['lemma'] for e in entries}
    hebrew = hebrew_headwords()
    body = '\n'.join(entry_tei(e, greek, hebrew) for e in entries)
    text = header(source_sha, applied, counts, unused) + body + '\n    </body>\n  </text>\n</TEI>\n'
    ET.fromstring(text.encode('utf-8'))  # well-formed, or stop before writing
    tmp = OUTPUT.with_suffix('.xml.tmp')
    tmp.write_text(text, encoding='utf-8')
    tmp.replace(OUTPUT)
    print(f'{len(entries)} entries written to {OUTPUT}')
    for name, count in counts.items():
        print(f'  {name}: {count}')
    print(f'  entries with alternative forms: {sum(1 for e in entries if e["forms"])}')
    print(f'  entries with remarks: {sum(1 for e in entries if e["remark"])}')
    print(f'  corrections applied: {len(applied)}')


if __name__ == '__main__':
    try:
        main()
    except Stop as stop:
        sys.exit(f'Stopped: {stop}')
