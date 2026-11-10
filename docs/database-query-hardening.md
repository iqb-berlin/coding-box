# Datenzugriff und Datenbankmigration

Die Änderungen aus der ORM-/SQL-Prüfung vom 02.11.2026 liegen auf
`harden-orm-database-access`. Die technische Nachprüfung und ihr tatsächlicher
Stand werden im Umsetzungsbericht vom 04.11.2026 dokumentiert. Ein lokaler Test
belegt weder ein Deployment noch eine fachliche Abnahme.

## Verhalten und Datenvertrag

- `chunk.id` und die bereits vorhandene `unitlaststate.id` identifizieren einzelne
  Zeilen. Mehrere Chunks oder Zustandsschlüssel derselben Unit bleiben beim
  ORM-Lesen erhalten. Vorhandene Duplikate werden nicht zusammengeführt.
  Replay und Cache-Warmup verwenden gemeinsam den neuen Cache-Suffix `:v7`, damit
  zuvor zwischengespeicherte unvollständige Antworten nicht weiter ausgeliefert werden.
- Alle aktiven Entities haben nach den neuen Migrationen einen physischen
  Primärschlüssel. Die historischen Entities `logs` und `workspace_admin` werden
  nicht mehr als Anwendungstabellen registriert. `synchronize` bleibt aus.
- Fremdschlüsselzugriffe auf Antwort-/Unit-IDs und allgemeine Booklet-Log-Abfragen
  haben passende führende Indexspalten. Vier Indexduplikate und zwei seit der
  Statuskonvertierung wirkungslose Teilindizes werden entfernt.
- Die Vollwertsuche und der vorhandene Präfixindex behalten ihren bisherigen
  Umfang. Ein vollständiger GIN auf `response.value` ist **kein Bestandteil** der
  Pflichtmigration. Im Review führten synthetische Base64-Werte bereits bei
  64 KiB zu deutlich höheren Import-/Statusupdate- und WAL-Kosten. Ein solcher
  Index benötigt eine getrennte Qualifizierung auf einer repräsentativen
  Datenkopie mit Schreiblast und Speicherbudget; die Suche wird dafür nicht
  stillschweigend auf 2.000 Zeichen gekürzt.
- Definitionen lesen gemeinsam verwendete Variablenbündel einmal, mit
  Workspace-Filter. Trainingsergebnisse werden innerhalb der bisherigen
  Transaktion mit höchstens 500 Antwortzeilen je SQL-Anweisung übernommen.
- Fortschrittsabfragen lesen bei ausgeschalteter Aggregation keine Antwortwerte.
  Die fachlich notwendigen Identitäts-/Statusmengen bleiben erhalten. Bei aktiver
  Aggregation sind vollständige Antwortwerte weiterhin erforderlich.
- Die zwölf Standardfacetten teilen drei schmale, materialisierte Projektionen.
  Personen-/Bookletwerte, Antwort-/Unitwerte und Sessionwerte werden jeweils
  gemeinsam gelesen. Damit sind einschließlich der zwei separaten Logauswertungen
  fünf statt vierzehn SQL-Anweisungen nötig. Ihre Grundmengen stammen weiterhin
  aus denselben fachlichen Filtern. Die begrenzten Ergebnisarrays behalten die
  bisherige Sortierung vor der Textkonvertierung bei.
- Kappa liest über einen Cursor in einer schreibgeschützten
  Repeatable-Read-Transaktion. Ein wachsendes OFFSET und wechselnde Snapshots
  zwischen Batches entfallen. Missing-Profile werden einmal über dieselbe
  Verbindung im selben Snapshot gelesen. Die Zeilenverarbeitung benötigt keine
  zweite Poolverbindung; Standard-Missings werden dabei nur im Speicher ergänzt.
  Die Rückgabe enthält weiterhin alle benötigten
  Gruppen; deren Gesamtspeicherbedarf bleibt proportional zur Ergebnisgröße.

Die bekannten historischen Nullbarkeitsunterschiede sind explizit in
`database/legacy-nullability.json` erfasst. Der PostgreSQL-Vertragstest verhindert
zusätzliche unerklärte Abweichungen. Diese Unterschiede werden durch
diese Migration nicht pauschal in NOT-NULL-Constraints umgewandelt. Dafür wäre eine
Prüfung der Bestandsdaten und der jeweiligen fachlichen Optionalität nötig.

## Neue Liquibase-Changesets ausrollen

