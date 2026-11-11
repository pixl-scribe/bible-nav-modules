import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  addSignature,
  checkSignatures,
  formatSignatures,
  keyId,
  parseSignatures,
  signManifest,
} from './signing-service';

const manifest = Buffer.from('{"type": "bible-nav module manifest"}\n');

describe('signatures', () => {
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signing-'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the key id is the start of the SHA-256 of the raw public key', () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    // An Ed25519 public key's DER form ends with its 32 raw bytes.
    const der = publicKey.export({ format: 'der', type: 'spki' });
    const raw = der.subarray(der.length - 32);
    assert.equal(
      keyId(publicKey),
      createHash('sha256').update(raw).digest('hex').slice(0, 16)
    );
  });

  test('a signature checks against its key and its manifest only', () => {
    const signer = generateKeyPairSync('ed25519');
    const other = generateKeyPairSync('ed25519');
    const lines = parseSignatures(
      formatSignatures([signManifest(manifest, signer.privateKey)])
    );
    assert.deepEqual(
      checkSignatures(manifest, lines, [signer.publicKey, other.publicKey]),
      { valid: [keyId(signer.publicKey)], invalid: [], unknown: [] }
    );
    const altered = Buffer.from(manifest.toString().replace('}', ' }'));
    assert.deepEqual(checkSignatures(altered, lines, [signer.publicKey]), {
      valid: [],
      invalid: [keyId(signer.publicKey)],
      unknown: [],
    });
    assert.deepEqual(checkSignatures(manifest, lines, [other.publicKey]), {
      valid: [],
      invalid: [],
      unknown: [keyId(signer.publicKey)],
    });
  });

  test('only Ed25519 keys can sign', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    assert.throws(() => signManifest(manifest, privateKey), /Ed25519/);
  });

  test('malformed signature lines fail', () => {
    assert.throws(
      () => parseSignatures('rsa 0123456789abcdef AAAA\n'),
      /malformed/
    );
    assert.throws(
      () => parseSignatures('ed25519 0123456789abcdef AAAA\n'),
      /malformed/
    );
  });

  test('signing again with the same key replaces its line', () => {
    const first = generateKeyPairSync('ed25519');
    const second = generateKeyPairSync('ed25519');
    const sigFile = path.join(dir, 'replace.manifest.sig');
    addSignature(sigFile, signManifest(manifest, first.privateKey));
    addSignature(sigFile, signManifest(manifest, second.privateKey));
    addSignature(sigFile, signManifest(manifest, first.privateKey));
    const ids = parseSignatures(fs.readFileSync(sigFile, 'utf8')).map(
      (line) => line.keyId
    );
    assert.deepEqual(ids, [keyId(second.publicKey), keyId(first.publicKey)]);
  });

  test('OpenSSL checks a signature with the commands in the spec', (t) => {
    try {
      execFileSync('openssl', ['version']);
    } catch {
      t.skip('openssl is not installed');
      return;
    }
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const manifestFile = path.join(dir, 'test.manifest.json');
    const sigFile = path.join(dir, 'test.manifest.sig');
    const keyFile = path.join(dir, 'public-key.pem');
    const signatureFile = path.join(dir, 'signature.bin');
    fs.writeFileSync(manifestFile, manifest);
    fs.writeFileSync(
      sigFile,
      formatSignatures([signManifest(manifest, privateKey)])
    );
    fs.writeFileSync(
      keyFile,
      publicKey.export({ format: 'pem', type: 'spki' })
    );
    // cut -d' ' -f3 test.manifest.sig | head -n1 | base64 -d > signature.bin
    const base64 = fs
      .readFileSync(sigFile, 'utf8')
      .split('\n')[0]
      .split(' ')[2];
    fs.writeFileSync(signatureFile, Buffer.from(base64, 'base64'));
    const output = execFileSync('openssl', [
      'pkeyutl',
      '-verify',
      '-pubin',
      '-inkey',
      keyFile,
      '-rawin',
      '-in',
      manifestFile,
      '-sigfile',
      signatureFile,
    ]).toString();
    assert.match(output, /Signature Verified Successfully/);
  });

  test('the development key is an Ed25519 key pair', () => {
    const keys = path.resolve('keys', 'development');
    const privateKey = createPrivateKey(
      fs.readFileSync(path.join(keys, 'private.pem'))
    );
    const publicKey = createPublicKey(
      fs.readFileSync(path.join(keys, 'public.pem'))
    );
    assert.equal(keyId(privateKey), keyId(publicKey));
  });
});
