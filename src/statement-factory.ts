import fs from 'node:fs';
import { createHash, createPublicKey } from 'node:crypto';
import {
  addedKey,
  checkStatement,
  checkStatementContent,
  KeyStatement,
  STATEMENT_TYPE,
  statementBytes,
  statementFiles,
  RevokedKey,
} from './services/key-statement-service';
import { addSignature, keyId, signManifest } from './services/signing-service';
import {
  backupKeyIds,
  backupKeys,
  readSigningKey,
  STATEMENTS_FOLDER,
} from './keys';

/**
 * Writes, signs, and checks key statements in `keys/statements/`. Writing
 * and signing are separate steps, so a statement can be read and checked
 * before the backup key comes out of storage.
 */
export default class StatementFactory {
  /**
   * Writes an unsigned statement. Refuses to replace an existing one: a
   * published statement is permanent.
   *
   * @param revoke entries written `<key id>:<reason>`.
   * @param add public key PEM files of new primary keys.
   * @param keep manifest files of modules a revoked key signed
   *   legitimately, which stay trusted.
   */
  public static make(options: {
    sequence: number;
    revoke: string[];
    add: string[];
    keep: string[];
    issuedAt?: string;
  }): void {
    const files = statementFiles(STATEMENTS_FOLDER, options.sequence);
    if (fs.existsSync(files.statement)) {
      throw new Error(
        `${files.statement} already exists. A statement is permanent: use the next sequence number.`
      );
    }
    const statement: KeyStatement = {
      type: STATEMENT_TYPE,
      statementVersion: 1,
      sequence: options.sequence,
      issuedAt: options.issuedAt ?? new Date().toISOString().slice(0, 10),
      revoke: options.revoke.map(parseRevoke),
      add: options.add.map((file) =>
        addedKey(createPublicKey(fs.readFileSync(file)))
      ),
      keepModules: options.keep.map((file) =>
        createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      ),
    };
    const bytes = statementBytes(statement);
    checkStatementContent(bytes, backupKeyIds());
    fs.mkdirSync(STATEMENTS_FOLDER, { recursive: true });
    fs.writeFileSync(files.statement, bytes);
    console.log(`Wrote ${files.statement}, not yet signed:\n`);
    console.log(bytes.toString());
    StatementFactory.describe(statement);
  }

  /** Signs a statement with a backup key, after checking its content. */
  public static async sign(sequence: number, keyFile?: string): Promise<void> {
    const files = statementFiles(STATEMENTS_FOLDER, sequence);
    const bytes = fs.readFileSync(files.statement);
    const statement = checkStatementContent(bytes, backupKeyIds());
    StatementFactory.describe(statement);
    const privateKey = await readSigningKey(keyFile);
    if (!backupKeyIds().includes(keyId(privateKey))) {
      throw new Error(
        `Key ${keyId(privateKey)} is not a backup key in keys/. Only a backup key can sign a statement.`
      );
    }
    const line = signManifest(bytes, privateKey);
    addSignature(files.signatures, line);
    console.log(`Signed ${files.statement} with backup key ${line.keyId}.`);
  }

  /** Checks a statement and its signatures, as Bible Nav will. */
  public static check(sequence: number): void {
    const files = statementFiles(STATEMENTS_FOLDER, sequence);
    const signatures = fs.existsSync(files.signatures)
      ? fs.readFileSync(files.signatures, 'utf8')
      : '';
    const { statement, signedBy } = checkStatement(
      fs.readFileSync(files.statement),
      signatures,
      backupKeys()
    );
    StatementFactory.describe(statement);
    console.log(`Valid signature by backup key: ${signedBy.join(', ')}`);
  }

  private static describe(statement: KeyStatement): void {
    console.log(`Statement ${statement.sequence}, ${statement.issuedAt}:`);
    for (const entry of statement.revoke) {
      console.log(`  revokes primary key ${entry.keyId} (${entry.reason})`);
    }
    for (const entry of statement.add) {
      console.log(`  adds primary key ${entry.keyId}`);
    }
    for (const hash of statement.keepModules) {
      console.log(`  keeps the module whose manifest SHA-256 is ${hash}`);
    }
  }
}

/** Reads `<key id>:<reason>`. */
function parseRevoke(entry: string): RevokedKey {
  const colon = entry.indexOf(':');
  if (colon < 0) {
    throw new Error(
      `--revoke takes <key id>:<reason>, such as 447d4fa16f501391:stolen (got ${entry})`
    );
  }
  return {
    keyId: entry.slice(0, colon),
    reason: entry.slice(colon + 1),
  };
}
