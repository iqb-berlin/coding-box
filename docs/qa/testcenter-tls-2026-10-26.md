# Testcenter HTTPS verification, 2026-10-26

Scope: verified HTTPS, additional private CAs, and individual URLs in PR #1109.
The public probes run from the local development machine with Node 22.23.1,
Axios, `rejectUnauthorized: true`, no additional CA bundle, no proxy and no
redirect following. They read only the public `/api/version` endpoint.

| Host | HTTPS result | Reported Testcenter version |
| --- | --- | --- |
| iqb-testcenter1.de | DNS lookup failed | unknown |
| iqb-testcenter2.de | 200, certificate verified | 19.0.1 |
| iqb-testcenter3.de | 200, certificate verified | 17.6.1 |
| iqb-testcenter4.de | 200, certificate verified | 19.0.1 |
| iqb-testcenter5.de | 200, certificate verified | 18.1.2 |
| iqb-testcenter6.de | 200, certificate verified | 19.0.1 |
| iqb-testcenter7.de | 200, certificate verified | 18.3.1 |
| iqb-testcenter8.de | 200, certificate verified | 19.0.1 |
| iqb-testcenter9.de | DNS lookup failed | unknown |
| iqb-testcenter10.de | DNS lookup failed | unknown |

Google Public DNS also returned `Status: 3` (NXDOMAIN) for the A queries for
[1](https://dns.google/resolve?name=iqb-testcenter1.de&type=A),
[9](https://dns.google/resolve?name=iqb-testcenter9.de&type=A) and
[10](https://dns.google/resolve?name=iqb-testcenter10.de&type=A).
These are point-in-time results, not availability guarantees.

The Docker Compose CLI resolved both development and production configurations
with and without `NODE_EXTRA_CA_CERTS`. In all four cases the API backend retains
the read-only bind mount from `config/trusted-cas` to
`/etc/coding-box/trusted-cas`, and the configured environment value reaches the
backend. This checks the Compose model without starting containers.

The three `testcenter-tls.integration.spec.ts` cases start a real local HTTPS
server with an ephemeral private CA and run the actual `TestcenterService` in
fresh Node child processes. They verify rejection before sending credentials
without trust, successful authentication and file download under an individual
`/tci` base path with `NODE_EXTRA_CA_CERTS`, and rejection of a hostname mismatch
even with the CA trusted. The tests do not mutate the service's HTTPS agent.

The Cypress Testcenter-import specification covers the built-in selector,
an individual HTTPS URL with `/tci`, and all ten numbered hosts entered as
individual URLs. Authentication and import responses in these browser tests are
stubbed; the tests check UI state, the exact URL and server values sent to the
backend, progress, failure display and retry.

No public Testcenter credentials were available. A successful authenticated
import against the public installations was not performed. The public HTTPS
probes, local service integration and simulated browser flow provide separate
evidence and do not establish that end-to-end acceptance.

## Local validation

- Backend lint and production build passed.
- Frontend production build passed; all 12 Cypress cases passed in Electron
  against that fresh production build, with no retries or skipped cases.
- Full backend suite: 3,903 tests passed, 106 existing opt-in tests skipped.
  This includes all three fresh-process TLS integration cases.
- After the PR's rebase, the two private import cleanup cases were adapted to
  call `processWorkspaceJob`, matching the existing processor unit tests.
  The workspace-lock wrapper retains its separate test coverage.
