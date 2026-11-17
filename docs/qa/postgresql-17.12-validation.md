# PostgreSQL 17.12 – Validierung für PR #1186

Stand: 17.11.2026. Getestet in isolierten Docker-Testinstanzen mit synthetischen
Daten. Keine Produktionsdatenbank und kein vorhandenes Anwendungsvolume wurden
umgestellt. [Betriebsablauf und Rückfallplan](../postgresql-17-migration.md).

## Versionen und Konfiguration

- Quelle: bewusst als Vergleich eingesetztes früheres Projektimage **14.24**.
- Regulärer Standard: Projekt-Dockerfile ohne Versions-Build-Argument mit
  `postgres:17.12-alpine3.24@sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7`.
- Tatsächliche Serverversionen per SQL geprüft, nicht nur Image-Tags. Das Ziel
  meldet `PostgreSQL 17.12 on x86_64-pc-linux-musl`.
- Beide Projektimages mit `musl-locales`, `de_DE.utf8`, `Europe/Berlin`, dem
  bestehenden gosu-Build, ohne zusätzliche Preload-/Tuning-Einstellungen;
  jeweils 512 MiB Shared Memory. Separates Redis **7.4** ohne Anwendungsdaten.
- Echte Liquibase **4.28.0** aus `database/Liquibase.Dockerfile` für die
  Transferprobe; Anwendungsschema mit **181 Changesets**.

## Automatisierte Ergebnisse

| Prüfung | PostgreSQL 14.24 | PostgreSQL 17.12 |
|---|---:|---:|
| `nx run backend:test-integration` einschließlich Kappa-Benchmark | 25 Suites, 193 bestanden | 25 Suites, 193 bestanden |
| Fehlgeschlagene Pflichtprüfungen | 0 | 0 |
| Übersprungene Prüfungen in diesem Lauf | 0 | 0 |

Zusätzlicher vollständiger Backend-Lauf mit dem PostgreSQL-17.12-Testserver für
die Kappa-/Fixture-Prüfungen und Redis 7.4: **284 Suites / 4.599 Tests bestanden**,
17 Suites und insgesamt 152 Tests ohne entsprechende zusätzliche Aktivierung
beziehungsweise als optionale Prüfungen übersprungen. Die separate verpflichtende
Integration oben aktiviert alle Datenbank-/Redis-Pflichtprüfungen und bestand sie.
Backend-Lint und Produktionsbuild ebenfalls erfolgreich.

Mit dem neuen 17.12-Standard zusätzlich `nx run frontend:e2e-replay-live:production`
ausgeführt: **2 Live-Cypress-Specs / 2 Tests bestanden**, keine übersprungenen
Prüfungen. Der isolierte Stack initialisierte das Schema mit Liquibase auf 17.12,
startete Backend, Keycloak und das Produktions-Frontend und prüfte Replay sowie
den Export einer unvollständigen Item-Matrix durch den Browser.

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

`nx run backend:test-migration-tools`: **15 Tests bestanden**. Sie prüfen u. a.
exakte Serverversion, Pflichtprüfungs-Gate, Inhalts-/Sequenz-/Rechtevergleich,
die eng begrenzte CHECK-Normalisierung und übereinstimmende unveränderliche
17.12-Image-Referenzen in regulärem Build, Vorbereitung, primärer CI sowie
Replay-/Codebook-Tests. Die gesonderte 14.24-Prüfung dient der Migrationsquelle.
Ohne explizite Änderung bleibt das historische Projektvolume ausgewählt;
Pool-/Logging-Defaults bleiben unverändert.

Zusätzlich die regulären Produktions-Compose-Dateien mit ausschließlich lokalen
Image-/Port-/Netzwerk-Anpassungen ausgeführt:

1. Historisches Standardvolume mit 14.24, vollständigem Liquibase-Schema und
   synthetischen Daten angelegt; Image/Volume in einer `legacy`-Datei festgehalten.
