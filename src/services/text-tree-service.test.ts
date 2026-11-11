import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import ModuleFactory from '../module-factory';
import { ModuleConfig } from '../model/module-config';
import { DbExporterService } from './db-exporter-service';
import {
  encodeItems,
  headingLeaf,
  Item,
  itemsFromStored,
  moduleRoots,
  node,
  root,
  textView,
  verseLeaf,
} from './text-tree-service';
import UsxParserService from './usx-parser-service';

// Expected bytes below are written out by hand from docs/integrity-spec.md,
// not produced by the code under test.
const hex = (text: string) => Buffer.from(text.replace(/\s+/g, ''), 'hex');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest();
const ascii = (text: string) => Buffer.from(text, 'utf8').toString('hex');

describe('encoding', () => {
  test('a verse leaf of plain text', () => {
    const expected = sha(
      hex(`00
        00000005 ${ascii('verse')}
        00000001 ${ascii('1')}
        00000001
          74 00000002 ${ascii('In')}`)
    );
    assert.deepEqual(verseLeaf('1', ['In']), expected);
  });

  test('a word with its Strong number, as an element', () => {
    const items = itemsFromStored([
      { style: 'w', strong: 'H7225', txt: 'beginning' },
    ]);
    assert.deepEqual(
      encodeItems(items),
      hex(`00000001
        65 00000001 ${ascii('w')}
          00000001 00000006 ${ascii('strong')} 00000005 ${ascii('H7225')}
          00000001 74 00000009 ${ascii('beginning')}`)
    );
  });

  test('attributes are sorted by their UTF-8 bytes', () => {
    const element: Item = {
      style: 'x',
      attributes: [
        ['b', '2'],
        ['a', '1'],
      ],
      children: [],
    };
    assert.deepEqual(
      encodeItems([element]),
      hex(`00000001
        65 00000001 ${ascii('x')}
          00000002 00000001 ${ascii('a')} 00000001 ${ascii('1')}
                   00000001 ${ascii('b')} 00000001 ${ascii('2')}
          00000000`)
    );
  });

  test('a heading leaf, and a chapter node over its leaves', () => {
    const title = headingLeaf('d', ['A Psalm']);
    assert.deepEqual(
      title,
      sha(
        hex(`00
          00000007 ${ascii('heading')}
          00000001 ${ascii('d')}
          00000001 74 00000007 ${ascii('A Psalm')}`)
      )
    );
    const verse = verseLeaf('1', ['LORD']);
    assert.deepEqual(
      node('chapter', '3', [title, verse]),
      sha(
        Buffer.concat([
          hex(
            `01 00000007 ${ascii('chapter')} 00000001 ${ascii('3')} 00000002`
          ),
          title,
          verse,
        ])
      )
    );
  });

  test('a root names the tree, its version, and its view', () => {
    const testament = node('testament', 'OT', []);
    assert.deepEqual(
      root('text', [testament]),
      sha(
        Buffer.concat([
          hex(`01
            00000013 ${ascii('bible-nav text tree')}
            00000001
            00000004 ${ascii('text')}
            00000001`),
          testament,
        ])
      )
    );
  });

  test('text is hashed exactly as given, never normalized', () => {
    // "é" precomposed (NFC) and as e + combining acute (NFD) differ.
    assert.notDeepEqual(verseLeaf('1', ['é']), verseLeaf('1', ['é']));
  });

  test('unknown stored content fails rather than being left out', () => {
    assert.throws(
      () =>
        itemsFromStored([{ style: 'add', children: [], extra: 1 } as never]),
      /unexpected inline content/
    );
  });
});

describe('textView', () => {
  const stored = itemsFromStored([
    'In the ',
    { style: 'w', strong: 'H7225', txt: 'beginning' },
    { style: 'f', children: [{ style: 'ft', children: ['a note'] }] },
    ' ',
    { style: 'wj', children: ['I ', { style: 'add', children: ['am'] }] },
    '',
  ]);

  test('keeps the words, italics, and the divine name only', () => {
    assert.deepEqual(textView(stored), [
      'In the beginning I ',
      { style: 'add', attributes: [], children: ['am'] },
    ]);
  });

  test("doesn't depend on how the text was split", () => {
    assert.deepEqual(
      encodeItems(textView(['In', ' the ', 'beginning'])),
      encodeItems(textView(['In the beginning']))
    );
  });
});

