#!/usr/bin/env python3
"""
Tests for tools/betacode.py: the Perseus features Strong's Greek never
uses, and what must be refused. Every expected answer is built from Unicode
character names, never typed, so a test can't share a typing mistake with
the converter.

    python3 -I tools/betacode_test.py

Also run by src/services/betacode.test.ts with the rest of the tests, which
also checks every word of Strong's Greek Dictionary.
"""
import sys
import unicodedata
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from betacode import BetaCodeError, beta_to_unicode  # noqa: E402

_ = unicodedata.lookup


def letter(name, capital=False):
    return _(f'GREEK {"CAPITAL" if capital else "SMALL"} LETTER {name}')


def mark(name):
    return _(f'COMBINING {name}')


def nfc(*parts):
    return unicodedata.normalize('NFC', ''.join(parts))


ALPHA, GAMMA, PI, ETA = (letter(n) for n in ('ALPHA', 'GAMMA', 'PI', 'ETA'))
SMOOTH, ROUGH = mark('COMMA ABOVE'), mark('REVERSED COMMA ABOVE')
ACUTE, GRAVE = mark('ACUTE ACCENT'), mark('GRAVE ACCENT')
CIRCUMFLEX, IOTA_SUB = mark('GREEK PERISPOMENI'), mark('GREEK YPOGEGRAMMENI')
BREVE, MACRON, DIAERESIS = mark('BREVE'), mark('MACRON'), mark('DIAERESIS')
SIGMA, FINAL = letter('SIGMA'), letter('FINAL SIGMA')