Voraussetzungen: Sicherung und getestete Wiederherstellung, aktueller Changelogstand,
ausreichend freier Platz für neue Indizes und WAL sowie ein eingeplantes
Wartungsfenster. Anwendung und Worker während der Zeilenidentitätsmigration
anhalten. Das Hinzufügen von `chunk.id` befüllt Bestandszeilen und benötigt eine
Tabellensperre. Indexaufbauten mit `CONCURRENTLY` laufen außerhalb einer
Liquibase-Transaktion; Constraints werden erst danach angebunden.

1. Auf einer Datenkopie prüfen, ob `bookletlog.id`, `unitlog.id`, `session.id` oder
   `unitlaststate.id` mehrfach vorkommen. Beispielsweise:

   ```sql
   SELECT id, COUNT(*) FROM unitlaststate GROUP BY id HAVING COUNT(*) > 1 LIMIT 20;
   ```

   Erwartet: keine Zeilen. Bei Konflikten den Importursprung klären und eine
   gezielte ID-Reparatur planen. Die Migration verwirft keine Log-/Zustandszeilen,
   um Konflikte zu verdecken.
2. Mit dem projektspezifischen Liquibase-Verfahren zuerst validieren und dann
   migrieren: lokal `make dev-db-validate-changelog`, danach `make dev-db-update`.
   Für den Betrieb die entsprechenden dokumentierten Produktionsziele verwenden.
3. Alle neuen Changesets und `pg_index.indisvalid` prüfen. Ein abgebrochener
   Concurrent-Indexaufbau kann einen ungültigen Index hinterlassen. Vor einem
   erneuten Versuch genau diesen fehlgeschlagenen Aufbau prüfen und bereinigen;
   nicht alte Changesets ändern oder History/Checksummen pauschal zurücksetzen.
4. Die neue Anwendung erst nach erfolgreichem Schemawechsel starten. Import,
   Export und Replay einer Unit mit mindestens zwei Chunks und zwei
   Zustandsschlüsseln prüfen. Vorhandene fachliche Abnahmen bleiben gültig;
   dieser gezielte Nachtest betrifft das bisher unvollständige Mehrzeilenlesen.
5. Such- und Löschpläne sowie Index-/WAL-Wachstum auf derselben Datenkopie erfassen.

Die Pflichtmigration enthält 14 Changesets. Beim Teil-Rollback des
Constraint-Changesets werden die vier zuvor angelegten Unique-Indizes wieder
hergestellt. Damit ist sowohl ein erneutes Anwenden ab dieser Grenze als auch
anschließendes vollständiges Zurückrollen möglich. Der Wiederaufbau dieser
Indizes läuft im Rollback innerhalb der Transaktion und benötigt entsprechend
Platz, Laufzeit und Sperren im Wartungsfenster.

Die SQL-Rollbackanweisungen stellen das alte Schema wieder her. Ein Rollback
entfernt den neuen technischen Chunk-Schlüssel, aber keine fachlichen Chunkwerte.
Ein Zurückrollen auf die alte Anwendung reaktiviert ihren bekannten Lesefehler.
Rollback deshalb im Wartungsfenster mit wiederherstellbarer Sicherung durchführen.

## Wirksame Konfiguration und SQL-Messung

`POSTGRES_SHM_SIZE` setzt die Größe von `/dev/shm` im PostgreSQL-Container
(Standard: `512m`). Der frühere Docker-Standard von 64 MiB führte im isolierten
Lasttest schon während der Aufwärmung mit zehn Nutzern zu
`could not resize shared memory segment ... No space left on device` und
HTTP-500-Antworten. Das betraf dynamischen Shared Memory bei parallelen
Abfragen, nicht den freien Platz des Datenbankvolumes. Der anschließende
Dauerlauf wird mit 512 MiB separat qualifiziert; dieser Wert ist keine
allgemeine Kapazitätsgarantie.

