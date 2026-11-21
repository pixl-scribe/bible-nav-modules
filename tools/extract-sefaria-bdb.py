#!/usr/bin/env python3
"""
Extracts Brown-Driver-Briggs from Sefaria's MongoDB dump into plain JSON,
the locked source of the eng_bdb lexicon.

    tools/venv/bin/python -I tools/extract-sefaria-bdb.py <lexicon_entry.bson[.gz]> <out.json>

Sefaria publishes its data as a MongoDB dump (dump_small.tar.gz), replaced
from time to time; the lexicon entries are in its lexicon_entry collection.
This keeps only the entries of the two BDB lexicons, "BDB Dictionary" and
"BDB Aramaic Dictionary", exactly as stored (every field, in order), sorted
by lexicon and then by BDB's own entry id ("rid"), and writes them as JSON. Its
reader of BSON (MongoDB's binary format; https://bsonspec.org) is written
here, so nothing outside the standard library is trusted; it refuses any
BSON type it doesn't know.
"""
import gzip
import json
import struct
import sys

LEXICONS = ('BDB Dictionary', 'BDB Aramaic Dictionary')


class BsonError(Exception):
    pass


def cstring(data, at):
    end = data.index(b'\x00', at)
    return data[at:end].decode('utf-8'), end + 1


def document(data, at, is_array=False):
    """A BSON document (or array) starting at `at`: (value, next position)."""
    (size,) = struct.unpack_from('<i', data, at)
    end = at + size
    if data[end - 1] != 0:
        raise BsonError(f'document at {at} does not end in a zero byte')
    at += 4
    out = [] if is_array else {}
    while at < end - 1:
        kind = data[at]
        name, at = cstring(data, at + 1)
        if kind == 0x01:  # double
            (value,) = struct.unpack_from('<d', data, at); at += 8
        elif kind == 0x02:  # string
            (length,) = struct.unpack_from('<i', data, at)
            value = data[at + 4:at + 4 + length - 1].decode('utf-8'); at += 4 + length
        elif kind in (0x03, 0x04):  # document, array
            value, at = document(data, at, is_array=(kind == 0x04))
        elif kind == 0x05:  # binary
            (length,) = struct.unpack_from('<i', data, at)
            value = {'$binary': data[at + 5:at + 5 + length].hex(), '$subtype': data[at + 4]}
            at += 5 + length
        elif kind == 0x07:  # ObjectId
            value = {'$oid': data[at:at + 12].hex()}; at += 12
        elif kind == 0x08:  # boolean
            value = data[at] == 1; at += 1
        elif kind == 0x09:  # datetime, milliseconds since 1970
            (value,) = struct.unpack_from('<q', data, at); value = {'$date': value}; at += 8
        elif kind == 0x0A:  # null
            value = None
        elif kind == 0x10:  # int32
            (value,) = struct.unpack_from('<i', data, at); at += 4
        elif kind == 0x11:  # timestamp
            (value,) = struct.unpack_from('<Q', data, at); value = {'$timestamp': value}; at += 8
        elif kind == 0x12:  # int64
            (value,) = struct.unpack_from('<q', data, at); at += 8
        else:
            raise BsonError(f'BSON type 0x{kind:02x} at {at} is not known here')
        if is_array:
            out.append(value)
        else:
            out[name] = value
    return out, end


def entries(data):
    at = 0
    while at < len(data):
        value, at = document(data, at)
        yield value


def main():
    source, target = sys.argv[1:3]
    opener = gzip.open if source.endswith('.gz') else open
    with opener(source, 'rb') as f:
        data = f.read()
    kept = [e for e in entries(data) if e.get('parent_lexicon') in LEXICONS]
    # BDB's own order: its entry ids, "BDB00001" onwards (the Aramaic
    # section has its own, after the Hebrew).
    kept.sort(key=lambda e: (LEXICONS.index(e['parent_lexicon']), e['rid']))
    with open(target, 'w', encoding='utf-8') as out:
        json.dump(kept, out, ensure_ascii=False, indent=1, sort_keys=False)
        out.write('\n')
    counts = {name: sum(1 for e in kept if e['parent_lexicon'] == name) for name in LEXICONS}
    print(f'{len(kept)} entries written to {target}: {counts}')


if __name__ == '__main__':
    main()
