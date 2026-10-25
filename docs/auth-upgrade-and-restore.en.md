# Upgrading and Restoring Existing Auth Configuration

[Deutsch](auth-upgrade-and-restore.md)

Related to #565; foundation for #571. Acceptance is separate from implementation,
CI and deployment. This is the English counterpart of the operator procedure.

## Supported Scope

`scripts/migration/2.0.0.sh` migrates the local operator-controlled
`.env.coding-box`. It does not import a realm, download files, change client secrets
or start services. It is not a Keycloak version upgrade or a DB schema rollback.
Existing realm users, roles, sessions and client settings remain operator-owned.

A complete OIDC configuration is retained unchanged, including a custom public
issuer, internal token/JWKS endpoints, client ID/secret and callback path prefix.
Other settings, such as TLS resolver, database credentials and infrastructure paths,
are retained too. If only the callback is missing, `//${SERVER_NAME}/api/auth/callback`
is added. For a path prefix, different API port or reverse proxy, explicitly set
the correct callback and allow it in the existing client before migration.

Only if **no** `OIDC_*` entries exist can explicit legacy settings
`KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`
be translated. The existing context path is retained; endpoints are appended
under `${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}`. For separate public/internal
addresses, explicitly provide complete OIDC settings before migration. The actual
provider's discovery metadata is authoritative; generic OIDC endpoints are not
guessed from Keycloak conventions.

Duplicate Auth keys (including equal duplicates), partial OIDC settings, missing
legacy settings or unusable endpoints cause an abort. Correct the specific file
and retry. A client without a secret needs an explicit empty `OAUTH2_CLIENT_SECRET=`.
An existing secret is never replaced by a new default. The file is read as Bash,
as in the existing scripts: use only trusted operator configuration, not third-party
dotenv files. Symlinks are rejected before changes. Explicitly select the real
installation directory. A detected concurrent file change aborts preparation;
coordinate configuration changes during the maintenance window.

## Preconditions and Backup

1. Establish a maintenance window, owner and sufficient free storage. Resolve
   running/paused jobs before a separate application/queue upgrade according to
   [backend-hardening.md](backend-hardening.md).
2. Record exact image digests, Compose files, effective configuration, realm/client,
   public/internal endpoints and callback allowlist. Keep secrets/tokens only in
   access-restricted files.
3. Quiesce writing API/workers and Keycloak for one consistent backup point.
   Back up the databases actually used, assets and, if applicable, Redis; the
   realm JSON template alone is insufficient. Retain existing backups.
4. Use PostgreSQL `pg_dump --format=custom` separately for application and Keycloak
   DBs, with each verified Compose service and configured database/user. Account
   separately for roles/extensions and external provider configuration. Validate
   dumps with `pg_restore --list` and an actual isolated restore. A directory tar
   does not back up an external realm.
5. Protect copies of `.env.coding-box`, Compose/proxy/realm configuration, themes
   and signing keys. Archive assets consistently with the DB snapshot. Use
   `umask 077`, hashes and a new unique backup target; never overwrite an existing
   backup.

Before an actual file change, migration also privately copies the original into
`.auth-upgrade-2.0.0.XXXXXX/.env.coding-box`. This does not replace DB/realm/asset
backup. Unchanged configuration produces no additional backup. These directories
are Git-ignored and are not removed automatically.

## Execution and Failure Handling

From the selected installation directory, with the explicitly chosen script:

```bash
bash scripts/migration/2.0.0.sh
```

Before starting the new application, privately render effective Compose settings
and compare them with the backup. Never print secrets in tickets or CI logs.
Then start only the affected application services and check health and complete
login, including protected API access. A second migration must produce the same
file. A customized existing realm does not need a new JSON import. In particular,
do not run `kc.sh import --override` against an existing realm.

A failed migration does not replace the active file. `scripts/update.sh` stops by
default after migration failure; only an explicitly entered `y` overrides that.
Resolve the cause before continuing. After login failure, do not repeatedly import
a realm; compare exact endpoints/client/callback with the backup. With several
migration scripts, earlier successful steps may already have changed files;
retain and account for their backups.

## Concrete Restore Procedure

1. Stop affected API/workers and Keycloak. Before rollback, separately preserve
   existing data and any changes since the backup. Restrict every action to
   verified project names, container IDs and target DBs.
2. For configuration-only rollback, restore the private `.env.coding-box` copy and
   previous image/Compose versions. Realm data untouched by migration needs no
   import. Check health, complete login and workspace assignments.
3. If DB/realm restore is also required, restore verified dumps to the explicitly
   selected DBs while clients are stopped; for example,
   `pg_restore --clean --if-exists --no-owner --exit-on-error --dbname=...`.
   This overwrites target data: first exercise it in a separate isolated DB and
   never use an unverified default service/project. Restore assets consistently
   to the same backup point.
4. Redis contains temporary Auth state. Do not overlay new sessions with an old
   Auth cache. For full restore, use a new empty Redis instance owned exclusively
   by the selected project; in-progress logins must restart. Production queues
   need a separately checked queue restore, not a blanket flush or deletion of
   a shared volume.
5. Start provider, API/workers and frontend on the backed-up versions. Check health,
   new login, protected API, identity, workspace assignments and retained
   client/realm configuration. Keep backups.

## Token Effects

- An existing secure `JWT_SECRET` is retained, including `export JWT_SECRET=...`.
  Correctly issued workspace tokens remain usable until expiration, subject to
  their remaining permissions. This key is independent of the provider's RSA key.
- A missing, empty or known placeholder `JWT_SECRET` is replaced by a random key.
  Workspace tokens signed with the old key need reissuance. Do not restore an
  unsafe production key just to regain old tokens.
- Configuration-only upgrade does not change OIDC signing keys or provider
  sessions. Existing access tokens still undergo issuer/client/signature/expiry
  checks.
- Keycloak restart or DB restore may lose refresh/browser sessions. Access tokens
  are self-contained signed data and can remain valid until expiration if keys
  and verification configuration are retained. Restore is not reliable global
  token revocation; plan explicit key/session revocation and reauthentication
  if needed.
- A full DB restore can lose users, permissions or changes created since the
  snapshot. It is a maintenance/restore operation requiring its own backup,
  not ordinary repeatable configuration migration.

## Verification Evidence

[install-migration-regression.sh](../scripts/tests/install-migration-regression.sh)
executes the actual migration with custom public/internal endpoints, legacy
context paths, client/callback/secret, repeat execution, private preserved backup,
safe key rotation and unchanged files after failures. Docker/download calls are
blocked in those file tests.

[#565 acceptance](https://github.com/iqb-berlin/coding-box/issues/565#issuecomment-6395469691),
[live protocol](qa/auth-upgrade-565-2026-10-25.md) and
[sanitized evidence](qa/auth-upgrade-565-evidence-2026-10-25.json) record the tested
scope and exact boundaries. Local checks are not remote CI or separate acceptance.