Die Einstellung gilt für die gemeinsame Compose-Basis und damit auch für das
Produktions- und PostgreSQL-17-Overlay. Ein laufender Container übernimmt sie
erst beim Neuerstellen. `shared_buffers`, `work_mem` und ein gegebenenfalls
gesetztes Container-Speicherlimit müssen weiterhin zusammen geplant werden.
Quellen: [Docker-Laufzeitoptionen](https://docs.docker.com/engine/containers/run/),
[PostgreSQL-Ressourcenkonfiguration](https://www.postgresql.org/docs/14/runtime-config-resource.html).

`POSTGRES_SLOW_QUERY_MS` setzt die Schwelle für langsame SQL-Anweisungen
(Standard: 1.000 ms). Das Protokoll enthält Laufzeit und einen SQL-Fingerprint,
keine SQL-Texte, Bindewerte oder Antwortinhalte. HTTP-Laufzeit und Poolbelegung
bleiben zusätzlich verfügbar.

`POSTGRES_POOL_ACQUIRE_TIMEOUT_MS` begrenzt die Wartezeit auf eine freie oder
neu aufgebaute PostgreSQL-Verbindung (Standard: 10.000 ms, positive ganze
Millisekunden). Ohne diese Grenze konnte ein abgebrochener HTTP-Aufruf weiter
auf den Pool warten und bei wiederholten Aufrufen einen langen Rückstau
verursachen. Die Grenze gilt auch für die getrennten Lock-Sessions und den
Export-Worker; sie beendet keine bereits laufende SQL-Anweisung und ist kein
Antwortzeitziel. Abgelaufene Pool-Anforderungen führen zu HTTP 503. Sie sind
weiterhin fehlgeschlagene Aufrufe und dürfen nicht als Performanceerfolg zählen.

Ungefilterte Filteroptionen teilen innerhalb eines Prozesses eine laufende
Berechnung pro Workspace, Cache-Generation und Schwellenwert. HTTP-Aufrufe und
der Filteroptionen-Queueprozessor verwenden denselben Cachepfad. Die Generation
hat eine zufällige Identität. Ein fehlender oder gelöschter Versionsschlüssel
erzeugt atomar eine neue Identität, statt den bisherigen Standardwert 1
wiederzuverwenden. Dadurch kann ein Aufruf nach einem abgeschlossenen Import
keine noch laufende Berechnung vor dem Import übernehmen. Alte Berechnungen
dürfen nur dann im Cache veröffentlichen, wenn ihre Generation noch aktuell ist;
Prüfung und Schreiben erfolgen in einem Redis-Lua-Aufruf. Die bereits laufende
alte Anfrage darf ihr ursprüngliches Ergebnis noch erhalten. Zwischen mehreren
API-Prozessen erfolgt keine gemeinsame Berechnungssperre. Bei einem SQL-Fehler
bleibt die Berechnung bis zum Ende aller bereits gestarteten Teilabfragen aktiv,
damit ein sofortiger Wiederholungsversuch diese nicht zusätzlich vervielfacht.
Bei einem Redis-Fehler wird ohne Cache gerechnet. Die neue Cache-Generation
ersetzt historische numerische Zähler. Anwendung und Queue-Worker deshalb im
vorgesehenen Wartungsfenster gemeinsam aktualisieren; ein gemischter Betrieb
alter und neuer Cache-Protokolle ist nicht qualifiziert. Die verpflichtenden
Redis-Integrationstests prüfen parallele API-/Worker-Aufrufe, Importinvalidierung
über eine zweite Serviceinstanz und das verspätete Ende alter Berechnungen.

CSV-Importe invalidieren Ergebnis- und Facetten-Caches nach Abschluss der
Schreibvorgänge auch dann, wenn eine optionale Statistikabfrage fehlgeschlagen ist.
Der Hinweis `overviewPending` darf diese Pflichtaktion nicht überspringen. Ein
explizites `false` der Invalidierung führt ebenfalls zum bestehenden Warnhinweis;
bereits gespeicherte Importdaten bleiben erhalten.

Beim Rollback auf eine Anwendung mit numerischen Facetten-Zählern zunächst alle
API- und Workerprozesse anhalten. Vor deren Neustart ausschließlich die
Facetten-Versionen und Facettenwerte mit dem logischen Präfix
`flat_response_filter_options:` im konfigurierten Anwendungs-Cache-Namespace
entfernen. Die zufälligen Generationen sind für alte `INCR`-Aufrufe ungeeignet.
Dafür keine gesamte Redis-Datenbank und keine Queue-Daten leeren.

Antwortlisten verwenden für Tagfilter ein `EXISTS` und berechnen die
Tagaggregation in einer korrelierten Projektion statt einer Gruppierung aller
Antworten vor dem Seitenlimit. Die bisherigen Filter, ausschließlich passende
Tags und die Begrenzung der Antwortwerte bleiben erhalten. Die Antwort-ID ist
der letzte Sortierschlüssel, damit identische sichtbare Schlüssel bei der
Seitennavigation eine feste Reihenfolge haben. Der tatsächliche Ausführungsplan
und die Auswirkungen unter Last werden gesondert nachgeprüft.

Ungefilterte Listen zählen Antworten über die zulässigen Units statt über einen
Scan aller Workspaces. Der zusätzliche partielle Index
`idx_response_manual_unit_variable` enthält `unitid`, `variableid`, `id` und
`status` ausschließlich für `is_autocoder_generated IS NOT TRUE`; historische
NULL-Werte bleiben eingeschlossen. Antwortwerte werden nicht in diesen Index
aufgenommen. Der Index benötigt zusätzlichen Platz und Schreibarbeit. Im
isolierten Bestandsdaten-Probelauf belegte er rund 293 MiB; der Aufbau auf der
externen HDD dauerte rund 106 Sekunden. Das ist keine Laufzeitzusage für andere
Instanzen und kein HTTP-Antwortzeitziel.

Für die ungefilterte Seite werden Units nach denselben ersten drei
Sortierschlüsseln vorausgewählt. `FETCH FIRST ... WITH TIES` erhält alle Units
mit gleichem Code, Bookletnamen und Alias; anschließend sortieren weiterhin
Variable und Antwort-ID. Liefern leere oder ausschließlich automatisch erzeugte
Units zu wenige Antworten, wird die vollständige Seitenabfrage verwendet.
Gefilterte Suchpfade behalten ihren bisherigen SQL-Vertrag.

Ungefilterte Facetten bestimmen Antwortexistenz auf Unit-Ebene und berechnen
Metadaten sowie Dauer/Fortschritt auf Booklet-Ebene. Die 14 Dimensionen,
Sortierungen und 500-Werte-Grenzen bleiben erhalten. Die PostgreSQL-Regressionen
vergleichen diesen Pfad mit der vollständigen gefilterten Abfrage und prüfen
Sortiergleichstände, leere Units und historische NULL-Werte.

Der neue Nx-Aufruf ist ausschließlich lesend und benötigt explizite
`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER` und gegebenenfalls
`POSTGRES_PASSWORD` für die beabsichtigte Instanz:

```sh
npx --no-install nx run backend:database-diagnostics --reportFile=postgres-diagnostics.json
```

Erwartet: JSON mit wirksamen Parametern, Tabellen-/Indexgrößen, Autovacuum-/Analyze-
Zeitpunkten, Wartezuständen sowie optionalen aggregierten Queryzeiten. Fehlt
`pg_stat_statements`, meldet das Ergebnis dies ausdrücklich. Seine Aktivierung
ist eine Betriebsänderung, keine Nebenwirkung dieses Diagnoseaufrufs.

Der PostgreSQL-17-Overlay lädt das Modul vor. Nach einem dafür vorgesehenen
Neustart muss Betrieb mit ausreichenden Rechten einmalig in der Ziel-Datenbank
`CREATE EXTENSION IF NOT EXISTS pg_stat_statements` ausführen. Danach die
Diagnose wiederholen. Querytexte aus der Statistik sind privilegiert; der
Diagnoseaufruf gibt ausschließlich ihre Hashwerte und Kennzahlen aus.

`database/config/postgresql.conf` bleibt eine Beispielkonfiguration und wird nicht
automatisch verwendet. Speicherwerte müssen zum Betriebsbudget passen. `work_mem`
gilt pro Sortier-/Hashoperation; parallele Operationen und Prozesse vervielfachen
den möglichen Verbrauch. Das Poolbudget muss API, Export-Worker und die separaten
Advisory-Lock-Verbindungen gemeinsam berücksichtigen.

## PostgreSQL 14 auf 17 vorbereiten

Der reguläre Support für PostgreSQL 14 endet am 12.11.2026. Das bisherige
Standardimage wird auf das letzte zum Prüfzeitpunkt aktuelle Minorimage 14.24
angehoben. Für den Hauptversionswechsel steht zusätzlich
`docker-compose.postgres17.yaml` mit geprüftem 17.11-Image-Digest bereit.
Ein Minorupdate ersetzt den notwendigen Hauptversionswechsel nicht.

Das Overlay verwendet ein separates `db17_vol`. Es mountet das alte `db_vol`
nicht in den neuen Server. Bestehende Daten werden dadurch weder konvertiert noch
automatisch kopiert. Beispiel für eine lokale Erprobung auf synthetischen Daten:

```sh
docker compose --env-file .env.dev -f docker-compose.yaml \
  -f docker-compose.override.yaml -f docker-compose.postgres17.yaml build db
docker compose --env-file .env.dev -f docker-compose.yaml \
  -f docker-compose.override.yaml -f docker-compose.postgres17.yaml up -d db
```

Für den tatsächlichen Wechsel: Schreibzugriffe/Worker stoppen, konsistenten
logischen Dump mit passenden PostgreSQL-17-Werkzeugen erstellen, in einen neuen
17er-Cluster einspielen, Rollen/Erweiterungen und Liquibase-History erhalten,
Tabellenumfänge vergleichen und Statistiken aktualisieren. Anschließend
Integrationssuite, charakteristische Querypläne, Import, Export und Replay auf
der Datenkopie prüfen. Erst dann den Verbindungswechsel für die benannte Instanz
vornehmen. Alten Cluster und Sicherung für den Rückweg behalten. Sobald auf dem
17er-Ziel neue Daten geschrieben wurden, ist ein Rückweg ohne Datenabgleich kein
verlustfreier Rollback.

Das hier bereitgestellte Image/Overlay ist noch kein Nachweis einer erfolgreichen
14→17-Datenmigration oder eines Produktionsdeployments. Für einen tatsächlichen
Rollout müssen Zielinstanz und deren Sicherung/Wiederherstellung benannt werden.

## TypeORM 1.x als getrennte Migration

Die Fehlerbehebung verwendet weiterhin 0.3.31. Die Empfehlung der Prüfung lautete,
den Hauptversionssprung getrennt vorzubereiten. Dafür gibt es ein reproduzierbares
Inventar:

```sh
npx --no-install nx run backend:typeorm-upgrade-inventory --reportFile=typeorm-upgrade-inventory.json
```

Erwartet: installierte Version, Quellstellen der entfernten Imports, Arrayformen
bei Find-Optionen und SQLite-Treiberverwendung. Am 04.11.2026 waren dies sechs
Importstellen, 120 Arrayoptionen und ein SQLite-Test. Das ist eine syntaktische
Bestandsaufnahme, kein automatischer semantischer Migrationsnachweis.

Vorgehen für den eigenständigen Versionswechsel:

1. TypeORM 1.1.2 und passende `reflect-metadata`-Peerabhängigkeit in einem eigenen
   Änderungsstand pinnen. Den offiziellen `@typeorm/codemod` zuerst mit `--dry`
   prüfen; Änderungen anschließend einzeln beurteilen.
2. `Connection` auf `DataSource` und Array-Findoptionen auf Objektformen umstellen.
   Den SQLite-Profiltest auf einen unterstützten Treiber oder eine echte isolierte
   PostgreSQL-Fixture umstellen. Der direkte SQLite-Export verwendet sqlite3
   unabhängig vom ORM und muss erhalten bleiben.
3. Das neue Verhalten bei `null`/`undefined`-Filtern und nicht-nullbaren Relationen
   ausdrücklich testen. Workspace- und Berechtigungsfilter dürfen weder entfallen
   noch unbemerkt andere Zeilenmengen liefern.
4. Vollständige Backendtests, PostgreSQL-/Redis-Integrationen, ESM-Metadatenvergleich,
   Produktionsbuild, Laufzeitpaket und die betroffenen Browserabläufe ausführen.

## Technische Regressionen

Voraussetzungen: Node gemäß `.nvmrc`; isolierter PostgreSQL-Testserver mit
CREATE-DATABASE- und pg_trgm-Rechten; isoliertes Redis. Keine Anwendungssysteme
als Integrations-Testserver verwenden.

```sh
npx --no-install nx lint backend
npx --no-install nx test backend --maxWorkers=2 --skipNxCache
npx --no-install nx run backend:typecheck
npx --no-install nx build backend --configuration=production

BACKEND_INTEGRATION_TEST_DATABASE_URL='postgresql://testuser@127.0.0.1:55439/postgres' \
BULLMQ_TEST_REDIS_HOST=127.0.0.1 BULLMQ_TEST_REDIS_PORT=55440 \
npx --no-install nx run backend:test-integration
```

Der Integrationsrunner erstellt und entfernt seine eigenen Datenbanken. Die neue
`orm-schema.postgres.spec.ts` prüft Primärschlüssel, Indexvertrag, Mehrzeilen-
Import/Export/Replay, Suchumfang, echte Facettenabfragen und Cursor-Snapshots.
Die Kappa-Referenztests vergleichen weiterhin die vollständige fachliche Ausgabe.

Primärquellen:
[PostgreSQL-Support](https://www.postgresql.org/support/versioning/),
[PostgreSQL-Hauptversionswechsel](https://www.postgresql.org/docs/17/upgrading.html),
[TypeORM-Migrationsleitfaden](https://typeorm.io/docs/releases/1.0/upgrading-from-0.3/).