const USX = (parts: {
  title?: string;
  word?: string;
  layout?: string;
  closing?: string;
  strong?: boolean;
  note?: boolean;
  red?: boolean;
  bookTitle?: string;
}) => {
  const word =
    parts.strong === false
      ? 'LORD'
      : '<char style="w" strong="H3068">LORD</char>';
  const note =
    parts.note === false
      ? ''
      : '<note style="f" caller="+"><char style="fr">1.1 </char><char style="ft">a note</char></note>';
  const follow =
    parts.red === false ? 'Follow me.' : '<char style="wj">Follow me.</char>';
  return `<?xml version="1.0" encoding="UTF-8"?>
<usx version="3.0"><book style="id" code="TST">The Book of Test</book>
  <para style="h">Test</para>
  <para style="toc1">Long Test</para>
  <para style="toc2">Test</para>
  <para style="toc3">Tst</para>
  <para style="mt1">${parts.bookTitle ?? 'THE BOOK'}</para>
  <chapter style="c" number="1" sid="TST 1"/>
  <para style="d">${parts.title ?? 'A Psalm of old.'}</para>
  <para style="${parts.layout ?? 'p'}"><verse style="v" number="1" sid="TST 1:1"/>The <char style="nd">${word}</char> is <char style="add">my</char> ${parts.word ?? 'true'} guide.${note}<verse eid="TST 1:1"/><verse style="v" number="2" sid="TST 1:2"/>${follow}<verse eid="TST 1:2"/></para>
  <para style="s1">${parts.closing ?? 'The end.'}</para>
  <chapter eid="TST 1"/>
</usx>
`;
};

const CONFIG: ModuleConfig = {
  name: 'Test',
  description: 'Test',
  moduleType: 'bible',
  language: 'English',
  languageCode: 'eng',
  license: 'Public Domain',
  version: '1.0.0',
  testamentsIncluded: ['OT'],
};

describe('moduleRoots', () => {
  let dir: string;
  let count = 0;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'text-tree-'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const roots = (parts: Parameters<typeof USX>[0]) => {
    const dbFile = path.join(dir, `test-${count++}.db`);
    const book = new UsxParserService().parseBookXml(USX(parts));
    const exporter = new DbExporterService(dbFile);
    exporter.exportModule(CONFIG);
    exporter.exportTestament('OT');
    ModuleFactory.exportBook(exporter, 'OT', book, {
      paragraph: 0,
      lastVerseId: 0,
    });
    exporter.close();
    return moduleRoots(dbFile);
  };

  test('builds the content root from the chapter in reading order', () => {
    // The Psalm title comes before verse 1, and the closing note after the
    // last verse, within the chapter.
    const items = (stored: unknown[]) => itemsFromStored(stored as never);
    const chapter = node('chapter', '1', [
      headingLeaf('d', items(['A Psalm of old.'])),
      verseLeaf(
        '1',
        items([
          'The ',
          {
            style: 'nd',
            children: [{ style: 'w', strong: 'H3068', txt: 'LORD' }],
          },
          ' is ',
          { style: 'add', children: ['my'] },
          ' true guide.',
          {
            style: 'f',
            children: [
              { style: 'fr', children: ['1.1'] },
              { style: 'ft', children: ['a note'] },
            ],
          },
        ])
      ),
      verseLeaf('2', items([{ style: 'wj', children: ['Follow me.'] }])),
      headingLeaf('s1', items(['The end.'])),
    ]);
    const expected = root('content', [
      node('testament', 'OT', [node('book', 'TST', [chapter])]),
    ]);
    assert.equal(roots({}).contentRoot, expected.toString('hex'));
  });

  test('the text root ignores what editors added around the text', () => {
    const base = roots({});
    const plain = roots({
      strong: false,
      note: false,
      red: false,
      closing: 'Fin.',
    });
    assert.equal(plain.textRoot, base.textRoot);
    assert.notEqual(plain.contentRoot, base.contentRoot);
  });

  test('neither root covers layout or book titles', () => {
    const base = roots({});
    const restyled = roots({ layout: 'q1', bookTitle: 'THE TEST BOOK' });
    assert.deepEqual(restyled, base);
  });

  test('the text root changes with any word of a verse or Psalm title', () => {
    const base = roots({});
    assert.notEqual(roots({ word: 'false' }).textRoot, base.textRoot);
    assert.notEqual(
      roots({ title: 'A Psalm of new.' }).textRoot,
      base.textRoot
    );
  });

  test('the independent Python checker gives the same roots', (t) => {
    try {
      execFileSync('python3', ['--version']);
    } catch {
      t.skip('python3 is not installed');
      return;
    }
    for (const parts of [{}, { strong: false, red: false, closing: 'Fin.' }]) {
      const expected = roots(parts);
      const dbFile = path.join(dir, `test-${count - 1}.db`);
      const output = execFileSync('python3', [
        '-I',
        path.resolve('tools', 'text-roots.py'),
        dbFile,
      ]).toString();
      const found = JSON.parse(output) as { text: string; content: string };
      assert.deepEqual(
        { textRoot: found.text, contentRoot: found.content },
        expected
      );
    }
  });
});
