#!/usr/bin/env python3
"""
Computes a Bible Nav module's text root and content root, following
docs/integrity-spec.md and nothing else.

It shares no code with the generator, on purpose: if both agree, the spec is
clear enough to implement and the generator follows it. It needs only Python 3
and its standard library, so anyone can check a copy:

    python3 tools/text-roots.py eng_kjv-1.1.0.db

and compare the output with "textRoot" and "contentRoot" in the manifest.
"""
import hashlib, json, sqlite3, struct, sys

def u32(n): return struct.pack('>I', n)
def s(x):
    b = x.encode('utf-8')
    return u32(len(b)) + b
H = lambda b: hashlib.sha256(b).digest()

def to_items(stored):
    out = []
    for c in stored:
        if isinstance(c, str):
            out.append(c)
        elif c['style'] == 'w':
            out.append(('w', [('strong', c['strong'])], [c['txt']]))
        else:
            out.append((c['style'], [], to_items(c['children'])))
    return out

def text_view(items):
    changed = []
    for it in items:
        if isinstance(it, str):
            changed.append(it)
        elif it[0] == 'f':
            pass
        elif it[0] in ('w', 'wj'):
            changed.extend(text_view(it[2]))
        else:
            changed.append((it[0], [], text_view(it[2])))
    joined = []
    for it in changed:
        if isinstance(it, str) and joined and isinstance(joined[-1], str):
            joined[-1] += it
        else:
            joined.append(it)
    return [it for it in joined if it != '']

def enc(it):
    if isinstance(it, str):
        return b't' + s(it)
    style, attrs, children = it
    attrs = sorted(attrs, key=lambda a: a[0].encode('utf-8'))
    return (b'e' + s(style) + u32(len(attrs)) + b''.join(s(n) + s(v) for n, v in attrs)
            + u32(len(children)) + b''.join(enc(c) for c in children))

def enc_list(items): return u32(len(items)) + b''.join(enc(i) for i in items)

def roots(path):
    db = sqlite3.connect(f'file:{path}?immutable=1&mode=ro', uri=True)
    result = {}
    for view in ('text', 'content'):
        tests = []
        present = {r[0] for r in db.execute('SELECT code FROM testaments')}
        for t in [c for c in ('OT', 'NT') if c in present]:
            books = []
            for bid, code in db.execute('SELECT id, code FROM books WHERE testamentCode=? ORDER BY id', (t,)).fetchall():
                chs = []
                for (nbr,) in db.execute('SELECT nbr FROM chapters WHERE bookId=? ORDER BY nbr', (bid,)).fetchall():
                    items = [(vid, 0, ('verse', vn, ch)) for vid, vn, ch in db.execute(
                        'SELECT id, nbr, children FROM verses WHERE bookId=? AND chapter=?', (bid, nbr))]
                    items += [(after + 0.5, hid, ('heading', st, ch)) for hid, after, st, ch in db.execute(
                        'SELECT id, afterVerseId, style, children FROM headings WHERE bookId=? AND chapter=?', (bid, nbr))]
                    items.sort(key=lambda x: (x[0], x[1]))
                    leaves = []
                    for _, _, (kind, label, ch) in items:
                        its = to_items(json.loads(ch))
                        if view == 'text':
                            its = text_view(its)
                        if kind == 'verse':
                            leaves.append(H(b'\x00' + s('verse') + s(str(label)) + enc_list(its)))
                        elif view == 'content' or label == 'd':
                            leaves.append(H(b'\x00' + s('heading') + s(label) + enc_list(its)))
                    chs.append(H(b'\x01' + s('chapter') + s(str(nbr)) + u32(len(leaves)) + b''.join(leaves)))
                books.append(H(b'\x01' + s('book') + s(code) + u32(len(chs)) + b''.join(chs)))
            tests.append(H(b'\x01' + s('testament') + s(t) + u32(len(books)) + b''.join(books)))
        result[view] = H(b'\x01' + s('bible-nav text tree') + u32(1) + s(view) + u32(len(tests)) + b''.join(tests)).hex()
    return result

if __name__ == '__main__':
    print(json.dumps(roots(sys.argv[1]), indent=2))
