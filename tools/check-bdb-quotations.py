#!/usr/bin/env python3
"""
Checks Brown-Driver-Briggs's Hebrew quotations against the Westminster
Leningrad Codex: every Hebrew phrase in assets/eng_bdb/source/bdb.json that
is directly followed by a reference to one verse is looked up in that verse
of eBible's WLC text (assets/hbo_wlc/ebible/hboWLC_usfx.zip, whose PGP
signature and file hashes are checked first).

    tools/venv/bin/python -I tools/check-bdb-quotations.py [report.json]

Each quotation is compared twice, and given one result:

  exact          the quotation's words, with their vowel points, are a run
                 of words in the verse (cantillation ignored: BDB doesn't
                 print the accents)
  prefixed       as exact, but some words carry a prefix in the verse that
                 BDB leaves off when quoting (the conjunction, a preposition,
                 the article: up to three of ve, he, be, ke, le, mi, she)
  pointing       the consonants are a run of words in the verse, but a word
                 is pointed differently (BDB may quote a form unpointed, or
                 in pause, or with a different vowel)
  scattered      every word is in the verse, but not as one run (BDB often
                 leaves words out of a quotation)
  and, where a word of the quotation is not in the verse, the likeliest
  reason, tried in this order:
  nearby verse   the quotation is in a verse up to three away (the
                 reference is probably wrong)
  look-alike     a word equals a verse word, pointing and all, except for
                 one letter swapped for one that looks like it (he and het,
                 bet and kaf, dalet and resh ...): almost certainly a slip in
                 the transcription
  one letter     a word differs from a verse word by one letter otherwise
  spelling       a word is spelled with or without the vowel letters vav
                 and yod (plene or defective)
  other form     a word shares its first three consonants with a verse
                 word: BDB quotes another form of it
  ketiv          the verse has an unpointed ketiv word; BDB probably quotes
                 the qere
  unexplained    none of these
  no verse       the WLC has no such verse
  not checkable  a book outside the WLC (Ben Sira, Maccabees), or nothing
                 left once BDB's abbreviations are set aside

Words with a geresh or gershayim (BDB's abbreviations, such as the first
letter of a word, or "vegomer", and so on) are set aside, not compared.
Marks are removed only to compare: the Hebrew is never changed or
normalised in any file.

The report lists every quotation that isn't exact, with the verse.
"""
import importlib.util
import json
import re
import sys
import unicodedata
import zipfile
from collections import Counter
from pathlib import Path

BDB = Path('assets/eng_bdb/source/bdb.json')
WLC = Path('assets/hbo_wlc/ebible/hboWLC_usfx.zip')

BOOKS = {
    'Genesis': 'GEN', 'Exodus': 'EXO', 'Leviticus': 'LEV', 'Numbers': 'NUM',
    'Deuteronomy': 'DEU', 'Joshua': 'JOS', 'Judges': 'JDG', 'Ruth': 'RUT',
    'I Samuel': '1SA', 'II Samuel': '2SA', 'I Kings': '1KI', 'II Kings': '2KI',
    'I Chronicles': '1CH', 'II Chronicles': '2CH', 'Ezra': 'EZR',
    'Nehemiah': 'NEH', 'Esther': 'EST', 'Job': 'JOB', 'Psalms': 'PSA',
    'Proverbs': 'PRO', 'Ecclesiastes': 'ECC', 'Song of Songs': 'SNG',
    'Isaiah': 'ISA', 'Jeremiah': 'JER', 'Lamentations': 'LAM',
    'Ezekiel': 'EZK', 'Daniel': 'DAN', 'Hosea': 'HOS', 'Joel': 'JOL',
    'Amos': 'AMO', 'Obadiah': 'OBA', 'Jonah': 'JON', 'Micah': 'MIC',
    'Nahum': 'NAM', 'Habakkuk': 'HAB', 'Zephaniah': 'ZEP', 'Haggai': 'HAG',
    'Zechariah': 'ZEC', 'Malachi': 'MAL',
}

LETTER = re.compile('[\u05d0-\u05ea]')
MAQAF = '\u05be'
GERESH = ('\u05f3', '\u05f4', "'", '"')
# Marks kept when comparing pointing: vowels, dagesh/mappiq, rafe, shin and
# sin dots, upper and lower dots, qamats qatan. Cantillation (U+0591-U+05AF),
# meteg (U+05BD), paseq, sof pasuq and the like are ignored.
POINTS = set(chr(c) for c in range(0x05B0, 0x05BD)) | {'\u05bf', '\u05c1', '\u05c2', '\u05c4', '\u05c5', '\u05c7'}


