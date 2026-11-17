# PostgreSQL 14 → 17.12: Migration und Rückfall

Dieser Ablauf bereitet einen **ausdrücklichen Betriebswechsel** vor. Die normalen
Make-/Compose-Aufrufe bleiben auf PostgreSQL 14. Datenbankversion, Pool-Timeout,
Slow-Query-Logging und Anwendungsfunktionen werden nicht automatisch umgestellt.
Die lokalen Testergebnisse stehen in [der Validierung](qa/postgresql-17.12-validation.md).

## Verfahren und Grenzen

Wir verwenden einen logischen Volltransfer mit **pg_dump/pg_dumpall 17.12** und
**pg_restore 17.12**, einem neuen Volume und einer Schreibpause. Die Werkzeuge von
17 können die Quelle auf 14 lesen. Wichtig: pg_dump 14 lässt die damaligen
Standardrechte/Eigentümer des Schemas `public` im Dump aus. Ein Restore auf 17
übernimmt dann dessen andere Defaults. Der getestete Ablauf mit pg_dump 17
erhält die alten Rechte ausdrücklich; der Vergleich prüft sie zusätzlich.

Die Anwendung einschließlich Liquibase-Schema zuerst auf 14 aktualisieren und
stabil betreiben. Erst danach mit **denselben Anwendungsimages und demselben
Schema** die Datenbank wechseln. Schemaänderungen, Berechtigungsbereinigungen,
Tuning und neue Timeouts sind eigene Änderungen. Insbesondere keine Log- oder
Session-Datensätze deduplizieren oder löschen. Die ID-Prüfungen aus
[database-query-hardening.md](database-query-hardening.md) vorher ausführen.

Die alte Datenbank und ihr Volume bleiben erhalten. Ein Rückfall ohne Datenverlust
ist mit diesem Verfahren nur **vor neuen Schreibzugriffen auf 17** zugesichert.
Redis, Queue-Präfix, Exportdateien und übrige Anwendungsvolumes bleiben bestehen.
Browseränderungen müssen vor der Schreibpause gespeichert sein.

## 1. Bestandsaufnahme und Generalprobe

Vor dem Wartungsfenster an einer geschützten Kopie der echten Daten messen:

- Aktuelle Serverversion, Datenbankname, Owner, Rollen, Encoding, Collation,
  Ctype, Zeitzone, Extensions und Speicherbedarf erfassen. Tatsächlich laufende
  Images/Digests und Mounts prüfen; nicht allein auf `.env` oder Tags vertrauen.
- Alle Schreiber erfassen: API-Replikate, Export-Worker, andere Queue-Worker,
  Importe, Cronjobs, manuelle Zugriffe und externe SQL-Clients. Vor dem finalen
  Dump müssen sie gestoppt und ihre Transaktionen beendet sein.
- Quell- und Ziel-Locale müssen zusammenpassen. Das Projektimage verwendet
  `de_DE.utf8` und `Europe/Berlin`. Bei anderer Quell-Locale die Zielinitialisierung
  ausdrücklich anpassen und proben. Keine stillschweigende Umstellung auf ICU.
- Nicht standardmäßige Tablespaces, weitere Datenbanken/Benutzerschemas,
  Funktionen, Views, Trigger, RLS, Large Objects, eigene Rollen-Defaults und
  zusätzliche Extensions inventarisieren. Der unten beschriebene automatische
  Inhaltsvergleich umfasst normale/partitionierte Tabellen in `public`, nicht
  alle möglichen PostgreSQL-Objekttypen. Zusätzliche Objekte separat prüfen;
  ohne vollständige Abdeckung keine Freigabe.
- Bestehende ungültige Indizes/unvalidierte Constraints klären. Ein Major-Upgrade
  repariert sie nicht automatisch. Gültige Log-/Session-ID-Sequenzen prüfen.
- Quelleinstellungen sichern, z. B. `pg_settings` mit `name,setting,unit,source`.
  Explizite Ressourcengrenzen übernehmen; geänderte Defaults wie
  `hash_mem_multiplier` (14: 1, ab 15: 2) bewusst bewerten. PG17 benötigt nach dem
  Restore neue Statistiken; Laufzeiten/Pläne dürfen sich trotz gleicher Ergebnisse
  ändern. Kein automatisches Tuning in diesem PR.

