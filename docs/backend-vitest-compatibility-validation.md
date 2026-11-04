# Technischer Prüfbericht: manueller Vitest-Kompatibilitätspilot

Stand: 1. November 2026. Zielbranch: `develop`, geprüft auf dessen Commit
`0139d2a2c2aa7573a24157d7bc7a29ce1b928f26` einschließlich des Freshness-Schnitts
aus PR #1146. Der unabhängige ESM-Vorbereitungs-PR #1145 ist keine Voraussetzung.

Dies ist eine Entwicklungsprüfung. Merge, Release, Deployment und fachliche
Abnahme sind damit nicht erfolgt. Es gibt keine Änderung eines fachlichen
Bedienablaufs und keinen neuen Abnahmeauftrag an Fachtester.

## Voraussetzungen und Wiederholung

Geprüft wurde lokal unter macOS/arm64 mit Node 24.22.1, TypeScript 5.9.3,
Vitest 5.0.5, PostgreSQL 14.24 und Redis 7.4.2. Alle Nx-Läufe verwendeten
`NX_DAEMON=false NX_NO_CLOUD=true` und `--skip-nx-cache`. Backendprüfungen liefen
nacheinander. Die Pilotinstallation mit
`npm ci --prefix tools/backend-vitest --include=dev --ignore-scripts` war erfolgreich.

Für Live-Fälle wurden ausschließlich eigene, kurzlebige PostgreSQL-/Redis-Server
auf freien Loopback-Ports verwendet; die Server und ihre synthetischen Daten
wurden anschließend entfernt. Der Testbenutzer hatte `CREATE DATABASE` und
`psql` war verfügbar. Ein wiederholter Lauf benötigt entsprechende
**Testdienste**, keine Anwendungssysteme:

```sh
export BACKEND_INTEGRATION_TEST_DATABASE_URL='postgresql://integration_test:disposable_test_only@127.0.0.1:15441/postgres'
export KAPPA_QUERY_TEST_DATABASE_URL="$BACKEND_INTEGRATION_TEST_DATABASE_URL"
export BULLMQ_TEST_REDIS_HOST=127.0.0.1
export BULLMQ_TEST_REDIS_PORT=16441
```

Für den Unitlauf bleiben `POSTGRES_INTEGRATION_TESTS=false` und
`WORKSPACE_DELETION_TEST_DATABASE_URL` leer. Der Integrationsrunner setzt seine
allgemeinen PostgreSQL-/Redis-Werte selbst. Beide Runner verwenden das vollständige
SQL-Changelog; TypeORM-Synchronisierung wird nicht als Ersatz verwendet.

## Erstqualifikation vor der P2-Korrektur

| Prüfung / reproduzierbarer Nx-Aufruf | Ergebnis |
| --- | --- |
| `npx nx run backend:test-vitest --coverage` | Bestanden: 4.211 Tests, 107 übersprungen; 277 Dateien, keine Ladefehler |
| Separate Pilot-Typprüfung, im Standardaufruf enthalten | Bestanden: 0 Diagnosen, 292 Root-Dateien; auch falsche Mock-Argumente/-Rückgaben werden durch Typverträge abgeprüft |
| `npx nx run backend:test-vitest:integration` | Bestanden: 135 Tests in 17 Dateien; nur der optionale Kappa-Benchmark übersprungen; unveränderte Pflichtprüfung erfolgreich |
| `npx nx test backend --configuration=ci --maxWorkers=2 --json --outputFile=coverage/apps/backend/results.json` | Bestanden: 4.194 Tests, 107 übersprungen; alle 258 ausführbaren Suiten grün; bestehende Coverage-Schwellen erfüllt |
| `npx nx run backend:test-integration` | Bestanden: 135 Tests, 1 optionaler Benchmark-Skip; bestehende Runner-Vertragstests ebenfalls grün |
| `npx nx lint backend` | Bestanden |
| `npx nx run backend:typecheck` | Bestanden: 0 strikte Diagnosen, 43 gültige Entity-Metadaten; bestehende Checker-Vertragstests grün |
| `npx nx build backend --configuration=production` | Bestanden; regulärer CommonJS-Produktionsbuild |

Im Vitest-Vollauf entfallen 4.194 bestandene Tests auf die Anwendung und 17 auf
die eigene Kompatibilitätsschicht. Zwei der Anwendungstests sichern den gemeinsamen
Fassade-Testproxy zusätzlich unter beiden Runnern ab. Die 107 Unit-Skips gehören
zum separaten Infrastrukturblock beziehungsweise zum optionalen Benchmark.

Die Adapterverträge decken insbesondere Mock-Reset, Hook-Rückgaben, echte
Vitest-Typen, generische Aufrufe, Konstruktoren, Descriptor-Spies, Deep-Mock-Imports
ohne `jest`-Bezeichner, CommonJS-Modulformen und synchrone Callbacks mit
vorgeladenem `requireActual` ab. Native Vitest-Hook-Cleanups bleiben wirksam.
Zyklische Entity-Module, explizite Relation-Ziele und Metadatenaufbau aus
Entity-Konstruktoren werden ebenfalls geprüft. Der Integrationsbericht-Test
verwendet die unveränderte Pflichtprüfung und weist Pflicht-Skips, Fehler und
leere Ergebnisse ab.

