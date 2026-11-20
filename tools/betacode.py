#!/usr/bin/env python3
"""
Converts Greek written in Beta Code to Unicode, as the Perseus texts write
it (the Middle Liddell among them).

    from betacode import beta_to_unicode
    beta_to_unicode('a)ga/ph')      # 'ἀγάπη'

Beta Code writes Greek in ASCII (TLG Beta Code manual, and Perseus's use of
it):

- Letters: a b g d e z h q i k l m n c o p r s t u f x y w for
  α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω, and v for digamma (ϝ).
  Letter case means nothing: Strong's writes A)GA/PH, Perseus a)ga/ph.
- A capital is marked by * before the letter: *a is Α. Its breathings and
  accents may come between the * and the letter (*)/a is Ἄ) or after it.
- Marks follow their letter: ) smooth breathing, ( rough breathing,
  / acute, \\ grave, = circumflex, + diaeresis, | iota subscript, and, in
  Perseus, ^ short and _ long (a breve or macron over the vowel).
- s is σ, or ς at the end of a word (when no letter follows). A hyphen
  after it marks a word part (dus- for δυσ-), so σ stays. The TLG's
  numbered sigmas (s1, s2, s3) are not used: in Perseus a digit after a
  word is a homograph number, as in qu/w1, so it ends the word.
- [1 and ]1 are the TLG's parentheses, ( and ); [ and ] alone are
  square brackets.
- # followed by a digit is a TLG numeral letter: #1 koppa (ϟ), #2 stigma
  (ϛ), #3 archaic koppa (ϙ), #5 sampi (ϡ). # alone is the numeral sign
  (ʹ), as in bʹ for 2.
- ( and ) are breathings when they follow a vowel, ρ, or a capital's *;
  otherwise they are parentheses.
- : is the raised dot (·) and ' the apostrophe of elision (’).
- Perseus also writes = for "equals" between words (after a space) and /
  in fractions (after a digit, as in 1 1/2); both are kept as they are.

The output is in Unicode Normalization Form C: an accented letter such as
ά is the single character U+03AC, as in the Textus Receptus. Marks on one
letter are put in the canonical order (length, breathing, diaeresis,
accent, iota subscript) before composing.

Anything else stops with BetaCodeError naming the character and its place,
so a mistake in a source (such as Perseus's *je/rcea for Ξέρξεα) is never
turned into wrong Greek silently. Characters that are already Unicode Greek
or plain punctuation (spaces, digits, , . ; ? ! - [ ] " — † and the
numeral signs ʹ ͵) pass through unchanged.

`python3 -I tools/betacode.py <strongsgreek.xml>` tests the converter
against every word Strong's Greek Dictionary gives in both Beta Code and
Unicode.
"""
import sys
import unicodedata

# Every character is named, not typed: Greek letters and combining marks
# typed into source code are easy to get subtly wrong and hard to see.
_ = unicodedata.lookup

LETTERS = {
    beta: _(f'GREEK SMALL LETTER {name}')
    for beta, name in (
        ('a', 'ALPHA'), ('b', 'BETA'), ('g', 'GAMMA'), ('d', 'DELTA'),
        ('e', 'EPSILON'), ('z', 'ZETA'), ('h', 'ETA'), ('q', 'THETA'),
        ('i', 'IOTA'), ('k', 'KAPPA'), ('l', 'LAMDA'), ('m', 'MU'),
        ('n', 'NU'), ('c', 'XI'), ('o', 'OMICRON'), ('p', 'PI'),
        ('r', 'RHO'), ('s', 'SIGMA'), ('t', 'TAU'), ('u', 'UPSILON'),
        ('f', 'PHI'), ('x', 'CHI'), ('y', 'PSI'), ('w', 'OMEGA'),
        ('v', 'DIGAMMA'),
    )
}
FINAL_SIGMA = _('GREEK SMALL LETTER FINAL SIGMA')
CAPITAL_DIGAMMA = _('GREEK LETTER DIGAMMA')

