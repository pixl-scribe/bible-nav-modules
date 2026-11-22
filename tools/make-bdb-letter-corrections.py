#!/usr/bin/env python3
"""
Writes assets/eng_bdb/corrections-letters.yaml: the one-letter OCR slips in
Sefaria's Hebrew quotations, corrected from the Westminster Leningrad Codex
(decided 2026-11-21; evidence in assets/eng_bdb/print-checks.md).

    tools/venv/bin/python -I tools/check-bdb-quotations.py report.json
    tools/venv/bin/python -I tools/make-bdb-letter-corrections.py report.json

It takes, from the quotation checker's report:
  - every "look-alike" result (a word equal to a verse word, pointing and
    all, but for one letter that looks like the verse's letter), and
  - the 31 more chosen by hand from the "one letter" results, listed in the
    table "More look-alike letters" of print-checks.md;
and leaves out the one the print showed to be BDB's own misprint
(BDB02917 at Is 5:22), which corrections.yaml notes instead.

Each correction names the entry, the quotation exactly as Sefaria has it,
the scripture link that follows it, Sefaria's word (sic) and the word with
the one letter changed (corr). Only that letter changes: Sefaria's vowel
points are kept as they are. The Hebrew is never typed: it is copied from
the source and the WLC, and the letter put in is the verse's own.
"""
import json
import re
import sys
from pathlib import Path

CHECKS = Path('assets/eng_bdb/print-checks.md')
OUT = Path('assets/eng_bdb/corrections-letters.yaml')
LETTER = re.compile('[\u05d0-\u05ea]')
PREFIX = re.compile('[\u05d5\u05d4\u05d1\u05db\u05dc\u05de\u05e9]{1,3}')
FINALS = str.maketrans('\u05da\u05dd\u05df\u05e3\u05e5', '\u05db\u05de\u05e0\u05e4\u05e6')
LOOKALIKE = {frozenset(p) for p in (
    '\u05d4\u05d7', '\u05d7\u05ea', '\u05d1\u05db', '\u05d3\u05e8', '\u05d5\u05d6', '\u05d5\u05df',
    '\u05e1\u05dd', '\u05d8\u05de', '\u05d2\u05e0', '\u05e2\u05e6', '\u05e8\u05da', '\u05d9\u05d5',
    '\u05d4\u05ea', '\u05db\u05e0', '\u05d1\u05e0', '\u05d2\u05e7', '\u05e1\u05d8', '\u05e1\u05de',
)}
# The print showed these to be BDB's own reading, not a slip.
NOT_SLIPS = {('BDB02917', 'Isaiah 5:22')}
# Checked in the print (print-checks.md, "Look-alike letters").
IN_PRINT = {('BDB01122', 'Ezekiel 20:5'), ('BDB02751', 'Isaiah 59:21'), ('BDB02966', 'Zechariah 13:4'),
            ('BDB04760', 'Daniel 12:5'), ('BDB06941', 'Lamentations 4:21'), ('BDB06591', 'I Kings 10:27'),
            ('BDB06989', 'Proverbs 25:20'), ('BDB06650', 'Isaiah 45:1'), ('BDB09941', 'Isaiah 30:11'),
            ('BDBA0680', 'Daniel 7:16'), ('BDBA0331', 'Ezra 4:21')}


def letters(word):
    return [(i, c) for i, c in enumerate(word) if LETTER.match(c)]


def corrected(word, verse_words):
    """The word with its one look-alike letter replaced by the verse's, or
    None if no verse word (with or without a prefix) differs from it by
    exactly one such letter."""
    mine = letters(word)
    for v in verse_words:
        theirs = [c for _, c in letters(v)]
        for cut in range(0, 4):
            if cut and not PREFIX.fullmatch(''.join(theirs[:cut])):
                continue
            rest = theirs[cut:]
            if len(rest) != len(mine):
                continue
            diff = [k for k, ((_, a), b) in enumerate(zip(mine, rest)) if a != b]
            if len(diff) != 1:
                continue
            k = diff[0]
            a, b = mine[k][1], rest[k]
            if a.translate(FINALS) == b.translate(FINALS) or frozenset((a, b)) not in LOOKALIKE:
                continue
            i = mine[k][0]
            return word[:i] + b + word[i + 1:]
    return None


def chosen_by_hand():
    """(entry, Sefaria's word) from the print-checks table of 31."""
    text = CHECKS.read_text(encoding='utf-8')
    table = text.split('## More look-alike letters', 1)[1]
    out = set()
    for line in table.splitlines():
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) == 6 and re.fullmatch(r'BDBA?\d+', cells[0]):
            out.add((cells[0], cells[3]))
    return out


def quoted(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


def main():
    report = json.load(open(sys.argv[1], encoding='utf-8'))
    by_hand = chosen_by_hand()
    found = []
    seen = set()
    skipped = []
    for r in report:
        verse = re.split(r'[\s\u05be\u05c3]+', r.get('verse') or '')
        # A "word" of one letter is BDB's letter in brackets, such as the
        # vav of z(v)nh, split off by the checker: never a slip to correct.
        words = [w for w in (r['detail'] if isinstance(r['detail'], list) else []) if len(letters(w)) >= 2]
        if r['result'] == 'look-alike' and (r['entry'], r['ref']) not in NOT_SLIPS:
            # Other words of the quotation may differ for other reasons;
            # only the look-alike one is corrected, and there must be one.
            fixes = [(w, corrected(w, verse)) for w in words]
            fixes = [(w, n) for w, n in fixes if n is not None]
            if not fixes:
                # The checker's look-alike was a bracketed letter (above).
                skipped.append(f"{r['entry']} {r['ref']}")
                continue
        elif r['result'] == 'one letter':
            fixes = []
            for w in words:
                if (r['entry'], w) in by_hand:
                    n = corrected(w, verse)
                    if n is None:
                        sys.exit(f"{r['entry']} {r['ref']}: no one-letter look-alike for {w}")
                    fixes.append((w, n))
        else:
            continue
        for w, new in fixes:
            key = (r['entry'], r['quote'], r['ref'], w)
            if key in seen:
                continue
            seen.add(key)
            found.append((r, w, new))
    unchecked = IN_PRINT - {(r['entry'], r['ref']) for r, _, _ in found}
    if unchecked:
        sys.exit(f'checked in the print but not found: {sorted(unchecked)}')
    missing = by_hand - {(r['entry'], w) for r, w, _ in found}
    if missing:
        sys.exit(f'chosen by hand but not found in the report: {sorted(missing)}')
    lines = [
        '# Generated by tools/make-bdb-letter-corrections.py from the quotation',
        '# checker\'s report; do not edit by hand. One-letter OCR slips in Sefaria\'s',
        '# Hebrew, corrected from the WLC (decided 2026-11-21, print-checks.md).',
        '# quote: the quotation as Sefaria has it; ref: the scripture link after it.',
        '',
    ]
    for r, w, new in found:
        evidence = 'print' if (r['entry'], r['ref']) in IN_PRINT else 'wlc'
        lines += [
            f"- entry: {r['entry']}",
            f"  quote: {quoted(r['quote'])}",
            f"  ref: {quoted(r['ref'])}",
            f"  sic: {quoted(w)}",
            f"  corr: {quoted(new)}",
            f"  evidence: {evidence}",
        ]
    OUT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    if skipped:
        print(f'not slips (a bracketed letter): {", ".join(skipped)}')
    print(f'{len(found)} corrections written to {OUT} '
          f'({sum(1 for r, w, _ in found if (r["entry"], w) in by_hand)} chosen by hand)')


if __name__ == '__main__':
    main()
