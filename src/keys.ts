import fs from 'node:fs';
import path from 'node:path';
import { createPublicKey, KeyObject } from 'node:crypto';
import { keyId, readPrivateKey } from './services/signing-service';

/**
 * The public keys in `keys/`, by the job each may do (see "Keys and
 * revocation" in docs/integrity-spec.md). Only `public.pem` files are read:
 * the maintainer's private keys are never in this repository.
 */

/** Keys that sign module manifests. */
const MODULE_KEY_FOLDERS = ['development', 'primary'];

/** Keys that sign key statements only, never a module. */
const BACKUP_KEY_FOLDERS = ['backup', 'development-backup'];

/** Where key statements are kept. */
export const STATEMENTS_FOLDER = path.join('keys', 'statements');

function publicKeys(folders: string[]): KeyObject[] {
  return folders
    .map((folder) => path.join('keys', folder, 'public.pem'))
    .filter((file) => fs.existsSync(file))
    .map((file) => createPublicKey(fs.readFileSync(file)));
}

/** The public keys that may sign modules. */
export function moduleKeys(): KeyObject[] {
  return publicKeys(MODULE_KEY_FOLDERS);
}

/** The maintainer's primary keys: the only module keys release builds trust. */
export function primaryKeys(): KeyObject[] {
  return publicKeys(['primary']);
}

/** The public keys that may sign key statements. */
export function backupKeys(): KeyObject[] {
  return publicKeys(BACKUP_KEY_FOLDERS);
}

/** The ids of the backup keys. */
export function backupKeyIds(): string[] {
  return backupKeys().map(keyId);
}

/**
 * Reads a private key from a PEM file or, without one (or with '-'), from
 * standard input, so it never has to be written to disk.
 */
export async function readSigningKey(keyFile?: string): Promise<KeyObject> {
  const fromStdin = keyFile === undefined || keyFile === '-';
  if (fromStdin && process.stdin.isTTY) {
    console.error(
      'Paste the private key PEM, including its BEGIN and END lines, then press Enter and Ctrl+D.'
    );
  }
  const pem = fromStdin ? await readStdin() : fs.readFileSync(keyFile);
  return readPrivateKey(pem);
}

/**
 * Reads standard input to its end as a stream. A synchronous read fails with
 * EAGAIN when the terminal is in non-blocking mode, as it is under tsx.
 */
async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}
