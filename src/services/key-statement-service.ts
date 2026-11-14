import { createPublicKey, KeyObject } from 'node:crypto';
import path from 'node:path';
import {
  checkSignatures,
  keyId,
  parseSignatures,
  rawPublicKey,
} from './signing-service';

/**
 * Key statements, as described in "Keys and revocation" in
 * docs/integrity-spec.md: a backup key revokes primary keys and adds their
 * replacements. The statement's exact bytes are signed, in a `.sig` file
 * of the same form as a manifest's.
 */

export const STATEMENT_TYPE = 'bible-nav key statement';

/** A primary key that a statement revokes. */
export interface RevokedKey {
  /**
   * The revoked key's id: the first 16 lowercase hexadecimal digits of the
   * SHA-256 of its 32-byte raw public key, as in `.sig` files.
   */
  keyId: string;
  /**
   * Why it's revoked, such as "stolen", "lost", or "retired". For people
   * only: the app treats every reason the same way.
   */
  reason: string;
}

/** A new primary key that a statement adds. */
export interface AddedKey {
  /** The new key's id. Must match `publicKey`, or the statement is ignored. */
  keyId: string;
  /** Always "primary": a statement can never add a backup key. */
  role: 'primary';
  /** The 32-byte raw Ed25519 public key, in padded standard Base64. */
  publicKey: string;
}

/**
 * A key statement: a notice, signed only by a backup key, that revokes
 * primary keys and adds their replacements. Its exact bytes are signed, so
 * it's never reformatted after signing. The app accepts it only if every
 * field below is present and valid and no others exist; otherwise it
 * ignores the whole statement.
 *
 * Once accepted, a statement is permanent. The app applies every statement
 * it has seen, in any order, and a revocation always wins: a key revoked by
 * any statement is never trusted again, even if another statement adds it.
 */
export interface KeyStatement {
  /**
   * Always "bible-nav key statement". It comes first, so the signed bytes
   * say what they are and a signature over a statement can't be passed off
   * as one over a manifest.
   */
  type: typeof STATEMENT_TYPE;
  /**
   * The version of the statement format, not of this statement: always 1
   * for now. It changes only if the layout of statements changes, and an
   * app that doesn't know a version ignores the statement.
   */
  statementVersion: 1;
  /**
   * This statement's number among all the maintainer's statements: 1, 2,
   * 3, ... It names the files (`bible-nav-keys-<sequence>.json`) and lets
   * people compare copies. It's a name, not an order: a later number
   * doesn't replace an earlier statement, and gaps don't matter. Never
   * reuse a number once a statement is published.
   */
  sequence: number;
  /**
   * The date it was written, `YYYY-MM-DD`. For people only: whoever signs a
   * statement writes its date, so the app never relies on it.
   */
  issuedAt: string;
  /** Primary keys no longer trusted. May be empty. */
  revoke: RevokedKey[];
  /** New primary keys to trust. May be empty, but not if `revoke` is. */
  add: AddedKey[];
  /**
   * Modules a revoked key signed legitimately, which stay trusted: the
   * SHA-256 of each one's manifest file, in 64 lowercase hexadecimal
   * digits. A revoked key's signature counts on these manifests and no
   * others. May be empty, in which case those modules are signed again
   * with the new key.
   */
  keepModules: string[];
}

/** `keys/bible-nav-keys-<sequence>.json` and `.sig` in `folder`. */
export function statementFiles(
  folder: string,
  sequence: number
): { statement: string; signatures: string } {
  const base = path.join(folder, `bible-nav-keys-${sequence}`);
  return { statement: `${base}.json`, signatures: `${base}.sig` };
}

/** The entry that adds a public key as a primary key. */
export function addedKey(publicKey: KeyObject): AddedKey {
  return {
    keyId: keyId(publicKey),
    role: 'primary',
    publicKey: rawPublicKey(publicKey).toString('base64'),
  };
}

/**
 * A statement's bytes: its fields in the spec's order, two-space indented,
 * with a final newline. Checking never depends on this layout.
 */
export function statementBytes(statement: KeyStatement): Buffer {
  const ordered: KeyStatement = {
    type: statement.type,
    statementVersion: statement.statementVersion,
    sequence: statement.sequence,
    issuedAt: statement.issuedAt,
    revoke: statement.revoke.map((entry) => ({
      keyId: entry.keyId,
      reason: entry.reason,
    })),
    add: statement.add.map((entry) => ({
      keyId: entry.keyId,
      role: entry.role,
      publicKey: entry.publicKey,
    })),
    keepModules: statement.keepModules,
  };
  return Buffer.from(JSON.stringify(ordered, null, 2) + '\n');
}

