#!/usr/bin/env python3
"""
Compares eBible.org's eng-kjv2006 USFX with a Bible Nav module, verse by verse.

    python3 tools/compare-ebible.py assets/eng_kjv/ebible/eng-kjv2006_usfx.zip \
        exports/eng_kjv-1.1.0.db

It first checks the USFX file against the SHA-256 list in eBible's
signature.txt.asc inside the archive. (Checking that list's PGP signature
needs GnuPG; see assets/eng_kjv/PROVENANCE.md.) Then it compares, for every
verse: the text, the inline markup (each word's Strong's number, add, nd, wj,
tl), and the footnotes; and the headings with their positions, the paragraph
styles, and the book names and titles. Whitespace runs count as one space,
because USFX puts words on separate lines. It exits with status 1 if
anything differs.

It needs only Python 3 and its standard library, and shares no code with the
generator.
"""
import hashlib, io, zipfile
import collections, json, re, sqlite3, sys
import xml.etree.ElementTree as ET

ws = lambda s: re.sub(r'\s+', ' ', s).strip()
INLINE = {'w', 'add', 'nd', 'wj', 'tl'}

# ---- eBible USFX ----
archive = zipfile.ZipFile(sys.argv[1])
xml_name = next(n for n in archive.namelist() if n.endswith('_usfx.xml'))
xml = archive.read(xml_name)
signed = archive.read('signature.txt.asc').decode('utf-8')
listed = {line.split('  ', 1)[1].strip(): line.split('  ', 1)[0]
          for line in signed.splitlines() if re.match(r'^[0-9a-f]{64}  ', line)}
if listed.get(xml_name) != hashlib.sha256(xml).hexdigest():
    sys.exit(f'{xml_name} does not match the SHA-256 in signature.txt.asc')
print(f'{xml_name} matches the SHA-256 in eBible\'s signed list.')
usfx = ET.parse(io.BytesIO(xml)).getroot()
ev = collections.OrderedDict()  # sid -> {'text': [...], 'marks': [...], 'notes': [...]}
eheadings = []  # (book, chapter, after_sid, style, text)
epara = []      # (book, chapter, style)
ebooks = {}

def walk(node, state, in_note=False):
    tag = node.tag
    if tag == 'book':
        state['book'] = node.get('id'); state['chapter'] = 0; state['sid'] = None
        ebooks[state['book']] = {}
    elif tag == 'toc':
        ebooks[state['book']][f"toc{node.get('level')}"] = ws(''.join(node.itertext()))
    elif tag == 'h':
        ebooks[state['book']]['h'] = ws(''.join(node.itertext()))
    elif tag == 'c':
        state['chapter'] = int(node.get('id'))
    elif tag == 'v':
        b, c, v = node.get('bcv').split('.')
        state['sid'] = f'{b} {c}:{v}'
        ev[state['sid']] = {'text': [], 'marks': [], 'notes': []}
    elif tag == 've':
        state['last'] = state['sid']; state['sid'] = None
    elif tag == 'f':
        if state['sid']:
            parts = [(p.tag, ws(''.join(p.itertext()))) for p in node]
            ev[state['sid']]['notes'].append(parts)
        if node.tail and state['sid']:
            ev[state['sid']]['text'].append(node.tail)
        return
    elif tag in ('d', 's') or (tag == 'p' and node.get('style', '').startswith('mt')):
        text = ws(''.join(node.itertext()))
        if tag == 'p':
            ebooks[state['book']][node.get('style')] = text
        else:
            style = node.get('style') or ('s1' if tag == 's' else tag)
            eheadings.append((state['book'], state['chapter'], state.get('last'), style, text))
            epara.append((state['book'], state['chapter'], style))
        if node.tail and state['sid']:
            ev[state['sid']]['text'].append(node.tail)
        return
    if tag in ('p', 'q', 'b') and node.get('style', tag) not in ('mt1', 'mt2'):
        epara.append((state['book'], state['chapter'], node.get('style') or tag))
    if tag in INLINE and state['sid']:
        ev[state['sid']]['marks'].append((tag, node.get('s') or '', ws(''.join(
            t for t in node.itertext()))))
    if tag not in ('book', 'toc', 'h', 'id') and node.text and state['sid']:
        ev[state['sid']]['text'].append(node.text)
    for child in node:
        walk(child, state, in_note)
    if node.tail and state['sid'] and tag not in ('v',):
        ev[state['sid']]['text'].append(node.tail)
    elif tag == 'v' and node.tail and state['sid']:
        ev[state['sid']]['text'].append(node.tail)

walk(usfx, {'sid': None, 'book': None, 'chapter': 0, 'last': None})

