# PostgreSQL 17.12 – Validierung für PR #1186

Stand: 17.11.2026. Getestet in isolierten Docker-Testinstanzen mit synthetischen
Daten. Keine Produktionsdatenbank und kein vorhandenes Anwendungsvolume wurden
umgestellt. [Betriebsablauf und Rückfallplan](../postgresql-17-migration.md).

## Versionen und Konfiguration

- Quelle: Projekt-Dockerfile mit dem unveränderten Standard PostgreSQL **14.24**.
- Ziel: dasselbe Projekt-Dockerfile mit
  `postgres:17.12-alpine3.24@sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7`.
- Tatsächliche Serverversionen per SQL geprüft, nicht nur Image-Tags. Das Ziel
  meldet `PostgreSQL 17.12 on x86_64-pc-linux-musl`.
- Beide Projektimages mit `musl-locales`, `de_DE.utf8`, `Europe/Berlin`, dem
  bestehenden gosu-Build und `shared_preload_libraries=pg_stat_statements`;
  jeweils 512 MiB Shared Memory. Separates Redis **7.4** ohne Anwendungsdaten.
- Echte Liquibase **4.28.0** aus `database/Liquibase.Dockerfile` für die
  Transferprobe; Anwendungsschema mit **181 Changesets**.

## Automatisierte Ergebnisse

| Prüfung | PostgreSQL 14.24 | PostgreSQL 17.12 |
|---|---:|---:|
| `nx run backend:test-integration` | 25 Suites, 192 bestanden | 25 Suites, 192 bestanden |
| Fehlgeschlagene Pflichtprüfungen | 0 | 0 |
| Optionaler Kappa-Laufzeitbenchmark | 1 übersprungen | 1 übersprungen |

Der Integration-Runner richtet jeweils eine neue Datenbank aus dem vollständigen
Liquibase-SQL-Changelog ein, aktiviert PostgreSQL-/Redis-Prüfungen und verwirft sie
danach. Er bricht bei fehlender Infrastruktur, falscher angeforderter Serverversion
oder übersprungenen Pflichtprüfungen ab. Die Transferprobe unten verwendet
zusätzlich das reale Liquibase-Werkzeug samt History/Checksummen.

Abgedeckt sind u. a. Pool-Warten und Verbindungsaufbau, Daten-/ORM-Schema,
Kodierstände und Sperren, Replay-/Exportdaten, Importe, Workspace-Löschung,
Kappa-/Variablenanalyse-Abfragen sowie Redis-/Queue-Verhalten. Das neue
Snapshot-Spec prüft mit echten Tabellen:

- stabile Hashes einschließlich doppelter Werte, Unicode, JSONB, Bytea, numerischer
  Scores und Bigint-Werten oberhalb der JavaScript-Ganzzahlgrenze;
- sichtbare Spaltenreihenfolge trotz einer vorher gelöschten Spalte;
- unveränderte Sequenzstände, keine Antwortwerte im Bericht, Dateirechte `0600`;
- Abbruch bei geändertem Score trotz gleicher Zeilenzahl;
- Abbruch bei geänderten Zugriffsrechten trotz gleicher Daten.

`nx run backend:test-migration-tools`: **14 Tests bestanden**. Sie prüfen u. a.
exakte Serverversion, Pflichtprüfungs-Gate, Inhalts-/Sequenz-/Rechtevergleich,
die eng begrenzte CHECK-Normalisierung und übereinstimmende unveränderliche
17.12-Image-Referenzen in Vorbereitung, Umschaltung und CI. Die normale
PG14-Konfiguration bleibt bestehen. Compose-Konfiguration zusätzlich mit Docker
Compose aufgelöst: Vorbereitung lässt `db` unverändert, `db17` hat keinen Hostport,
Vorbereitung/Umschaltung verwenden dasselbe explizit benannte Zielvolume und
ein fehlender Volume-Name bricht ab.

Zusätzlich die tatsächlichen Vorbereitungs-/Umschalt-Overlays in einem eigenen
Compose-Projekt mit privatem Netzwerk ausgeführt: PG14-Quelle restauriert,
PG17-Dump aus `db17` gegen `db`, Restore auf das neue Volume, `db17` gestoppt,
Dienst `db` auf 17.12/neues Volume umgeschaltet. Vollvergleich erfolgreich und
Schreibschutz weiterhin `on`. Anschließend `db` wieder mit 14.24/altem Volume
gestartet; derselbe Vollvergleich ebenfalls erfolgreich. Die Produktionsbasis
wurde dabei durch eine minimale, ausschließlich lokale Testbasis ersetzt.

Reproduktion mit eigenen **wegwerfbaren** Testservern und lokalen Abhängigkeiten:

