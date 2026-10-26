# Additional trusted certificate authorities

The backend mounts this directory read-only at
`/etc/coding-box/trusted-cas`. It trusts no additional certificates by default.

To connect to a private Testcenter, place its verified CA certificate bundle
(PEM, public certificates only) here and set `NODE_EXTRA_CA_CERTS` to the
container path in `.env.coding-box` or `.env.dev`. Recreate the backend after
changing the configuration. Certificate files are excluded from Git.

See [the Testcenter TLS upgrade instructions](../../docs/testcenter-tls-de.md).
