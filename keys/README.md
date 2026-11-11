# Signing keys

Modules are signed with Ed25519, as described in
[`docs/integrity-spec.md`](../docs/integrity-spec.md).

| Folder | Key | Private key |
|---|---|---|
| `development/` | Development key. `generate` signs every module with it, so anyone can build and test. Only development builds of Bible Nav accept it. | Committed on purpose. It protects nothing. |
| `primary/` | The maintainer's primary key, for publishing modules. Only `public.pem` belongs here. | Never in this repository, in CI, or with module files. |
| `backup/` | The maintainer's backup key, which only signs key statements (revoking and replacing the primary key). Only `public.pem` belongs here. | Kept offline only, apart from the primary key. |

`verify` checks signatures with every `public.pem` in these folders.

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
npm start -- sign --id eng_kjv --key -
```

and paste or pipe the private key PEM into standard input. `sign` checks the
module against the USX and its manifest before signing.

## The old RSA key

Format 1 modules held an RS256 JWT signed with `private.pem` in this folder,
also kept as a repository secret. Format 2 replaces it, and nothing uses it
any more. It can be deleted, along with the repository secret.
