# Manueller Backend-Vitest-Pilot

Der Pilot führt die vorhandenen Backend-Specs zusätzlich unter Vitest aus. Jest
bleibt der verbindliche Testläufer. Anwendungscode, Request-Validierung,
Jest-Konfiguration, Root-Abhängigkeiten und bestehende CI-Gates werden nicht
umgestellt. Das neue Nx-Ziel ist keine Abhängigkeit eines anderen Ziels und wird
von keiner bestehenden Pipeline aufgerufen.

## Installation und Aufruf

Voraussetzungen: Node 24.22.1 bis einschließlich Node 24, installierte
Workspace-Abhängigkeiten und die separat fixierten Pilotwerkzeuge:

```sh
npm ci --prefix tools/backend-vitest --include=dev --ignore-scripts
NX_DAEMON=false NX_NO_CLOUD=true npx nx run backend:test-vitest
```

Die Installation verändert weder die Root-Manifeste noch die Abhängigkeiten des
normalen Jest-Laufs. Der Pilot verwendet Vitest/coverage-v8 5.0.5, Vite 7.3.7 und
TypeScript 5.9.3 aus seinem eigenen Lockfile.

| Manueller Aufruf | Umfang |
| --- | --- |
| `npx nx run backend:test-vitest` | Separate Test-Typprüfung, alle Backend-Specs und Adapter-Vertragstests |
| `npx nx run backend:test-vitest:pilot` | Typprüfung, die versionierte Auswahl von 184 Unit-/HTTP-/Prozesstests und Adapter-Vertragstests |
| `npx nx run backend:test-vitest:typecheck` | Nur Test-Typprüfung, einschließlich tatsächlich verwendeter Vitest-API-Typen |
| `npx nx run backend:test-vitest:contracts` | Typprüfung und gezielte Verträge für die Kompatibilitätsschicht |
| `npx nx run backend:test-vitest:coverage` | Vollständiger Unitlauf mit separaten Coverage-Artefakten |
| `npx nx run backend:test-vitest:integration` | Typprüfung und verpflichtender PostgreSQL-/Redis-Block mit eigener Datenbank |

Für eine gezielte Fehlersuche gibt es beispielsweise:

```sh
npx nx run backend:test-vitest --filter=facade-spy-compatibility
npx nx run backend:test-vitest --tests-only --filter=testcenter.service.spec,workspace-coding.service.spec
```

`--tests-only` überspringt die Typprüfung ausdrücklich und dient der Fehlersuche;
der Standardaufruf prüft zuerst alle Testtypen. Die Typprüfung läuft in einem
eigenen Prozess, damit ihr Compilerzustand beim anschließenden Testlauf keinen
Speicher belegt. Die Integrationsauswahl kann nicht gefiltert werden.

Frontend- und Backend-Prüfungen auf dieser lokalen Maschine nacheinander ausführen.

## PostgreSQL und Redis

Der Integrationsaufruf benötigt einen ausdrücklich benannten, wegwerfbaren
PostgreSQL-Testserver, Redis für Tests und `psql`. Anwendungsdienste und
Anwendungsdatenbanken dürfen dafür nicht verwendet werden. Beispielsweise mit
synthetischen Zugangsdaten einer bereits bereitgestellten Testfixture:

```sh
BACKEND_INTEGRATION_TEST_DATABASE_URL='postgresql://integration_test:disposable_test_only@127.0.0.1:15441/postgres' \
BULLMQ_TEST_REDIS_HOST=127.0.0.1 BULLMQ_TEST_REDIS_PORT=16441 \
npx nx run backend:test-vitest:integration
```

`PSQL_BIN` kann den Pfad zum Client festlegen. Der Runner übernimmt die bestehende
Konfigurationsprüfung, erzeugt eine eindeutig benannte eigene Datenbank, wendet
die vollständigen SQL-Changelogs an und entfernt ausschließlich diese Datenbank
im Cleanup. Er startet oder stoppt den bereitgestellten Server nicht. Die
Tests verwenden eigene Redis-Namensräume. `synchronize` ersetzt keine Migrationen.

Es laufen dieselben 17 Integrationsdateien wie im vorhandenen Gate. Nur der
optionale Kappa-Benchmark darf ohne `KAPPA_QUERY_BENCHMARK=1` ausgelassen werden.
Die unveränderte Funktion `assertIntegrationResults` prüft das Ergebnis. Lediglich
Vitests JSON-Status `skipped` wird in einer Kopie des Rohberichts zu `pending`
übersetzt. Pflicht-Skips, leere Ergebnisse und Fehler bleiben rot.

Im normalen Unitlauf werden die allgemeinen PostgreSQL-Opt-ins deaktiviert.
Dedizierte `BULLMQ_TEST_REDIS_*`- und `KAPPA_QUERY_TEST_DATABASE_URL`-Variablen
können, wie bei Jest, zusätzlich die dafür vorgesehenen Live-Fälle aktivieren.
Die übrigen PostgreSQL-Fälle gehören zum separaten Integrationsaufruf. Die vier
API-/Export-Worker-Shutdownfälle starten echte Nest-Kindprozesse; sie sind kein
vollständiger fachlicher Exportlauf oder Ersatz für die Produktions-Smokechecks.

