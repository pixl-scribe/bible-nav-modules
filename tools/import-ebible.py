#!/usr/bin/env python3
"""
Imports a text from eBible.org as USX for the generator.

eBible publishes USFM and USFX, not USX, each archive with
signature.txt.asc: a SHA-256 list of its files, PGP-signed by eBible's
editors. This tool fetches the archives, checks that signature and those
hashes, and converts the USFM to USX 3.1 with usfmtc, the reference
converter of the USFM technical committee
(https://github.com/usfm-bible/usfmtc).

Set up once, from bible-nav-modules:

    python3 -m venv tools/venv
    tools/venv/bin/pip install -r tools/requirements.txt

Then:

    tools/venv/bin/python tools/import-ebible.py fetch englsv englsv
    tools/venv/bin/python tools/import-ebible.py convert englsv

`fetch <module-id> <ebible-id>` downloads <ebible-id>_usfm.zip and
<ebible-id>_usfx.zip into assets/<module-id>/ebible/, refusing to replace
archives already there: they are the locked input, kept unchanged. The USFX
archive is for tools/compare-ebible.py, an independent check of the module.

`convert <module-id>` checks the USFM archive's signature and hashes, then
writes one <book>.usx per canonical book into assets/<module-id>/,
replacing earlier ones, and their SHA256SUMS. Literal | characters in the
text are escaped first (see escape_literal_bars), and verses holding only
a dash, eBible's placeholders for verses the edition doesn't have, are left
out (see drop_placeholder_verses). Other books in the archive,
such as front matter or a glossary, are listed and left out.

The PGP check needs GnuPG. It uses a temporary keyring, imports the key from
the archive, and accepts only a signature by eBible's key with the
fingerprint below, the key that signed the KJV source we locked.
"""
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

# eBible.org editors' signing key, as recorded in assets/eng_kjv/PROVENANCE.md.
EBIBLE_FINGERPRINT = '54D714D76956DA6673DC1EEA5F62009D93505F26'

# The canonical books, in USX codes, in the generator's order.
CANON = (
    'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB '
    'PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP '
    'HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI '
    '2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'
).split()


def fail(message):
    sys.exit(f'import-ebible: {message}')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


# A `|` separates a marker's attributes from its content only inside a
# character marker (\w word|strong="H1"\w*, also nested as \+w) or in a
# milestone (\qt-s |sid="..."\*). Anywhere else it's text. USFM expects a
# literal bar to be escaped as \|, but some texts use it unescaped: the LSV
# marks poetic line breaks with ||. usfmtc then reads the words after it as
# attributes and drops them, so literal bars are escaped before converting.
ATTRIBUTE_BAR = re.compile(
    r'\\(\+?[A-Za-z0-9]+)\s[^\\|]*(\|)[^\\]*\\\1\*'
    r'|\\[A-Za-z0-9]+-[se]\s*(\|)[^\\]*\\\*')


def escape_literal_bars(usfm):
    """Escapes every | that isn't an attribute separator. Returns the new
    text and how many bars were escaped."""
    separators = {match.start(2) if match.group(2) else match.start(3)
                  for match in ATTRIBUTE_BAR.finditer(usfm)}
    out, escaped = [], 0
    for index, character in enumerate(usfm):
        if (character == '|' and index not in separators
                and not (index > 0 and usfm[index - 1] == '\\')):
            out.append('\\')
            escaped += 1
        out.append(character)
    return ''.join(out), escaped


# eBible keeps a slot for a verse an edition doesn't have as a verse holding
# only a dash (the LSV's 3 John 1:15 and Revelation 12:18, whose words are in
# the KJV's 3 John 1:14 and Revelation 13:1). It isn't text, so it's left out.
PLACEHOLDER_VERSE = re.compile(
    r'\\v (\S+)[ \t]+-[ \t]*(?:\r?\n)?(?=\\c |\\v |\\p|\Z)')


def drop_placeholder_verses(usfm, code):
    """Removes verses holding only a dash. Returns the new text and the
    references removed."""
    dropped = []

    def reference(match):
        chapters = re.findall(r'\\c (\d+)', usfm[:match.start()])
        dropped.append(f'{code} {chapters[-1] if chapters else "?"}:'
                       f'{match.group(1)}')
        return ''

    return PLACEHOLDER_VERSE.sub(reference, usfm), dropped


def fetch(module_id, ebible_id):
    folder = Path('assets', module_id, 'ebible')
    folder.mkdir(parents=True, exist_ok=True)
    for kind in ('usfm', 'usfx'):
        name = f'{ebible_id}_{kind}.zip'
        target = folder / name
        if target.exists():
            fail(f'{target} already exists. It is the locked input: delete it '
                 'first only if you mean to replace it.')
        url = f'https://ebible.org/Scriptures/{name}'
        # eBible refuses Python's default user agent; send the tool's name.
        request = urllib.request.Request(
            url, headers={'User-Agent': 'bible-nav-modules import-ebible'})
        try:
            with urllib.request.urlopen(request) as response:
                data = response.read()
        except urllib.error.URLError as error:
            fail(f'could not download {url}: {error}')
        target.write_bytes(data)
        print(f'{target}  {len(data)} bytes  SHA-256 {sha256(data)}')