Mit der Datenkopie den gesamten Ablauf einschließlich Rückfall üben und Dauer
von Dump, Restore, ANALYZE, Vollvergleich und fachlichen Prüfungen dokumentieren.
Der Vollvergleich sortiert und hasht jede Tabelle und kann bei großen Beständen
erheblich dauern/temp. Speicher benötigen. Standardtimeout je SQL-Statement:
15 Minuten; bei Bedarf `MIGRATION_SNAPSHOT_TIMEOUT_MS` ausdrücklich erhöhen.
Schreibpause einschließlich dieser Prüfung planen, nicht nur den Restore messen.
Die mitgelieferten Tests ersetzen diese Generalprobe mit dem eigenen Bestand nicht.

## 2. Befehle und getrenntes Ziel vorbereiten

Die folgenden Bash-Befehle gelten für die vorhandene Produktions-Compose-Struktur
im Installationsverzeichnis. Für andere Setups Dateiliste/Netzwerk/Dienstnamen
vorher anpassen. Bei jedem fehlgeschlagenen Schritt anhalten und Schreiber
gestoppt lassen. Kein `down -v`, kein `--clean`, kein Volume-Prune verwenden.

```bash
set -euo pipefail
umask 077
base=(docker compose --env-file "$PWD/.env.coding-box"
  -f "$PWD/docker-compose.coding-box.yaml"
  -f "$PWD/docker-compose.coding-box.prod.yaml")
stage=("${base[@]}" -f "$PWD/docker-compose.postgres17.prepare.yaml")
cutover=("${base[@]}" -f "$PWD/docker-compose.postgres17.yaml")
backup_dir="$PWD/backups/pg17-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 -p "$backup_dir"
```

`POSTGRES17_VOLUME_NAME` und `POSTGRES17_MIGRATION_ADMIN_PASSWORD` in der privaten
`.env.coding-box` setzen. Volume-Namen pro Generalprobe/finalem Transfer neu
vergeben, z. B. `coding_box_pg17_final_20261117`. Der Name ist Pflicht; ein
versehentlich weggelassenes Overlay-Ziel bricht die Konfiguration ab. Das Passwort
gehört zum separaten Bootstrap-Administrator `pg17_migration_admin` und darf nicht
das Anwendungspasswort sein. Diese Rolle darf auf der Quelle noch nicht existieren.
Die Anwendungsdatenbank darf nicht `postgres`, `template0` oder `template1` heißen;
Sonderfälle benötigen einen angepassten Plan. Eine Quellrolle namens `postgres`
ist dagegen mit dem getrennten Zieladministrator kompatibel.

```bash
"${base[@]}" config --format json > "$backup_dir/compose-before.json"
db_container=$("${base[@]}" ps -q db)
old_image_id=$(docker inspect --format '{{.Image}}' "$db_container")
old_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$db_container")
test -n "$old_volume"
rollback_image="coding-box-postgres14-rollback:$(date -u +%Y%m%dT%H%M%SZ)"
docker image tag "$old_image_id" "$rollback_image"
docker image save "$rollback_image" > "$backup_dir/postgres14-image.tar"
cat > "$backup_dir/rollback.yaml" <<EOF
services:
  db:
    image: $rollback_image
    pull_policy: never
EOF
"${stage[@]}" config --format json > "$backup_dir/compose-stage.json"
```

In `compose-stage.json` den aufgelösten Namen von `volumes.db17_vol.name` prüfen:
anders als `$old_volume` und **noch nicht vorhanden** (`docker volume inspect NAME`
muss vor dem ersten Start fehlschlagen). Abbruch bei bereits vorhandenem Ziel;
keinen alten Testbestand als finalen Bestand weiterverwenden. Private Configdateien
enthalten Zugangsdaten und bleiben außerhalb von Git. Off-host-Backup einplanen.

```bash
"${stage[@]}" build db17
"${stage[@]}" up -d --no-deps db17
"${stage[@]}" exec -T db17 pg_isready -U pg17_migration_admin -d postgres
"${stage[@]}" exec -T db17 psql -X -v ON_ERROR_STOP=1 \
  -U pg17_migration_admin -d postgres -c 'SHOW server_version;'
```

Exakt `17.12` verlangen. `db17` erhält keinen Hostport und keinen Alias `db`.
Die Quelle läuft unverändert weiter. Die Compose-Basis verwendet das externe
Netzwerk `app-net`: Ein anderer Compose-Projektname allein isoliert deshalb
keine Testumgebung! Andere Teststacks benötigen ein eigenes Netzwerk und eigene
DNS-Namen. Hier wird gezielt im vorhandenen Stack nur der Dienst `db17` ergänzt.