class BetaCode(unittest.TestCase):
    def test_a_word_with_breathing_and_accent(self):
        # a)ga/ph: the Middle Liddell's spelling of agape.
        expected = nfc(ALPHA, SMOOTH, GAMMA, ALPHA, ACUTE, PI, ETA)
        self.assertEqual(beta_to_unicode('a)ga/ph'), expected)
        self.assertEqual(beta_to_unicode('A)GA/PH'), expected)  # case means nothing

    def test_output_is_nfc_with_tonos(self):
        # An acute on alpha is U+03AC (tonos), not U+1F71 (oxia).
        self.assertEqual(beta_to_unicode('a/'), '\u03ac')

    def test_marks_in_any_order(self):
        self.assertEqual(beta_to_unicode('a/)'), beta_to_unicode('a)/'))
        self.assertEqual(beta_to_unicode('w=|('), nfc(letter('OMEGA'), ROUGH, CIRCUMFLEX, IOTA_SUB))

    def test_length_marks(self):
        # Perseus's ^ (short) and _ (long), before the breathing and accent.
        self.assertEqual(beta_to_unicode('a^'), nfc(ALPHA, BREVE))
        self.assertEqual(beta_to_unicode('a_'), nfc(ALPHA, MACRON))
        self.assertEqual(beta_to_unicode('a)/^'), nfc(ALPHA, BREVE, SMOOTH, ACUTE))

    def test_diaeresis(self):
        self.assertEqual(beta_to_unicode('i+/'), nfc(letter('IOTA'), DIAERESIS, ACUTE))

    def test_capitals(self):
        self.assertEqual(beta_to_unicode('*a'), letter('ALPHA', True))
        self.assertEqual(beta_to_unicode('*)/a'), nfc(letter('ALPHA', True), SMOOTH, ACUTE))
        self.assertEqual(beta_to_unicode('*a)/'), nfc(letter('ALPHA', True), SMOOTH, ACUTE))
        self.assertEqual(beta_to_unicode('*v'), _('GREEK LETTER DIGAMMA'))

    def test_digamma(self):
        self.assertEqual(beta_to_unicode('v'), letter('DIGAMMA'))

    def test_final_sigma(self):
        self.assertEqual(beta_to_unicode('qeo/s'), nfc(letter('THETA'), letter('EPSILON'), letter('OMICRON'), ACUTE, FINAL))
        self.assertEqual(beta_to_unicode('qeo/s, '), beta_to_unicode('qeo/s') + ', ')
        self.assertTrue(beta_to_unicode('sw/zw').startswith(SIGMA))
        # Cited alone, as the letter, sigma is not final.
        self.assertEqual(beta_to_unicode('s'), SIGMA)
        self.assertEqual(beta_to_unicode('o( s'), nfc(letter('OMICRON'), ROUGH) + ' ' + SIGMA)
        # A word part keeps sigma; a homograph number ends the word.
        self.assertTrue(beta_to_unicode('dus-').endswith(SIGMA + '-'))
        self.assertTrue(beta_to_unicode('a(/lios2').endswith(FINAL + '2'))

    def test_parentheses_and_breathings(self):
        # After a vowel ( is a breathing; elsewhere a parenthesis.
        self.assertEqual(beta_to_unicode('(qeo/s)'), '(' + beta_to_unicode('qeo/s') + ')')
        self.assertEqual(beta_to_unicode('o('), nfc(letter('OMICRON'), ROUGH))
        self.assertEqual(beta_to_unicode('[1ge]1'), '(' + GAMMA + letter('EPSILON') + ')')
        self.assertEqual(beta_to_unicode('[e)sti]'), '[' + beta_to_unicode('e)sti') + ']')

    def test_punctuation(self):
        self.assertEqual(beta_to_unicode('a:'), ALPHA + _('MIDDLE DOT'))
        self.assertEqual(beta_to_unicode("d'"), letter('DELTA') + _('RIGHT SINGLE QUOTATION MARK'))
        self.assertEqual(beta_to_unicode('b#'), letter('BETA') + _('MODIFIER LETTER PRIME'))
        self.assertEqual(beta_to_unicode('#2'), letter('STIGMA'))

    def test_what_is_refused(self):
        for text in ('*je/rcea', 'a#9', 'k/', '/', '*', '[2a]2', 'a@'):
            with self.assertRaises(BetaCodeError, msg=text):
                beta_to_unicode(text)

    def test_equals_between_words(self):
        # Perseus writes "=" for "equals" between two Greek words.
        self.assertEqual(beta_to_unicode('a = b'), ALPHA + ' = ' + letter('BETA'))
        self.assertEqual(beta_to_unicode('w='), nfc(letter('OMEGA'), CIRCUMFLEX))
        # And "/" in a fraction.
        self.assertEqual(beta_to_unicode('1 1/2'), '1 1/2')

    def test_stray_length_marks_are_refused_unless_dropping(self):
        for text in ('dia-^pa/lh', 'amf^i', 'qa^^la/mh', 'a^_'):
            with self.assertRaises(BetaCodeError, msg=text):
                beta_to_unicode(text)

    def test_stray_length_marks_dropped_and_reported(self):
        dropped = []
        # After a hyphen, and after a consonant: left out.
        self.assertEqual(
            beta_to_unicode('dia-^pa/lh', drop_stray_length=True, dropped=dropped),
            beta_to_unicode('dia-pa/lh'),
        )
        self.assertEqual(
            beta_to_unicode('amf^i', drop_stray_length=True, dropped=dropped),
            beta_to_unicode('amfi'),
        )
        # Doubled: kept once. Contradictory: neither.
        self.assertEqual(
            beta_to_unicode('qa^^la/mh', drop_stray_length=True, dropped=dropped),
            beta_to_unicode('qa^la/mh'),
        )
        self.assertEqual(
            beta_to_unicode('a^_', drop_stray_length=True, dropped=dropped), ALPHA
        )
        self.assertEqual(len(dropped), 4)

    def test_dropping_never_touches_accents_or_letters(self):
        # The circumflex (=) and other marks are not length marks.
        dropped = []
        text = 'w)=^'  # a stray-looking ^ on a vowel is still a length mark
        self.assertEqual(
            beta_to_unicode(text, drop_stray_length=True, dropped=dropped),
            nfc(letter('OMEGA'), BREVE, SMOOTH, CIRCUMFLEX),
        )
        self.assertEqual(dropped, [])
        with self.assertRaises(BetaCodeError):
            beta_to_unicode('k/', drop_stray_length=True)  # an accent stays refused

    def test_two_accents_on_one_letter_are_refused(self):
        with self.assertRaises(BetaCodeError):
            beta_to_unicode('a/\\')


if __name__ == '__main__':
    unittest.main()