# Each mark's combining character, and its place in the canonical order.
MARKS = {
    '^': (_('COMBINING BREVE'), 0),  # short
    '_': (_('COMBINING MACRON'), 0),  # long
    ')': (_('COMBINING COMMA ABOVE'), 1),  # smooth breathing
    '(': (_('COMBINING REVERSED COMMA ABOVE'), 1),  # rough breathing
    '+': (_('COMBINING DIAERESIS'), 2),
    '/': (_('COMBINING ACUTE ACCENT'), 3),
    '\\': (_('COMBINING GRAVE ACCENT'), 3),
    '=': (_('COMBINING GREEK PERISPOMENI'), 3),  # circumflex
    '|': (_('COMBINING GREEK YPOGEGRAMMENI'), 4),  # iota subscript
}

PUNCTUATION = {
    ':': _('MIDDLE DOT'),  # the Greek raised dot (ano teleia, which NFC makes this)
    "'": _('RIGHT SINGLE QUOTATION MARK'),  # apostrophe of elision
}

NUMERAL_LETTERS = {
    '1': _('GREEK SMALL LETTER KOPPA'),
    '2': _('GREEK SMALL LETTER STIGMA'),
    '3': _('GREEK SMALL LETTER ARCHAIC KOPPA'),
    '5': _('GREEK SMALL LETTER SAMPI'),
}
NUMERAL_SIGN = _('GREEK NUMERAL SIGN')

PASS_THROUGH = set(' \t\n,.;?!-[]"0123456789') | {
    _('EM DASH'), _('DAGGER'), _('MODIFIER LETTER PRIME'),
    _('GREEK NUMERAL SIGN'), _('GREEK LOWER NUMERAL SIGN'),
    _('MACRON'), _('BREVE'),
}

VOWELS_AND_RHO = set('aehiouwr')


class BetaCodeError(ValueError):
    """The text holds something that isn't Beta Code."""


def _is_greek(ch):
    # Greek and Coptic, and Greek Extended.
    return 0x0370 <= ord(ch) <= 0x03FF or 0x1F00 <= ord(ch) <= 0x1FFF


LENGTH_MARKS = '^_'


def beta_to_unicode(text, drop_stray_length=False, dropped=None):
    """Converts Beta Code `text` to Unicode (NFC).

    With `drop_stray_length`, a breve or macron (^ or _) that no vowel can
    carry where it stands (after a consonant, a hyphen or a space) is left
    out instead of refused; a doubled identical one is kept once, and
    contradictory ones on one vowel (^ and _) are both left out. Each is
    described in `dropped`, if given. These are editors' marks of vowel
    length, not part of the word: letters, breathings, accents (including
    the circumflex, =), diaeresis and iota subscript are never dropped.
    """
    out = []
    i = 0
    n = len(text)

    def marks_from(j):
        """Collect the marks starting at j: their combining characters, and
        where they end."""
        found = []
        while j < n and text[j] in MARKS:
            # ( and ) count as breathings only here, right after a letter
            # that can take them; the caller decides when that is.
            found.append(MARKS[text[j]])
            j += 1
        return found, j

    while i < n:
        ch = text[i]
        lower = ch.lower()
        if ch == '*':
            # A capital: marks may come before the letter, and after it.
            before, j = marks_from(i + 1)
            if j >= n or text[j].lower() not in LETTERS:
                raise BetaCodeError(f'"*" without a letter at {i} in {text!r}')
            letter = text[j].lower()
            after, k = ([], j + 1)
            if letter in VOWELS_AND_RHO:
                after, k = marks_from(j + 1)
            base = CAPITAL_DIGAMMA if letter == 'v' else LETTERS[letter].upper()
            out.append(_compose(base, before + after, drop_stray_length, dropped, text))
            i = k
            continue
        if lower in LETTERS and ch.isascii():
            if lower == 's':
                following = text[i + 1] if i + 1 < n else ''
                is_final = (
                    not (following.isascii() and following.isalpha())
                    and following not in ('*', '-')
                )
                out.append(FINAL_SIGMA if is_final else LETTERS['s'])
                i += 1
                continue
            if lower in VOWELS_AND_RHO:
                marks, j = marks_from(i + 1)
            else:
                # Consonants other than rho take no marks; a mark after one
                # is an error, except a parenthesis, handled below, and a
                # stray length mark, if those are being dropped.
                marks, j = [], i + 1
                while drop_stray_length and j < n and text[j] in LENGTH_MARKS:
                    if dropped is not None:
                        dropped.append(f'"{text[j]}" after a consonant at {j} in {text!r}')
                    j += 1
                if j < n and text[j] in MARKS and text[j] not in '()':
                    raise BetaCodeError(f'mark "{text[j]}" after a consonant at {j} in {text!r}')
            out.append(_compose(LETTERS[lower], marks, drop_stray_length, dropped, text))
            i = j
            continue
        if ch in '[]' and i + 1 < n and text[i + 1].isdigit():
            if text[i + 1] != '1':
                raise BetaCodeError(f'"{ch}{text[i + 1]}" is a TLG bracket this converter doesn\'t know, at {i} in {text!r}')
            out.append('(' if ch == '[' else ')')
            i += 2
            continue
        if ch == '#':
            digit = text[i + 1] if i + 1 < n else ''
            if digit.isdigit():
                if digit not in NUMERAL_LETTERS:
                    raise BetaCodeError(f'"#{digit}" is a TLG sign this converter doesn\'t know, at {i} in {text!r}')
                out.append(NUMERAL_LETTERS[digit])
                i += 2
                continue
            out.append(NUMERAL_SIGN)  # NFC makes it U+02B9
            i += 1
            continue
        if ch in PUNCTUATION:
            out.append(PUNCTUATION[ch])
        elif ch in '()':
            out.append(ch)  # a parenthesis: not after a vowel or rho
        elif ch in PASS_THROUGH or _is_greek(ch):
            out.append(ch)
        elif ch == '=' and (i == 0 or text[i - 1].isspace()):
            out.append('=')  # "equals", between words, as Perseus uses it
        elif ch == '/' and i > 0 and text[i - 1].isdigit():
            out.append('/')  # a fraction, as in "1 1/2"
        elif drop_stray_length and ch in LENGTH_MARKS:
            if dropped is not None:
                dropped.append(f'"{ch}" with no vowel at {i} in {text!r}')
        elif ch in MARKS:
            raise BetaCodeError(f'mark "{ch}" with no letter at {i} in {text!r}')
        else:
            raise BetaCodeError(f'"{ch}" (U+{ord(ch):04X}) is not Beta Code, at {i} in {text!r}')
        i += 1
    return unicodedata.normalize('NFC', ''.join(out))