## Kompatibilität statt Produktionsmigration

Die vorhandenen Specs werden im manuellen Modulgraphen angepasst. Assertions,
Testdaten und erlaubte Skips werden vom Adapter nicht ersetzt. Die regulären
Quellen auf der Platte bleiben in ihrer bisherigen Modulform:

- Legacy-Dekoratoren und `emitDecoratorMetadata` werden durch TypeScript erhalten.
  Skalarrelationen bekommen im virtuellen Graphen den identischen TypeORM-Typ
  `Relation<T>`, damit Entity-Zyklen keine ESM-TDZ erzeugen. Der Produktivcode aus
  dem separaten ESM-Vorbereitungsschritt wird hierfür nicht mit übernommen.
- Jest-APIs und Mock-Typen werden auf native Vitest-Mocks abgebildet. Die
  historischen Rückgabe-/Argumentgenerics bleiben typgeprüft. Die Verträge prüfen
  auch, dass falsche Argumente und Rückgaben weiterhin Typfehler sind.
- `fn(implementation)` wird beim Reset wie unter Jest geleert. Ein aus einem
  Legacy-Hook zurückgegebener Mock wird nicht als Vitest-Cleanup ausgeführt.
  Native Vitest-Dateien behalten ihre Cleanup-Semantik.
- Literalpfade in `requireActual`/`requireMock` werden asynchron vorgeladen, ohne
  synchrone Mock-Implementierungen in Promise-Rückgaben umzuwandeln. Dynamische
  `requireActual`-Pfade werden ausdrücklich abgewiesen.
- Verschachtelte Modul-Mocks behalten ihren späten Registrierungszeitpunkt.
  Als Konstruktor verwendete Mock-Implementierungen und callable CommonJS-Mocks
  erhalten die erforderliche Form; ihre Aufrufverfolgung bleibt erhalten.
- Ein begrenzter Deep-Mock-Adapter erhält die bestehenden Proxy-Verträge und
  materialisiert Property-Descriptoren für Vitest-Spies. Herkunft und MIT-Lizenz
  stehen in `tools/backend-vitest/THIRD_PARTY_LICENSES.md`.
- Veränderbare CommonJS-Imports für `fs`, `adm-zip` und `form-data` sowie reine
  Typimporte werden nur im virtuellen Graphen normalisiert. TypeORM-Dateiglobs
  werden durch Entity-Konstruktoren aus demselben Modulgraphen ersetzt.
- Der Controller-Importtest lädt alle Controller über Vites expliziten
  Modulgraphen vor der Assertion. Das Dateisystem bestimmt weiterhin die zu
  prüfenden Dateien. Ladefehler bleiben Suite-Fehler; Timeouts werden nicht erhöht.

Vier gemeinsam genutzte Test-Factories verwenden zusätzlich denselben
Descriptor-fähigen Fassade-Proxy. Eine Typannotation vermeidet `never` in einer
DOCX-Testliste. Zwei vorhandene Prüfungen sind portabel formuliert: Controller
werden an Nest-Metadaten erkannt, und ein als Promise-Ergebnis gelieferter Fehler
wird über Fehlerklasse und enthaltenen Nachrichtentext geprüft. Die fachlichen
Erwartungen bleiben erhalten und werden auch unter Jest gegengeprüft.

Der Adapter ist auf die verwendeten Verträge begrenzt. Er ist keine vollständige
Jest-Implementierung und kein Nachweis eines nativen ESM-Produktionsbackends.
Eine spätere Testquellen-Migration kann ihn schrittweise durch direkte
Vitest-Imports ersetzen.

## Artefakte und bestehende Gates

Alle neuen Laufzeitartefakte liegen getrennt unter
`coverage/apps/backend-vitest/` und `tmp/backend-vitest/`. Dazu gehören JSON,
JUnit, LCOV, Cobertura, HTML und der Typprüfungsbericht. Die bestehenden
Jest-Artefakte werden nicht überschrieben.

Die Coverage-Dateigrenze entspricht dem bestehenden Backend-Preset. Der Pilot
ändert keine produktiven Schwellenwerte und übernimmt sie nicht ungeprüft:
Beide Läufer verwenden V8, zählen aber Statements, Funktionen und Branches
unterschiedlich. Kindprozessabdeckung fließt nicht automatisch in den
Elternprozessbericht ein. Ein Laufzeitvergleich muss die zusätzliche Typprüfung,
Setup, Cleanup und Reporting einschließen; lokale Zeiten ersetzen keinen
vergleichbaren Linux-CI-Lauf.

Produktions-Typecheck, Backend-Lint/-Build, bestehende Jest-/Integrations-Gates und
Runtime-/Containerprüfungen bleiben eigenständige Prüfungen. Der
[technische Prüfbericht](backend-vitest-compatibility-validation.md) dokumentiert
die tatsächlich ausgeführten Läufe dieses PRs getrennt von Remote-CI und Release.

Details der Runner-Unterschiede: [Vitest-Migration von Jest](https://vitest.dev/guide/migration/jest.html),
[Modul-Mocks](https://vitest.dev/guide/mocking/modules.html).
