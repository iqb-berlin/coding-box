# Workspace API Token Permissions

[Deutsch](workspace-api-token-rights-de.md)

Binding permissions overview for [#569](https://github.com/iqb-berlin/coding-box/issues/569),
based on `develop` at `0f08d70d2cc1f9bebc852d9996ac01657368ca4a`.
The issue remains open until separately confirmed acceptance.

## Token Types and Supported Access

OIDC user sessions use provider-signed RS256 tokens with an exact issuer and
matching `azp` or `aud`. Local roles, workspace membership and job permissions
determine user actions.

Workspace API tokens use HS256 and the separate `JWT_SECRET`, with
`token_use=workspace`, `tokenType=workspace-api`, `iss=coding-box`,
`aud=coding-box-workspace-token`, user ID, workspace ID and explicit scopes.
The replay, metadata, statistics and coding-job actions listed below are supported
within the bound workspace and with the represented person's current local
permissions. Tokens are not bound to one response or one job. They do not replace
an OIDC user session or grant additional roles.

The client-credentials exchange at `/api/auth/token` relays a provider token.
It does not define a separate machine-access model or workspace scope.
Independent machine access with a concrete consumer and permission model is
outside this issue; provider tokens follow existing OIDC rules. Opaque tokens
and arbitrary other provider clients are not accepted by this mechanism.

## Lifetimes and Scope Combinations

| Code | Scope | Maximum lifetime on issuance |
| --- | --- | --- |
| R | `replay:read` | Default 90 days; configurable through `WORKSPACE_TOKEN_REPLAY_READ_MAX_DURATION_DAYS`. |
| S | `replay-statistics:write` | 1 day. |
| C | `coding-job:operate` | 1 day. |

Whole days starting at 1 are allowed. At least one known scope is required;
missing or unknown issuance scopes are rejected. Combinations use the **shortest**
maximum: R+S, R+C and R+S+C are limited to one day. The limit applies to issuance;
it does not retroactively shorten existing correctly signed tokens. Their
expiration remains authoritative.

The current frontend uses these profiles:

- External replay/export: R, with the configured replay lifetime.
- Internal replay: R+S, at most one day.
- Coding-job replay: R+S+C, at most one day.

C alone does not allow replay assets or the statistics POST. S alone does not
allow replay data. Explicitly combine scopes when a consumer needs several actions.

## Binding Allow and Deny Matrix

Every row applies to **workspace tokens**. `yes` grants a scope allowance; it does
not remove additional checks. For combined scopes, one `yes` alternative suffices
on these routes. OIDC users retain their normal role/workspace/job checks
independently of this table. All routes include the global `/api` prefix.

- `workspace`: the token workspace must exactly match the route workspace;
  the represented user must currently have local workspace access.
- `job-access`: additionally, an existing job in this workspace and
  `assertUserCanAccessCodingJob`: system admin, workspace level at least 2, or
  a person enabled as a coder and assigned to that job.
- `job-code`: additionally, an existing job and `assertUserCanCodeCodingJob`;
  the person must be enabled as a coder and assigned to the job.
- `manager-job`: additionally, `job-access` plus workspace level at least 2 or system admin.
- `job-code/review`: normally `job-code`; with `issueReview=true`, an existing
  job plus system admin or workspace level at least 2 instead. This review branch
  is not a general bypass for a missing coding assignment.

| ID | HTTP | Route | R | S | C | Additional check |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | GET | `/api/admin/workspace/:workspace_id/player/:playerName` | yes | no | no | `workspace` |
| R02 | GET | `/api/admin/workspace/:workspace_id/:unit/unitDef` | yes | no | no | `workspace` |
| R03 | GET | `/api/admin/workspace/:workspace_id/unit/:unitId` | yes | no | no | `workspace` |
| R04 | GET | `/api/admin/workspace/:workspace_id/booklet/:bookletId/units` | yes | no | no | `workspace` |
| R05 | GET | `/api/admin/workspace/:workspace_id/responses/:testPerson/:unitId` | yes | no | no | `workspace` |
| R06 | GET | `/api/admin/workspace/:workspace_id/coding/responses/:responseId/replay-url` | yes | no | no | `workspace` |
| R07 | GET | `/api/admin/workspace/:workspace_id/replay-payload/:testPerson/:unitId` | yes | no | no | `workspace` |
| R08 | GET | `/api/admin/workspace/:workspace_id/replay-assets/:unitId` | yes | no | no | `workspace` |
| R09 | GET | `/api/admin/workspace/:workspace_id/replay-response/:testPerson/:unitId` | yes | no | no | `workspace` |
| R10 | GET | `/api/admin/workspace/:workspaceId/unit/:unitId/info` | yes | no | no | `workspace` |
| R11 | GET | `/api/admin/workspace/:workspaceId/booklet/:bookletId/info` | yes | no | no | `workspace` |
| S01 | POST | `/api/admin/workspace/:workspace_id/replay-statistics` | yes | yes | no | `workspace` |
| J01 | GET | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id` | no | no | yes | `job-access` |
| J02 | PUT | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id` | no | no | yes | `manager-job` |
| J03 | PUT | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/status` | no | no | yes | `job-code` |
| J04 | PUT | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/comment` | no | no | yes | `job-access` |
| J05 | POST | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/pause` | no | no | yes | `job-code` |
| J06 | POST | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/resume` | no | no | yes | `job-code` |
| J07 | POST | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/submit` | no | no | yes | `job-code` |
| J08 | POST | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/progress` | no | no | yes | `job-code/review` |
| J09 | POST | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/notes` | no | no | yes | `job-code/review` |
| J10 | GET | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/progress` | no | no | yes | `job-access` |
| J11 | GET | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/replay-session` | no | no | yes | `job-access` |
| J12 | GET | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/units` | no | no | yes | `job-access` |
| J13 | GET | `/api/admin/workspace/:workspace_id/coding-job/:codingJobId/notes` | no | no | yes | `job-access` |

### Deliberate Exceptions and Exclusions

R intentionally also allows S01 so external and older replays can report their
statistics. `replay:read` is therefore **not universally read-only**. R alone is
recorded as an external replay source; S or C produces an internal source.
Source classification grants no permission: C alone still cannot call S01.

C allows the listed reads and writes, including the general job update J02.
J02 retains its additional manager check; C bypasses neither job assignment nor
workspace permissions. These allowances extend beyond reading job notes.

**Default deny:** protected routes without an explicit workspace allowance reject
these tokens, even with R+S+C. In particular, this includes:

- Reading token policy or issuing own/other workspace tokens;
- Workspace/user/role administration and general administrator actions;
- Creating or deleting jobs and restarting open units;
- Job start, review submission (`submit-review`) and other unlisted job actions;
- Reading statistics reports, exports and other unlisted administrative actions.

The table grants no rights to public routes. A workspace bearer is not an OIDC
refresh token and cannot be substituted for one at `/api/auth/refresh`.

Missing/wrong scopes, token type, signature or expiration and a different token
workspace normally produce 401. Missing or revoked workspace access, insufficient
access level or missing job permission produces 403; a missing job may return 404.
Do not hide these distinctions by
indiscriminately requesting another login.

## Issuance and Use

These HTTP examples contain placeholders only. Start with a valid OIDC user
session and local workspace permissions.

```http
GET /api/admin/workspace/token-policy
Authorization: Bearer <OIDC-access-token>

GET /api/admin/workspace/7/token/90?scopes=replay:read
Authorization: Bearer <OIDC-access-token>

GET /api/admin/workspace/7/token/1?scopes=replay:read&scopes=coding-job:operate
Authorization: Bearer <OIDC-access-token>
```

For another identity use
`GET /api/admin/workspace/7/<encoded-identity>/token/1?scopes=replay:read`.
The requester additionally needs workspace level at least 3 or system admin.
The target person needs workspace access when using the token; issuance does not
replace that later check.

The response is a JSON string containing the token. Use the **decoded string
without JSON quotation marks** as bearer on subsequent requests:

```http
GET /api/admin/workspace/7/unit/UNIT-1/info
Authorization: Bearer <workspace-token>
```

Issuance is journalled as `ACCESS_TOKEN_CREATED` with actor, target person,
workspace, duration and scopes; the token value does not belong in the journal.
If journalling fails, no token is returned. Existing workspace tokens cannot issue
new tokens. After expiry, request a new token through an authorized user session;
there is no workspace refresh token.

Tokens are credentials. New integrations use bearer headers and HTTPS. Existing
replay links carrying Auth in the URL fragment remain a supported frontend path;
protect them as credentials and do not copy them into tickets or general logs.
Replay removes replaced Auth values from the URL. There is no individual workspace
token revocation route. Expiration, local permission removal and planned
`JWT_SECRET` rotation have different effects; key rotation affects every workspace
token signed with that key.

## Legacy Transition

Both env templates default `ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS` to `true`.
Shipped Compose files pass it to API and export worker. The strategy reads it on
startup; editing a file alone does not switch running instances. `false`, `0`,
`no` and `off` disable the old path. Modern tokens keep working afterwards.

The old path accepts only the checked previous format without `token_use`, `iss`
and `aud`, with user, workspace, username and expiration. Mixed or incorrect modern
claims do not fall back to legacy. Signature, HS256, expiration and the workspace,
scope and job checks above remain required.

**Existing scope arrays are preserved**, including C. Only entirely missing
`scopes` defaults to R. An empty or malformed scope value does not turn into a
general permission. Legacy means neither automatically unrestricted nor
automatically restricted to R.

Safe operator procedure:

1. Inventory affected replay links, exports and integrations. Classify old tokens
   privately; do not record their values or complete links.
2. Issue modern tokens through authorized user sessions with minimum scopes and
   suitable lifetimes. Move consumers in a controlled manner.
3. In an isolated environment, verify a modern R token, its statistics POST, the
   combined coding-job replay and expected denials. Check old tokens with and
   without a scope array separately before switching.
4. Set `ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS=false` in private operator configuration.
   Run `config --quiet` with the actual Compose files and overrides; never export
   effective secrets. The installed base may be named
   `docker-compose.coding-box.yaml` instead of `docker-compose.yaml`.
5. Consistently recreate affected backend instances through the normal deployment
   procedure. Modern tokens must keep working; old tokens are then rejected.
   Replay data and coding remain intact.
6. Observe denials without token values. For a missed consumer, do not rotate keys
   or broaden permissions indiscriminately. An operator-approved, time-limited
   return to `true` re-enables still-valid old tokens with their previous rights;
   migrate consumers specifically and repeat the cutoff.

## Evidence and Acceptance

The [matrix regressions](../apps/backend/src/app/auth/workspace-token-permissions.spec.ts)
check all documented route/scope assignments, both languages and the complete
permission inventory. The
[HTTP regressions](../apps/backend/src/app/auth/workspace-token-permissions.integration.spec.ts)
check representative actual controllers with signed tokens, real guards and the
actual `CodingJobAccessService`. Data access and domain writes use isolated test
doubles. Existing strategy, issuance, workspace/access-level and frontend/
replay tests complement this coverage.

This is not production operation with real tokens or new client-credentials
access. Separate acceptance of #569 remains outstanding.
