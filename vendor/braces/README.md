# Temporary braces security patch

This private package is `braces` 3.0.3 with the reviewed depth-limit patch from
[upstream PR #72](https://github.com/micromatch/braces/pull/72), pinned to commit
`28d440b5dd449dbf1fe6f3506cf94ecca4d02660`.
`index.js`, `lib/*.js` and `LICENSE` are copied from that commit without changes.
Only the package metadata and this note are local. The MIT license is retained.

As of 2026-10-04, [CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects every published `braces` release. The patch limits brace/parenthesis
nesting and recursive AST traversal to 100 levels, honors stricter `maxDepth`
limits, and rejects cyclic AST parent chains.

The root development dependency and `$braces` override route every consumer to
this source, including micromatch and the three chokidar installations. The
private package name distinguishes the patched source from the vulnerable
registry release; it does not declare an upstream release fixed. npm audit
cannot assess this local package. The binding `frontend:test-dependency-patches`
check therefore verifies the installed consumer paths and exercises deep input,
caller-supplied ASTs, cycles, and normal glob compatibility before npm audit.

When a corrected upstream release becomes available, replace the local
dependency/override with that release, remove this directory, update the lockfile
and rerun the dependency tests, lint, builds and browser regressions. Keep the
security behavior tests for the published replacement.
