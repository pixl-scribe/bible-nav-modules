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
      entry('H2', '', 'from <term>x</term>'),
      entry('H2', '', '<hi rend="underline">x</hi>'),
      entry('H2', '', '<ref type="bible">Gn 1:1</ref>'),
      entry('H2', '', '<ref type="bible" bn:sid="Gen 1:1">Gn 1:1</ref>'),
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

  test('Greek entries: forms, Latin, remarks, and links into another lexicon', () => {
    const greek = `      <entry xml:id="G1" xml:lang="en">
        <form type="lemma">
          <orth xml:lang="grc">A</orth>
          <orth type="transliteration">a</orth>
          <pron>al'-fah</pron>
        </form>
        <note type="forms">or <mentioned xml:lang="grc" bn:pron="p">B</mentioned></note>
        <etym>for Latin <foreign xml:lang="la">aquila</foreign>, from <ref type="entry" target="eng_strongs_heb.tei.xml#H85" xml:lang="hbo">C</ref> and <choice xml:id="c1"><sic><ref type="entry" target="#G5689"/></sic><corr><ref type="entry" target="#G1" xml:lang="grc">A</ref></corr></choice>;</etym>
        <note type="comment">Compare <ref type="entry" target="#G1" xml:lang="grc">A</ref>.</note>
      </entry>`;
    const [entry] = readTeiLexicon(tei(greek)).entries;
    assert.deepEqual(
      entry.body.map((part) => (part as { style: string }).style),
      ['form', 'deriv', 'note']
    );
    assert.deepEqual(entry.body[1], {
      style: 'deriv',
      attributes: {},
      children: [
        'for Latin ',
        { style: 'foreign', attributes: { lang: 'la' }, children: ['aquila'] },
        ', from ',
        // Into Strong's Hebrew: allowed, though this lexicon lacks it.
        { style: 'ref', attributes: { strong: 'H85' }, children: ['C'] },
        ' and ',
        // The correction's link, not the source's.
        { style: 'ref', attributes: { strong: 'G1' }, children: ['A'] },
        ';',
      ],
    });
  });

  test('a link into this lexicon must still lead to an entry', () => {
    const body = entry('G1', '', 'from <ref type="entry" target="#G2">B</ref>');
    assert.throws(() => readTeiLexicon(tei(body)), /link to G2/);
  });

  test('Liddell and Scott: parts in order, senses, labels, links by headword, lookups', () => {
    // Built from code points, so no combining mark is typed: a breve
    // (U+0306) and a homograph number are left out of the lemma lookup.
    const breve = String.fromCodePoint(0x306);
    const ls = `      <entry xml:id="n1" xml:lang="en" n="1" bn:strong="G25 G26">
        <form type="lemma"><orth xml:lang="grc">a${breve}ga</orth></form>
        <note type="forms">ab, <foreign xml:lang="en">doric</foreign> <foreign xml:lang="grc">ac</foreign></note>
        <etym>from <ref type="lemma" xml:lang="grc" bn:lemma="be">be</ref></etym>
        <sense n="I" bn:level="2"><gloss>love</gloss>, <usg>Plat.</usg>, <usg bn:title="Plat.">id.</usg></sense>
        <etym>= <ref type="entry" target="#n2" xml:lang="grc">be</ref></etym>
        <sense>plain</sense>
      </entry>
      <entry xml:id="n2" xml:lang="en" n="1"><form type="lemma"><orth xml:lang="grc">be</orth></form></entry>
      <entry xml:id="n3" xml:lang="en" n="2"><form type="lemma"><orth xml:lang="grc">be</orth></form></entry>`;
    const lexicon = readTeiLexicon(tei(ls));
    const [first] = lexicon.entries;
    assert.equal(first.homograph, '1');
    assert.deepEqual(
      first.body.map((part) => (typeof part === 'string' ? part : part.style)),
      ['form', 'deriv', 'sense', 'deriv', 'sense']
    );
    assert.deepEqual(first.body[2], {
      style: 'sense',
      attributes: { n: 'I', level: '2' },
      children: [
        { style: 'tr', attributes: {}, children: ['love'] },
        ', ',
        { style: 'usg', attributes: {}, children: ['Plat.'] },
        ', ',
        { style: 'usg', attributes: { title: 'Plat.' }, children: ['id.'] },
      ],
    });
    assert.deepEqual(first.body[1], {
      style: 'deriv',
      attributes: {},
      children: [
        'from ',
        { style: 'ref', attributes: { lemma: 'be' }, children: ['be'] },
      ],
    });
    assert.deepEqual(
      lexicon.lookups.map((l) => `${l.kind} ${l.value} ${l.entryKey}`),
      [
        'lemma aga n1',
        'strong G25 n1',
        'strong G26 n1',
        'lemma be n2',
        'lemma be n3',
      ]
    );
  });

  test('inflected forms are lookups, not text', () => {
    const ls = `      <entry xml:id="n1.1" xml:lang="en">
        <form type="lemma"><orth xml:lang="grc">am</orth></form>
        <form type="inflected"><orth xml:lang="grc">ab</orth></form>
        <sense>x</sense>
      </entry>`;
    const lexicon = readTeiLexicon(tei(ls));
    assert.equal(lexicon.entries[0].headword, 'am');
    assert.deepEqual(
      lexicon.lookups.map((l) => `${l.kind} ${l.value} ${l.entryKey}`),
      ['lemma am n1.1', 'lemma ab n1.1']
    );
    assert.equal(JSON.stringify(lexicon.entries[0].body).includes('ab'), false);
  });

  test('a link by headword must lead to an entry with that headword', () => {
    const ls = `      <entry xml:id="n1" xml:lang="en"><form type="lemma"><orth xml:lang="grc">a</orth></form>
        <etym><ref type="lemma" xml:lang="grc" bn:lemma="zz">zz</ref></etym></entry>`;
    assert.throws(() => readTeiLexicon(tei(ls)), /headword zz/);
  });

  test('BDB: headword line, stems, daggers, notes, scripture references', () => {
    const bdb = `      <entry xml:id="BDB00001" xml:lang="en" n="I." bn:strong="H1 H2" bn:allCited="1" bn:peculiar="1" bn:brackets="first" bn:count="c. 12" bn:root="1">
        <form type="lemma"><orth xml:lang="hbo">A</orth></form>
        <form type="variant"><orth xml:lang="hbo">B</orth></form>
        <form type="variant" bn:count="5"><orth xml:lang="hbo">C</orth></form>
        <sense bn:level="1"><hi rend="bold">vb.</hi> x<hi rend="sup">2</hi><lb/>y</sense>
        <sense n="1" bn:level="1" bn:stem="Qal" bn:allCited="1" bn:pre="Especially" bn:count="7" />
        <sense bn:level="2">Pf. <foreign xml:lang="hbo">D</foreign> <ref type="bible" bn:sid="GEN 1:1">Gn 1:1</ref>; <ref type="bible" bn:sid="ISA 55:2" bn:meant="ISA 58:2">Is 55:2</ref>; <ref type="bible" bn:sid="2SA 1">2 S 1</ref>; <ref type="entry" target="#BDB00001">A</ref></sense>
        <note type="comment" n="1" />
        <note type="sourceCorrection">left out</note>
      </entry>`;
    const lexicon = readTeiLexicon(tei(bdb));
    const [e] = lexicon.entries;
    assert.equal(e.allCited, true);
    assert.equal(e.homograph, 'I.');
    assert.deepEqual(e.body[0], {
      style: 'hwline',
      attributes: { peculiar: '1', brackets: 'first', count: 'c. 12' },
      children: [
        { style: 'word', attributes: { lang: 'hbo' }, children: ['B'] },
        {
          style: 'word',
          attributes: { lang: 'hbo', count: '5' },
          children: ['C'],
        },
      ],
    });
    assert.deepEqual(e.body[1], {
      style: 'sense',
      attributes: { level: '1' },
      children: [
        { style: 'strong', attributes: {}, children: ['vb.'] },
        ' x',
        { style: 'sup', attributes: {}, children: ['2'] },
        { style: 'br', attributes: {}, children: [] },
        'y',
      ],
    });
    assert.deepEqual(e.body[2], {
      style: 'sense',
      attributes: {
        n: '1',
        level: '1',
        stem: 'Qal',
        allCited: '1',
        pre: 'Especially',
        count: '7',
      },
      children: [],
    });
    const refs = (e.body[3] as { children: unknown[] }).children.filter(
      (c) => typeof c !== 'string' && (c as { style: string }).style === 'bref'
    );
    assert.deepEqual(
      refs.map((r) => (r as { attributes: object }).attributes),
      [
        { sid: 'GEN 1:1' },
        { sid: 'ISA 55:2', meant: 'ISA 58:2' },
        { sid: '2SA 1' },
      ]
    );
    assert.deepEqual(e.body[4], {
      style: 'note',
      attributes: { n: '1' },
      children: [],
    });
    assert.equal(e.body.length, 5);
    // Hebrew headwords get no lemma lookups: only the Strong's numbers.
    assert.deepEqual(
      lexicon.lookups.map((l) => `${l.kind}:${l.value}`),
      ['strong:H1', 'strong:H2']
    );
  });

  test('two entries with one key fail', () => {
    assert.throws(
      () => readTeiLexicon(tei(entry('H2') + '\n' + entry('H2'))),
      /two entries H2/
    );
  });
});