```bash
BACKEND_INTEGRATION_TEST_DATABASE_URL=postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PORT/postgres \
BACKEND_INTEGRATION_POSTGRES_VERSION=17.12 \
BULLMQ_TEST_REDIS_HOST=127.0.0.1 BULLMQ_TEST_REDIS_PORT=TEST_REDIS_PORT \
PSQL_BIN=/path/to/psql NX_DAEMON=false npx nx run backend:test-integration
npx nx run backend:test-migration-tools
```

Für die Gegenprobe eine 14.24-Instanz und `BACKEND_INTEGRATION_POSTGRES_VERSION=14.24`
verwenden. Der bestehende CI-Job bleibt auf seiner bisherigen PG14-Version;
`test-backend-integration-postgres17` ergänzt ein verpflichtendes, separat auf
17.12 fixiertes Ziel. Lokal wurde zusätzlich das tatsächliche PG14-Projektimage
(14.24) als Vergleich verwendet.

## Durchgeführte Transfer- und Rückfallprobe

1. Frische PostgreSQL-14.24-Datenbank `pr1186_migration` mit echtem Liquibase
   initialisiert: **181 Changesets erfolgreich**.
2. [Synthetischen Bestand](../../scripts/qa/postgres-migration-fixture.sql) ergänzt:
   Workspace, Person, Booklet, Unit, Antworten mit Code-/Score-Versionen,
   Nullwerten/Whitespace/Unicode, Chunk-Duplikate, Laststates, inhaltlich doppelte
   Logs/Sessions mit unterschiedlichen IDs, Unit-Datei und Kodierauftrag.
3. Quelle schreibgeschützt, vollständigen read-only Snapshot erstellt:
   **43 Tabellen, 204 Zeilen, 37 Sequenzen**. Von den 204 Zeilen sind 181
   Liquibase-History-Einträge; dies ist eine kleine Funktionsprobe, kein Lasttest.
4. Zunächst mit pg_dump 14.24 übertragen. Alle Tabelleninhalte und Sequenzen
   gleich; **abweichende Rechte/Owner des Schemas `public` entdeckt**. Der
   erweiterte Rechtevergleich lehnt diesen Transfer korrekt ab.
5. Mit **pg_dumpall/pg_dump 17.12 gegen die Quelle auf 14.24** neu gesichert.
   Rollen in eine erneut frische 17.12-Instanz mit separatem Bootstrap-Administrator
   restauriert, dann `pg_restore --exit-on-error --create` ausgeführt. Owner/ACLs
   mitgesichert, keine Daten/Constraints entfernt. Der Datenbank-Schreibschutz
   blieb als Default erhalten.
6. Vollvergleich erfolgreich: alle 43 Tabellen samt Werten/Duplikaten, sichtbare
   Spalten, Defaults, Constraints, Indizes, 37 Sequenzstände, Owner/ACLs, Encoding
   und Locale stimmen überein. Interne Lücken durch früher gelöschte Spalten und
   die gleichwertige varchar-Array-Cast-Darstellung von CHECKs wurden gezielt
   normalisiert; geänderte Bedingungen werden nicht pauschal ignoriert.
7. Negativprobe: Score im Testziel geändert → Vergleich mit Exitcode 1 abgebrochen;
   Score wiederhergestellt → Vergleich wieder erfolgreich.
8. Echtes Liquibase auf 17.12: `validate` erfolgreich, `status --verbose` aktuell,
   **181 History-Einträge**, **0 ungültige Indizes**, **0 unvalidierte Constraints**.
   `ANALYZE` erfolgreich.
9. Neues Ziel gestoppt, Schreibschutz der unveränderten 14-Quelle aufgehoben,
   Schreibtransaktion mit anschließendem ROLLBACK möglich. Erneuter Vergleich mit
   dem Ausgangs-Snapshot erfolgreich, einschließlich aller Rechte und Sequenzen.

## Verbleibende Freigabekriterien für den echten Betrieb

Die Tests belegen die geprüften Anwendungsfälle und den synthetischen Transfer.
Sie belegen weder eine bestimmte Ausfallzeit noch das Laufzeitverhalten des echten
Bestands. Vor dem Betriebswechsel sind deshalb die Generalprobe mit einer aktuellen
Produktionskopie, Inventar zusätzlicher DB-Objekte/Rollen/Einstellungen, ausreichender
Speicherplatz, gemessene Wartungsdauer und fachlicher Smoke-Test erforderlich.

Das alte 14-Volume bleibt als Rückfallbestand erhalten. Nach neuen Schreibzugriffen
auf 17 enthält es diese Änderungen nicht; ein einfacher Rückwechsel wäre dann
Datenverlust. Diese Grenze ist im [Migrationsplan](../postgresql-17-migration.md)
als bewusster GO-Punkt festgehalten.
