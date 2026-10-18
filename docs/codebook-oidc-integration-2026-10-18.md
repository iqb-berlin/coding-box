# Codebook integration with current OIDC authentication

Local acceptance on 2026-10-18 used application commit
`739a13d1866db61d9926e328c241c645f7e9d4e5`, integrating develop
`1786bcb8e10eff84e6ed7ffdde2946a55e7da488` into PR #1041.
The later documentation commit records this evidence without changing runtime code.

The application retains develop's OIDC services, guards and interceptors.
Only the translation loader is replaced with the shared Codebook-aware loader.
Three tests using the actual application providers verify shared translations,
backend access-token attachment and login-code exchange without recursive token refresh.
Angular locale JavaScript is transformed by Jest so this provider test uses the real locale data.

Fresh lockfile installation, both lints and both production builds passed.
Full local CI-configuration suites with coverage passed sequentially:

- Frontend: 3,024 tests in 278 suites; 78.45% lines and 78.86% branches.
- Backend: 3,328 tests in 211 suites; 80.45% lines and 72.04% branches.
  Seven optional suites with 63 tests remained skipped.
- Zoneless inventory/risk approval, inventory regressions, quality gates,
  dependency-patch checks and replay harness regressions passed.

The dedicated Compose stack applied all 163 Liquibase changesets and ran PostgreSQL,
Redis/Bull and Keycloak 26.4.0. The runner obtains an actual RS256 token from its
isolated Keycloak realm; the normal backend verifies issuer, signature and client.
The separate workspace-token strategy still requires a disposable JWT_SECRET at startup.

[Machine-readable live report](qa/codebook-oidc-live-2026-10-18.json):

- All 24 JSON/DOCX downloads matched the actual installed Studio adapter at
  `86ff5d9d8f2d61d63258e15024f04beb3ef69b50`. Only DOCX creation/modification
  timestamps were normalized; all ZIP entries were compared.
- All six SOLVER cases and 18 persisted rows matched the independent Responses 5.2.0 reference.
- Empty Codebook scope failed without a download; invalid Autocoder namespace failed
  without changing response rows.

The report includes artifact/package/runner hashes, authentication provenance,
expected scopes, queue execution/progress and persisted results. Data is synthetic.
Studio repository/profile boundaries are in memory. This API/database/queue check
is separate from browser authorization-code/PKCE acceptance and Word layout acceptance.
Final remote CI and browser results are recorded in PR #1041.