2. Regulärer 17.12-Start auf genau diesem 14er Volume: erwarteter Abbruch
   `database files are incompatible with server`. Kein neues leeres Volume
   ausgewählt; erneuter 14er Inhalts-/Rechtevergleich unverändert.
3. PG17-Dump aus `db17` gegen 14, Restore in ein ausdrücklich angelegtes externes
   Zielvolume. Danach `db17` gestoppt und das Ziel über `POSTGRES_DATA_VOLUME` plus
   `POSTGRES_DATA_VOLUME_EXTERNAL=true` ausgewählt.
4. Normaler Start von `db` auf 17.12 ohne Versions-Overlay: Vollvergleich
   erfolgreich, Schreibschutz weiterhin `on`. Erneutes Recreate über dieselbe
   normale Konfiguration: wieder identischer Bestand.
5. Rückfall mit festgehaltenem 14-Image und altem Volume trotz weiterhin gesetzter
   neuer Standard-Volume-Variable: Vollvergleich erfolgreich.
6. Falsch geschriebener externer Zielname: Start abgebrochen, kein Ersatzvolume
   angelegt. Die vorbereitete Datenbank hat keinen öffentlichen Hostport.

Reproduktion mit eigenen **wegwerfbaren** Testservern und lokalen Abhängigkeiten:

```bash
BACKEND_INTEGRATION_TEST_DATABASE_URL=postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PORT/postgres \
BACKEND_INTEGRATION_POSTGRES_VERSION=17.12 \
KAPPA_QUERY_BENCHMARK=1 \
BULLMQ_TEST_REDIS_HOST=127.0.0.1 BULLMQ_TEST_REDIS_PORT=TEST_REDIS_PORT \
PSQL_BIN=/path/to/psql NX_DAEMON=false npx nx run backend:test-integration
npx nx run backend:test-migration-tools
```

Für die Gegenprobe eine 14.24-Instanz und `BACKEND_INTEGRATION_POSTGRES_VERSION=14.24`
verwenden. Der primäre CI-Job und der normale Backend-/Container-Test verwenden
17.12. `test-backend-integration-postgres14` prüft zusätzlich die Quelle 14.24.
Mit `KAPPA_QUERY_BENCHMARK=1` wird auch der sonst optionale Benchmark aktiviert;
die hier protokollierten Läufe ließen keine Prüfung aus.

## Ergänzende Kappa-Messung

25.000 synthetische Antworten / 50.000 Kodierzeilen, ein Aufwärmdurchlauf und
fünf Messungen je Variante mit wechselnder Reihenfolge. Median für den bestehenden
SQL-gefilterten Anwendungspfad, einschließlich Gruppierung in Node; keine HTTP-
oder Excel-Zeit:

| Filter | Gelesene Rohzeilen | PostgreSQL 14.24 | PostgreSQL 17.12 |
|---|---:|---:|---:|
| Keine Einschränkung | 50.000 / 11 Batches | 1.998,3 ms | 1.665,7 ms |
| Unit | 2.500 / 1 Batch | 58,1 ms | 50,5 ms |
| Variable | 5.000 / 2 Batches | 115,4 ms | 115,4 ms |
| Unit und Variable | 250 / 1 Batch | 19,9 ms | 17,9 ms |

Der Vergleichstest prüfte auf beiden Versionen identische fachliche Ergebnisse
zwischen vorherigem JS-Filter und bestehendem SQL-Filter. Die Zahlen sind lokale
Einzelmessreihen mit warmem Cache und zeitweise weiterer Betriebsaktivität; sie
isolieren den Versionseffekt nicht und sind keine Produktionsprognose. Die elf
ungefilterten OFFSET-Batches und die vollständige Gruppierung bleiben konkrete
Ansatzpunkte für [gezielte Folgeoptimierungen](../postgresql-17-architecture.md).

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
