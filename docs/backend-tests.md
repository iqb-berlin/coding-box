# Backend-Tests mit Vitest und ESM

Der reguläre Backend-Testpfad (`backend:test`, npm und CI) verwendet Vitest.
Die Umstellung baut auf dem gemergten Piloten #1148 und der gemergten
ESM-Produktionslaufzeit #1157 auf. Das Frontend verwendet weiterhin Jest.
Backend-Jest-Targets und -Konfigurationen wurden entfernt.

## Installation und Aufrufe

Voraussetzungen: Node 24.22.1 innerhalb der Hauptversion 24, die
Workspace-Abhängigkeiten und die separat fixierten Backend-Testwerkzeuge:

```sh
npm ci
npm ci --prefix tools/backend-vitest --include=dev --ignore-scripts
npx nx test backend
npx nx test backend --configuration=ci --maxWorkers=2 --passWithNoTests=false
npx nx run backend:test:typecheck
npx nx run backend:test:contracts
npx nx run backend:verify-test-runner
```

Die zweite Installation ist Bestandteil des CI-Installationsjobs und des
Backend-Test-/Entwicklungsimages. Der Produktionscontainer erhält diese
Dev-Abhängigkeiten nicht. Vitest und coverage-v8 5.0.5, Vite 7.3.7 und
TypeScript 5.9.3 bleiben durch das eigene Lockfile festgelegt.

Der Standardlauf prüft zuerst die angepassten Testquellen gegen echte
Vitest-Typen, anschließend alle Backend-Specs und Kompatibilitätsverträge.
Die Typprüfung läuft in einem eigenen Prozess. Die Quellkonfiguration behält
Jest-Deklarationen für die Bearbeitung alter Specs im Editor; der ausführbare
Typprüfer ersetzt diese ausdrücklich durch Vitest-Typen. Der CI-Aufruf erzwingt den
vollständigen Umfang, Typprüfung und Coverage; Filter oder Abschaltungen
werden dort abgewiesen. Leere Testsammlungen schlagen fehl. Testläufe werden
nicht von Nx gecacht, weil sie auch ausdrücklich aktivierte Live-Fixtures nutzen.

Zur Fehlersuche:

```sh
npx nx test backend --filter=workspace-file-workflows
npx nx test backend --tests-only --filter=nest-esm
npx nx test backend --testPathPatterns='(nest-esm|environment.validation)\.spec\.ts$'
npx nx test backend --coverage
```

`--tests-only` überspringt ausdrücklich die Test-Typprüfung. Die bisherigen
Aufrufe mit `--codeCoverage`, `--maxWorkers=2` und `--runInBand` funktionieren
weiter. `--filter` wählt Dateien über einfache Teilzeichenfolgen aus;
`--testPathPatterns` behält reguläre Ausdrücke mit Alternativen, Ankern und
maskierten Punkten bei, einschließlich projektbezogener `./src/`-Pfade und
Groß-/Kleinschreibungsunabhängigkeit. Mehrfach angegebene Muster bilden eine
Oder-Auswahl. Beide Filteroptionen werden getrennt verwendet. Ungültige Muster
und eine Auswahl ohne Treffer schlagen fehl. Im CI-Aufruf und im verpflichtenden
Integrationsgate sind beide Filter gesperrt. `backend:test-vitest` bleibt als Alias für vorhandene
Pilotaufrufe.
Frontend- und Backend-Prüfungen lokal immer nacheinander ausführen.

## Modulgrenzen und Kompatibilität

Anwendungscode wird mit TypeScript als ESM und mit denselben
Legacy-Dekoratoroptionen wie im Produktionsbuild ausgegeben. Der Adapter
ändert **keine Produktionsimporte oder Entity-Typen**. Ein Vertrag vergleicht
für jede Anwendungsdatei die Ausgabe mit einer direkten TypeScript-Transpilierung.
Ungültige Imports und zyklische Dekoratortypen werden im Test nicht repariert.
Die Typimporte, CommonJS-Default-Imports und `Relation<T>` stammen aus #1157.

