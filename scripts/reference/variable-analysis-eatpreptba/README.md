# Variable Analysis eatPrepTBA Reference

This folder contains the checked-in reference artifacts for GitHub issue #563.

Files:

* `reference-responses.csv`: minimal Kodierbox-side input responses used by the regression test.
* `reference-schema.csv`: expected value labels and scores for the reference variables.
* `eatpreptba-shaped-reference.csv`: manually normalized reference table using the relevant `eatPrepTBA::evaluate_psychometrics()` column names.
* `normalize-eatpreptba-reference.mjs`: dependency-free normalizer that validates the reference table and converts it into the Kodierbox golden fixture.

The reference table is intentionally committed and not regenerated in CI. This avoids making the backend test suite depend on R package installation, GitHub remotes, or transitive CRAN dependencies.

Important: `eatpreptba-shaped-reference.csv` is not an unchanged raw export from an external R session. It is the honest MVP artifact for #563: a documented, manually normalized table in the eatPrepTBA psychometrics column format. Replace it with a real raw `evaluate_psychometrics()` export once that export and its provenance are available.

Reference source:

* eatPrepTBA commit: `16e3567adefb7341a3e93fd3d97aa25a207d0c99`
* function: `R/evaluate_psychometrics.R`
* URL: `https://github.com/franikowsp/eatPrepTBA/blob/16e3567adefb7341a3e93fd3d97aa25a207d0c99/R/evaluate_psychometrics.R`

Refresh workflow:

1. Update `reference-responses.csv`, `reference-schema.csv`, and `eatpreptba-shaped-reference.csv` together.
2. Run `node scripts/reference/variable-analysis-eatpreptba/normalize-eatpreptba-reference.mjs`.
3. Run `node scripts/reference/variable-analysis-eatpreptba/normalize-eatpreptba-reference.mjs --check`.
4. Run the backend processor regression test.

The normalizer keeps Kodierbox percentages as percent values. eatPrepTBA proportions from `category_p_total` and `category_p_valid` are multiplied by `100`.
It also checks that counts, denominators, proportions, duplicate keys, and expected schema/response rows are internally consistent.