# ---- Module ----
db = sqlite3.connect(f'file:{sys.argv[2]}?immutable=1&mode=ro', uri=True)
mv = collections.OrderedDict()

def mwalk(items, out, top=True):
    for it in items:
        if isinstance(it, str):
            out['text'].append(it)
        elif it['style'] == 'f':
            out['notes'].append([(p['style'], ws(''.join(flat(p['children'])))) for p in it['children']])
        elif it['style'] == 'w':
            out['marks'].append(('w', it['strong'], ws(it['txt'])))
            out['text'].append(it['txt'])
        else:
            out['marks'].append((it['style'], '', ws(''.join(flat(it['children'])))))
            mwalk(it['children'], out, False)

def flat(items):
    for it in items:
        if isinstance(it, str):
            yield it
        elif it['style'] == 'f':
            continue
        elif it['style'] == 'w':
            yield it['txt']
        else:
            yield from flat(it['children'])

for sid, children in db.execute('SELECT sid, children FROM verses ORDER BY id'):
    out = {'text': [], 'marks': [], 'notes': []}
    mwalk(json.loads(children), out)
    mv[sid] = out

# Strong's numbers: compare without leading zeros in case of format differences.
norm_strong = lambda s: re.sub(r'^([GH])0*', r'\1', s)
def norm_marks(marks):
    return [(t, norm_strong(s), x) for t, s, x in marks]

problems = collections.defaultdict(list)
if list(ev) != list(mv):
    only_e = [s for s in ev if s not in mv]; only_m = [s for s in mv if s not in ev]
    problems['verse list'].append(f'only eBible: {only_e[:5]} only module: {only_m[:5]}')
for sid in ev:
    if sid not in mv:
        continue
    e, m = ev[sid], mv[sid]
    et, mt = ws(''.join(e['text'])), ws(''.join(m['text']))
    if et != mt:
        kind = 'spacing only' if et.replace(' ', '') == mt.replace(' ', '') else 'verse text'
        problems[kind].append((sid, et, mt))
    if norm_marks(e['marks']) != norm_marks(m['marks']):
        problems['markup'].append((sid, e['marks'], m['marks']))
    if e['notes'] != m['notes']:
        problems['notes'].append((sid, e['notes'], m['notes']))

mheadings = [(b, c, s, st, ws(r)) for b, c, s, st, r in db.execute(
    '''SELECT k.code, h.chapter, v.sid, h.style, h.raw FROM headings h
       JOIN books k ON k.id = h.bookId LEFT JOIN verses v ON v.id = h.afterVerseId ORDER BY h.id''')]
eh = [(b, c, s, st, t) for b, c, s, st, t in eheadings]
if len(eh) != len(mheadings):
    problems['headings'].append(f'{len(eh)} in eBible, {len(mheadings)} in module')
for a, b in zip(eh, mheadings):
    if a[0] != b[0] or a[1] != b[1] or a[3] != b[3] or a[4] != b[4]:
        problems['headings'].append((a, b))

mpara = [(b, c, st) for b, c, st in db.execute(
    'SELECT k.code, p.chapter, p.style FROM paragraphs p JOIN books k ON k.id = p.bookId ORDER BY p.id')]
if epara != mpara:
    diffs = [(i, a, b) for i, (a, b) in enumerate(zip(epara, mpara)) if a != b]
    problems['paragraphs'].append(f'{len(epara)} in eBible, {len(mpara)} in module; first differences: {diffs[:5]}')

mbooks = {code: dict(h=h, toc1=t1, toc2=t2, toc3=t3, mt1=m1, mt2=m2) for code, h, t1, t2, t3, m1, m2 in db.execute(
    'SELECT code, header, toc1, toc2, toc3, mt1, mt2 FROM books')}
for code, fields in ebooks.items():
    for k, v in fields.items():
        if k in mbooks.get(code, {}) and (mbooks[code][k] or '') != v:
            problems['book fields'].append((code, k, v, mbooks[code][k]))

print(f'verses: eBible {len(ev)}, module {len(mv)}')
print(f'notes: eBible {sum(len(v["notes"]) for v in ev.values())}, module {sum(len(v["notes"]) for v in mv.values())}')
for kind in ['verse list', 'verse text', 'spacing only', 'markup', 'notes', 'headings', 'paragraphs', 'book fields']:
    items = problems.get(kind, [])
    print(f'\n== {kind}: {len(items)}')
    for item in items[:8]:
        print('  ', item if not isinstance(item, tuple) or len(str(item)) < 600 else str(item)[:600])
total = sum(len(v) for v in problems.values())
print(f'\n{total} differences.')
sys.exit(1 if total else 0)
