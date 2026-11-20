#!/usr/bin/env python3
"""
Converts the Intermediate Liddell and Scott ("Middle Liddell", Perseus text
1999.04.0058, in Benjamin Linskey's corrected copy) into the TEI source
file of the eng_middle_liddell lexicon (docs/lexicon-format.md, "Source
files").

    tools/venv/bin/python -I tools/import-middle-liddell.py

Reads assets/eng_middle_liddell/source/Perseus_text_1999.04.0058.xml,
exactly as received, after checking it against
assets/eng_middle_liddell/SHA256SUMS, applies
assets/eng_middle_liddell/corrections.yaml, and writes
assets/eng_middle_liddell/eng_middle_liddell.tei.xml.

Each entry keeps its Perseus id (n105) as its key, and becomes:
  - the headword (`orth`), with a homograph number (the digit Perseus adds
    to its key, as in qu/w1) where it has one;
  - the headword line: the `alt` notes (the headword with its endings and
    article, "τροφαλίς, ίδος, ἡ,") and the `infl` notes (principal parts,
    "f. ήσω"), as one note of type forms, always first, as printed;
  - each `etym` (shown as From), and each numbered `sense`, in order.

Inside them: `tr` (a translation, printed in italics) becomes gloss; `usg`
(an author or usage label) becomes usg, with Perseus's "id=Plat." shown
as "id." meaning Plat.; `foreign` keeps its language (Greek converted from
Beta Code, Latin and English as they are); a cross-reference (`ref`)
becomes a link to the entry it names, or, when several entries share that
headword, a link to all of them by headword; a form that is no headword
stays plain Greek. `trans` and `xr` are wrappers and add nothing.

Greek is converted by tools/betacode.py, leaving out a breve or macron
that no vowel can carry where it stands (each counted).

Left out, and counted: Perseus's machine-made stem analysis (the
entry-level `gramGrp`: a part of speech and codes such as "diakwlu_s
is_ews fem"), which is not Liddell and Scott's text; the alphabet
headings between letters.

Repaired, and marked in the TEI file as corrections: the 65 words
Perseus's conversion tool split in two, leaving "failing on lembuf []" at
the end of one note and the rest of the word ("/r, h=ros, o(,") at the
start of the next. Joining them gives the printed text, as checked against
the 1889 printing. Any other problem stops the conversion unless
corrections.yaml settles it.

tools/check-middle-liddell.py checks the result independently.
"""
import hashlib
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from betacode import BetaCodeError, beta_to_unicode  # noqa: E402

MODULE = 'eng_middle_liddell'
ASSETS = Path('assets') / MODULE
SOURCE = ASSETS / 'source' / 'Perseus_text_1999.04.0058.xml'
OUTPUT = ASSETS / f'{MODULE}.tei.xml'
CORRECTIONS = ASSETS / 'corrections.yaml'
GREEK_TEI = Path('assets') / 'eng_strongs_grc' / 'eng_strongs_grc.tei.xml'

SOURCE_COMMIT = '5db8d88a20066e182ca3fc6ee758c9f61ac60603'
# The host is built from character codes (g-i-t-h-u-b-.-c-o-m): typed host
# names have been silently replaced by look-alike proxy hosts before.
GITHUB = ''.join(map(chr, [103, 105, 116, 104, 117, 98, 46, 99, 111, 109]))
SOURCE_URL = f'https://{GITHUB}/blinskey/middle-liddell/blob/{SOURCE_COMMIT}/Perseus_text_1999.04.0058.xml'
SOURCE_DATE = '2026-10-12'

TEI_NS = 'http://www.tei-c.org/ns/1.0'
BN_NS = 'https://biblenav.org/ns/lexicon/1'
LEMBUF = 'failing on lembuf []'
LENGTH_MARKS = {unicodedata.lookup('COMBINING MACRON'), unicodedata.lookup('COMBINING BREVE')}
DIAERESIS = unicodedata.lookup('COMBINING DIAERESIS')


class Stop(Exception):
    """The source holds something this converter doesn't know."""