def words(text):
    """A phrase's words: split at spaces and maqaf (and the brackets and
    dashes BDB puts inside quotations), keeping only words that have a
    Hebrew letter."""
    return [w for w in re.split(r'[\s\u05be()\[\]\u2014-]+', text) if LETTER.search(w)]


# The prefixes BDB leaves off a word it quotes: the conjunction, the
# prepositions be, ke, le, mi, the article and she.
PREFIX = re.compile('[\u05d5\u05d4\u05d1\u05db\u05dc\u05de\u05e9]{1,3}')


def same_word(quoted, found):
    """0 if the consonants are equal, 1 if `found` is `quoted` with a
    prefix, None otherwise."""
    if quoted == found:
        return 0
    if found.endswith(quoted) and PREFIX.fullmatch(found[:len(found) - len(quoted)]):
        return 1
    return None


def consonants(word):
    return ''.join(LETTER.findall(word))


def pointed(word):
    """Letters and vowel points, cantillation left out; marks put in a
    canonical order for comparison only."""
    kept = ''.join(c for c in unicodedata.normalize('NFD', word) if LETTER.match(c) or c in POINTS)
    return unicodedata.normalize('NFD', kept)


def load_wlc():
    spec = importlib.util.spec_from_file_location('import_ebible', Path(__file__).with_name('import-ebible.py'))
    ebible = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ebible)
    verses = {}
    with zipfile.ZipFile(WLC) as archive:
        ebible.check_signature(archive)
        xml = archive.read('hboWLC_usfx.xml').decode('utf-8')
    for book in re.finditer(r'<book id="([A-Z0-9]{3})">(.*?)</book>', xml, flags=re.S):
        code, body = book.groups()
        chapter = None
        for m in re.finditer(r'<c id="(\d+)" />|<v id="(\d+)"[^>]*/>(.*?)<ve />', body, flags=re.S):
            if m.group(1):
                chapter = int(m.group(1))
            else:
                # eBible's USFX lost the angle brackets of the markup for
                # the suspended letters (Judg 18:30, Ps 80:14, Job 38:13,
                # 38:15 ...), leaving it as text: 'l s="H3293"'...'/l'.
                # Keep only the word's letters.
                text = re.sub(r"'l s=\"[^\"]*\"'(.*?)'/l'",
                              lambda w: re.sub(r"'seg[^']*'", '', w.group(1)), m.group(3))
                text = re.sub(r'<[^>]+>', '', text)
                verses[(code, chapter, int(m.group(2)))] = words(text)
    return verses


def texts(node):
    """Every piece of text in an entry's content."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from texts(value)
    elif isinstance(node, list):
        for value in node:
            yield from texts(value)


QUOTE = re.compile(r'<span dir="rtl">([^<]*)</span>\s*<a [^>]*data-ref="([^"]+)"[^>]*>([^<]*)</a>')
SINGLE = re.compile(r'(.+) (\d+):(\d+)')


def run(seq, inside, prefixed=False):
    """Where seq is a run of words inside `inside`, or None; with
    `prefixed`, a verse word may carry a prefix BDB left off."""
    for i in range(len(inside) - len(seq) + 1):
        window = inside[i:i + len(seq)]
        if window == seq:
            return i
        if prefixed and all(same_word(a, b) is not None for a, b in zip(seq, window)):
            return i
    return None


def edit_one(a, b):
    """Whether a and b differ by one letter replaced, added or left out."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long_ = sorted((a, b), key=len)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def bare_forms(word):
    """A verse word's consonants, and the same without each possible prefix."""
    out = [word]
    for n in (1, 2, 3):
        if len(word) > n + 1 and PREFIX.fullmatch(word[:n]):
            out.append(word[n:])
    return out


# Letters easily mistaken for each other in print.
LOOKALIKE = {frozenset(p) for p in (
    '\u05d4\u05d7', '\u05d7\u05ea', '\u05d1\u05db', '\u05d3\u05e8', '\u05d5\u05d6', '\u05d5\u05df',
    '\u05e1\u05dd', '\u05d8\u05de', '\u05d2\u05e0', '\u05e2\u05e6', '\u05e8\u05da', '\u05d9\u05d5',
)}


def lookalike(quoted_word, verse_words):
    """Whether the quoted word (pointed) equals a verse word (or the verse
    word without a prefix) in every letter and point but one letter, which
    is a look-alike of the verse's letter."""
    q = pointed(quoted_word)
    for v in verse_words:
        vp = pointed(v)
        for start in range(0, 4):
            # The verse word without a prefix of `start` letters (and their points).
            letters = [i for i, c in enumerate(vp) if LETTER.match(c)]
            if start >= len(letters):
                break
            cut = vp[letters[start]:] if start else vp
            if start and not PREFIX.fullmatch(''.join(LETTER.findall(vp[:letters[start]]))):
                continue
            if len(cut) != len(q):
                continue
            diff = [(a, b) for a, b in zip(q, cut) if a != b]
            if len(diff) == 1 and frozenset(diff[0]) in LOOKALIKE:
                return True
    return False


