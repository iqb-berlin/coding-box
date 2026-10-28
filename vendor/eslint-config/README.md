# TypeScript-ESLint 8 compatibility

This private, local adaptation preserves the rules of
[@iqb/eslint-config 2.2.0](https://github.com/iqb-berlin/eslint-config) and
[eslint-config-airbnb-typescript 18.0.0](https://github.com/iamturns/eslint-config-airbnb-typescript).
Both published configurations require TypeScript-ESLint 7, which does not
support this workspace's TypeScript 5.9. This package replaces the published
IQB package through a `file:` dependency; it is not an upstream IQB release.

The Airbnb JavaScript base remains the published `eslint-config-airbnb-base`.
The copied TypeScript overrides and IQB rules use TypeScript-ESLint 8 and
ESLint Stylistic 5, executed through the workspace flat configuration. Removed formatting rules move to `@stylistic`;
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

The workspace now executes these rule definitions through ESLint 10 flat config
(`eslint.config.cjs`). `FlatCompat` translates the existing IQB/Airbnb policy.
Import-X implements the import checks under the existing `import` namespace;
its settings are translated to `import-x/*`. The published Airbnb JavaScript
package and its original import plugin remain configuration inputs, not the
runtime import-rule implementation. Their ESLint peer ranges are overridden
explicitly in the workspace manifest. Stylistic 5 provides ESLint 10 support;
its updated TypeScript return-type indentation is applied mechanically.
Frontend template/accessibility checks and core import boundaries remain active
and are covered by `frontend:test-quality-gates`.

The backend retains the previous policy for error wrapping and initial
assignments: ESLint 10's newly recommended `preserve-caught-error` and
`no-useless-assignment` checks are not enabled for backend files in this tooling
migration. Existing semantic checks remain enabled.
