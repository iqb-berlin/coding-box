# Vorbereitung der Backend-Entities auf ESM

Die Backend-Anwendung wird weiterhin als CommonJS gebaut und gestartet. Das
Root-Paket, Docker, Jest samt Launcher und die bestehende Request-Validierung
mit gemeinsamen Schemas, AJV und class-validator bleiben unverändert. Dieser
Schritt bereitet die Entity-Metadaten auf einen späteren separaten ESM-Umstieg vor.

## Relationstypen und Typimporte

Direkte skalare TypeORM-Relationen verwenden `Relation<T>`. Damit schreibt der
TypeScript-Compiler für diese Eigenschaften keine unmittelbar ausgewertete
Referenz auf eine noch nicht initialisierte Entity in `design:type`. Der native
ESM-Loader konnte zuvor bereits beim Laden von `BookletLog.booklet` mit
`Cannot access 'Booklet' before initialization` abbrechen.

Die tatsächlichen Entity-Klassen bleiben Wertimporte: TypeORM benötigt sie in
den bestehenden Relations-Callbacks. Array-Relationen behalten ihre Typen;
deren Reflexionsmetadaten verweisen bereits auf `Array`. Relations-Callbacks,
Join-Spalten, Spaltendekoratoren und Datenbankschema werden nicht geändert.

Reine Typimporte und der `BookletUnit`-Typ-Reexport werden ausdrücklich als solche
markiert. `QueryDeepPartialEntity` kommt aus dem öffentlichen TypeORM-Export.
Der optionale Cache-Invalidator behält seinen expliziten Nest-Injektionstoken;
nur der zugehörige Interface-Import wird zum Typimport.

## Native Metadatenprüfung

Voraussetzungen: Node 24.22.1 und die Abhängigkeiten aus dem Workspace-Lockfile.
Es werden weder PostgreSQL noch Redis benötigt. Ausführung durch Entwicklung:

```sh
npx nx run backend:verify-entity-metadata-esm
```

Die Prüfung:

1. Kompiliert alle `*.entity.ts`-Dateien und ihre Abhängigkeiten mit der
   Produktionskonfiguration nach CommonJS sowie separat mit
   `module: ESNext` und `moduleResolution: bundler` nach ESM.
2. Ergänzt ausschließlich in der temporären ESM-Ausgabe Dateiendungen an lokalen
   Imports. Klassen, Dekoratoren und ihre Auswertungsreihenfolge werden nicht
   umgeschrieben. Kein Bundler oder Laufzeit-Loader ersetzt die Node-Semantik.
3. Lädt die JavaScript-Dateien in frischen Node-Prozessen: einmal CommonJS,
   zweimal natives ESM mit alphabetischer und umgekehrter Importreihenfolge.
   `NODE_OPTIONS` und `NODE_PATH` sind für diese Prozesse leer.
4. Erstellt PostgreSQL-Metadaten mit `DataSource.buildMetadatas()`, ohne eine
   Datenbankverbindung zu öffnen oder Schema-Synchronisierung auszuführen.
5. Vergleicht TypeORMs Tabellenrepräsentation einschließlich Spaltentypen,
   Schlüsseln, Indizes, Constraints und Fremdschlüsseln sowie Relationsziele,
   Inversen, Join-Spalten, Nullbarkeit, Eager-/Lazy- und Cascade-Einstellungen.
   Tabellenmitglieder werden nach Namen sortiert; die Reihenfolge innerhalb
   zusammengesetzter Schlüssel oder Indizes bleibt Teil des Vertrags.
6. Entfernt ausschließlich das eigene temporäre Ausgabeverzeichnis.

Erwartet: Alle 43 Entities laden, beide ESM-Importreihenfolgen entsprechen der
CommonJS-Referenz und der Prozess endet erfolgreich. Ein neuer Metadatenzyklus,
ein Compilerfehler oder eine Vertragsabweichung lässt die Prüfung fehlschlagen.
Die Anzahl wird aus den tatsächlich geladenen Entity-Klassen bestimmt; neue
Entity-Dateien werden automatisch einbezogen.

Die zugehörigen Regressionstests verwenden echte temporäre TypeORM-Entities.
Sie belegen, dass der native Loader den ursprünglichen Zyklus erkennt, dass
`Relation<T>` die inferierten Spaltentypen und Relationen erhält und dass eine
zwischen CommonJS und ESM abweichende Spaltendefinition abgelehnt wird.

