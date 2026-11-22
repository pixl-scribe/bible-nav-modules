#!/usr/bin/env python3
"""
Checks assets/eng_bdb/eng_bdb.tei.xml against Sefaria's source
(assets/eng_bdb/source/bdb.json) and the corrections files, sharing no code
with the converter (tools/import-sefaria-bdb.py): it reads the TEI file with
minidom and the source's HTML with its own simple tag scanner.

    tools/venv/bin/python -I tools/check-sefaria-bdb.py

For every entry, in order, it checks:
  - the headword, homograph number, dagger, double dagger, brackets, count
    and root flag, and the variant spellings with their counts;
  - each sense's (or note's) number, level, stem, dagger, the words before
    its number, and its count;
  - the text, exactly: the source's HTML with its tags removed and the
    corrections made, against the TEI's text with each choice read as its
    corr and the converter's notes left out;
  - the links: as many scripture references and links to entries as the
    source has (less the ones to Ben Sira and Maccabees, and any link to
    an entry that couldn't be resolved), each showing the source's text,
    and every entry link leading to an entry that exists.
"""
import html
import json
import re
import sys
from pathlib import Path
from xml.dom import minidom

import yaml

HERE = Path('assets/eng_bdb')
TEI = 'http://www.tei-c.org/ns/1.0'
BN = 'https://biblenav.org/ns/lexicon/1'

failures = []


def fail(msg):
    failures.append(msg)
    if len(failures) >= 30:
        report()


def report():
    for f in failures:
        print('FAIL', f)
    sys.exit(f'{len(failures)} problems' + (' (stopped at 30)' if len(failures) >= 30 else ''))


# ---- the source, read independently

SCAN = re.compile(r'<(/?)(a|span|em|strong|sup|sub|big|br)\b[^>]*>')
LINK = re.compile(r'<a\b([^>]*)>(.*?)</a>', re.S)


def plain(htmltext):
    return html.unescape(SCAN.sub('', htmltext))


def source_links(htmltext):
    """(kind, shown text) for each link: kind bible, entry or other."""
    out = []
    for m in LINK.finditer(htmltext):
        ref = re.search(r'data-ref="([^"]*)"', m.group(1)).group(1)
        shown = plain(m.group(2))
        if ref.startswith('BDB'):
            out.append(('entry', shown))
        elif ref.startswith(('Ben Sira', 'The Book of Maccabees')):
            out.append(('other', shown))
        else:
            out.append(('bible', shown))
    return out


def source_parts(e):
    """The source's parts in the order the TEI file should give them: the
    headword suffix, then each sense or note, depth first."""
    parts = []
    if e.get('headword_suffix'):
        parts.append({'kind': 'forms', 'html': e['headword_suffix']})

    def walk(senses, level):
        for s in senses:
            num = s.get('num')
            parts.append({
                'kind': 'note' if s.get('note') else 'sense',
                'html': s.get('definition') or '',
                'n': re.sub(r'\.$', '', num.strip()) if num else '',
                'level': '' if s.get('note') else str(level),
                'stem': s.get('form') or '',
                'allCited': '1' if s.get('all_cited') else '',
                'pre': s.get('pre_num') or '',
                'count': s.get('occurrences') or '',
            })
            if s.get('senses'):
                walk(s['senses'], level + 1)
    walk(e['content']['senses'], 1)
    return parts


