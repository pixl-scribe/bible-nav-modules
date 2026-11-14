import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import ModuleFactory from './module-factory';
import { Book, Verse } from './model/book';

/** A book whose chapters have these numbers of verses. */
function book(code: string, counts: number[]): Book {
  return {
    name: code,
    code,
    header: code,
    toc1: code,
    toc2: code,
    toc3: code,
    mt1: code,
    chapters: counts.map((count, index) => ({
      nbr: index + 1,
      sid: `${code} ${index + 1}`,
      paragraphs: [
        { style: 'p', verses: new Array<Verse>(count).fill({} as Verse) },
      ],
    })),
  };
}

const kjv = { '3JN': [14], MAL: [14, 17, 18, 6] };

describe('verse counts', () => {
  test('the KJV numbering passes', () => {
    ModuleFactory.checkVerseCounts(book('3JN', [14]), kjv);
  });

  test('a difference fails unless the module lists it', () => {
    assert.throws(
      () => ModuleFactory.checkVerseCounts(book('3JN', [15]), kjv),
      /3JN 1 verse count of 15 did not match the expected count of 14/
    );
    ModuleFactory.checkVerseCounts(book('3JN', [15]), kjv, { '3JN 1': 15 });
  });

  test('a different number of chapters can be listed too', () => {
    const hebrew = book('MAL', [14, 17, 24]);
    assert.throws(() => ModuleFactory.checkVerseCounts(hebrew, kjv));
    ModuleFactory.checkVerseCounts(hebrew, kjv, { MAL: 3, 'MAL 3': 24 });
  });

  test('a listed difference that is no difference fails', () => {
    assert.throws(
      () =>
        ModuleFactory.checkVerseCounts(book('3JN', [14]), kjv, { '3JN 1': 14 }),
      /no difference/
    );
  });
});
