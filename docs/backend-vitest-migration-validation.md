# Technischer Prüfbericht: reguläre Backend-Tests mit Vitest und ESM

Stand: 4. November 2026. Entwicklungsprüfung, kein Release, Deployment oder
fachlicher Abnahmeauftrag. Arbeitsbranch: `migrate-backend-tests-vitest`.

## Basis und Abhängigkeiten

Die aktuellen GitHub-Stände wurden vor Beginn geprüft. PR #1148 wurde mit
`d8822e67012faaac3e85dc8c1cbf562373c672b6` gemergt (Merge
`2b249af1fbe160ea2522b87d2d39760fb80ffafb`). Auch #1157 war inzwischen gemergt:
Head `2be9a59550142c4613e23dec68826ce61f1e81d8`, Merge auf `develop`
`7a4197c5badd19a89c220c4c1c83e85f1cff82dd`. Dieser Merge ist die Basis der
Migration; die Vorfahrbeziehung zu #1148 wurde mit Git geprüft.

Die Änderung benötigt die ESM-Korrekturen aus #1157, insbesondere explizite
Typimporte, `Relation<T>` und passende CommonJS-Default-Imports. Sie sind bereits
in der Basis enthalten; es wurden keine abweichenden Kopien davon angelegt.
Die bestehenden PR-Branches und das primäre Arbeitsverzeichnis blieben unberührt.

## Implementierter Umfang

- `backend:test`, npm-Coverage-Aufruf, CI und der verpflichtende Integrationspfad
  führen Vitest aus. Backend-Jest-Targets, -Konfigurationen und -Launcher sind
  entfernt. Frontend-Jest bleibt bestehen.
- Der TypeScript-Transform gibt Anwendungscode als ESM mit Dekoratormetadaten aus.
  Er repariert keine Produktionsimporte oder Relationstypen. Ein Vertrag prüft
  alle Anwendungsdateien gegen direkte TypeScript-Ausgabe. Die vorhandene
  Testkompatibilität erhält Assertions, Daten, Mock-Typen und relevante Jest-
  Reset-/Hook-Verträge. Builtin-Spies synchronisieren native benannte Exporte.
- Die vier Lifecycle-Fixtures laufen als echte Node-ESM-Kindprozesse. Der Nest-
  Test prüft externe Modulidentität gegen Nodes nativen Importloader und
  Konstruktorinjektion anhand der reflektierten Metadaten.
- Die bisherigen globalen Coverage-Mindestwerte bleiben bei je 60 Prozent.
  JUnit, JSON, LCOV, Cobertura und HTML verwenden die etablierten CI-Pfade.
  CI erzwingt vollständigen Umfang, Typprüfung und Coverage. Filter, leere
  Sammlungen oder Abschaltungen dürfen keinen grünen CI-Lauf ergeben.
- Installationsjob und Backend-Testimage installieren das separate fixierte
  Tool-Lockfile. PostgreSQL/Redis, vollständiges SQL-Changelog, eigene
  Datenbanken, Cleanup und die bestehende Pflichtresultatprüfung bleiben erhalten.

## Lokale Nachweise

Die Erstqualifikation dieses Abschnitts bezieht sich auf Commit `5aee14dae`.
Die Nachqualifikation der Reviewkorrekturen folgt im nächsten Abschnitt.

Umgebung: macOS/arm64, Node 24.22.1, Vitest/coverage-v8 5.0.5,
Vite 7.3.7, TypeScript 5.9.3. PostgreSQL 14.22 und Redis 7.4 liefen in
neu angelegten eigenen Docker-Testcontainern mit flüchtigem Datenspeicher und
freien Loopback-Ports. Es wurden keine Anwendungsdienste verwendet.
Alle Frontend- und Backend-Validierungen liefen nacheinander.

Die Workspace-Abhängigkeiten wurden aus einer vorhandenen Installation mit
identischem Root-Lockfile wiederverwendet, keine frische Root-Installation.
Die Backend-Testwerkzeuge wurden dagegen frisch und erfolgreich mit
`npm ci --prefix tools/backend-vitest --include=dev --ignore-scripts --no-fund`
installiert: 46 Pakete, Audit ohne gemeldete Schwachstellen.