## 3. Wartungsfenster: Quelle einfrieren und sichern

Wartungsseite/Ingress-Sperre aktivieren. Alle Nutzer speichern lassen; laufende
Jobs geordnet beenden. Danach **sämtliche** ermittelten Schreiber stoppen, z. B.:

```bash
"${base[@]}" stop frontend backend backend-export-worker
source_user=$("${base[@]}" exec -T db printenv POSTGRES_USER)
source_db=$("${base[@]}" exec -T db printenv POSTGRES_DB)
"${base[@]}" exec -T db sh -ec '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec psql -X -v ON_ERROR_STOP=1 -v dbname="$POSTGRES_DB" -U "$POSTGRES_USER" -d postgres
' <<'SQL'
ALTER DATABASE :"dbname" SET default_transaction_read_only=on;
SELECT pid, usename, application_name, state, xact_start
FROM pg_stat_activity WHERE datname=:'dbname';
SQL
```

Offene Schreibtransaktionen/weitere Clients klären, nicht blind beenden. Die
Datenbankvorgabe wirkt erst auf neue Sitzungen; sie ersetzt das Stoppen der
Schreiber nicht. Superuser können sie umgehen. Der Quellbestand muss von jetzt
bis zum abschließenden Vergleich einschließlich Sequenzen unverändert bleiben.

Das Passwort der **Quellrolle** verdeckt in `PGPASSWORD` einlesen und exportieren;
es wird nur für die PG17-Werkzeuge gegen `db` benötigt. Keine Passwörter in URLs,
Shell-History oder Protokolle schreiben. Die Quelle muss über `db:5432` aus `db17`
erreichbar sein. Beispiel für interaktives Bash:

```bash
read -r -s -p 'PostgreSQL source password: ' PGPASSWORD
export PGPASSWORD
"${stage[@]}" exec -T -e PGPASSWORD db17 pg_dumpall --host=db \
  --username="$source_user" --database=postgres --roles-only > "$backup_dir/roles.sql"
"${stage[@]}" exec -T -e PGPASSWORD db17 pg_dump --host=db \
  --username="$source_user" --dbname="$source_db" --format=custom --create > "$backup_dir/database.dump"
unset PGPASSWORD
sha256sum "$backup_dir/roles.sql" "$backup_dir/database.dump" > "$backup_dir/SHA256SUMS"
```

Die Rollen-Sicherung enthält Passwort-Hashes; streng vertraulich behandeln.
Mit einem administrativen Quellkonto sichern, das alle Rollen, Eigentümer,
Tabellen und Sequenzen lesen kann. Die lokal getestete Installation verwendet
dafür `POSTGRES_USER`. Die administrativen Befehle dieses Plans setzen ein solches
Installationskonto voraus. Bei abweichenden Rechten sowohl Backup als auch die
administrativen Restore-/Freigabebefehle an das tatsächliche Administrationskonto
anpassen; die Anwendung behält ihr bisheriges Konto.

Für den inhalts- und rechtebasierten Vergleich läuft das Werkzeug als separater
Node-Prozess im bestehenden Backendimage; es startet keine Anwendung/Queue.
Es verlangt eine explizite Datenbank und schreibt neue Berichte mit Modus `0600`.
Keine Antworten, SQL-Parameter oder Passwort-Hashes stehen im Bericht.

```bash
snapshot() {
  local target_host="$1" output_name="$2"
  shift 2
  "${base[@]}" run --rm --no-deps -T --entrypoint node \
    --user "$(id -u):$(id -g)" \
    -v "$PWD/scripts/qa/postgres-migration-snapshot.mjs:/usr/src/coding-box-backend/migration-snapshot.mjs:ro" \
    -v "$backup_dir:/migration" -e POSTGRES_HOST="$target_host" \
    -e MIGRATION_SNAPSHOT_TIMEOUT_MS="${MIGRATION_SNAPSHOT_TIMEOUT_MS:-900000}" backend \
    /usr/src/coding-box-backend/migration-snapshot.mjs \
    "--reportFile=/migration/$output_name" "$@"
}
snapshot db before.json
```

