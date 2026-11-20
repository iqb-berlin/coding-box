# Temporary picomatch security patch

The JavaScript files and MIT license come from the npm `picomatch@4.0.7`
tarball. The patch in `lib/parse.js` detects wildcard
tokens while closing repeated extglobs, following the approach proposed in the
unmerged [upstream PR](https://github.com/micromatch/picomatch/pull/235) for
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
With picomatch's default safety checks, a bare wildcard inside a repeated
extglob now triggers the existing literal fallback. Escaped, quoted, and
bracketed asterisks keep their existing interpretation.

`lib/utils.js` unescapes paths in linear time. It skips complete bracket
expressions and scans each line once for their closing delimiters.

The root dependency and override route consumers to this private copy in
development and production. npm audit identifies registry packages by name.
`frontend:test-dependency-patches` verifies the local package resolution and
checks the fallback and ordinary glob matching before the audit runs.

When npm publishes a patched release, replace the local dependency and
override, regenerate the lockfile, and verify the audit and glob checks again.