Die Rohberichte enthalten dieselben 271 Anwendungsdateien. Anzahl und Status
aller Fälle stimmen je Datei überein, einschließlich der Multiplizität
parametrisierter Tests. Ein bytegleicher Testnamenvergleich ist nicht gegeben:
414 Namen werden unterschiedlich dargestellt, etwa durch Vitests Behandlung von
`%p` oder die Kürzung langer Parameterwerte. Assertions und Parameterdaten werden
vom Adapter nicht verändert. Vor einer CI-Umstellung muss auch die Zuordnung
solcher Fälle in der Testbericht-Oberfläche geklärt werden.
Im Infrastrukturblock stimmen zusätzlich alle 136 vollständigen Testnamen,
Statuswerte und ihre Multiplizität exakt zwischen beiden Rohberichten überein.

## Coverage und Aufwand

Die beiden Läufer verwenden V8 und dieselbe Quelldateigrenze, besitzen jedoch
unterschiedliche Instrumentierungs- und Zählmodelle. Prozentwerte allein beweisen
deshalb keine identische Testwirkung. Die Rohzahlen und die Übereinstimmung der
Anwendungstestfälle werden getrennt ausgewertet.

| Metrik | Jest | Vitest |
| --- | --- | --- |
| Statements | 111.292 / 137.488 = 80,94 % | 28.660 / 37.148 = 77,15 % |
| Branches | 15.422 / 21.103 = 73,07 % | 19.954 / 30.236 = 65,99 % |
| Funktionen | 3.206 / 3.935 = 81,47 % | 5.608 / 6.970 = 80,45 % |
| Zeilen | 111.292 / 137.488 = 80,94 % | 27.403 / 35.383 = 77,44 % |

Die beiden Coverage-JSON-Berichte enthalten dieselben 444 Quelldateipfade.
Vitests JUnit- und Cobertura-Berichte wurden zusätzlich als XML eingelesen;
der JUnit-Bericht enthält 4.318 Fälle ohne Fehler.

Lokale Einzelmessungen sind keine kalt/warm-Benchmarkserie und keine Messung
des Linux-CI-Gesamtaufwands. Für den Vitest-Vollauf wurden 140,63 s vom Nx-Start
bis zum Exit gemessen, einschließlich separater Typprüfung (8,75 s), Coverage und
Reporting; der eigentliche Vitest-Lauf meldete 125,73 s. Die Bereitstellung der
äußeren Testserver ist darin nicht enthalten.
Der entsprechende Jest-Nx-Aufruf dauerte 326,92 s einschließlich seiner
Coverage-Berichte. Der Vitest-Integrationsaufruf einschließlich Typprüfung,
Schemaaufbau, Pflichtprüfung und Datenbank-Cleanup dauerte 37,81 s, ebenfalls
ohne Bereitstellung der äußeren Server. Diese Zeiten sind getrennte lokale
Qualifikationsläufe, keine zugesagte CI-Beschleunigung.
Der bestehende Jest-Integrationsrunner dauerte 39,10 s einschließlich seiner
Runner-Vertragstests. Die lokalen Testblöcke ergeben damit 366,02 s für Jest
und 178,44 s für den zusätzlichen Vitest-Piloten. Gemeinsame CI-Prüfungen und
äußere Serverbereitstellung sind in diesen Summen nicht enthalten.

Die reguläre CI behält ihre bisherigen Jobs: JUnit-Reporter-/Installationsprüfung,
Produktions-Typecheck, frische Runtime-Paketinstallation, Jest mit Coverage,
verpflichtende Integration, Container- und weitere Runtime-Gates. Dieser PR fügt
keinen automatischen Vitest-Aufruf hinzu. Für eine spätere Umstellungsentscheidung
müssen Installation der separaten Werkzeuge, Typprüfung, Serverbereitstellung,
Schemaaufbau, Tests, Cleanup und sämtliche Reportformate auf vergleichbaren
Linux-Runnern mitgemessen werden. Kindprozess-Coverage wird von keinem der
Elternberichte automatisch zusammengeführt.

## Korrektur des P2-Findings: vorbelegte Methoden und `mockRestore`

Der Deep-Mock-Descriptor verwendet für konfigurierbare oder schreibbare
Dateneigenschaften jetzt denselben gecachten Wert wie der normale Property-Zugriff. Dadurch greift
`spyOn` auch nach vorheriger Mock-Konfiguration auf die tatsächlich aufgerufene
Funktion zu. Accessor-Deskriptoren sowie zugleich nicht konfigurierbare und nicht
schreibbare Dateneigenschaften werden unverändert weitergegeben; bestehende
Property-Flags bleiben erhalten.