Der Vergleich umfasst Tabellenwerte einschließlich Codes/Scores/Logs/Session-IDs,
Duplikathäufigkeiten, sichtbare Spaltenreihenfolge, Defaults, Constraints, Indizes,
Sequenzstände, Owner/ACLs und Datenbank-Locale. Dropped-Column-Lücken in internen
Spaltennummern und eine nachgewiesen gleichwertige Darstellung von varchar-Literal-
Arrays in CHECK-Bedingungen werden normalisiert; andere Unterschiede brechen ab.
Ein Backup ohne erfolgreichen Restore-Test ist keine Freigabe für den Umstieg.

## 4. Frisches Ziel restaurieren und prüfen

Die Zielinstanz besitzt zunächst nur den separaten Bootstrap-Administrator.
So können die Quellrollen inklusive bisheriger Kennwörter ohne Namenskollision
angelegt werden. Kein `--no-owner`, `--no-acl` oder Fehler-Weiterlaufen verwenden.

```bash
"${stage[@]}" exec -T db17 psql -X -v ON_ERROR_STOP=1 \
  -U pg17_migration_admin -d postgres < "$backup_dir/roles.sql"
"${stage[@]}" exec -T -e 'PGOPTIONS=-c default_transaction_read_only=off' db17 \
  pg_restore --exit-on-error --create --username=pg17_migration_admin --dbname=postgres \
  < "$backup_dir/database.dump"
snapshot db17 after.json --compareWith=/migration/before.json
"${stage[@]}" exec -T -e 'PGOPTIONS=-c default_transaction_read_only=off' db17 \
  psql -X -v ON_ERROR_STOP=1 -U pg17_migration_admin -d "$source_db" <<'SQL'
ANALYZE;
SELECT count(*) AS invalid_indexes FROM pg_index WHERE NOT indisvalid;
SELECT count(*) AS unvalidated_constraints FROM pg_constraint WHERE NOT convalidated;
SELECT count(*) AS applied_changesets FROM databasechangelog;
SQL
```

Das im Dump enthaltene Datenbank-Default `default_transaction_read_only=on`
bleibt aktiv. Nur die expliziten Wartungsverbindungen setzen es sitzungsweise
außer Kraft. Auf der Generalprobe Liquibase mit dem **gleichen Image wie auf
der Quelle** gegen `db17` ausführen: `validate` und `status --verbose`, keine
neuen Changesets. Für die JDBC-Wartungsverbindung kann
`?options=-c%20default_transaction_read_only%3Doff` verwendet werden. Im finalen
Fenster dieselben Prüfungen wiederholen; `databasechangelog` muss unverändert
sein. Nicht automatisch mit neuer Liquibase-Version oder neuen Migrationen starten.

Rollen/Login/Rechte mit dem späteren Anwendungskonto prüfen. Rollenattribute und
globale Rollen-/Datenbankeinstellungen separat mit der Quelle vergleichen; der
Snapshot vergleicht keine Passwort-Hashes. Locale und Zeitzone kontrollieren;
zusätzliche Extensions müssen auf dem Ziel verfügbar sein. Fachlich auf der
Generalprobe Replay, Kodierung/Speichern, Exporte/Importe, Kappa und Analysen sowie
deutsche Sortierung/Trigramm-Suche testen; anschließend wieder einen **frischen**
finalen Transfer verwenden. Queue-Tests der Probe benötigen ein eigenes Redis.

## 5. Umschalten und Freigabe

Freigabekriterien: verifizierte vollständige Backups, erprobter Rückfall, exakt
17.12, bestandener Vollvergleich, gleiche Owner/Rechte/Lokalisierung, keine
unerklärten ungültigen Indizes/Constraints, keine ausstehenden Liquibase-Changesets
und akzeptable Laufzeiten der echten Datenkopie. Andernfalls Quelle wieder
freigeben und das Fenster abbrechen.

```bash
"${stage[@]}" stop db17
test -z "$("${stage[@]}" ps --status running -q db17)"
"${cutover[@]}" up -d --no-deps --force-recreate db
"${cutover[@]}" exec -T db sh -ec '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "SHOW server_version;" -c "SHOW default_transaction_read_only;"
'
snapshot db cutover.json --compareWith=/migration/before.json
```

`db17` und `db` dürfen **niemals gleichzeitig dasselbe Zielvolume öffnen**.
Nach dem Umschalten tatsächlichen Mount prüfen: neues `POSTGRES17_VOLUME_NAME`,
Version `17.12`, Schreibschutz `on`. Quelle bleibt im alten Volume auf 14 erhalten.