def _compose(base, marks, drop_stray_length=False, dropped=None, text=''):
    lengths = [m for m in marks if m[1] == 0]
    if drop_stray_length and len(lengths) > 1:
        others = [m for m in marks if m[1] != 0]
        if len({m[0] for m in lengths}) == 1:
            keep = lengths[:1]  # the same mark twice: once is enough
            note = 'a doubled length mark kept once'
        else:
            keep = []  # breve and macron together: neither can be right
            note = 'contradictory length marks left out'
        if dropped is not None:
            dropped.append(f'{note} on {base!r} in {text!r}')
        marks = keep + others
    marks = sorted(marks, key=lambda m: m[1])  # stable: keeps order within a rank
    ranks = [m[1] for m in marks]
    if len(ranks) != len(set(ranks)):
        raise BetaCodeError(f'two marks of one kind on {base!r}')
    return base + ''.join(m[0] for m in marks)


def _test_against_strongs(path):
    """Every Greek word Strong's Greek gives in both forms must convert to
    its Unicode form (both in NFC)."""
    import re
    text = open(path, encoding='utf-8').read()
    pairs = re.findall(r'<greek BETA="([^"]*)" unicode="([^"]*)"', text)
    failures = []
    for beta, uni in pairs:
        try:
            got = beta_to_unicode(beta)
        except BetaCodeError as error:
            failures.append((beta, uni, f'error: {error}'))
            continue
        # Strong's writes word parts with U+2010 HYPHEN, Beta Code with -.
        if got != unicodedata.normalize('NFC', uni).replace(_('HYPHEN'), '-'):
            failures.append((beta, uni, got))
    for beta, uni, got in failures[:40]:
        print(f'{beta!r}: expected {uni!r}, got {got!r}')
    print(f'{len(pairs) - len(failures)} of {len(pairs)} Strong\'s words convert exactly.')
    return not failures


if __name__ == '__main__':
    sys.exit(0 if _test_against_strongs(sys.argv[1]) else 1)
