import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isNormalStrong, normalizeStrong } from './strong-number';

describe("Strong's numbers", () => {
  test('each source spelling has one normal form', () => {
    assert.equal(normalizeStrong('H0430'), 'H430');
    assert.equal(normalizeStrong('H430'), 'H430');
    assert.equal(normalizeStrong('G0026'), 'G26');
    assert.equal(normalizeStrong('g26'), 'G26');
    assert.equal(normalizeStrong('H1234A'), 'H1234a');
    assert.equal(normalizeStrong(' H7225 '), 'H7225');
  });

  test('anything else is not a number', () => {
    for (const raw of [
      '',
      'H',
      'H0',
      'X12',
      '7225',
      'H12ab',
      'H-1',
      'BDB09078',
    ]) {
      assert.equal(normalizeStrong(raw), undefined, raw);
    }
  });

  test('normal form is recognized', () => {
    assert.equal(isNormalStrong('H430'), true);
    assert.equal(isNormalStrong('H0430'), false);
  });
});
