// Writes test-vectors/key-statements/: sample key statements, signed with the
// development backup key, that every implementation must accept or reject
// as expected.json says. Run from bible-nav-modules:
//   npx tsx tools/make-statement-vectors.ts
import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, createHash } from 'node:crypto';
import {
  addedKey,
  statementBytes,
  KeyStatement,
} from '../src/services/key-statement-service';
import {
  formatSignatures,
  signManifest,
} from '../src/services/signing-service';

const out = path.join('test-vectors', 'key-statements');
fs.mkdirSync(out, { recursive: true });
const backup = createPrivateKey(
  fs.readFileSync('keys/development-backup/private.pem')
);
const dev = createPrivateKey(fs.readFileSync('keys/development/private.pem'));
// Fixed key pairs so the vectors never change: seeds 1 and 2 as PKCS#8.
const seeded = (n: number) =>
  createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.alloc(32, n),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
const oldPrimary = seeded(1);
const newPrimary = seeded(2);
const keep = createHash('sha256').update('example manifest\n').digest('hex');
const base = (): KeyStatement => ({
  type: 'bible-nav key statement',
  statementVersion: 1,
  sequence: 1,
  issuedAt: '2027-01-01',
  revoke: [{ keyId: addedKey(oldPrimary).keyId, reason: 'stolen' }],
  add: [addedKey(newPrimary)],
  keepModules: [keep],
});

type Case = {
  name: string;
  accept: boolean;
  reason?: string;
  bytes: Buffer;
  signer?: typeof backup;
  sigOver?: Buffer;
};
const valid = statementBytes(base());
const raw = (o: unknown) => Buffer.from(JSON.stringify(o, null, 2) + '\n');
const cases: Case[] = [
  { name: 'valid', accept: true, bytes: valid },
  {
    name: 'valid-revoke-only',
    accept: true,
    bytes: statementBytes({ ...base(), sequence: 2, add: [], keepModules: [] }),
  },
  {
    name: 'tampered',
    accept: false,
    reason: 'signature',
    bytes: Buffer.from(valid.toString().replace('stolen', 'lost')),
    sigOver: valid,
  },
  {
    name: 'signed-by-module-key',
    accept: false,
    reason: 'signature',
    bytes: valid,
    signer: dev,
  },
  {
    name: 'unsigned',
    accept: false,
    reason: 'signature',
    bytes: valid,
    signer: undefined,
    sigOver: Buffer.alloc(0),
  },
  {
    name: 'extra-field',
    accept: false,
    reason: 'fields',
    bytes: raw({ ...base(), note: 'x' }),
  },
  {
    name: 'unknown-version',
    accept: false,
    reason: 'kind',
    bytes: raw({ ...base(), statementVersion: 2 }),
  },
  {
    name: 'empty',
    accept: false,
    reason: 'neither',
    bytes: raw({ ...base(), revoke: [], add: [] }),
  },
  {
    name: 'revokes-backup-key',
    accept: false,
    reason: 'backup',
    bytes: raw({
      ...base(),
      revoke: [{ keyId: addedKey(backup).keyId, reason: 'x' }],
    }),
  },
  {
    name: 'adds-backup-role',
    accept: false,
    reason: 'primary',
    bytes: raw({
      ...base(),
      add: [{ ...addedKey(newPrimary), role: 'backup' }],
    }),
  },
  {
    name: 'added-key-id-mismatch',
    accept: false,
    reason: 'match',
    bytes: raw({
      ...base(),
      add: [{ ...addedKey(newPrimary), keyId: addedKey(oldPrimary).keyId }],
    }),
  },
  {
    name: 'revokes-and-adds-same-key',
    accept: false,
    reason: 'both',
    bytes: raw({
      ...base(),
      revoke: [{ keyId: addedKey(newPrimary).keyId, reason: 'x' }],
    }),
  },
  {
    name: 'bad-keep-hash',
    accept: false,
    reason: 'keepModules',
    bytes: raw({ ...base(), keepModules: [keep.toUpperCase()] }),
  },
  {
    name: 'bad-date',
    accept: false,
    reason: 'issuedAt',
    bytes: raw({ ...base(), issuedAt: '1 Jan 2027' }),
  },
  {
    name: 'zero-sequence',
    accept: false,
    reason: 'sequence',
    bytes: raw({ ...base(), sequence: 0 }),
  },
];
const expected: Record<string, unknown> = {};
for (const c of cases) {
  fs.writeFileSync(path.join(out, `${c.name}.json`), c.bytes);
  const signer = 'signer' in c ? c.signer : backup;
  const sig = signer
    ? formatSignatures([signManifest(c.sigOver ?? c.bytes, signer)])
    : '';
  fs.writeFileSync(path.join(out, `${c.name}.sig`), sig);
  expected[c.name] = c.accept
    ? { accept: true }
    : { accept: false, reason: c.reason };
}
fs.writeFileSync(
  path.join(out, 'expected.json'),
  JSON.stringify(
    {
      backupKey: addedKey(backup).keyId,
      oldPrimary: addedKey(oldPrimary).keyId,
      newPrimary: addedKey(newPrimary).keyId,
      cases: expected,
    },
    null,
    2
  ) + '\n'
);
console.log(Object.keys(expected).length, 'cases');
