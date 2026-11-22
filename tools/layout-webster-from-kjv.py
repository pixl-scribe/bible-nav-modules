#!/usr/bin/env python3
"""
Gives Webster's USX (assets/eng_webster/*.usx) the KJV's paragraphs:
eBible's Webster has one paragraph per chapter, while Webster's 1833
printing followed the KJV it was set from. Decided with the maintainer
2026-11-22. The layout is taken from the KJV's source USX
(assets/eng_kjv/*.usx), chapter by chapter: each prose paragraph (p),
each poetic line (q1, the Psalms) and each blank line between stanzas (b)
holds the same verses as in the KJV. Headings (d, s1) are not copied:
Webster's Psalm titles are part of verse 1, and it has no closing notes.

    tools/venv/bin/python -I tools/import-ebible.py convert eng_webster
    tools/venv/bin/python -I tools/layout-webster-from-kjv.py
    tools/venv/bin/python -I tools/tag-webster-strongs.py
    tools/venv/bin/python -I tools/check-webster.py

Only whole verses move into new paragraphs, so no verse's text changes
(the module's text root stays the same). It edits the files as text and
refuses a file that isn't one paragraph per chapter.
"""
import re
import sys
from pathlib import Path

KJV = Path('assets/eng_kjv')
WBT = Path('assets/eng_webster')
INDENT = '\n  '


def kjv_layout(xml):
    """{chapter sid: [(style, [verse sids])]} in reading order; a blank
    line is ('b', [])."""
    layout = {}
    chapter = None
    for m in re.finditer(r'<chapter [^>]*sid="([^"]+)"[^>]*/>|<para style="([a-z0-9]+)"\s*/>|'
                         r'<para style="([a-z0-9]+)"[^>]*>(.*?)</para>', xml, re.S):
        if m.group(1):
            chapter = m.group(1)
            layout[chapter] = []
        elif m.group(2):
            if m.group(2) != 'b':
                sys.exit(f'empty paragraph of style {m.group(2)} in the KJV')
            if chapter:
                layout[chapter].append(('b', []))
        else:
            style, body = m.group(3), m.group(4)
            verses = re.findall(r'<verse [^>]*sid="([^"]+)"', body)
            if style in ('p', 'q1'):
                if chapter is None or not verses:
                    sys.exit(f'a {style} paragraph without verses in the KJV ({chapter})')
                layout[chapter].append((style, verses))
            elif style in ('d', 's1'):
                if verses:
                    sys.exit(f'a {style} heading holding verses in the KJV ({chapter})')
            elif chapter is not None:
                sys.exit(f'paragraph style {style} in a KJV chapter ({chapter})')
    return layout


CHAPTER_PARA = re.compile(r'(<chapter style="c" number="\d+" sid="([^"]+)" />\n  )<para style="p">(.*?)</para>',
                          re.S)
VERSE = re.compile(r'<verse style="v" number="\d+" sid="([^"]+)" />.*?<verse eid="\1" />', re.S)


def lay_out(name, layout, counts):
    path = WBT / name
    xml = path.read_text(encoding='utf-8')
    if '<para style="q1"' in xml or '<para style="b"' in xml:
        sys.exit(f'{path} is already laid out: convert it again first')

    def chapter(m):
        sid, body = m.group(2), m.group(3)
        verses = {v.group(1): v.group(0) for v in VERSE.finditer(body)}
        if ''.join(verses.values()) != body:
            sys.exit(f'{sid}: its paragraph holds more than its verses')
        if sid not in layout:
            sys.exit(f'{sid}: not in the KJV')
        wanted = [v for _, vs in layout[sid] for v in vs]
        if wanted != list(verses):
            sys.exit(f'{sid}: the KJV\'s paragraphs hold other verses')
        paras = []
        for style, vs in layout[sid]:
            counts[style] = counts.get(style, 0) + 1
            if style == 'b':
                paras.append('<para style="b" />')
            else:
                paras.append(f'<para style="{style}">' + ''.join(verses[v] for v in vs) + '</para>')
        return m.group(1) + INDENT.join(paras)

    out, n = CHAPTER_PARA.subn(chapter, xml)
    if n != len([c for c in layout if c.split(' ')[0] == name[:3].upper()]):
        sys.exit(f'{path}: {n} chapters laid out')
    path.write_text(out, encoding='utf-8')
    counts['chapters'] = counts.get('chapters', 0) + n


def main():
    counts = {}
    names = sorted(p.name for p in WBT.glob('*.usx'))
    if len(names) != 66:
        sys.exit(f'{len(names)} USX files in {WBT}, 66 expected')
    for name in names:
        lay_out(name, kjv_layout((KJV / name).read_text(encoding='utf-8')), counts)
    print(', '.join(f'{k} {v}' for k, v in counts.items()))


if __name__ == '__main__':
    main()
