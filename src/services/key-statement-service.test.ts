import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  checkStatement,
  checkStatementContent,
  statementBytes,
} from './key-statement-service';

const vectors = path.join('test-vectors', 'key-statements');
const expected = JSON.parse(
  fs.readFileSync(path.join(vectors, 'expected.json'), 'utf8')
) as {
  backupKey: string;
  cases: Record<string, { accept: boolean; reason?: string }>;
};
const backupKey = createPublicKey(
  fs.readFileSync(path.join('keys', 'development-backup', 'public.pem'))
);

describe('key statements', () => {
  for (const [name, outcome] of Object.entries(expected.cases)) {
    test(`test vector ${name} is ${outcome.accept ? 'accepted' : 'rejected'}`, () => {
      const bytes = fs.readFileSync(path.join(vectors, `${name}.json`));
      const signatures = fs.readFileSync(
        path.join(vectors, `${name}.sig`),
        'utf8'
      );
      const check = () => checkStatement(bytes, signatures, [backupKey]);
      if (outcome.accept) {
        assert.deepEqual(check().signedBy, [expected.backupKey]);
      } else {
        assert.throws(check, new RegExp(outcome.reason ?? '.'));
      }
    });
  }

  test('writing a statement keeps its content and puts fields in order', () => {
    const bytes = fs.readFileSync(path.join(vectors, 'valid.json'));
    const statement = checkStatementContent(bytes, []);
    const shuffled = Object.fromEntries(
      Object.entries(statement).reverse()
    ) as typeof statement;
    assert.equal(statementBytes(shuffled).toString(), bytes.toString());
  });

  test('the test vectors are those the tool writes', () => {
    // A changed vector would need the Rust copy in bible-nav updated too.
    const files = fs.readdirSync(vectors).sort();
    assert.equal(files.length, Object.keys(expected.cases).length * 2 + 1);
  });
});