def why(quoted, verse_words):
    """Why a quoted word (consonants) isn't in the verse: the closest
    explanation, or None."""
    forms = [f for v in verse_words for f in bare_forms(v)]
    drop = lambda w: w.replace('\u05d5', '').replace('\u05d9', '')  # noqa: E731
    if any(edit_one(quoted, f) and drop(quoted) != drop(f) for f in forms):
        return 'one letter'
    if any(drop(quoted) == drop(f) for f in forms):
        return 'spelling'
    if len(quoted) >= 3 and any(f[:3] == quoted[:3] for f in forms):
        return 'other form'
    return None


def check(quote, verse):
    q = [w for w in words(quote) if not any(g in w for g in GERESH)]
    if not q:
        return 'not checkable', None
    qc = [consonants(w) for w in q]
    vc = [consonants(w) for w in verse]
    at = run(qc, vc)
    if at is not None:
        qp = [pointed(w) for w in q]
        vp = [pointed(w) for w in verse[at:at + len(q)]]
        if qp == vp:
            return 'exact', None
        # Unpointed quotations aren't wrong, only unpointed.
        if all(p == c for p, c in zip(qp, qc)):
            return 'exact', None
        return 'pointing', [(a, b) for a, b in zip(q, verse[at:at + len(q)]) if pointed(a) != pointed(b)]
    if run(qc, vc, prefixed=True) is not None:
        return 'prefixed', None
    found = lambda c: any(same_word(c, v) is not None for v in vc)  # noqa: E731
    if all(found(c) for c in qc):
        return 'scattered', None
    missing = [(w, c) for w, c in zip(q, qc) if not found(c)]
    if any(lookalike(w, verse) for w, _ in missing):
        return 'look-alike', [w for w, _ in missing]
    reasons = [why(c, vc) for _, c in missing]
    detail = [w for w, _ in missing]
    for kind in ('one letter', 'spelling', 'other form'):
        if kind in reasons and all(r is not None for r in reasons):
            return kind, detail
    if any(w and not any(ch in POINTS for ch in unicodedata.normalize('NFD', w)) for w in verse):
        return 'ketiv', detail
    return 'unexplained', detail


def main():
    verses = load_wlc()
    entries = json.loads(BDB.read_text(encoding='utf-8'))
    counts = Counter()
    report = []
    for entry in entries:
        for text in texts(entry['content']):
            for m in QUOTE.finditer(text):
                quote, ref = m.group(1), m.group(2)
                single = SINGLE.fullmatch(ref)
                if not single:
                    continue  # a range or a whole chapter
                book, chapter, verse = single.group(1), int(single.group(2)), int(single.group(3))
                code = BOOKS.get(book)
                if code is None:
                    result, detail = 'not checkable', None
                elif (code, chapter, verse) not in verses:
                    result, detail = 'no verse', None
                else:
                    result, detail = check(quote, verses[(code, chapter, verse)])
                    if result in ('look-alike', 'one letter', 'spelling', 'other form', 'ketiv', 'unexplained'):
                        # Is the whole quotation in a verse nearby?
                        for shift in (-1, 1, -2, 2, -3, 3):
                            near = verses.get((code, chapter, verse + shift))
                            if near and check(quote, near)[0] in ('exact', 'prefixed', 'pointing'):
                                result, detail = 'nearby verse', f'{book} {chapter}:{verse + shift}'
                                break
                counts[result] += 1
                if result not in ('exact', 'prefixed', 'not checkable'):
                    report.append({
                        'entry': entry['rid'], 'headword': entry['headword'], 'ref': ref,
                        'result': result, 'quote': quote, 'detail': detail,
                        'verse': ' '.join(verses.get((code, chapter, verse), [])),
                    })
    total = sum(counts.values())
    print(f'{total} quotations of one verse checked against the WLC:')
    for name in ('exact', 'prefixed', 'pointing', 'scattered', 'nearby verse', 'look-alike', 'one letter', 'spelling',
                 'other form', 'ketiv', 'unexplained', 'no verse', 'not checkable'):
        print(f'  {name:14} {counts[name]:6}  {100 * counts[name] / total:5.1f}%')
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'{len(report)} not exact, listed in {sys.argv[1]}')


if __name__ == '__main__':
    main()