const KEY_ID = /^[0-9a-f]{16}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks a statement's content against every rule in the spec except its
 * signature, and returns it. Throws with the first rule it breaks.
 *
 * @param backupKeyIds the ids of the backup keys, which a statement may
 *   never revoke or add.
 */
export function checkStatementContent(
  bytes: Buffer,
  backupKeyIds: string[]
): KeyStatement {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('the statement is not valid JSON');
  }
  const statement = value as KeyStatement;
  exactFields(
    value,
    [
      'type',
      'statementVersion',
      'sequence',
      'issuedAt',
      'revoke',
      'add',
      'keepModules',
    ],
    'the statement'
  );
  if (statement.type !== STATEMENT_TYPE || statement.statementVersion !== 1) {
    throw new Error('the statement is of a kind this tool does not know');
  }
  if (!Number.isSafeInteger(statement.sequence) || statement.sequence < 1) {
    throw new Error('sequence must be a whole number from 1');
  }
  if (
    typeof statement.issuedAt !== 'string' ||
    !DATE.test(statement.issuedAt)
  ) {
    throw new Error('issuedAt must be a date written YYYY-MM-DD');
  }
  for (const list of ['revoke', 'add', 'keepModules'] as const) {
    if (!Array.isArray(statement[list])) {
      throw new Error(`${list} must be a list`);
    }
  }
  if (statement.revoke.length + statement.add.length === 0) {
    throw new Error('the statement neither revokes nor adds a key');
  }

  for (const entry of statement.revoke) {
    exactFields(entry, ['keyId', 'reason'], 'a revoke entry');
    if (typeof entry.keyId !== 'string' || !KEY_ID.test(entry.keyId)) {
      throw new Error('a revoked keyId must be 16 lowercase hex digits');
    }
    if (typeof entry.reason !== 'string') {
      throw new Error('a revoke reason must be text');
    }
  }
  for (const entry of statement.add) {
    exactFields(entry, ['keyId', 'role', 'publicKey'], 'an add entry');
    if (entry.role !== 'primary') {
      throw new Error('a statement may only add primary keys');
    }
    const raw =
      typeof entry.publicKey === 'string' &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(entry.publicKey)
        ? Buffer.from(entry.publicKey, 'base64')
        : Buffer.alloc(0);
    // Standard Base64 with its padding, exactly: Node would also decode
    // other forms, which a strict checker (like Bible Nav's) rejects.
    if (raw.length !== 32 || raw.toString('base64') !== entry.publicKey) {
      throw new Error('an added publicKey must be 32 bytes in Base64');
    }
    let id: string;
    try {
      id = keyId(publicKeyFromRaw(raw));
    } catch {
      throw new Error('an added publicKey is not a valid Ed25519 key');
    }
    if (entry.keyId !== id) {
      throw new Error(
        `an added keyId (${String(entry.keyId)}) does not match its publicKey (${id})`
      );
    }
  }
  for (const entry of statement.keepModules) {
    if (typeof entry !== 'string' || !SHA256.test(entry)) {
      throw new Error(
        'each keepModules entry must be a manifest SHA-256 in 64 lowercase hex digits'
      );
    }
  }

  const revoked = statement.revoke.map((entry) => entry.keyId);
  const added = statement.add.map((entry) => entry.keyId);
  for (const id of [...revoked, ...added]) {
    if (backupKeyIds.includes(id)) {
      throw new Error(
        `a statement may never revoke or add a backup key (${id})`
      );
    }
  }
  const both = revoked.filter((id) => added.includes(id));
  if (both.length > 0) {
    throw new Error(`a key is both revoked and added: ${both.join(', ')}`);
  }
  return statement;
}

/**
 * Checks a statement completely: its content, and that a backup key signed
 * its exact bytes. Returns the statement and the ids of the backup keys
 * whose signatures are valid.
 */
export function checkStatement(
  bytes: Buffer,
  signatures: string,
  backupKeys: KeyObject[]
): { statement: KeyStatement; signedBy: string[] } {
  const statement = checkStatementContent(bytes, backupKeys.map(keyId));
  const check = checkSignatures(bytes, parseSignatures(signatures), backupKeys);
  if (check.invalid.length > 0) {
    throw new Error(`invalid signatures by: ${check.invalid.join(', ')}`);
  }
  if (check.valid.length === 0) {
    throw new Error('the statement has no valid signature from a backup key');
  }
  return { statement, signedBy: check.valid };
}

/** An Ed25519 public key from its 32 raw bytes. */
function publicKeyFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
    format: 'jwk',
  });
}

/** Throws unless `value` is an object with exactly these fields. */
function exactFields(value: unknown, fields: string[], what: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be a JSON object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...fields].sort();
  if (actual.join() !== wanted.join()) {
    throw new Error(
      `${what} must have exactly the fields ${fields.join(', ')}`
    );
  }
}