Das bestehende `backend:typecheck` führt diese Prüfung zusätzlich zur bisherigen
strikten Typprüfung und CommonJS-Metadatenprüfung aus. Damit erfassen auch die
vorhandenen verpflichtenden Backend-CI-Gates die ESM-Vorbereitung. Jest und seine
Konfiguration werden dafür nicht verändert.

## Prüfung des Vorbereitungsstands

Basis: bestätigter Merge von PR #1143 auf `develop`,
`d28ab3485263f10a2eed6e8d49b405870980c86a`.

Die technische Prüfung umfasst getrennte, nacheinander ausgeführte Aufrufe:

```sh
npx nx run backend:typecheck
npx nx lint backend
npx nx test backend --maxWorkers=2 --codeCoverage=false
npx nx build backend --configuration=production
```

Die vollständige Suite verwendet zwei Worker. Infrastrukturabhängige Suites
benötigen weiterhin explizite wegwerfbare PostgreSQL-/Redis-Fixtures;
deren verpflichtendes CI-Gate bleibt bestehen.

Lokaler Nachweis am 01.11.2026 mit Node 24.22.1:

| Prüfung | Ergebnis |
| --- | --- |
| Typecheck | 0 Diagnosen; bisherige CommonJS-Metadatenprüfung und native ESM-Prüfung für alle 43 Entities bestanden |
| Neue Regressionstests | 3 bestanden |
| Backend-Lint | Bestanden |
| CommonJS-Produktionsbuild | Bestanden |
| Backend-Volltest | 4.073 Tests bestanden, 135 Infrastrukturtests übersprungen; fünf Suites konnten wegen `ENOSPC` keine Transformationsdateien schreiben; Exit 1 |
| Gezielte Wiederholung | Alle fünf betroffenen Suites bestanden mit zusammen 85 Tests; der Filter erfasste zusätzlich eine bereits bestandene Suite mit 19 Tests, insgesamt 104 bestanden |
| Zusammengeführter Testnachweis | Alle 4.158 unterschiedlichen ausführbaren Tests bestanden über Volltest und Wiederholung; kein einzelner vollständig grüner Volltest behauptet |
| Remote-CI mit Coverage und PostgreSQL-/Redis-Integration | Bei Erstellung des PRs ausstehend |

## Aktualisierung auf `develop` am 03.11.2026

Basis: `7f94651b91cf43a5e39c7c900922d77e6f52748c` (PR #1153).
Die aufgeteilten Workspace-Dateiworkflows bleiben erhalten. Die bisherigen
Typimport-Anpassungen liegen jetzt im `WorkspaceFileCacheService` und in
`workspace-file-write.util.ts`; die Kompatibilitätsfassade entspricht `develop`.
Der Merge übernimmt außerdem die aktuellen CI-Retries für Runner-Startfehler.

Erneute lokale Prüfung mit Node 24.22.1 und npm 11.19.1:

| Prüfung | Ergebnis |
| --- | --- |
| Saubere Installation | `npm ci --no-fund` bestanden, Lockfile unverändert |
| Backend-Typecheck | 0 Diagnosen; CommonJS- und ESM-Metadaten für 43 Entities gleich; alle 12 Regressionstests bestanden |
| Backend-Lint | Bestanden |
| Backend-Volltest | 256 Suites und 4.217 Tests bestanden; 18 Infrastruktur-Suites mit 160 Tests übersprungen |
| CommonJS-Produktionsbuild | Bestanden |
| Isolierte Produktionsabhängigkeiten | `backend:verify-runtime-package` bestanden; native Module geladen, Manifeste unverändert |
| Dateilisten-Browsertests | Alle 19 Tests aus `cypress/zoneless/file-list.cy.ts` mit Electron bestanden |
| Remote-CI und PostgreSQL-/Redis-Integration | Durch diese lokalen Prüfungen nicht bestätigt |

Der neue native Entity-Nachweis ist keine Bestätigung, dass Bootstrap, alle
Services, Nx-Serve, Produktionspakete und Docker bereits als ESM funktionieren.
Diese Laufzeitumstellung sowie ein möglicher Vitest-Wechsel bleiben getrennte
Arbeiten. Der Vorbereitungsschritt beinhaltet kein Release, Deployment oder
fachliche Abnahme und schließt keine Tickets.