| Prüfung | Ergebnis |
| --- | --- |
| `npx nx test backend --configuration=ci --maxWorkers=2 --passWithNoTests=false` mit dediziertem Redis und `KAPPA_QUERY_TEST_DATABASE_URL` | Bestanden: 4.278 Tests, davon 4.254 Anwendung und 24 Kompatibilitätsverträge; 126 Skips; 282 Dateien, kein Fehler |
| Separate Test-Typprüfung im Standardlauf | Bestanden: 0 Diagnosen; 296 Root-Dateien, echte Vitest-Typen statt Jest-Ambienttypen |
| `npx nx run backend:test-integration` | Bestanden: 154 Pflichtfälle in 19 Dateien; ausschließlich 1 optionaler Kappa-Benchmark-Skip |
| `npx nx run backend:verify-test-runner` | Bestanden: 16 Verträge zu ESM-Emission, Argumenten, Integrationspflichten, JUnit-Ladefehlern, leerer Sammlung, echter Coverage-Unterschreitung und Erhalt vorheriger Integrationsberichte |
| Gezielter Korrekturlauf einschließlich Shutdown, Paket-Reproduzierbarkeit, Exportfehlern, Nest und Kompatibilität | Bestanden: 279 Tests in 19 Dateien |
| `npx nx lint backend` | Bestanden, keine Lintfehler |
| `npx nx run backend:typecheck` | Bestanden: strikte Anwendungstypen sowie Metadatenparität aller 43 Entities in CommonJS/nativem ESM, beide Importreihenfolgen |
| `npx nx build backend --configuration=production` | Bestanden, `main.mjs`, Webpack ohne Buildwarnungen |
| `npx nx exec --projects=backend -- node ../../scripts/qa/verify-backend-esm-interop.mjs` | Bestanden: native Node-ESM-Roundtrips für ZIP, XLSX, Multipart, Archiver und SQLite aus der lokalen Entwicklerinstallation |
| Aktuelles `dist/apps/backend/main.mjs` direkt mit Node, `APP_ROLE=api`, leerem `JWT_SECRET` | Alle eager Imports geladen; erwarteter Fehler „JWT_SECRET must be a non-empty string“, Exit 1 |
| `npx nx run frontend:test-quality-gates` | Bestanden: 81 CI-/Qualitätsverträge, darunter echte Ausführung des Backend-Jobs an einer Fehlerfixture |

Der Unitlauf weist 120 PostgreSQL-/Benchmark-Skips aus, die im separaten
Pflichtgate behandelt werden, und sechs unveränderte bestehende Skips in
Coding-List-Stream, Coding-Statistics und Coding-Validation. Diese sechs werden
weiterhin nicht als bestanden gezählt. Neue Freistellungen wurden nicht angelegt.

Coverage über 457 Quelldateien:

| Metrik | Gemessen | Mindestwert |
| --- | ---: | ---: |
| Statements | 78,00 % | 60 % |
| Branches | 66,80 % | 60 % |
| Funktionen | 80,91 % | 60 % |
| Zeilen | 78,26 % | 60 % |

Nach der Korrektur der Berichtsbereinigung wurden Integration und vollständiger
CI-Unitlauf erneut erfolgreich ausgeführt; alle drei Integrationsberichte blieben
nach der Coverage-Erzeugung erhalten.

Die Runner zählen Coverage unterschiedlich; diese Werte sind keine Behauptung
numerischer Gleichheit zu historischen Jest-Berichten oder eines CI-Speedups.
Der dokumentierte vollständige Vitest-Lauf dauerte 126.23 Sekunden zuzüglich
separater Test-Typprüfung; ein lokaler Einzellauf ist kein Linux-CI-Benchmark.

## Nachqualifikation der beiden Reviewbefunde

Explizites `POSTGRES_INTEGRATION_TESTS=true` und die unabhängige
`WORKSPACE_DELETION_TEST_DATABASE_URL` werden im normalen Backend-Testaufruf
jetzt erhalten. So werden angeforderte PostgreSQL-Prüfungen ausgeführt.
Ohne diese Opt-ins bleiben allgemeine PostgreSQL-Fixtures deaktiviert und
Anwendungs-Redis-Einstellungen werden weiterhin nicht übernommen.

