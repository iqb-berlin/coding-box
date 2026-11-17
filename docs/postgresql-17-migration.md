# PostgreSQL 14 → 17.12: Migration und Rückfall

**PostgreSQL 17.12 ist der verbindliche Standard** für die Anwendungsdatenbank:
regulärer Docker-Build, CI sowie Replay-/Codebook-Testumgebungen verwenden 17.12.
Ein Versions-Overlay ist nicht erforderlich. Pool-Timeout, Slow-Query-Logging und
Anwendungsfunktionen behalten ihre bisherigen Defaults.
Die lokalen Testergebnisse stehen in [der Validierung](qa/postgresql-17.12-validation.md).

Normales Starten konvertiert bestehende Daten nicht. Ohne `POSTGRES_DATA_VOLUME`
bleibt das bisherige `<Compose-Projekt>_db_vol` ausgewählt. Enthält es Daten von 14,
verweigert PostgreSQL 17 den Start; es wird kein leerer Ersatzbestand ausgewählt.
Erst der folgende geprüfte Transfer und die dauerhafte Auswahl des Zielvolumes
schalten den Bestand um. Normale `make ...-up`-/Update-Befehle vorher nicht ausführen.
Die separate Keycloak-Datenbank ist nicht Teil dieses Anwendungsdatenbank-Umstiegs.

## Automatisierter Umstieg mit Make (empfohlener Weg)

Im Installationsverzeichnis, **während die bisherige 14er Datenbank und das Backend
noch gesund laufen**:

```bash
make coding-box-postgres17-migrate
make coding-box-postgres17-status
```

Voraussetzungen: Linux, Python **3.9 oder neuer**, Make, Docker mit Compose v2 und
Zugriff auf denselben Docker-Daemon wie die Installation. Lokales Node/npm ist
nicht erforderlich; der Vergleich läuft mit `pg` im bestehenden Backendimage.
Die aktualisierten Produktions-Compose-Dateien und `.env.coding-box` müssen das
gewählte Release mit seinem 17.12-DB-Image benennen. Installer und Updater liefern
Make-Datei, Python-Programm und Vergleichsskript mit. Erkennt der Updater eine noch
laufende 14er Quelle, lässt er sie laufen und verweist auf diesen Befehl.
Bei privater Registry bei Bedarf vorher mit `docker login` anmelden.

Der Befehl:

1. Prüft Quelle, Administratorzugang, Objektumfang, Images und Backup-Speicherplatz.
   Er hält die tatsächlich laufenden Images, Umgebungen und Startbefehle fest.
2. Sichert das alte DB-Image, die Konfiguration und Authentifizierungsdateien;
   initialisiert ein **neues** Volume mit 17.12 und übernimmt Quelleinstellungen.
3. Stoppt API, Export-Worker und Frontend für die Schreibpause. Eine temporäre
   `pg_hba.conf` lässt Zugriffe auf die Anwendungsdatenbank nur aus dem privaten
   Migrationsnetz zu. Verbleibende externe Sitzungen führen zum Abbruch.
4. Erstellt Rollenbackup und vollständigen Custom-Dump mit den 17.12-Werkzeugen,
   Prüfsummen und einen konsistenten Ausgangsbericht. Antwortwerte stehen nur im
   geschützten Dump, im Bericht lediglich Zeilenzahlen und SHA-256-Hashes.
5. Stellt ins neue Volume wieder her, vergleicht alle `public`-Tabellen vollständig,
   inklusive Spalten, Enum-Typen, Constraints, Indizes, Sequenzständen, Ownern,
   Rechten und Datenbank-Locale. Führt `ANALYZE` aus.
6. Setzt die Volume-Auswahl in `.env.coding-box` dauerhaft und atomar, startet den
   regulären DB-Dienst auf 17.12 und vergleicht erneut. Erst danach öffnet er die
   Schreibfreigabe und startet die zuvor laufenden Anwendungsdienste mit deren
   bisherigen Images. Backend-Readiness und die Verbindung des Workers werden geprüft.

Das ist ein **Datenbankwechsel**. Er startet weder Liquibase noch neue
Anwendungsimages. Die zum laufenden Backend passende Schemafassung bleibt erhalten.
Ein gewünschtes Anwendungs-/Schema-Update anschließend separat durchführen.
Timeouts, Slow-Query-Logging und fachliche Funktionen werden nicht umgestellt.

### Status, kontrollierte Freigabe und Rückfall

Für eine getrennte Prüfung vor der Schreibfreigabe:

```bash
make coding-box-postgres17-migrate PG17_PREPARE_ONLY=1
make coding-box-postgres17-status
# Nach Prüfung genau einen dieser beiden Befehle ausführen:
make coding-box-postgres17-finish
make coding-box-postgres17-rollback
```

