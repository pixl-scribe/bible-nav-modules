import {
  createHash,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
  verify,
} from 'node:crypto';
import fs from 'node:fs';

/**
 * Ed25519 signatures of manifests, in the `.manifest.sig` format from
 * docs/integrity-spec.md: one line per signature,
 * `ed25519 <key id> <Base64 signature>`.
 */

/** The 32-byte raw Ed25519 public key. */
export function rawPublicKey(key: KeyObject): Buffer {
  // A private key's PEM also holds its public key, which createPublicKey
  // derives.
  const publicKey =
    key.type === 'private'
      ? createPublicKey(key.export({ format: 'pem', type: 'pkcs8' }))
      : key;
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('signing keys must be Ed25519 keys');
  }
  const { x } = publicKey.export({ format: 'jwk' });
  return Buffer.from(x ?? '', 'base64url');
}

/** The first 16 hexadecimal digits of the SHA-256 of the raw public key. */
export function keyId(key: KeyObject): string {
  return createHash('sha256')
    .update(rawPublicKey(key))
    .digest('hex')
    .slice(0, 16);
}

export interface SignatureLine {
  keyId: string;
  signature: Buffer;
}

/** Signs a manifest's exact bytes. */
export function signManifest(
  manifest: Buffer,
  privateKey: KeyObject
): SignatureLine {
  if (privateKey.type !== 'private') {
    throw new Error('signing needs a private key');
  }
  // Ed25519 hashes the message itself, so Node takes no digest name (null).
  return {
    keyId: keyId(privateKey),
    signature: sign(null, manifest, privateKey),
  };
}

export function formatSignatures(lines: SignatureLine[]): string {
  return lines
    .map(
      (line) => `ed25519 ${line.keyId} ${line.signature.toString('base64')}\n`
    )
    .join('');
}

/** Reads a `.manifest.sig` file's lines, failing on anything malformed. */
export function parseSignatures(text: string): SignatureLine[] {
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const match = /^ed25519 ([0-9a-f]{16}) ([A-Za-z0-9+/]+={0,2})$/.exec(
        line
      );
      const signature = match ? Buffer.from(match[2], 'base64') : undefined;
      if (!match || signature?.length !== 64) {
        throw new Error(`malformed signature line: ${line}`);
      }
      return { keyId: match[1], signature };
    });
}

/**
 * Adds a signature to a `.manifest.sig` file, replacing any earlier
 * signature by the same key.
 */
export function addSignature(sigFile: string, line: SignatureLine): void {
  const existing = fs.existsSync(sigFile)
    ? parseSignatures(fs.readFileSync(sigFile, 'utf8'))
    : [];
  const kept = existing.filter((other) => other.keyId !== line.keyId);
  fs.writeFileSync(sigFile, formatSignatures([...kept, line]));
}

export interface SignatureCheck {
  /** Key ids whose signature is valid. */
  valid: string[];
  /** Key ids whose signature doesn't match the manifest. */
  invalid: string[];
  /** Key ids for which no public key was given. */
  unknown: string[];
}

/** Checks each signature line against the public keys given. */
export function checkSignatures(
  manifest: Buffer,
  lines: SignatureLine[],
  publicKeys: KeyObject[]
): SignatureCheck {
  const byId = new Map(publicKeys.map((key) => [keyId(key), key]));
  const result: SignatureCheck = { valid: [], invalid: [], unknown: [] };
  for (const line of lines) {
    const key = byId.get(line.keyId);
    if (!key) {
      result.unknown.push(line.keyId);
    } else if (verify(null, manifest, key, line.signature)) {
      result.valid.push(line.keyId);
    } else {
      result.invalid.push(line.keyId);
    }
  }
  return result;
}

/**
 * Reads an Ed25519 private key from PKCS#8 PEM text, as `openssl genpkey`
 * writes it. Tolerates what pasting from a password manager can do to it:
 * line breaks turned into spaces or lost, Windows line ends, indentation,
 * and a terminal's bracketed-paste markers. Error messages describe what was
 * found without ever including the key.
 */
export function readPrivateKey(input: Buffer | string): KeyObject {
  const text = input
    .toString()
    // eslint-disable-next-line no-control-regex -- removes the terminal's bracketed-paste markers
    .replace(/\x1b\[20[01]~/g, '')
    .replace(/\r/g, '');
  const pem = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(
    text
  );
  if (!pem) {
    const lines = text.split('\n').filter((line) => line.trim()).length;
    throw new Error(
      `No PEM key found in the ${text.length} characters (${lines} non-blank lines) received. ` +
        'Paste the whole key, including the -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines.'
    );
  }
  const label = pem[1];
  const wrong: Record<string, string> = {
    'PUBLIC KEY': 'This is a public key. Signing needs the private key.',
    'ENCRYPTED PRIVATE KEY':
      'This private key is encrypted with a passphrase, which sign does not support.',
    'OPENSSH PRIVATE KEY':
      'This is an OpenSSH key (from ssh-keygen). Make the key with the openssl commands in keys/README.md.',
  };
  if (label !== 'PRIVATE KEY') {
    throw new Error(
      wrong[label] ??
        `Found a "${label}" PEM block, but sign needs a "PRIVATE KEY" block as written by openssl genpkey -algorithm ed25519.`
    );
  }
  const body = pem[2].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new Error(
      'The text between the BEGIN and END lines is not Base64. Was part of the key changed or cut off?'
    );
  }
  const lines = body.match(/.{1,64}/g) ?? [];
  let key: KeyObject;
  try {
    key = createPrivateKey(
      `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`
    );
  } catch {
    throw new Error(
      `The PRIVATE KEY block (${body.length} Base64 characters; an Ed25519 key has 64) could not be read as a key. Was part of it changed or cut off?`
    );
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      `This is an ${key.asymmetricKeyType ?? 'unknown'} key; sign needs an Ed25519 key.`
    );
  }
  return key;
}