def apply_corrections(rid, e, parts, corr):
    for c in corr.get(rid, []):
        k = c['kind']
        if k == 'letter':
            # Each word of the quotation corrected, where the quotation
            # stands before a link to the verse.
            old = c['quote']
            hits = 0
            for p in parts:
                for m in list(re.finditer(re.escape('<span dir="rtl">' + old + '</span>'), p['html'])):
                    after = p['html'][m.end():m.end() + 300]
                    if re.match(r'\s*<a [^>]*data-ref="' + re.escape(c['ref']) + '"', after):
                        hits += 1
            if not hits:
                fail(f'{rid}: correction quote not found: {old}')

        elif k == 'ref':
            pass
        elif k == 'homograph':
            if e.get('ordinal') != c['sic']:
                fail(f'{rid}: homograph correction does not apply')
            e['ordinal'] = c['corr']
        elif k == 'markup':
            pass
    # Letters: replace each quotation once all its words are known.
    done = set()
    for c in corr.get(rid, []):
        if c['kind'] != 'letter' or (c['quote'], c['ref']) in done:
            continue
        done.add((c['quote'], c['ref']))
        group = [x for x in corr[rid] if x['kind'] == 'letter' and (x['quote'], x['ref']) == (c['quote'], c['ref'])]
        new = c['quote']
        for g in group:
            words = re.split(r'([\s\u05be()\[\]]+)', new)
            if words.count(g['sic']) != 1:
                fail(f"{rid}: {g['sic']} is not once a word of the quotation")
            new = ''.join(g['corr'] if w == g['sic'] else w for w in words)
        for p in parts:
            p['html'] = re.sub(re.escape('<span dir="rtl">' + c['quote'] + '</span>') +
                               r'(?=\s*<a [^>]*data-ref="' + re.escape(c['ref']) + '")',
                               '<span dir="rtl">' + new.replace('\\', '\\\\') + '</span>', p['html'])
    for c in corr.get(rid, []):
        if c['kind'] == 'ref':
            for p in parts:
                p['html'] = re.sub(r'(<a [^>]*data-ref="' + re.escape(c['link']) + r'"[^>]*>)' + re.escape(c['sic']) +
                                   '</a>', lambda m: m.group(1) + c['corr'] + '</a>', p['html'])


# ---- the TEI file

def text_of(node):
    """Text in reading order: a choice as its corr, the converter's notes
    and line breaks as nothing."""
    out = []
    for ch in node.childNodes:
        if ch.nodeType == ch.TEXT_NODE:
            out.append(ch.data)
        elif ch.nodeType == ch.ELEMENT_NODE:
            name = ch.localName
            if name == 'choice':
                corr = [x for x in ch.childNodes if x.nodeType == x.ELEMENT_NODE and x.localName == 'corr']
                out.append(text_of(corr[0]))
            elif name == 'note' and ch.getAttribute('type') == 'sourceCorrection':
                continue
            else:
                out.append(text_of(ch))
    return ''.join(out)


def tei_links(node):
    out = []
    for r in node.getElementsByTagNameNS(TEI, 'ref'):
        out.append((r.getAttribute('type'), text_of(r), r.getAttribute('target'), r.getAttributeNS(BN, 'sid')))
    return out