`PREPARE_ONLY=1` lässt die Anwendung gestoppt und die verifizierte 17er Datenbank
schreibgeschützt. `finish` prüft Backup-Prüfsummen und Datenbestand erneut.
Ein Fehler **vor** der Schreibfreigabe führt automatisch zur alten 14er Quelle
zurück; deren Identität und, sofern vollständig und dauerhaft gespeichert, Ausgangsbericht werden geprüft,
die ursprüngliche Konfiguration wiederhergestellt und die Anwendung gestartet.
Ein wiederholter Rückfallbefehl nach erfolgreichem Rückfall verändert nichts.
Nach einem Rückfall läuft der alte Bestand mit seinem festgehaltenen Image.
Das konfigurierte neue Release bleibt ein 17er Release: Ein normales
`make coding-box-up` würde erneut 17 starten wollen. Bis zum erneuten Transfer
für einen DB-Neustart die gesicherte Konfiguration verwenden (Pfad aus `status`):

```bash
docker compose -f /pfad/zum/lauf/compose-source.json up -d --no-deps --no-build db
```

Diese Datei ist bereits für Compose maskiert; `source.json` ist das interne,
unmaskierte Journal. Anwendungscontainer im Rückfallbetrieb mit `docker start`
und ihren IDs aus `state.json` starten; kein separates Anwendungsupdate einmischen.

**Ab der Schreibfreigabe ist der Rückfall auf 14 gesperrt.** Der Freigabemarker wird
dauerhaft geschrieben, bevor der Zugriff geöffnet wird. Auch bei anschließendem
Fehler oder Prozessabbruch darf der möglicherweise neuere 17er Bestand nicht durch
die ältere Quelle ersetzt werden. Bei einem erkannten Startfehler stoppt der Befehl
die Anwendung, schaltet 17 wieder schreibgeschützt und versucht einen zusätzlichen
`recovery17-*.dump`. Status `needs_attention`: Ursache auf 17 beheben, neuen Bestand
sichern und Anwendung kontrolliert wieder freigeben; keine 14er Rückschaltung.

Nach Stromausfall/SIGKILL zuerst `status` aufrufen. Ohne Schreibfreigabe kann
`rollback` anhand des Journals fortsetzen. Mit Schreibfreigabe Dienste gestoppt
halten und auf 17 weiterarbeiten. Ein physischer Wechsel zurück auf 14 nach neuen
Schreibzugriffen erfordert einen gesondert getesteten Rücktransfer dieser Änderungen.

Backups und Journal liegen standardmäßig unter
`backup/postgres17/<Zeitstempel>-<Zufall>/`, Verzeichnisrechte `0700`, Dateien `0600`.
Sie enthalten Zugangsdaten und Rollenpassworthashes und gehören auf einen geschützten
Backup-Datenträger. `latest.json` verweist auf den letzten Lauf. **Kein** Befehl
löscht das alte oder neue Datenvolume oder die Backups; deren Aufbewahrung und
eine zusätzliche Kopie auf einem unabhängigen Datenträger bleiben Betreiberaufgabe.

Optionen (bei Folgeaufrufen denselben Lauf angeben):

```bash
make coding-box-postgres17-migrate PG17_MIGRATION_DIR=/sicherer/datentraeger/pg17-lauf
make coding-box-postgres17-status PG17_MIGRATION_DIR=/sicherer/datentraeger/pg17-lauf
make coding-box-postgres17-rollback PG17_MIGRATION_DIR=/sicherer/datentraeger/pg17-lauf
```

Das neue Laufverzeichnis darf noch nicht existieren. `PG17_WAIT_SECONDS` steuert
die Bereitschaftswartezeit pro Dienst (Standard 180 Sekunden),
`MIGRATION_SNAPSHOT_TIMEOUT_MS` den SQL-Timeout des Vollvergleichs (Standard 900000).
Ein Dateilock verhindert gleichzeitige Migration/Rückfall derselben Installation.
Konfigurationsänderungen während des Transfers führen zum Abbruch statt zum
Überschreiben fremder Änderungen. Wechsel des Docker-Daemons wird zurückgewiesen.

Automatisch unterstützt wird die reguläre Produktionsstruktur mit einer eigenen
Anwendungsdatenbank auf einem benannten Standard-Datenvolume. Weitere Datenbanken,
Benutzerschemas, Views, Funktionen, Trigger, RLS, Large Objects, Replikation,
zusätzliche Extensions, TLS und besondere Tablespaces führen **vor der Schreibpause**
zum Abbruch. Für diese Installationen ist der untenstehende manuelle Ablauf
anzupassen und um deren Prüfungen zu ergänzen. Generalprobe mit einer Kopie der
echten Daten sowie ein ausreichend großes Wartungsfenster bleiben erforderlich.

