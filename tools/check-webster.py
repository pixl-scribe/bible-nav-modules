#!/usr/bin/env python3
"""
Checks Webster's USX (assets/eng_webster/*.usx) after the KJV's paragraphs
(tools/layout-webster-from-kjv.py) and Strong's numbers
(tools/tag-webster-strongs.py) have been added, sharing no code with
either.

    tools/venv/bin/python -I tools/check-webster.py

1. No text changed: with each <char style="w" strong="..."> element
   replaced by its text, and each chapter's paragraphs joined back into
   the one paragraph eBible gives, every file must have the SHA-256 that
   assets/eng_webster/SHA256SUMS.converted gives for the USX converted from
   eBible (tools/import-ebible.py convert).
2. The layout is the KJV's: read with an XML parser, each chapter's
   paragraphs (p and q1 with their verses, and the blank lines b) must be
   the KJV's (assets/eng_kjv), its headings (d, s1) aside.
3. Every number is the KJV's, in the KJV's order: the numbers in each verse
   must be a subsequence of the numbers in the same verse of the KJV, whose
   Psalm titles (d headings before verse 1) count as the start of verse 1;
   neighbouring repeats count once on both sides, since a phrase that
   spans an italic word is tagged piece by piece.
"""
import hashlib
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

KJV = Path('assets/eng_kjv')
WBT = Path('assets/eng_webster')
W = re.compile(r'<char style="w" strong="[^"]*">([^<]*)</char>')


def joined(text):
    """Each chapter's paragraphs as one p paragraph again, as converted."""
    def chapter(m):
        body = m.group(2)
        paras = re.findall(r'<para style="(?:p|q1)">(.*?)</para>|<para style="b" />', body, re.S)
        rest = re.sub(r'<para style="(?:p|q1)">.*?</para>|<para style="b" />|\n  ', '', body, flags=re.S)
        if rest:
            raise ValueError(f'{m.group(1)}: unexpected content between paragraphs')
        return f'{m.group(1)}\n  <para style="p">' + ''.join(paras) + '</para>\n  '
    return re.sub(r'(<chapter style="c" number="\d+" sid="[^"]+" />)\n  (.*?)(?=<chapter eid=)', chapter,
                  text, flags=re.S)


def layout(path):
    """{chapter: [(style, [verse sids])]} from the XML; headings left out."""
    out = {}
    chapter = None
    for el in ET.parse(path).getroot():
        if el.tag == 'chapter' and el.get('sid'):
            chapter = el.get('sid')
            out[chapter] = []
        elif el.tag == 'para' and chapter and el.get('style') in ('p', 'q1', 'b'):
            out[chapter].append((el.get('style'), [v.get('sid') for v in el.iter('verse') if v.get('sid')]))
    return out


def numbers_by_verse(path):
    out = {}
    pending = []
    current = None

    def walk(el, in_title):
        nonlocal current, pending
        if el.tag == 'note':
            return
        if el.tag == 'verse':
            if el.get('sid'):
                current = el.get('sid')
                out[current] = pending if current.endswith(':1') else []
                pending = []
            elif el.get('eid'):
                current = None
            return
        title = in_title or (el.tag == 'para' and el.get('style') == 'd')
        if el.tag == 'char' and el.get('style') == 'w':
            if current is not None:
                out[current].append(el.get('strong'))
            elif title:
                pending.append(el.get('strong'))
        for child in el:
            walk(child, title)

    walk(ET.parse(path).getroot(), False)
    return out


def runs(nums):
    return [n for i, n in enumerate(nums) if i == 0 or nums[i - 1] != n]


def subsequence(small, big):
    it = iter(runs(big))
    return all(any(x == y for y in it) for x in runs(small))


def main():
    sums = {}
    for line in (WBT / 'SHA256SUMS.converted').read_text(encoding='utf-8').splitlines():
        digest, name = line.split(None, 1)
        sums[name.strip()] = digest
    files = sorted(WBT.glob('*.usx'))
    if len(files) != 66 or set(sums) != {f.name for f in files}:
        sys.exit('the USX files are not the 66 listed in SHA256SUMS.converted')
    problems = []
    tagged = total = verses = paras = 0
    for f in files:
        text = f.read_text(encoding='utf-8')
        plain = W.sub(r'\1', text)
        if 'style="w"' in plain:
            problems.append(f'{f.name}: a w element holding markup')
        try:
            if hashlib.sha256(joined(plain).encode('utf-8')).hexdigest() != sums[f.name]:
                problems.append(f'{f.name}: the text differs from the USX converted from eBible')
        except ValueError as e:
            problems.append(f'{f.name}: {e}')
        mine, theirs = layout(f), layout(KJV / f.name)
        if mine != theirs:
            diff = next(c for c in theirs if mine.get(c) != theirs[c])
            problems.append(f'{diff}: paragraphs differ from the KJV\'s')
        paras += sum(len(v) for v in mine.values())
        nums, kjv_nums = numbers_by_verse(f), numbers_by_verse(KJV / f.name)
        for sid, n in nums.items():
            verses += 1
            tagged += len(n)
            total += len(kjv_nums.get(sid, []))
            if not subsequence(n, kjv_nums.get(sid, [])):
                problems.append(f'{sid}: numbers not in the KJV verse\'s order')
    if problems:
        for p in problems[:30]:
            print('FAIL', p)
        sys.exit(f'{len(problems)} problems')
    print(f'66 files: text unchanged; {paras} paragraphs and blank lines, as the KJV\'s; {verses} verses; '
          f'{tagged} Strong\'s numbers, each the KJV\'s in its order ({tagged / total:.2%} of the KJV\'s {total})')


if __name__ == '__main__':
    main()
