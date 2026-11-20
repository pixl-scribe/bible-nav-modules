import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, test } from 'node:test';

/**
 * The Beta Code converter (tools/betacode.py) is Python, like the lexicon
 * converters that use it. These run its own tests, and its check against
 * every word Strong's Greek Dictionary gives in both Beta Code and Unicode.
 */
describe('Beta Code converter', () => {
  const python = (args: string[]) =>
    execFileSync('python3', ['-I', ...args], { encoding: 'utf8' });

  test('its own tests pass', (t) => {
    try {
      python(['--version']);
    } catch {
      t.skip('python3 is not installed');
      return;
    }
    // unittest writes its report to standard error; a failure throws.
    python([path.resolve('tools', 'betacode_test.py')]);
  });

  test("every word of Strong's Greek converts exactly", (t) => {
    try {
      python(['--version']);
    } catch {
      t.skip('python3 is not installed');
      return;
    }
    const output = python([
      path.resolve('tools', 'betacode.py'),
      path.resolve('assets', 'eng_strongs_grc', 'source', 'strongsgreek.xml'),
    ]);
    assert.match(output, /^(\d+) of \1 Strong's words convert exactly\.$/m);
  });
});
