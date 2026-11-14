# Signing keys

Modules are signed with Ed25519, as described in
[`docs/integrity-spec.md`](../docs/integrity-spec.md).

| Folder | Key | Private key |
|---|---|---|
| `development/` | Development key. `generate` signs every module with it, so anyone can build and test. Only development builds of Bible Nav accept it. | Committed on purpose. It protects nothing. |
| `primary/` | The maintainer's primary key, for publishing modules. Only `public.pem` belongs here. | Never in this repository, in CI, or with module files. |
| `backup/` | The maintainer's backup key, which only signs key statements (revoking and replacing the primary key). Only `public.pem` belongs here. | Kept offline only, apart from the primary key. |
| `development-backup/` | Development backup key, for testing key statements. It signs the test vectors in `test-vectors/key-statements/`. Only development builds of Bible Nav accept it. | Committed on purpose. It protects nothing. |
| `statements/` | Published key statements, `bible-nav-keys-<sequence>.json` and `.sig`. None yet. | No private keys. |

`verify` checks a module's signatures with the development and primary
keys, and fails if a backup key signed a module. `sign` refuses a backup
key, and `sign-statement` accepts only a backup key.

## Making a key

```
openssl genpkey -algorithm ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem
```

Put only `public.pem` in `primary/` or `backup/`. Store the private key
somewhere safe, and remove it from the disk.

## Signing a module

`generate` writes the module, its manifest, and a development signature.
To add a real signature, without writing the private key to disk:

```
npm start -- sign --id eng_kjv
```

then paste the whole private key PEM, including its BEGIN and END lines,
when asked, and press Enter and then Ctrl+D (or pipe the key in).
`--key <file>` reads it from a file instead. `sign` checks the module against
the USX and its manifest before signing.

## Versions and pinned texts

A module's major version changes whenever its text changes (any word,
italics, divine name, numbering, or Psalm title); minor and patch versions
change only notes, Strong's numbers, red letters, other headings, layout,
and titles. `generate` refuses a version whose text differs from another
export with the same major version.

Bible Nav pins the texts it bundles (the KJV, and later the Textus Receptus
and Masoretic text) by module id and major version, in `PINNED_EDITIONS` in
its `src-tauri/src/modules/pins.rs`. It refuses a pinned module whose text
differs, or whose major version isn't pinned, whatever key signed it. So:

- A new minor version of a pinned module needs nothing more: it opens in
  every copy. Optionally add its manifest's `file.sha256` to the pin's
  known files, so Bible Nav needn't compute its root at startup.
- A new major version needs a new pin (module id, major version, the
  manifest's `text.edition` and `text.textRoot`, and `file.sha256` as a
  known file; `verify` prints them) and a Bible Nav release.
- Never change or remove a pin.

## If the primary key is stolen, lost, or retired

A key statement, signed with the backup key, revokes the primary key and
names its replacement. Bible Nav accepts it from any source, because only
the backup key can sign it. See "Key statements" in the spec.

1. Make a new primary key (above) and put its `public.pem` in `primary/`,
   keeping the old one as `primary/revoked-<key id>.pem` for the record.
2. Decide which modules the old key signed legitimately. If the key was
   stolen, any of its signatures could be forged, so list only modules you
   published and can identify by their manifests; or list none and sign
   them all again with the new key.
3. Write the statement, then read it carefully:

   ```
   npm start -- make-statement --sequence 1 \
     --revoke <old key id>:stolen \
     --add keys/primary/public.pem \
     --keep exports/eng_kjv-1.1.0.manifest.json
   ```

   `--revoke` and `--keep` can be repeated. A statement is permanent, so
   the command never replaces one: if it's wrong, delete the unsigned file
   and write it again.
4. On an offline computer, sign it with the backup key, pasting the key as
   for `sign`:

   ```
   npm start -- sign-statement --sequence 1
   npm start -- check-statement --sequence 1
   ```

5. Sign modules again with the new primary key as needed, and publish the
   statement everywhere: beside every new module in a `keys` folder, in
   Bible Nav (`npm run copy-db` copies it, then list it in `keys.rs`), in
   releases, and on thumb drives.

## The old RSA key

Format 1 modules held an RS256 JWT signed with `private.pem` in this folder,
also kept as a repository secret. Format 2 replaces it, and nothing uses it
any more. It can be deleted, along with the repository secret.