def check_source():
    sums = {}
    for line in (ASSETS / 'SHA256SUMS').read_text(encoding='utf-8').splitlines():
        digest, name = line.split(maxsplit=1)
        sums[name] = digest
    actual = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    if actual != sums.get(SOURCE.name):
        raise Stop(f'{SOURCE} has SHA-256 {actual}, but SHA256SUMS says {sums.get(SOURCE.name)}')
    return actual


def esc(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def attr(text):
    return esc(text).replace('"', '&quot;')


def bare(word, keep_diaeresis=True):
    """A headword as it is looked up: NFC, without breve or macron, and
    without a homograph number; optionally without diaeresis."""
    d = unicodedata.normalize('NFD', word)
    d = ''.join(
        c for c in d
        if c not in LENGTH_MARKS and not c.isdigit() and (keep_diaeresis or c != DIAERESIS)
    )
    return unicodedata.normalize('NFC', d).strip()


class Converter:
    def __init__(self, corrections, draft=False):
        # A draft writes unsettled Greek as its raw Beta Code (listed in
        # self.pending) so later steps can be built and tested; it is never
        # the real source file.
        self.draft = draft
        self.pending = []
        self.dropped_length = []
        self.counts = {'machine stem analysis (gramGrp) left out': 0, 'split words joined': 0}
        self.flags = []  # things worth a human look, reported at the end
        self.corrections = corrections
        self.used = set()
        self.applied = []

    # -- Greek ----------------------------------------------------------------

    def greek(self, raw, entry_id, where):
        """Beta Code to Unicode, through corrections.yaml where the source is
        wrong. Returns TEI text (escaped), possibly with a <choice>."""
        fix = self.corrections.get((entry_id, raw))
        if fix:
            self.used.add((entry_id, raw))
            ident = f'corr{len(self.applied) + 1}'
            self.applied.append((ident, entry_id, raw, fix))
            corr = beta_to_unicode(fix['corr'], drop_stray_length=True, dropped=self.dropped_length)
            return (f'<choice xml:id="{ident}"><sic><seg type="betacode">{esc(raw)}</seg></sic>'
                    f'<corr>{esc(corr)}</corr></choice>')
        try:
            return esc(beta_to_unicode(raw, drop_stray_length=True, dropped=self.dropped_length))
        except BetaCodeError as error:
            if self.draft:
                self.pending.append(f'entry {entry_id}, {where}: {error}')
                return esc(raw)
            raise Stop(f'entry {entry_id}, {where}: {error}') from None

    # -- inline content ---------------------------------------------------

    def inline(self, el, entry_id, greek=False):
        """An element's content as TEI. `greek` means bare text inside it is
        Beta Code (a Greek note, or a Greek foreign word)."""
        out = []
        if el.text:
            out.append(self.greek(el.text, entry_id, el.tag) if greek else esc(el.text))
        for child in el:
            out.append(self.child(child, entry_id))
            if child.tail:
                out.append(self.greek(child.tail, entry_id, el.tag) if greek else esc(child.tail))
        return ''.join(out)

    def child(self, c, entry_id):
        tag = c.tag
        if tag in ('trans', 'xr'):
            return self.inline(c, entry_id)
        if tag == 'tr':
            return f'<gloss>{self.inline(c, entry_id)}</gloss>'
        if tag in ('usg', 'bibl'):
            text = ''.join(c.itertext())
            if len(c):
                raise Stop(f'entry {entry_id}: <{tag}> with markup')
            # Perseus writes LS's "id." (the same author) as "id=Plat.";
            # also "id=" alone, "id=id=Aesch.", "id=???", and "id=Soph.;"
            # with a semicolon that belongs after the label.
            m = re.fullmatch(r'id=(?:id=)?(.*?)(;?)', text.strip())
            if m:
                title, semi = m.group(1), m.group(2)
                usg = f'<usg bn:title="{attr(title)}">id.</usg>' if title and title != '???' else '<usg>id.</usg>'
                return usg + esc(semi)
            return f'<usg>{esc(text)}</usg>'
        if tag == 'foreign':
            lang = c.get('lang')
            if lang == 'greek':
                return f'<foreign xml:lang="grc">{self.inline(c, entry_id, greek=True)}</foreign>'
            if lang in ('la', 'en'):
                if len(c):
                    raise Stop(f'entry {entry_id}: <foreign lang="{lang}"> with markup')
                return f'<foreign xml:lang="{lang}">{esc(c.text or "")}</foreign>'
            raise Stop(f'entry {entry_id}: <foreign lang="{lang}">')
        if tag == 'ref':
            return self.ref(c, entry_id)
        if tag == 'gramGrp':
            # Inside a sense, LS's own heading, such as "WITH GEN.".
            colloc = c.find('colloc')
            if colloc is None or len(c) != 1:
                raise Stop(f'entry {entry_id}: <gramGrp> in a sense without <colloc>')
            return esc(''.join(colloc.itertext()))
        raise Stop(f'entry {entry_id}: unexpected <{tag}>')

    def ref(self, c, entry_id):
        # Greek, though a few lack the language attribute.
        if len(c) or c.get('lang') not in ('greek', None):
            raise Stop(f'entry {entry_id}: unexpected <ref>')
        raw = c.text or ''
        # Punctuation Perseus left inside the reference ("a)gaph/.") goes after it.
        m = re.fullmatch(r'(.*?)([.,;:]*)', raw.strip(), flags=re.S)
        word, punct = m.group(1), m.group(2)
        lead = raw[:len(raw) - len(raw.lstrip())]
        trail = raw[len(raw.rstrip()):]
        shown = self.greek(word, entry_id, 'ref')
        if '<choice' in shown:
            target_word = beta_to_unicode(self.corrections[(entry_id, word)]['corr'], drop_stray_length=True)
        else:
            try:
                target_word = beta_to_unicode(word, drop_stray_length=True)
            except BetaCodeError:
                target_word = None  # only in a draft: greek() reported it
        targets = self.by_head.get(bare(target_word), []) if target_word else []
        if len(targets) == 1:
            out = f'<ref type="entry" target="#{targets[0]}" xml:lang="grc">{shown}</ref>'
            self.counts['cross-references to one entry'] = self.counts.get('cross-references to one entry', 0) + 1
        elif targets:
            out = f'<ref type="lemma" xml:lang="grc" bn:lemma="{attr(bare(target_word))}">{shown}</ref>'
            self.counts['cross-references to several entries'] = self.counts.get('cross-references to several entries', 0) + 1
        else:
            out = f'<foreign xml:lang="grc">{shown}</foreign>'
            self.counts['cross-references to no headword (plain Greek)'] = self.counts.get('cross-references to no headword (plain Greek)', 0) + 1
        return esc(lead) + out + esc(punct) + esc(trail)

    # -- entry parts ------------------------------------------------------

    def forms(self, notes, entry_id):
        """The headword line: alt and infl notes in order, joining any word
        Perseus's tool split in two."""
        parts = []
        i = 0
        while i < len(notes):
            n = notes[i]
            text = ''.join(n.itertext())
            if LEMBUF in text:
                nxt = notes[i + 1] if i + 1 < len(notes) else None
                if (nxt is None or nxt.get('type') != 'alt' or len(nxt)
                        or not re.match(r'[/=\\]', nxt.text or '') or not text.rstrip().endswith(LEMBUF)):
                    if not self.draft:
                        raise Stop(f'entry {entry_id}: "{LEMBUF}" not followed by the rest of its word')
                    self.pending.append(f'entry {entry_id}: "{LEMBUF}" not followed by the rest of its word')
                    parts.append(esc(text))
                    i += 1
                    continue
                parts.append(self.joined(n, nxt, entry_id))
                self.counts['split words joined'] += 1
                i += 2
                continue
            greek = n.get('type') == 'alt' or n.tag == 'orth'
            parts.append(self.inline(n, entry_id, greek=greek))
            i += 1
        return ' '.join(p.strip() for p in parts)

    def joined(self, first, second, entry_id):
        """The split word, marked as a correction: the source's two pieces in
        <sic>, the joined text in <corr>. The broken end may be the note's
        own last text, or the text of a Greek element nested at its end
        ("doric <foreign>mnasthfailing on lembuf []</foreign>")."""
        ident = f'corr{len(self.applied) + 1}'
        self.applied.append((ident, entry_id, 'split word', {'evidence': 'join rule'}))
        raw = ''.join(first.itertext()) + ' | ' + (second.text or '')
        rest = second.text or ''
        out = []
        found = False
        pieces = [first.text or ''] + [x for c in first for x in (c, c.tail or '')]
        # The broken end is the last piece with any text.
        last = max(
            i for i, p in enumerate(pieces)
            if (p.strip() if isinstance(p, str) else ''.join(p.itertext()).strip())
        )
        for i, piece in enumerate(pieces):
            if isinstance(piece, str):
                if i == last:
                    if not piece.rstrip().endswith(LEMBUF):
                        raise Stop(f'entry {entry_id}: "{LEMBUF}" not where expected')
                    piece = piece.rstrip()[:-len(LEMBUF)] + rest
                    found = True
                out.append(self.greek(piece, entry_id, 'note') if piece else '')
            elif i == last:
                if piece.tag != 'foreign' or piece.get('lang') != 'greek' or len(piece) \
                        or not (piece.text or '').rstrip().endswith(LEMBUF):
                    raise Stop(f'entry {entry_id}: "{LEMBUF}" not where expected')
                word = (piece.text or '').rstrip()[:-len(LEMBUF)] + rest
                out.append(f'<foreign xml:lang="grc">{self.greek(word, entry_id, "note")}</foreign>')
                found = True
            else:
                out.append(self.child(piece, entry_id))
        if not found:
            raise Stop(f'entry {entry_id}: "{LEMBUF}" not found')
        return (f'<choice xml:id="{ident}"><sic><seg type="betacode">{esc(raw)}</seg></sic>'
                f'<corr>{"".join(out)}</corr></choice>')

    def entry(self, e, strong):
        entry_id = e.get('id')
        key = e.get('key')
        homograph = re.search(r'(\d+)$', key)
        lemma_forms = [f for f in e.findall('form') if f.get('type') is None]
        if len(lemma_forms) != 1 or lemma_forms[0].find('orth') is None or len(lemma_forms[0].find('orth')):
            raise Stop(f'entry {entry_id}: one plain <form><orth> expected')
        orth = lemma_forms[0].find('orth')
        head_raw = re.sub(r'\d+$', '', (orth.text or '').strip())
        headword = self.greek(head_raw, entry_id, 'orth')
        notes, rest = [], []
        for c in e:
            if c is lemma_forms[0]:
                continue
            if c.tag == 'form' and c.get('type') == 'infl':
                # Another form of the word, part of the headword line.
                o = c.find('orth')
                if o is None or len(c) != 1 or len(o):
                    raise Stop(f'entry {entry_id}: unexpected <form type="infl">')
                notes.append(o)
            elif c.tag == 'note' and c.get('type') in ('alt', 'infl'):
                notes.append(c)
            elif c.tag == 'gramGrp':
                self.counts['machine stem analysis (gramGrp) left out'] += 1
                if c.find('.//bibl') is not None:
                    self.flags.append(f'{entry_id}: an author name inside the machine analysis left out: '
                                      + ', '.join(''.join(b.itertext()) for b in c.iter('bibl')))
            elif c.tag in ('etym', 'sense'):
                rest.append(c)
            else:
                raise Stop(f'entry {entry_id}: unexpected <{c.tag}>')
        attrs = f' xml:id="{entry_id}" xml:lang="en"'
        if homograph:
            attrs += f' n="{homograph.group(1)}"'
        numbers = strong.get(self.head_bare[entry_id], [])
        if numbers:
            attrs += f' bn:strong="{" ".join(numbers)}"'
        lines = [f'      <entry{attrs}>',
                 f'        <form type="lemma"><orth xml:lang="grc">{headword}</orth></form>']
        if notes:
            lines.append(f'        <note type="forms">{" ".join(self.forms(notes, entry_id).split())}</note>')
        for c in rest:
            body = ' '.join(self.inline(c, entry_id).split())
            if not re.sub(r'<[^>]*>', '', body).strip():
                # Empty senses in the source (one holds only an empty <tr>,
                # numbered "Perseus"); a numbered one may have lost its
                # text, so it is listed for a look at the print.
                self.counts['empty senses left out'] = self.counts.get('empty senses left out', 0) + 1
                if c.get('n') not in (None, '0'):
                    self.flags.append(f'{entry_id}: empty sense numbered {c.get("n")} left out')
                continue
            if c.tag == 'etym':
                lines.append(f'        <etym>{body}</etym>')
            else:
                n, level = c.get('n'), c.get('level')
                sense_attrs = ''
                if n and n != '0':
                    sense_attrs += f' n="{attr(n)}"'
                if level and level != '0':
                    sense_attrs += f' bn:level="{attr(level)}"'
                lines.append(f'        <sense{sense_attrs}>{body}</sense>')
        lines.append('      </entry>')
        return '\n'.join(lines)


def strong_numbers(ls_heads):
    """Strong's Greek numbers by LS headword: Strong's headword equal to an
    LS headword (both looked up as `bare`), or else equal once diaeresis is
    ignored (Strong's πρωΐ, LS πρωί)."""
    text = GREEK_TEI.read_text(encoding='utf-8')
    found = {}
    plain = {bare(h, keep_diaeresis=False): h for h in ls_heads}
    for n, word in re.findall(r'<entry xml:id="(G\d+)"[^>]*>\s*<form type="lemma">\s*<orth xml:lang="grc">([^<]*)</orth>', text):
        b = bare(word)
        if b not in ls_heads:
            b = plain.get(bare(word, keep_diaeresis=False))
        if b:
            found.setdefault(b, []).append(n)
    return found


def header(source_sha, conv, entries_count):
    changes = '\n'.join(
        f'      <change target="#{ident}">{entry}: '
        + ('a word split by the conversion tool, joined (rule; checked on five cases against the 1889 printing).'
           if fix.get('evidence') == 'join rule'
           else f'"{esc(raw)}" corrected to "{esc(fix["corr"])}". Evidence: {esc(fix["evidence"].strip())}')
        + '</change>'
        for ident, entry, raw, fix in conv.applied
    )
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="{TEI_NS}" xmlns:bn="{BN_NS}" xml:lang="en">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title>An Intermediate Greek-English Lexicon</title>
        <title type="sub">Founded upon the seventh edition of Liddell and Scott's Greek-English Lexicon</title>
        <author>Henry George Liddell</author>
        <author>Robert Scott</author>
        <respStmt>
          <resp>Converted to TEI for Bible Nav (module {MODULE})</resp>
          <name>Bible Nav</name>
        </respStmt>
      </titleStmt>
      <publicationStmt>
        <publisher>Bible Nav</publisher>
        <availability>
          <licence target="http://creativecommons.org/licenses/by-sa/3.0/us/">Text provided by Perseus Digital Library, with funding from The Annenberg CPB/Project. Original version available for viewing and download at http://www.perseus.tufts.edu/hopper/. Corrected copy by Benjamin Linskey. Licensed under the Creative Commons Attribution-ShareAlike 3.0 United States License, with the additional restriction that modifications are offered to Perseus. Converted to TEI by Bible Nav, with corrections listed below.</licence>
        </availability>
      </publicationStmt>
      <sourceDesc>
        <bibl xml:id="source">Perseus Digital Library, An Intermediate Greek-English Lexicon (text 1999.04.0058), in Benjamin Linskey's corrected copy: {SOURCE_URL} (commit {SOURCE_COMMIT}, {SOURCE_DATE}), file SHA-256 {source_sha}.</bibl>
        <bibl>Henry George Liddell and Robert Scott, An Intermediate Greek-English Lexicon (Oxford: Clarendon Press, 1889; New York: Harper and Brothers, 1889).</bibl>
      </sourceDesc>
    </fileDesc>
    <encodingDesc>
      <p>Each of the {entries_count} entries keeps its Perseus id as its xml:id; n is the homograph number where Perseus gives one, and bn:strong the Strong's Greek numbers whose headword is the same word. The note of type forms is the headword line (endings, article, principal parts); etym is the etymology (Perseus writes Liddell and Scott's "Hence" at the end of an entry as "from ..." on the next), and each sense a numbered sense, with its level in bn:level. gloss is a translation, usg an author or usage label (bn:title gives the author an "id." refers to), and foreign a Greek, Latin or English word. A ref of type entry links to one entry; a ref of type lemma links to every entry with the headword in bn:lemma. Greek is converted from Perseus's Beta Code to Unicode (NFC).</p>
      <p>Left out: Perseus's machine-made stem analysis ({conv.counts["machine stem analysis (gramGrp) left out"]} groups), the alphabet headings, and {len(conv.dropped_length)} breves or macrons that no vowel can carry where they stand.</p>
    </encodingDesc>
    <revisionDesc>
{changes or "      <change>No corrections.</change>"}
    </revisionDesc>
  </teiHeader>
  <text>
    <body>