### Reproduktion der Automatisierungstests

Der Nx-Target `backend:test-postgres17-migration` benötigt vier ausdrücklich
gesetzte Testimages: `PG17_TEST_BACKEND_IMAGE`, `PG17_TEST_POSTGRES14_IMAGE`,
`PG17_TEST_POSTGRES17_IMAGE` und `PG17_TEST_LIQUIBASE_IMAGE`. Die DB-Images müssen
14.24 bzw. 17.12 enthalten, Liquibase den aktuellen Changelog. Es werden ausschließlich
eigene Compose-Projekte mit synthetischen Daten angelegt. API/Worker werden für die
Orchestrierungsprüfung durch kleine DB-Clients im Backendimage simuliert; die
Anwendungstests laufen separat über `backend:test-integration`.
`PG17_TEST_DIRECTORY` kann ein vorhandenes, für den Docker-Daemon freigegebenes
Hostverzeichnis vorgeben (Docker Desktop bzw. gemeinsames `/builds` bei DinD).
`backend:test-migration-tools` prüft Vergleich, Journal, Freigabegrenze und Make-/Update-Anbindung.

## Verfahren und Grenzen

Wir verwenden einen logischen Volltransfer mit **pg_dump/pg_dumpall 17.12** und
**pg_restore 17.12**, einem neuen Volume und einer Schreibpause. Die Werkzeuge von
17 können die Quelle auf 14 lesen. Wichtig: pg_dump 14 lässt die damaligen
Standardrechte/Eigentümer des Schemas `public` im Dump aus. Ein Restore auf 17
übernimmt dann dessen andere Defaults. Der getestete Ablauf mit pg_dump 17
erhält die alten Rechte ausdrücklich; der Vergleich prüft sie zusätzlich.

Für den manuellen Alternativweg zuerst wie unten beschrieben das tatsächlich laufende 14-Image und Volume sichern.
Die Anwendung einschließlich Liquibase-Schema mit diesem festgehaltenen 14-Image
über die `legacy`-Konfiguration aktualisieren und stabil betreiben. Erst danach mit
**denselben Anwendungsimages und demselben Schema** die Datenbank wechseln.
Schemaänderungen, Berechtigungsbereinigungen,
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
im Installationsverzeichnis mit vollständigem Quellbaum und Images des gewählten
Releases. Bei einer minimalen Release-Installation zuerst auch Dockerfile,
Vorbereitungs-Compose-Datei und Snapshot-Skript desselben Releases bereitstellen.
Für andere Setups Dateiliste/Netzwerk/Dienstnamen
vorher anpassen. Bei jedem fehlgeschlagenen Schritt anhalten und Schreiber
gestoppt lassen. Kein `down -v`, kein `--clean`, kein Volume-Prune verwenden.

```bash
set -euo pipefail
umask 077
base=(docker compose --env-file "$PWD/.env.coding-box"
  -f "$PWD/docker-compose.coding-box.yaml"
  -f "$PWD/docker-compose.coding-box.prod.yaml")
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
volumes:
  db_vol:
    name: "$old_volume"
    external: true
EOF
legacy=("${base[@]}" -f "$backup_dir/rollback.yaml")
stage=("${legacy[@]}" -f "$PWD/docker-compose.postgres17.prepare.yaml")
"${stage[@]}" config --format json > "$backup_dir/compose-stage.json"
```

`legacy` hält Image **und Volume** der Quelle fest, auch wenn anschließend
`POSTGRES_DATA_VOLUME` auf das neue Ziel zeigt. Für die erste Schema-/Anwendungs-
Aktualisierung auf 14 ausschließlich `legacy` verwenden: neues Liquibase- und
Anwendungsimage zum gewünschten Release bereitstellen, mit
`"${legacy[@]}" run --rm liquibase` das Schema aktualisieren und die Anwendungsdienste
mit `"${legacy[@]}" up -d --no-deps backend backend-export-worker frontend` starten. Readiness/fachlich prüfen
und stabilisieren. Die neue reguläre DB-Image-Version 17.12 noch nicht starten.

In `compose-stage.json` den aufgelösten Namen von `volumes.db17_vol.name` prüfen:
anders als `$old_volume` und **noch nicht vorhanden** (`docker volume inspect NAME`
muss vor dem ersten Start fehlschlagen). Abbruch bei bereits vorhandenem Ziel;
keinen alten Testbestand als finalen Bestand weiterverwenden. Private Configdateien
enthalten Zugangsdaten und bleiben außerhalb von Git. Off-host-Backup einplanen.
Das frische Zielvolume nach dieser Prüfung mit `docker volume create NAME`
ausdrücklich anlegen. Der Vorbereitungsdienst nutzt es als externes Volume; dadurch
gehört es nicht zum automatischen Lebenszyklus eines temporären Compose-Dienstes.

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
"${legacy[@]}" stop frontend backend backend-export-worker
source_user=$("${legacy[@]}" exec -T db printenv POSTGRES_USER)
source_db=$("${legacy[@]}" exec -T db printenv POSTGRES_DB)
"${legacy[@]}" exec -T db sh -ec '
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