Bis hier ist der Rückfall ohne Verlust neuer Anwendungsdaten möglich. Das Aufheben
des Schreibschutzes und der folgende Anwendungsstart sind der bewusste GO-Punkt:

```bash
"${cutover[@]}" exec -T db sh -ec '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec psql -X -v ON_ERROR_STOP=1 -v dbname="$POSTGRES_DB" -U "$POSTGRES_USER" -d postgres
' <<'SQL'
ALTER DATABASE :"dbname" SET default_transaction_read_only=off;
ALTER ROLE pg17_migration_admin NOLOGIN;
SQL
"${cutover[@]}" up -d --no-deps backend backend-export-worker frontend
```

Nach dem Start Readiness/Anmeldung, Replay, eine kontrollierte Kodierspeicherung
und Export prüfen; Fehlerquote, Queue-Fortschritt, Verbindungen und Abfragelaufzeiten
beobachten. Beim Start können Worker/Cronjobs bereits schreiben: Nicht erst die
erste manuelle Kodierung definiert diese Grenze. Bootstrap-Rolle bleibt `NOLOGIN`,
kein ungeprüftes `DROP OWNED`/`DROP ROLE` auf möglicherweise zugeordneten Objekten.

Die aktive Compose-Dateiliste inklusive `docker-compose.postgres17.yaml` und den
Volume-Namen **dauerhaft in Betriebs-/Deploymentkonfiguration übernehmen**. Alle
weiteren Starts/Restarts/Updates verwenden sie. Ein normaler alter Make-Aufruf ohne
Overlay würde sonst wieder die auf 14 stehengebliebene Datenbank starten. Erst nach
abgeschlossener Beobachtungs-/Aufbewahrungsfrist separat über das alte Volume
entscheiden; dieser Plan löscht es nicht.

## Rückfall vor neuen Schreibzugriffen

Alle Anwendungsdienste bleiben gestoppt, Ingress bleibt gesperrt. Neues Ziel
stoppen und die Basis mit dem gesicherten **alten** Image verwenden:

```bash
"${cutover[@]}" stop frontend backend backend-export-worker db
rollback=("${base[@]}" -f "$backup_dir/rollback.yaml")
"${rollback[@]}" up -d --no-deps --force-recreate db
```

Altes `$old_volume`, gesichertes Image und Quellversion kontrollieren, dann
`snapshot db rollback.json --compareWith=/migration/before.json`. Erst bei
erfolgreichem Vergleich auf der alten Datenbank `default_transaction_read_only=off`
setzen (derselbe ALTER-DATABASE-Befehl wie oben, ohne ALTER ROLE) und dieselben
Anwendungsimages/Worker wieder starten. Mount/Readiness und fachlichen Smoke-Test
prüfen. Neues 17-Volume und Backups für die Untersuchung behalten.

## Störung nach neuen Schreibzugriffen

Schreiber stoppen, Wartungsseite aktivieren, den aktuellen 17-Bestand und Redis/
Queue-Zustand zusätzlich sichern und beide Volumes erhalten. Bevorzugt auf 17
beheben. Ein einfaches Zurückschalten auf das alte 14-Volume würde alle seit dem
GO-Punkt gespeicherten Antworten, Kodierungen und Jobänderungen verlieren.

Ein verlustfreier Rückweg nach 14 benötigt eine gesondert geprüfte Übernahme der
seitdem entstandenen Änderungen. Ein vollständiger Dump einer neueren Major-Version
ist nicht allgemein als Restore in eine ältere Version zugesichert. Deshalb gibt
es hier **keinen automatischen 17→14-Restore und keine RPO-0-Zusage nach GO**.
Verantwortliche für Betrieb und Fachverfahren entscheiden anhand des gesicherten
Bestands über Reparatur oder einen separat validierten Datentransfer.

## Referenzen

- [PostgreSQL 17: Major-Upgrades](https://www.postgresql.org/docs/17/upgrading.html)
- [pg_dump: unterstützte Server und Restore-Grenzen](https://www.postgresql.org/docs/17/app-pgdump.html)
- [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)
- [PostgreSQL 15: geänderte public-Rechte und weitere Kompatibilitätspunkte](https://www.postgresql.org/docs/15/release-15.html)
