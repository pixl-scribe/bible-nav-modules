import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { checkVersionRule, majorVersion } from './version-rule';

describe('the versioning rule', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'versions-'));
  const write = (version: string, textRoot: string) =>
    fs.writeFileSync(
      path.join(dir, `tst-${version}.manifest.json`),
      JSON.stringify({ text: { textRoot } })
    );
  write('1.0.0', 'a');
  write('2.0.0', 'b');

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('reads major versions', () => {
    assert.equal(majorVersion('1.10.2'), 1);
    assert.equal(majorVersion('1.1'), undefined);
    assert.equal(majorVersion('v1.0.0'), undefined);
  });

  test('a minor version may change anything but the text', () => {
    checkVersionRule(dir, 'tst', '1.1.0', 'a');
    checkVersionRule(dir, 'tst', '2.3.1', 'b');
  });

  test('a text change within a major version is refused', () => {
    assert.throws(
      () => checkVersionRule(dir, 'tst', '1.1.0', 'c'),
      /new major version \(2\.0\.0\)/
    );
  });

  test('a new major version may change the text', () => {
    checkVersionRule(dir, 'tst', '3.0.0', 'c');
  });

  test('regenerating the same version is allowed', () => {
    checkVersionRule(dir, 'tst', '1.0.0', 'z');
  });

  test('versions must be major.minor.patch', () => {
    assert.throws(() => checkVersionRule(dir, 'tst', '1.1', 'a'), /major/);
  });
});
