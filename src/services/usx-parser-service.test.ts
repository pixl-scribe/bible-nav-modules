import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import UsxParserService from './usx-parser-service';
import { Book, Heading, Verse } from '../model/book';

const parser = new UsxParserService();

function loadBook(code: string): Book {
  return parser.parseBook(path.resolve('assets', 'eng_kjv', `${code}.usx`));
}

function findVerse(book: Book, sid: string): Verse {
  const verse = book.chapters
    .flatMap((chapter) => chapter.paragraphs)
    .flatMap((paragraph) => paragraph.verses)
    .find((candidate) => candidate.sid === sid);
  assert.ok(verse, `${sid} not found`);
  return verse;
}

function headingsIn(book: Book, chapterNbr: number): Heading[] {
  const chapter = book.chapters.find((c) => c.nbr === chapterNbr);
  return (chapter?.paragraphs ?? []).flatMap((p) =>
    p.heading ? [p.heading] : []
  );
}

function usx(body: string): string {
  return `<?xml version="1.0"?><usx version="3.0"><book style="id" code="TST">Test</book>
    <para style="h">T</para><chapter style="c" number="1" sid="TST 1"/>${body}</usx>`;
}

function verse(content: string): string {
  return `<para style="p"><verse style="v" number="1" sid="TST 1:1"/>${content}<verse eid="TST 1:1"/></para>`;
}

describe('KJV text that the parser used to lose', () => {
  test('keeps the name of deity', () => {
    assert.equal(
      findVerse(loadBook('psa'), 'PSA 23:1').raw,
      'The LORD is my shepherd; I shall not want.'
    );
    assert.match(
      findVerse(loadBook('gen'), 'GEN 2:4').raw,
      /in the day that the LORD God made the earth and the heavens,$/
    );
  });

  test('keeps a word nested in a translator addition', () => {
    const { raw, children } = findVerse(loadBook('exo'), 'EXO 15:13');
    assert.match(raw, /the people which thou hast redeemed/);
    assert.ok(!raw.includes('undefined'));
    assert.ok(
      JSON.stringify(children).includes(
        '{"style":"add","children":[{"style":"w","strong":"H2098","txt":"which"}]}'
      )
    );
  });

  test('keeps the word false', () => {
    assert.match(
      findVerse(loadBook('mat'), 'MAT 26:59').raw,
      /sought false witness against Jesus/
    );
  });

  test('keeps footnote references and nested footnote text as text', () => {
    const genesis = JSON.stringify(findVerse(loadBook('gen'), 'GEN 4:10'));
    assert.ok(genesis.includes('"style":"fr","children":["4.10"]'), genesis);
    const exodus = JSON.stringify(findVerse(loadBook('exo'), 'EXO 6:2'));
    assert.ok(exodus.includes('{"style":"nd","children":["LORD"]}'), exodus);
    assert.ok(exodus.includes('JEHOVAH'), exodus);
  });

  test('keeps text between verses', () => {
    const psalms = loadBook('psa');
    assert.equal(
      headingsIn(psalms, 3)[0].raw,
      'A Psalm of David, when he fled from Absalom his son.'
    );
    const aleph = headingsIn(psalms, 119)[0];
    assert.equal(aleph.raw, 'א ALEPH.');
    assert.deepEqual(aleph.children, [{ style: 'tl', children: ['א ALEPH.'] }]);
    assert.equal(
      loadBook('1ki').mt2,
      'Commonly Called the Third Book of the Kings'
    );
    assert.match(
      headingsIn(loadBook('1co'), 16)[0].raw,
      /^The first epistle to the Corinthians was written from Philippi/
    );
  });

  test('keeps the layout of poetry and prose', () => {
    const layout = (book: Book, chapterNbr: number) =>
      book.chapters
        .find((chapter) => chapter.nbr === chapterNbr)
        ?.paragraphs.map((p) => [p.style, p.verses.map((v) => v.nbr)]);

    assert.deepEqual(layout(loadBook('psa'), 1), [
      ['q1', [1]],
      ['q1', [2]],
      ['q1', [3]],
      ['b', []],
      ['q1', [4]],
      ['q1', [5]],
      ['q1', [6]],
    ]);
    assert.deepEqual(layout(loadBook('psa'), 3)?.slice(0, 2), [
      ['d', []],
      ['q1', [1]],
    ]);
    const proseStyles = new Set(
      layout(loadBook('gen'), 1)?.map(([style]) => style)
    );
    assert.deepEqual([...proseStyles], ['p']);
  });
});

describe('spacing', () => {
  test('joins nested pieces with single spaces and no outer spaces', () => {
    const book = parser.parseBookXml(
      usx(
        verse(
          '  the <char style="nd"><char style="w" strong="H1">LORD</char></char> <char style="add"> God </char> x<note style="f" caller="+"><char style="fr">1.1 </char></note>  \n'
        )
      )
    );
    const parsed = findVerse(book, 'TST 1:1');
    assert.equal(parsed.raw, 'the LORD God x');
  });

  test('handles non-Latin text without extra spaces', () => {
    const book = parser.parseBookXml(
      usx(verse('ἐν <char style="w" strong="G1">ἀρχῇ</char>, ἦν'))
    );
    assert.equal(findVerse(book, 'TST 1:1').raw, 'ἐν ἀρχῇ, ἦν');
  });
});

describe('unknown content is an error', () => {
  const rejects = (name: string, xml: string, message: RegExp) =>
    test(name, () => {
      assert.throws(() => parser.parseBookXml(xml), message);
    });

  rejects(
    'unknown character style, naming the verse',
    usx(verse('<char style="zzz">x</char>')),
    /TST 1:1: unknown character style "zzz"/
  );
  rejects(
    'unknown paragraph style',
    usx('<para style="zzz">x</para>'),
    /unknown paragraph style "zzz"/
  );
  rejects(
    'unknown inline element',
    usx(verse('<figure>x</figure>')),
    /unknown inline element <figure>/
  );
  rejects(
    'unknown footnote segment',
    usx(verse('<note style="f"><char style="zzz">x</char></note>')),
    /unknown footnote content/
  );
  rejects(
    'unknown note style',
    usx(verse('<note style="x"><char style="ft">x</char></note>')),
    /unknown note style/
  );
  rejects(
    'unknown book-level element',
    usx('<sidebar>x</sidebar>'),
    /unknown element <sidebar>/
  );
  rejects(
    'text outside a verse',
    usx('<para style="p">stray</para>'),
    /outside of a verse/
  );
  rejects(
    'text in a blank paragraph',
    usx('<para style="b">stray</para>'),
    /should be empty/
  );
  rejects(
    'a verse that never ends',
    usx('<para style="p"><verse number="1" sid="TST 1:1"/>x</para>'),
    /spans two paragraphs/
  );
  rejects(
    'a word without a Strong number',
    usx(verse('<char style="w">x</char>')),
    /word needs a strong/
  );
});
