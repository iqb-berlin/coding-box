# TypeScript-ESLint 8 compatibility

This private, local adaptation preserves the rules of
[@iqb/eslint-config 2.2.0](https://github.com/iqb-berlin/eslint-config) and
[eslint-config-airbnb-typescript 18.0.0](https://github.com/iamturns/eslint-config-airbnb-typescript).
Both published configurations require TypeScript-ESLint 7, which does not
support this workspace's TypeScript 5.9. This package replaces the published
IQB package through a `file:` dependency; it is not an upstream IQB release.

The Airbnb JavaScript base remains the published `eslint-config-airbnb-base`.
The copied TypeScript overrides and IQB rules use TypeScript-ESLint 8 and
ESLint Stylistic 3, the last major supporting the existing ESLint 8 legacy
configuration. Removed formatting rules move to `@stylistic`;
`no-throw-literal` becomes `only-throw-error`, and `no-loss-of-precision`
uses ESLint's core rule. Semantic checks use the current TypeScript-ESLint
recommended configuration.

The compatibility options retain the previous unused-variable policy,
TypeScript import-equals declarations for CommonJS libraries, and interfaces
that extend a single existing contract. Variable `require()` calls and empty
object types remain checked. Stylistic also checks generic argument indentation
more thoroughly; the resulting source edits only adjust whitespace.

See the [TypeScript-ESLint v8 migration guide](https://typescript-eslint.io/blog/announcing-typescript-eslint-v8/)
and [Stylistic migration guide](https://eslint.style/guide/migration).
The original MIT license notices are retained in `LICENSE-IQB` and
`LICENSE-AIRBNB-TYPESCRIPT`.

When compatible upstream releases become available, replace the local
dependency, remove this adapter, and rerun both frontend and backend lint
plus the frontend quality-gate checks. Nx already hashes `vendor/**/*`
through `sharedGlobals`, including every file in this adapter.