Die vorhandenen Assertions und Testdaten bleiben bestehen. Nur in alten
Testdateien passt der begrenzte Adapter Jest-Mocks, deren Typen, Resetverhalten,
Hook-Rückgaben und Mock-Fabriken an Vitest an. Dateisystem-Spies auf dem
CommonJS-Default-Objekt aktualisieren über Nodes `syncBuiltinESMExports()`
auch die benannten Exporte; Restore synchronisiert diese ebenfalls. `requireActual`/`requireMock` mit
Literalpfaden werden asynchron vorgeladen; synchrone Mock-Rückgaben bleiben
synchron. Dynamische Pfade werden abgewiesen. Der Deep-Mock-Proxy behält die
vorhandenen Descriptor-/Spy-Verträge. Herkunft und Lizenz sind in
`tools/backend-vitest/THIRD_PARTY_LICENSES.md` dokumentiert. Neue Tests können
direkte Vitest-Imports verwenden und behalten die native Hook-Semantik.

TypeORM-Dateiglobs in Test-Fixtures werden durch echte Entity-Konstruktoren
im selben Vite-Graphen ersetzt. Der Controller-Ladetest prüft weiterhin jede
im Dateisystem gefundene Controllerdatei, lädt diese aber über Vites Modulgraphen.
Diese zwei Anpassungen betreffen die Test-Fixtures, nicht die Anwendung.

