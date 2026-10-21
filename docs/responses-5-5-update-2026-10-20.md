# Responses 5.5.0 in Kodierbox

Das veröffentlichte npm-Paket `@iqb/responses@5.5.0` ersetzt 5.4.0. Coding Components bleibt auf dem veröffentlichten Paket 4.1.0, Coding-Scheme auf 3.5.0. Der unabhängige Autocoder-Vergleich bleibt auf Responses 5.2.0.

Registry-Archiv: `https://registry.npmjs.org/@iqb/responses/-/responses-5.5.0.tgz`.
SHA-256: `736cb5ad542e64ec54b06ae7bd3cb46f43922183f11126bd29bed3961d716925`.
Das heruntergeladene npm-Archiv stimmt bytegenau mit dem [GitHub-Release](https://github.com/iqb-berlin/responses/releases/tag/5.5.0) und dem freigegebenen Kandidaten überein. Das Root-Lockfile pinnt dessen SHA-512-Integrität. Nur Responses und dessen verschachtelte VariableInfo-Abhängigkeit ändern sich im Abhängigkeitsbaum.

## Erneut lokal geprüft

- `node scripts/build-autocoder-compat.mjs` und `--check`: Bundle neu erzeugt und bytegenau reproduzierbar. Genau ein mathjs-Import wird auf den bestehenden Adapter umgeleitet.
- `npx nx test backend --runInBand --skipNxCache --testPathPatterns='(autocoder-compatibility|responses-compatibility|autocoder-solver-math|codebook-generation.service|codebook-generator.class|codebook-docx-generator.class|codebook-docx-generator.integration|codebook-image-security)\.spec\.ts$'`: 75 Tests / 7 Suites bestanden.
- `npx nx test frontend --runInBand --skipNxCache --testPathPatterns='(export-coding-book|codebook-job-definition-picker-dialog).*spec.ts$'`: 68 Tests / 3 Suites bestanden.
- Produktionsbuilds von Backend und Frontend, jeweils mit `--skipNxCache`: bestanden.
- `npx nx lint backend --skipNxCache` und `npx nx lint frontend --skipNxCache`: bestanden.
- `npm ci --dry-run --ignore-scripts --no-audit --no-fund`: bestanden.
- Erzeugtes Backend-Manifest: Responses 5.5.0 / Coding Components 4.1.0.

Frontend und Backend wurden nacheinander geprüft. Die frühere vollständige Backend-Suite und der Exportpaarvergleich aus [dem 5.4-Bericht](codebook-npm-update-2026-10-20.md) wurden für 5.5.0 nicht erneut ausgeführt. Docker-Image, neue HTTP-/Browser-/Redis-Abnahme und Word-Abnahme sind durch diese lokalen Prüfungen nicht nachgewiesen. Remote-CI ist separat am aktuellen PR-Head zu prüfen.
