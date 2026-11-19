import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readTeiLexicon } from './tei-lexicon-reader';

/** A TEI file holding these entries. */
export function tei(entries: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:bn="https://biblenav.org/ns/lexicon/1" xml:lang="en">
  <teiHeader><fileDesc><titleStmt><title>Test</title></titleStmt></fileDesc></teiHeader>
  <text>
    <body>
${entries}
    </body>
  </text>
</TEI>
`;
}

export function entry(
  id: string,
  inner = '',
  etym = 'from <ref type="entry" target="#H2" xml:lang="hbo" bn:translit="b">B</ref>;'
): string {
  return `      <entry xml:id="${id}" xml:lang="en">
        <form type="lemma">
          <orth xml:lang="hbo">W${id}</orth>
          <orth type="transliteration">w${id}</orth>
          <pron>pron-${id}</pron>
        </form>
        <etym>${etym}</etym>
        <sense>
          <def><hi rend="italic">first</hi>, rank, <choice xml:id="c1"><sic>itc.</sic><corr>etc.</corr></choice>)</def>
          <note type="kjvRenderings">beginning<note type="sourceCorrection" resp="#os">xlit <seg type="catchWord">x</seg></note>.</note>
        </sense>${inner}
      </entry>`;
}

describe('TEI lexicon reader', () => {
  test('reads entries into bodies, lookups and links', () => {
    const lexicon = readTeiLexicon(tei(entry('H1') + '\n' + entry('H2')));
    assert.equal(lexicon.entries.length, 2);
    const [first] = lexicon.entries;
    assert.equal(first.key, 'H1');
    assert.equal(first.headword, 'WH1');
    assert.equal(first.headwordLang, 'hbo');
    assert.equal(first.translit, 'wH1');
    assert.equal(first.pronunciation, 'pron-H1');
    assert.deepEqual(first.body, [
      {
        style: 'deriv',
        attributes: {},
        children: [
          'from ',
          { style: 'ref', attributes: { strong: 'H2' }, children: ['B'] },
          ';',
        ],
      },
      {
        style: 'def',
        attributes: {},
        children: [
          { style: 'em', attributes: {}, children: ['first'] },
          // The correction's <corr>, joined with the text around it.
          ', rank, etc.)',
        ],
      },
      // The source editors' note is left out.
      { style: 'kjv', attributes: {}, children: ['beginning.'] },
    ]);
    assert.deepEqual(lexicon.lookups, [
      { kind: 'strong', value: 'H1', entryKey: 'H1' },
      { kind: 'strong', value: 'H2', entryKey: 'H2' },
    ]);
  });

  test('an unlinked word keeps its language, transliteration and pronunciation', () => {
    const lexicon = readTeiLexicon(
      tei(
        entry(
          'H2',
          '',
          'or <mentioned xml:lang="hbo" bn:translit="t" bn:pron="p">X</mentioned>; and <mentioned xml:lang="hbo" bn:pron="q"></mentioned>'
        )
      )
    );
    assert.deepEqual(lexicon.entries[0].body[0], {
      style: 'deriv',
      attributes: {},
      children: [
        'or ',
        {
          style: 'word',
          attributes: { lang: 'hbo', translit: 't', pronunciation: 'p' },
          children: ['X'],
        },
        '; and ',
        {
          style: 'word',
          attributes: { lang: 'hbo', pronunciation: 'q' },
          children: [],
        },
      ],
    });
  });

  test('a link to a missing entry fails', () => {
    assert.throws(
      () => readTeiLexicon(tei(entry('H1'))),
      /link to H2, which no entry has/
    );
  });

  test('unknown markup fails, so nothing is dropped silently', () => {
    const cases = [
      entry('H2', '\n        <usg>x</usg>'),
      entry('H2', '', 'from <foreign xml:lang="grc">x</foreign>'),
      entry('H2', '', '<hi rend="bold">x</hi>'),
      entry('H2', '', '<mentioned xml:lang="hbo" bn:other="1">x</mentioned>'),
    ];
    for (const body of cases) {
      assert.throws(
        () => readTeiLexicon(tei(body)),
        /unexpected|unknown|must/,
        body
      );
    }
  });

  test('two entries with one key fail', () => {
    assert.throws(
      () => readTeiLexicon(tei(entry('H2') + '\n' + entry('H2'))),
      /two entries H2/
    );
  });
});
