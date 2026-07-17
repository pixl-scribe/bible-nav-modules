The following command was used to generate the PSA private and public keys
located in this directory. The private key is not checked into source
control but is stored in the github repo as a repository secret.

```
openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:2048
openssl pkey -in private.pem -pubout -out public.pem
```