def main():
    source = json.loads((HERE / 'source' / 'bdb.json').read_text(encoding='utf-8'))
    corr = {}
    for c in yaml.safe_load((HERE / 'corrections.yaml').read_text(encoding='utf-8')):
        corr.setdefault(c['entry'], []).append(c)
    for c in yaml.safe_load((HERE / 'corrections-letters.yaml').read_text(encoding='utf-8')):
        c['kind'] = 'letter'
        corr.setdefault(c['entry'], []).append(c)
    review = (HERE / 'strongs-review.md').read_text(encoding='utf-8')
    unresolved = {}
    for line in review.split('# Links to entries that lead to no single entry')[1].splitlines():
        cells = [x.strip() for x in line.strip().strip('|').split('|')]
        if len(cells) == 3 and re.fullmatch(r'BDBA?\d+', cells[0]):
            unresolved[cells[0]] = unresolved.get(cells[0], 0) + 1

    doc = minidom.parse(str(HERE / 'eng_bdb.tei.xml'))
    entries = doc.getElementsByTagNameNS(TEI, 'entry')
    if len(entries) != len(source):
        fail(f'{len(entries)} entries in the TEI file, {len(source)} in the source')
    ids = {x.getAttribute('xml:id') for x in entries}
    bible = entry_links = 0
    for e, x in zip(source, entries):
        rid = e['rid']
        if x.getAttribute('xml:id') != rid:
            fail(f'entry order: {x.getAttribute("xml:id")} where {rid} was expected')
            continue
        parts = source_parts(e)
        apply_corrections(rid, e, parts, corr)
        # Headword line.
        forms = [f for f in x.childNodes if f.nodeType == f.ELEMENT_NODE and f.localName == 'form']
        lemma = [f for f in forms if f.getAttribute('type') == 'lemma']
        orth = lemma[0].getElementsByTagNameNS(TEI, 'orth')[0] if lemma else None
        if orth is None or text_of(orth) != e['headword']:
            fail(f'{rid}: headword')
        expect = {
            'n': e.get('ordinal') or '',
            'bn:allCited': '1' if e.get('all_cited') else '',
            'bn:peculiar': '1' if e.get('peculiar') else '',
            'bn:brackets': {'first_word': 'first', 'all': 'all', None: ''}[e.get('brackets')],
            'bn:count': e.get('occurrences') or '',
            'bn:root': '1' if e.get('root') else '',
        }
        for k, v in expect.items():
            got = x.getAttribute(k)
            if got != v:
                fail(f'{rid}: {k} is "{got}", the source gives "{v}"')
        variants = [(text_of(f.getElementsByTagNameNS(TEI, 'orth')[0]), f.getAttributeNS(BN, 'count'))
                    for f in forms if f.getAttribute('type') == 'variant']
        if variants != [(a['word'], a.get('occurences', '')) for a in e.get('alt_headwords') or []]:
            fail(f'{rid}: variant spellings')
        # Parts.
        tparts = []
        for ch in x.childNodes:
            if ch.nodeType != ch.ELEMENT_NODE:
                continue
            if ch.localName == 'sense':
                tparts.append(('sense', ch))
            elif ch.localName == 'note' and ch.getAttribute('type') in ('comment', 'forms'):
                tparts.append(('note' if ch.getAttribute('type') == 'comment' else 'forms', ch))
            elif ch.localName == 'note' and ch.getAttribute('type') == 'sourceCorrection':
                continue
            elif ch.localName != 'form':
                fail(f'{rid}: unexpected <{ch.localName}>')
        if len(tparts) != len(parts):
            fail(f'{rid}: {len(tparts)} parts in the TEI file, {len(parts)} in the source')
            continue
        want_links = []
        for p, (kind, node) in zip(parts, tparts):
            if p['kind'] != kind:
                fail(f'{rid}: a {kind} where the source has a {p["kind"]}')
            for attr, key in (('n', 'n'), ('bn:level', 'level'), ('bn:stem', 'stem'), ('bn:allCited', 'allCited'),
                              ('bn:pre', 'pre'), ('bn:count', 'count')):
                if kind == 'forms':
                    break
                if node.getAttribute(attr) != p[key]:
                    fail(f'{rid}: {attr} is "{node.getAttribute(attr)}", the source gives "{p[key]}"')
            want = plain(p['html'])
            got = text_of(node)
            if got != want:
                i = next((k for k, (a, b) in enumerate(zip(got, want)) if a != b), min(len(got), len(want)))
                fail(f'{rid}: text differs at {i}: TEI "{got[max(0, i - 30):i + 30]}" source "{want[max(0, i - 30):i + 30]}"')
            want_links += source_links(p['html'])
        links = tei_links(x)
        kept = [(k, s) for k, s in want_links if k != 'other']
        n_unres = unresolved.get(rid, 0)
        if len(links) != len(kept) - n_unres:
            fail(f'{rid}: {len(links)} links in the TEI file, {len(kept) - n_unres} expected')
        else:
            for (kind, shown, target, sid), (k2, s2) in zip(links, [k for k in kept if True]):
                if n_unres:
                    break
                if kind != k2 or shown != s2:
                    fail(f'{rid}: link "{shown}" ({kind}) where the source has "{s2}" ({k2})')
                if kind == 'entry' and target[1:] not in ids:
                    fail(f'{rid}: link to {target}, which does not exist')
                if kind == 'bible' and not re.fullmatch(r'[1-3A-Z]{3} \d+(:\d+)?', sid):
                    fail(f'{rid}: scripture link without a verse: "{sid}"')
        bible += sum(1 for l in links if l[0] == 'bible')
        entry_links += sum(1 for l in links if l[0] == 'entry')
    if failures:
        report()
    print(f'{len(source)} entries match the source: text, headword lines, senses, and '
          f'{bible} scripture and {entry_links} entry links')


if __name__ == '__main__':
    main()
