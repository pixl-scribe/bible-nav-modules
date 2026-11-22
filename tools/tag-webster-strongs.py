#!/usr/bin/env python3
"""
Adds the KJV's Strong's numbers to Webster's USX (assets/eng_webster/*.usx),
by aligning each verse of Webster (Noah Webster's 1833 revision of the KJV)
with the same verse of the KJV (assets/eng_kjv/*.usx, the locked source).
Decided with the maintainer 2026-11-22.

    tools/venv/bin/python -I tools/import-ebible.py convert eng_webster   # the untagged USX
    tools/venv/bin/python -I tools/layout-webster-from-kjv.py              # the KJV's paragraphs
    tools/venv/bin/python -I tools/tag-webster-strongs.py
    tools/venv/bin/python -I tools/check-webster.py

The text doesn't change: the tool only puts <char style="w" strong="...">
around words already there, editing the files as text, so every other
byte stays as it was. It refuses USX that already has Strong's numbers.

The KJV tags phrases (a w element, usually one word, sometimes several).
Each verse's words are compared (case, apostrophes, and the ligatures ae
and oe aside; Psalm titles, which the KJV gives as a heading before verse
1 and Webster as part of it, counted as the start of verse 1), and a
KJV phrase's number goes to the Webster words that stand for it:

  exact      the same words, in the same place
  compound   written apart or together ("firstborn", "first born")
  swap       words replaced one for one ("unto" -> "to", "spake" ->
             "spoke"): Webster's updates, translating the same word
  particle   a particle dropped, the main word kept ("flew up" -> "flew")
  rewritten  a change within the one phrase ("did eat" -> "ate", "round
             about" -> "around"): the same Hebrew or Greek word, rendered
             anew

A phrase is left without a number where Webster removed all its words,
or where a change runs across two tagged phrases (which number belongs
where can't be told). Where two phrases would share Webster words, both
are left without one.
"""
import difflib
import re
import sys
from pathlib import Path

KJV = Path('assets/eng_kjv')
WBT = Path('assets/eng_webster')

TAG = re.compile(r'<[^>]+>')
WORD = re.compile(r"(?:[A-Za-z\u00c6\u00e6\u0152\u0153\u2019']|&apos;)+")


def norm(word):
    w = word.replace('&apos;', "'").replace('\u2019', "'")
    w = w.replace('\u00e6', 'ae').replace('\u00c6', 'Ae').replace('\u0153', 'oe').replace('\u0152', 'Oe')
    return w.lower()


def segments(xml):
    """The file as (kind, text, start) pieces: 'tag' or 'text'."""
    pos = 0
    for m in TAG.finditer(xml):
        if m.start() > pos:
            yield 'text', xml[pos:m.start()], pos
        yield 'tag', m.group(0), m.start()
        pos = m.end()
    if pos < len(xml):
        yield 'text', xml[pos:], pos


def attr(tag, name):
    m = re.search(name + r'="([^"]*)"', tag)
    return m.group(1) if m else None


def kjv_verses(xml):
    """{sid: (tokens, phrases)}: each token normalized; phrases as (start,
    end, strong) over the tokens. Notes are left out; a Psalm title (a d
    heading before verse 1) is counted as the start of verse 1."""
    verses = {}
    title = ([], [])
    current = None
    in_note = 0
    in_w = None
    in_title = False
    chapter = None
    for kind, text, _ in segments(xml):
        if kind == 'tag':
            if text.startswith('<note'):
                in_note += 0 if text.endswith('/>') else 1
            elif text.startswith('</note'):
                in_note -= 1
            elif text.startswith('<chapter') and attr(text, 'sid'):
                chapter = attr(text, 'sid')
            elif text.startswith('<para') and attr(text, 'style') == 'd':
                in_title = True
                title = ([], [])
            elif text.startswith('</para'):
                in_title = False
            elif text.startswith('<verse') and attr(text, 'sid'):
                current = attr(text, 'sid')
                verses[current] = ([], [])
                if current.endswith(':1') and title[0]:
                    verses[current] = (list(title[0]), list(title[1]))
                    title = ([], [])
            elif text.startswith('<verse') and attr(text, 'eid'):
                current = None
            elif text.startswith('<char') and attr(text, 'style') == 'w':
                in_w = (attr(text, 'strong'), None)
            elif text.startswith('</char') and in_w is not None:
                # A w element holds text only in this source.
                in_w = None
            continue
        if in_note:
            continue
        target = verses[current] if current else (title if in_title else None)
        if target is None:
            continue
        toks, phrases = target
        words = [norm(m.group(0)) for m in WORD.finditer(text)]
        if in_w is not None and words:
            phrases.append((len(toks), len(toks) + len(words), in_w[0]))
        toks.extend(words)
    return verses


def webster_tokens(xml):
    """{sid: [(normalized word, start, end)]}: each word's place in the file."""
    verses = {}
    current = None
    for kind, text, start in segments(xml):
        if kind == 'tag':
            if text.startswith('<verse') and attr(text, 'sid'):
                current = attr(text, 'sid')
                verses[current] = []
            elif text.startswith('<verse') and attr(text, 'eid'):
                current = None
            continue
        if current is None:
            continue
        for m in WORD.finditer(text):
            verses[current].append((norm(m.group(0)), start + m.start(), start + m.end(), start, start + len(text)))
    return verses