`--testPathPatterns` wird getrennt vom einfachen Vitest-Dateifilter behandelt.
Die Auswahl wertet reguläre Ausdrücke gegen projektbezogene und absolute
Dateipfade aus, einschließlich Alternativen, Ankern, maskierten Punkten,
`./src/`-Pfaden und Groß-/Kleinschreibungsunabhängigkeit. Wiederholte Muster
bilden eine Oder-Auswahl. Ungültige Muster und eine leere Treffermenge führen
zu einem Fehler. Die Filterverbote für CI und das Pflichtintegrationsgate
bleiben bestehen; geerbte Diagnosefilter können dieses Gate nicht verkürzen.

Die neuen Regressionen starten auch den tatsächlichen Runner in einer eigenen
synthetischen Teststruktur. Sie beweisen die Ausführung bei Opt-in, die
Weitergabe der Fixture-Einstellungen, den Offline-Standard und den Fehler bei
fehlenden Regex-Treffern. Zusätzlich wurden die realen bisherigen Aufrufe
gegen ausschließlich eigene wegwerfbare Testdienste wiederholt:

| Prüfung | Ergebnis |
| --- | --- |
| `POSTGRES_INTEGRATION_TESTS=true … npx nx test backend --runInBand --testPathPatterns='(flat-response-filters|workspace-settings)\.postgres\.spec\.ts$'` | 15 bestanden, 0 Skips |
| `WORKSPACE_DELETION_TEST_DATABASE_URL=… npx nx test backend --runInBand --testPathPatterns='workspace-deletion\.postgres\.spec\.ts$'` | 7 bestanden, 0 Skips; Opt-in unabhängig vom allgemeinen PostgreSQL-Schalter |
| `npx nx test backend --testPathPatterns='nest-esm\.spec\.ts$'` | 3 bestanden, 0 Skips |
| `npx nx run backend:verify-test-runner` | 24 Verträge bestanden |
| `npx nx lint backend` | Bestanden |
| `npx nx run backend:test-integration` nach der Korrektur | 154 bestanden, 1 optionaler Benchmark-Skip |
| Vollständiger CI-Unitlauf nach der Korrektur, einschließlich Test-Typprüfung | 4.278 bestanden, unverändert 126 Skips; 0 Typdiagnosen; alle Coverage-Mindestwerte erfüllt |

## Wiederholung und Grenzen

Installation, Befehle und sichere Fixture-Konfiguration stehen in
[backend-tests.md](backend-tests.md). Unitberichte liegen unter
`coverage/apps/backend/`, Integrationsberichte unter demselben Pfad mit
`integration-`-Präfix; der Typprüfungsbericht liegt in
`tmp/backend-vitest/typecheck.json`. CI sammelt die relevanten Berichte auch
bei Fehlern. Für einen anderen Lauf dürfen ausschließlich eigene wegwerfbare
Testserver angegeben werden. Nach den Prüfungen enthielt der eigene PostgreSQL-Server nur noch die
administrative Datenbank `postgres`. Die beiden eigenen Testcontainer wurden
anschließend beendet; es wurde kein Hintergrundmonitor eingerichtet.

Vitest verwendet Vites ESM-Modulrunner für lokale Quellen. Auflösung lokaler
Imports, Testkontext, Mocks und die TypeORM-/Controller-Test-Fixtures unterscheiden
sich weiterhin vom durch Webpack gebündelten nativen Produktionsstart.
Ein ZIP-Korruptions-Kindprozess bleibt eine explizite ts-node/CommonJS-Prüfung;
Paketprüfskripte behalten eigene CommonJS-Kontrollen. Einzelheiten stehen in der
[Testdokumentation](backend-tests.md).

Die vorhandene Produktionscontainer-Prüfung aus #1157 wurde nicht entfernt oder
abgeschwächt. Sie prüft zusätzlich Linux/amd64, die tatsächlichen Dockerfiles,
eine Installation ohne Dev-Abhängigkeiten, API-/Worker-Start mit PostgreSQL/Redis,
SIGTERM und den Verbindungsabbau. Ein neues vollständiges Produktionsimage
wurde in diesem lokalen Lauf nicht gebaut; auch eine frische Produktions-
Installation wurde hier nicht wiederholt. Die nativen lokalen Paketproben
ersetzen diese CI-Nachweise nicht.

Remote-CI des neuen Branches, Merge, Release und Deployment sind durch die
obigen lokalen Ergebnisse nicht bestätigt. Es wurde keine fachliche Abnahme
widerrufen oder als ausgeführt dargestellt.