def check_signature(archive):
    """Checks the archive's PGP-signed SHA-256 list. Returns {name: hash}."""
    names = set(archive.namelist())
    for needed in ('signature.txt.asc', 'keys.asc'):
        if needed not in names:
            fail(f'the archive has no {needed}')
    if shutil.which('gpg') is None:
        fail('GnuPG (gpg) is needed to check eBible\'s signature')
    with tempfile.TemporaryDirectory() as home:
        os.chmod(home, 0o700)
        signature = Path(home, 'signature.txt.asc')
        signature.write_bytes(archive.read('signature.txt.asc'))
        keys = Path(home, 'keys.asc')
        keys.write_bytes(archive.read('keys.asc'))
        gpg = ['gpg', '--homedir', home, '--batch', '--quiet']
        subprocess.run(gpg + ['--import', str(keys)], check=True,
                       capture_output=True)
        result = subprocess.run(gpg + ['--status-fd', '1', '--verify',
                                       str(signature)],
                                capture_output=True, text=True)
    valid = [line.split()[2] for line in result.stdout.splitlines()
             if line.startswith('[GNUPG:] VALIDSIG ')]
    if result.returncode != 0 or valid != [EBIBLE_FINGERPRINT]:
        fail('signature.txt.asc is not validly signed by eBible\'s key '
             f'{EBIBLE_FINGERPRINT}')
    text = archive.read('signature.txt.asc').decode('utf-8')
    return {line[66:].strip(): line[:64] for line in text.splitlines()
            if re.match(r'^[0-9a-f]{64}  ', line)}


def convert(module_id):
    module = Path('assets', module_id)
    zips = sorted(Path(module, 'ebible').glob('*_usfm.zip'))
    if len(zips) != 1:
        fail(f'expected one *_usfm.zip in {module}/ebible, found {len(zips)}')
    archive = zipfile.ZipFile(zips[0])
    listed = check_signature(archive)
    print(f'{zips[0].name}: signed by eBible ({EBIBLE_FINGERPRINT}).')

    converter = Path(sys.executable).parent / 'usfmconv'
    if not converter.exists():
        fail('usfmconv not found: run this with tools/venv/bin/python '
             '(see the setup at the top of this file)')

    books, skipped = {}, []
    for name in sorted(n for n in archive.namelist() if n.endswith('.usfm')):
        data = archive.read(name)
        if listed.get(name) != sha256(data):
            fail(f'{name} does not match the SHA-256 in signature.txt.asc')
        match = re.search(rb'^\\id\s+(\S+)', data, re.MULTILINE)
        code = match.group(1).decode('ascii').upper() if match else '?'
        if code in CANON:
            if code in books:
                fail(f'{code} appears twice in the archive')
            books[code] = (name, data)
        else:
            skipped.append(f'{code} ({name})')

    escaped_total, placeholders = 0, []
    with tempfile.TemporaryDirectory() as work:
        for code, (name, data) in books.items():
            text, dropped = drop_placeholder_verses(data.decode('utf-8'), code)
            placeholders += dropped
            text, escaped = escape_literal_bars(text)
            escaped_total += escaped
            source = Path(work, f'{code}.usfm')
            source.write_text(text, encoding='utf-8')
            target = Path(work, f'{code.lower()}.usx')
            subprocess.run([str(converter), '-q', '-e', '-F', 'usx',
                            '-o', str(target), str(source)], check=True)
        # Only now replace the old USX, so a failure leaves it untouched.
        for old in module.glob('*.usx'):
            old.unlink()
        sums = []
        for code in CANON:
            if code in books:
                name = f'{code.lower()}.usx'
                shutil.move(Path(work, name), module / name)
                sums.append(f'{sha256((module / name).read_bytes())}  {name}')
    sums.sort(key=lambda line: line[66:])
    (module / 'SHA256SUMS').write_text('\n'.join(sums) + '\n')
    print(f'Wrote {len(books)} books as USX to {module}/, with SHA256SUMS.')
    if placeholders:
        print('Left out placeholder verses holding only "-": '
              + ', '.join(placeholders))
    if escaped_total:
        print(f'Escaped {escaped_total} literal | characters in the text, '
              'so the converter keeps them as text.')
    if skipped:
        print('Left out (not canonical books): ' + ', '.join(skipped))


def main(args):
    if len(args) == 3 and args[0] == 'fetch':
        fetch(args[1], args[2])
    elif len(args) == 2 and args[0] == 'convert':
        convert(args[1])
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