def align(a, phrases, b):
    """Each phrase's Webster token span (first, last), or None; and its kind."""
    ops = difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()
    owner = {}
    for g, (st, en, _) in enumerate(phrases):
        for i in range(st, en):
            owner[i] = g
    spans = [set() for _ in phrases]
    kinds = ['exact'] * len(phrases)
    lost = set()
    rank = {'exact': 0, 'compound': 1, 'swap': 2, 'particle': 3, 'rewritten': 4}

    def mark(g, kind):
        if rank[kind] > rank[kinds[g]]:
            kinds[g] = kind

    for tag, i1, i2, j1, j2 in ops:
        if tag == 'equal':
            for d in range(i2 - i1):
                if i1 + d in owner:
                    spans[owner[i1 + d]].add(j1 + d)
            continue
        touched = {owner[i] for i in range(i1, i2) if i in owner}
        if tag == 'insert':
            g = owner.get(i1 - 1) if i1 > 0 else None
            if g is not None and i1 < len(a) and owner.get(i1) == g:
                spans[g].update(range(j1, j2))
                mark(g, 'rewritten')
            continue
        if not touched:
            continue
        if tag == 'replace' and ''.join(a[i1:i2]) == ''.join(b[j1:j2]):
            if len(touched) > 1:
                lost.update(touched)
            else:
                g = next(iter(touched))
                spans[g].update(range(j1, j2))
                mark(g, 'compound')
            continue
        if tag == 'replace' and i2 - i1 == j2 - j1:
            for d in range(i2 - i1):
                if i1 + d in owner:
                    spans[owner[i1 + d]].add(j1 + d)
                    mark(owner[i1 + d], 'swap')
            continue
        if len(touched) > 1:
            lost.update(touched)
            continue
        g = next(iter(touched))
        st, en, _ = phrases[g]
        if tag == 'delete':
            if st >= i1 and en <= i2:
                lost.add(g)
            else:
                mark(g, 'particle')
        else:
            spans[g].update(range(j1, j2))
            mark(g, 'rewritten')
    out = []
    for g in range(len(phrases)):
        if g in lost or not spans[g]:
            out.append((None, 'untagged'))
        else:
            out.append(((min(spans[g]), max(spans[g])), kinds[g]))
    # Phrases that would share Webster words: neither gets a number.
    taken = {}
    for g, (span, _) in enumerate(out):
        if span:
            for j in range(span[0], span[1] + 1):
                taken.setdefault(j, []).append(g)
    clash = {g for gs in taken.values() if len(gs) > 1 for g in gs}
    return [((None, 'untagged') if g in clash else out[g]) for g in range(len(out))]


def tag_file(name, counts):
    kxml = (KJV / name).read_text(encoding='utf-8')
    wpath = WBT / name
    wxml = wpath.read_text(encoding='utf-8')
    if 'style="w"' in wxml:
        sys.exit(f'{wpath} already has Strong\'s numbers: convert it again first')
    kv = kjv_verses(kxml)
    wv = webster_tokens(wxml)
    inserts = []  # (position, text), in any order
    for sid, words in wv.items():
        if sid not in kv:
            sys.exit(f'{sid}: not in the KJV')
        a, phrases = kv[sid]
        b = [w for w, *_ in words]
        for (span, kind), (st, en, strong) in zip(align(a, phrases, b), phrases):
            counts[kind] = counts.get(kind, 0) + 1
            if span is None:
                continue
            first, last = span
            # One w element per text piece: a phrase across markup (an
            # italic word) is tagged piece by piece, with the same number.
            pieces = []
            for j in range(first, last + 1):
                _, s, e, seg_start, seg_end = words[j]
                if pieces and pieces[-1][2] == seg_start:
                    pieces[-1][1] = e
                else:
                    pieces.append([s, e, seg_start])
            for s, e, _ in pieces:
                inserts.append((s, f'<char style="w" strong="{strong}">'))
                inserts.append((e, '</char>'))
    out = []
    pos = 0
    # Closing before opening at one place, so neighbours don't nest.
    for p, text in sorted(inserts, key=lambda x: (x[0], 0 if x[1] == '</char>' else 1)):
        out.append(wxml[pos:p])
        out.append(text)
        pos = p
    out.append(wxml[pos:])
    wpath.write_text(''.join(out), encoding='utf-8')


def main():
    counts = {}
    names = sorted(p.name for p in WBT.glob('*.usx'))
    if len(names) != 66:
        sys.exit(f'{len(names)} USX files in {WBT}, 66 expected')
    for name in names:
        tag_file(name, counts)
    total = sum(counts.values())
    carried = total - counts.get('untagged', 0)
    print(f'{carried} of {total} KJV phrases carried ({carried / total:.2%}):',
          ', '.join(f'{k} {v}' for k, v in sorted(counts.items(), key=lambda x: -x[1])))


if __name__ == '__main__':
    main()