Den tatsächlichen Namen des restaurierten Zielvolumes aus dem `db17`-Mount
ablesen. In `.env.coding-box` **`POSTGRES_DATA_VOLUME` dauerhaft auf genau diesen
Namen setzen**, also auf den Wert von `POSTGRES17_VOLUME_NAME`. Außerdem die
Variable **`POSTGRES_DATA_VOLUME_EXTERNAL=true`** setzen. Damit muss der restaurierte
Bestand bereits existieren; ein Tippfehler erzeugt keine leere Ersatzdatenbank.
Die normale Konfiguration mit `"${base[@]}" config --format json` prüfen: `volumes.db_vol.name`
muss dieses restaurierte Volume sein. Die Quelldaten bleiben durch den expliziten
Volume-Eintrag in `rollback.yaml` unabhängig von dieser Änderung erreichbar.

Das reguläre DB-Image des neuen Releases muss verfügbar sein und tatsächlich
17.12 enthalten. Dies vor dem Wechsel ohne Datenbankstart kontrollieren:

```bash
"${base[@]}" pull db
"${base[@]}" run --rm --no-deps -T --entrypoint postgres db --version
```

Bei einer anderen Version abbrechen. Danach den alten Dienst `db` ausschließlich
mit dem neuen Standardimage und dem ausgewählten Zielvolume neu erzeugen:

```bash
"${stage[@]}" stop db17
test -z "$("${stage[@]}" ps --status running -q db17)"
"${base[@]}" up -d --no-deps --force-recreate db
"${base[@]}" exec -T db sh -ec '
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
"${base[@]}" exec -T db sh -ec '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec psql -X -v ON_ERROR_STOP=1 -v dbname="$POSTGRES_DB" -U "$POSTGRES_USER" -d postgres
' <<'SQL'
ALTER DATABASE :"dbname" SET default_transaction_read_only=off;
ALTER ROLE pg17_migration_admin NOLOGIN;
SQL
"${base[@]}" up -d --no-deps backend backend-export-worker frontend
```

Nach dem Start Readiness/Anmeldung, Replay, eine kontrollierte Kodierspeicherung
und Export prüfen; Fehlerquote, Queue-Fortschritt, Verbindungen und Abfragelaufzeiten
beobachten. Beim Start können Worker/Cronjobs bereits schreiben: Nicht erst die
erste manuelle Kodierung definiert diese Grenze. Bootstrap-Rolle bleibt `NOLOGIN`,
kein ungeprüftes `DROP OWNED`/`DROP ROLE` auf möglicherweise zugeordneten Objekten.

`POSTGRES_DATA_VOLUME` und `POSTGRES_DATA_VOLUME_EXTERNAL=true` bleiben dauerhaft
in der privaten Umgebungskonfiguration.
Normale Make-/Compose-Aufrufe verwenden danach 17.12 und dieses Volume, ohne
zusätzliche Versionsdatei. Den Wert nicht wieder leeren. Erst nach
abgeschlossener Beobachtungs-/Aufbewahrungsfrist separat über das alte Volume
entscheiden; dieser Plan löscht es nicht.

## Rückfall vor neuen Schreibzugriffen

Alle Anwendungsdienste bleiben gestoppt, Ingress bleibt gesperrt. Neues Ziel
stoppen und die Basis mit dem gesicherten **alten** Image verwenden:

```bash
"${base[@]}" stop frontend backend backend-export-worker db
rollback=("${base[@]}" -f "$backup_dir/rollback.yaml")
"${rollback[@]}" up -d --no-deps --force-recreate db
```

Altes `$old_volume`, gesichertes Image und Quellversion kontrollieren, dann
`snapshot db rollback.json --compareWith=/migration/before.json`. Erst bei
erfolgreichem Vergleich auf der alten Datenbank `default_transaction_read_only=off`
setzen (derselbe ALTER-DATABASE-Befehl wie oben, ohne ALTER ROLE) und dieselben
Anwendungsimages/Worker wieder starten. Mount/Readiness und fachlichen Smoke-Test
prüfen. Neues 17-Volume und Backups für die Untersuchung behalten.
Bis zur erneuten Migration im Rückfallbetrieb ausschließlich `rollback`/`legacy`
einschließlich des gesicherten 14-Images verwenden; der reguläre Standard bleibt 17.

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
