# Backend startup configuration

Both root modules use the same `ConfigModule.forRoot({ validate })` validator.
It checks the effective `.env.dev` and process environment before Nest creates
database, cache or queue connections. Process environment variables take
precedence. Validation errors list field names and rules, never their values.

| Configuration | API (`APP_ROLE=api`, also the default) | Export worker (`APP_ROLE=export-worker`) |
| --- | --- | --- |
| `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Required, non-empty | Required, non-empty |
| `POSTGRES_PORT` | Required, integer 1–65535 | Required, integer 1–65535 |
| `REDIS_HOST` | Non-empty, default `redis` | Non-empty, default `redis` |
| `REDIS_PORT` | Integer 1–65535, default `6379` | Integer 1–65535, default `6379` |
| `REDIS_PREFIX` | Non-empty, default `coding-box` | Non-empty, default `coding-box` |
| `JWT_SECRET` | Required, including with Keycloak (workspace replay tokens) | Not required |
| Keycloak/OIDC settings | Checked whenever configured | Not required |

For Keycloak, configure `KEYCLOAK_URL`, `KEYCLOAK_REALM` and
`KEYCLOAK_CLIENT_ID`. Alternatively, configure `OIDC_ISSUER`, `OIDC_JWKS_URI`
and `KEYCLOAK_CLIENT_ID`. Mixed configurations must still resolve both the
trusted issuer and the JWKS endpoint. `OIDC_PROVIDER_URL` is an existing fallback
for the JWKS base URL; it does not replace issuer configuration. All configured
auth URLs must use HTTP(S) and must not embed credentials. The backend does not
use `KEYCLOAK_CLIENT_SECRET`, so startup validation does not require it.
Blank optional Keycloak/OIDC values are treated as absent, matching the existing
issuer and JWKS fallback rules and Compose's unset variable handling. Required
values for the selected configuration must still be non-empty.

Unknown environment variables remain available. An unknown `APP_ROLE`, an
explicitly blank required field, or an invalid port fails startup rather than
silently selecting another runtime or connection default. Existing performance
and concurrency configuration keeps its own parsing rules.

Compose supplies database and Redis hosts. For hybrid development, set
`POSTGRES_HOST=localhost REDIS_HOST=localhost` as described in the project guide,
and provide the remaining credentials through `.env.dev` or the environment.

## Request fields and entity writes

DTO validation checks the declared fields. TypeScript types such as `Omit` and
`Pick` are compile-time constraints and do not remove fields from client JSON.
The global validation pipe deliberately retains additional fields for existing
API contracts. Persistence services must therefore select allowed fields.

Variable bundle creation and updates select only `name`, `description` and
`variables`. The route determines workspace ownership; clients cannot overwrite
primary keys, timestamps or cascading relationships through extra JSON fields.