'''


def load_corrections():
    items = yaml.safe_load(CORRECTIONS.read_text(encoding='utf-8')) or []
    out = {}
    for index, c in enumerate(items, start=1):
        if set(c) != {'entry', 'source', 'corr', 'evidence'}:
            raise Stop(f'correction {index} must have exactly entry, source, corr and evidence')
        out[(c['entry'], c['source'])] = c
    return out


def main():
    draft = '--draft' in sys.argv[1:]
    source_sha = check_source()
    root = ET.parse(SOURCE).getroot()
    entries = list(root.iter('entry'))
    corrections = load_corrections()
    conv = Converter(corrections, draft=draft)
    # Every headword, for cross-references and Strong's numbers.
    conv.by_head = {}
    conv.head_bare = {}
    heads = set()
    for e in entries:
        raw = re.sub(r'\d+$', '', (e.find('form/orth').text or '').strip())
        try:
            h = bare(beta_to_unicode(raw, drop_stray_length=True))
        except BetaCodeError:
            fix = corrections.get((e.get('id'), raw))
            if fix:
                h = bare(beta_to_unicode(fix['corr'], drop_stray_length=True))
            else:
                # Reported with the entry's other problems below.
                h = raw
        conv.by_head.setdefault(h, []).append(e.get('id'))
        conv.head_bare[e.get('id')] = h
        heads.add(h)
    strong = strong_numbers(heads)
    problems = []
    body = []
    for e in entries:
        try:
            body.append(conv.entry(e, strong))
        except Stop as stop:
            problems.append(str(stop))
    unused = set(corrections) - conv.used
    for key in sorted(unused):
        problems.append(f'correction for {key[0]} not used: {key[1]!r} (fixed upstream, or mistyped)')
    if problems:
        for p in problems[:60]:
            print(p)
        raise Stop(f'{len(problems)} problems; nothing written')
    text = header(source_sha, conv, len(entries)) + '\n'.join(body) + '\n    </body>\n  </text>\n</TEI>\n'
    if draft:
        text = text.replace('<TEI ', '<!-- DRAFT: unsettled Greek left as Beta Code; not the source file. -->\n<TEI ', 1)
    ET.fromstring(text.encode('utf-8'))  # well-formed, or stop before writing
    tmp = OUTPUT.with_suffix('.xml.tmp')
    tmp.write_text(text, encoding='utf-8')
    tmp.replace(OUTPUT)
    linked = sum(1 for nums in strong.values() for _ in nums)
    print(f'{len(entries)} entries written to {OUTPUT}')
    for name, count in conv.counts.items():
        print(f'  {name}: {count}')
    print(f'  stray breves and macrons left out: {len(conv.dropped_length)}')
    print(f'  Strong\'s numbers linked: {linked} (to {len(strong)} headwords)')
    print(f'  corrections applied: {len(conv.applied)}')
    if draft:
        print(f'  DRAFT: {len(conv.pending)} unsettled, left as Beta Code')
    for flag in conv.flags:
        print('  to check:', flag)


if __name__ == '__main__':
    try:
        main()
    except Stop as stop:
        sys.exit(f'Stopped: {stop}')