Sechs zusätzliche Regressionstests prüfen vorbelegte normale Funktionen und
native Vitest-Mocks, die Identität von Descriptor und Property-Zugriff, Spies
nach vorheriger Konfiguration sowie `mockRestore` vor dem ersten Property-Zugriff.
Nach dem Restore bleibt die Mock-API verwendbar; die Implementierung wird wie
beim bisherigen Jest-Helfer zu einer leeren Funktion zurückgesetzt. Zusätzlich
werden Descriptor-Flags, schreibbare nicht konfigurierbare Methoden, unveränderbare
Datenfelder und die Inspektion ohne Ausführung von Gettern geprüft.

Die neuen Fälle scheiterten jeweils vor ihrer Korrektur, während die bisherigen
17 Vertragstests bestanden. Im abschließenden Vollauf bestehen alle 23
Vertragstests; die separate Pilot-Typprüfung meldet 0 Diagnosen bei 293 Root-Dateien.

| Erneute Prüfung des Korrekturstands | Ergebnis |
| --- | --- |
| `npx nx run backend:test-vitest --coverage --skip-nx-cache` | Bestanden: 4.217 Tests (4.194 Anwendung + 23 Adapter), 107 vorgesehene Skips; keine Ladefehler |
| `npx nx run backend:test-vitest:integration --skip-nx-cache` | Bestanden: 135 Tests, ausschließlich der optionale Benchmark übersprungen; unveränderte Pflichtprüfung erfolgreich |
| `npx nx lint backend --skip-nx-cache` | Bestanden |

Anzahl und Status der Testfälle stimmen für alle 271 Anwendungsdateien weiterhin
mit dem qualifizierten Jest-Bericht überein. Die Korrektur ändert ausschließlich
den Pilotadapter, seine Regressionstests und diesen Bericht. Bestehende
Backendquellen, Jest, Validierung, Abhängigkeiten und CI-Gates bleiben unverändert.

## Workflow-Refresh nach dem 401 in Pipeline #106850

Der Live-Test verwendete für direkte API-Aufrufe einen beim Login gespeicherten
Access-Token, auch nachdem die Browser-Sitzung erneuert worden war. Beim
fehlgeschlagenen Export-Polling war dieser Token bereits abgelaufen.

Die Workflow-Spec liest jetzt vor jedem direkten API-Aufruf den aktuellen Token
aus der Browser-Sitzung. Bei weniger als fünf Sekunden Restlaufzeit erneuert sie
ihn über den echten Backend-Endpunkt `/api/auth/refresh` und übernimmt auch einen
rotierten Refresh-Token. Eine zwischenzeitliche Erneuerung durch die Anwendung
wird nicht überschrieben. Fehler beim Refresh schlagen weiterhin fehl;
401-Antworten auf fachliche Requests werden nicht pauschal wiederholt.

Ein zusätzlicher Live-Fall wartet den tatsächlichen Tokenablauf ab, führt einen
Refresh aus und prüft anschließend die unveränderte Benutzeridentität über
`/auth-data`. Die Provider-Tokenlaufzeit bleibt bei 30 Sekunden. Jest,
Produktionsvalidierung und sämtliche CI-Gates sind unverändert.

Die fokussierte TypeScript-Prüfung der geänderten Cypress-Spec mit ES2021 und
Bundler-Modulauflösung besteht. Der direkte Lint-Vergleich zeigt unverändert
19 bestehende Befunde und keine neuen Befunde. Der allgemeine Cypress-Typecheck umfasst auch
Frontend-Specs und scheitert bereits an deren Angular-/Jest-Konfiguration.
Der echte lokale Workflow-Lauf ist durch den nicht verfügbaren Docker-Daemon
blockiert; der neue Live-Fall wird durch das unveränderte Remote-Gate ausgeführt.

## Artefakte und Grenzen

Vitest schreibt JSON, JUnit, LCOV, Cobertura, HTML und Coverage-JSON getrennt nach
`coverage/apps/backend-vitest/`. Die Typdiagnosen stehen unter
`tmp/backend-vitest/typecheck.json`. Der Integrationsrunner bewahrt seinen
Rohbericht und eine für das bestehende Gate normalisierte Kopie auf. Jest behält
`coverage/apps/backend/`. Generierte Artefakte werden nicht eingecheckt.

Bestehende Nx-Ziele wurden strukturell gegen `develop` verglichen. Root-Manifeste,
Jest-Presets/-Konfigurationen, Validierungsskripte und sämtliche CI-Definitionen
sind unverändert. Die Produktionsquellen werden nicht migriert; die neuen
Test-Factories sind aus dem Produktions-TypeScript-Projekt ausgeschlossen.

Remote-CI, Containerbau und eine frische isolierte Installation des
Produktionspakets sind separate Nachweise. Ihr aktueller Status ist am PR zu
prüfen; lokale Testergebnisse ersetzen diese Gates nicht. Automatisches Mergen
ist nicht aktiviert.