Vitest führt lokale Module über Vites ESM-Modulrunner aus. Externe Pakete aus
`node_modules` werden standardmäßig durch natives dynamisches `import()`
geladen; der CommonJS-Fallback ist ausdrücklich ausgeschaltet. Der Nest-Test
prüft die Identität mit dem nativen Node-Importloader sowie echte
Konstruktor-Metadaten und Nest-Injektion. Siehe die
[Vitest-Dokumentation zur Externalisierung](https://main.vitest.dev/config/server).

Vitest ist trotzdem kein nativer Start des Produktionsbundles: Vite löst
endungslose lokale Imports auf, stellt Testkontext und Mocks bereit und verändert
Testmodule. Hilfsnamen wie `__dirname` und `require` in diesem Testkontext
beweisen keine Verfügbarkeit beim nativen ESM-Start. Webpack bündelt den Produktionscode zu `main.mjs`; Node lädt dessen
externe Pakete aus einer Installation ohne Dev-Abhängigkeiten. Die vier Lifecycle-Kindprozesse laufen als native `.mjs`-Dateien mit
TypeScript-Dekoratormetadaten. Der separate ZIP-Korruptionsprozess verwendet
weiterhin ts-node/CommonJS aus der Anwendungskonfiguration, und die
Paketprüfskripte behalten ihre expliziten CommonJS-Kontrollen. Kindprozess-
Coverage fließt nicht automatisch in den Elternprozessbericht ein. Deshalb
bleiben die Metadaten-Paritätsprüfung und das verpflichtende Linux/amd64-
Produktionscontainer-Gate aus #1157 erhalten, einschließlich Paket-Roundtrips,
API-/Worker-Start, SIGTERM und Verbindungsabbau. Details stehen in
[backend-esm-runtime.md](backend-esm-runtime.md).

## PostgreSQL und Redis

```sh
BACKEND_INTEGRATION_TEST_DATABASE_URL='postgresql://integration_test:disposable_test_only@127.0.0.1:15441/postgres' \
BULLMQ_TEST_REDIS_HOST=127.0.0.1 BULLMQ_TEST_REDIS_PORT=16441 \
npx nx run backend:test-integration
```

Erforderlich sind ausdrücklich wegwerfbare PostgreSQL-/Redis-Testdienste,
`psql` (optional `PSQL_BIN`) und ein Benutzer mit `CREATE DATABASE`.
Keine Anwendungsdatenbanken oder Anwendungs-Redis-Daten verwenden.
Der Runner erzeugt eine eindeutige eigene Datenbank, wendet die vollständigen
SQL-Changelogs an und entfernt ausschließlich diese Datenbank im Cleanup.
Tests verwenden eigene Redis-Namensräume. Der bereitgestellte Server wird
nicht gestartet oder gestoppt. Alle PostgreSQL-Specs sowie BullMQ und der
Redis-Rate-Limiter laufen verpflichtend mit einem Worker.

Die bestehende Pflichtprüfung bleibt erhalten: Fehler, leere Ergebnisse,
übersprungene Suiten und übersprungene Pflichtfälle schlagen fehl. Ausschließlich
der exakt benannte optionale Kappa-Benchmark darf ohne
`KAPPA_QUERY_BENCHMARK=1` übersprungen werden. Vitests Status `skipped` wird nur
in einer Kopie des Rohberichts nach `pending` normalisiert.

Ohne explizite Opt-ins läuft der reguläre Testaufruf ohne allgemeine
PostgreSQL-Fixtures und übernimmt keine Anwendungs-Redis-Konfiguration.
`POSTGRES_INTEGRATION_TESTS=true` sowie die unabhängige
`WORKSPACE_DELETION_TEST_DATABASE_URL` werden dagegen unverändert weitergegeben.
Dabei bleibt auch eine ausdrücklich bereitgestellte Redis-Konfiguration erhalten.
Diese Aufrufe benötigen selbst vorbereitete, wegwerfbare Testdatenbanken und
übernehmen deren Migrationen nicht automatisch. Die dokumentierten gezielten
Prüfungen bleiben damit ausführbar, beispielsweise:

```sh
POSTGRES_INTEGRATION_TESTS=true POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=15441 \
POSTGRES_USER=fixture POSTGRES_PASSWORD=disposable_test_only POSTGRES_DB=fixture \
npx nx test backend --runInBand --testPathPatterns='flat-response-filters\.postgres\.spec\.ts$'
```

Die dedizierten `BULLMQ_TEST_REDIS_*`- und `KAPPA_QUERY_TEST_DATABASE_URL`-
Variablen aktivieren weiterhin ihre entsprechenden Live-Fälle; die CI stellt
diese Dienste bereit. `backend:verify-bullmq-live` nutzt denselben regulären
Runner. Das vollständige verpflichtende Integrationsgate oben ist weiterhin
der maßgebliche CI-Nachweis und kann nicht gefiltert werden.

## Coverage und CI-Artefakte

Unitberichte liegen unter `coverage/apps/backend/`: `results.json`, `junit.xml`,
`coverage-final.json`, `coverage-summary.json`, LCOV, Cobertura und HTML.
Die CI übernimmt weiterhin diese Pfade. Der Integrationslauf erzeugt getrennt
`integration-results.json`, `integration-results-normalized.json` und
`integration-junit.xml`. Der Unitlauf bereinigt ausschließlich seine eigenen
Berichte und erhält die `integration-`-Artefakte; die V8-Coverage darf den
gemeinsamen Ordner nicht pauschal löschen. Der Typprüfungsbericht liegt unter
`tmp/backend-vitest/typecheck.json`.

Die bisherige Dateiauswahl und die globalen Mindestwerte von jeweils 60 Prozent
für Statements, Funktionen, Branches und Zeilen bleiben verbindlich. Vitest
und Jest zählen trotz V8 unterschiedlich; historische Prozentzahlen sind
nicht direkt vergleichbar. Die Schwellen gelten für den vollständigen Unitlauf,
nicht für gefilterte Diagnoseläufe oder den Integrationsblock.

[Technischer Migrationsnachweis](backend-vitest-migration-validation.md) und
[historischer Pilotbericht](backend-vitest-compatibility-validation.md) trennen
lokale Prüfungen von Remote-CI, Release, Deployment und fachlicher Abnahme.
