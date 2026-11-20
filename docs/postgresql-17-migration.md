# Bestehende Kodierbox von PostgreSQL 14 auf 17 umstellen

Neuinstallationen verwenden PostgreSQL 17.12. Bei einer bestehenden 14er-Installation
kann das Kodierbox-Update separat erfolgen. Für das Update die aktive
`.env.coding-box` beibehalten und `POSTGRES_IMAGE_SUFFIX` leer oder undefiniert lassen.

Diese Anleitung gilt für die mitgelieferte Produktionsinstallation mit einer
Kodierbox-Datenbank, dem Dienst `db`, dem regulären Administrator aus
`POSTGRES_USER` und einem Docker-Volume. Sie benötigt Bash, Docker Compose,
`jq`, `openssl`, `sha256sum` und Platz für Backup, Zielvolume und temporäre Sortierdateien.
Das installierte Release muss beide DB-Images unter einem festen Release-Tag anbieten.
Bei extern verwalteten Clustern steuert der Datenbankbetrieb das Upgrade und stimmt die
Verbindungen von API, Export-Worker und Liquibase auf dasselbe Ziel ab.
[PostgreSQL-Verfahren für Major-Upgrades](https://www.postgresql.org/docs/17/upgrading.html)

## 1. Vorbereiten, solange die Anwendung läuft

Den Ablauf einschließlich Rückfall zuerst mit einer geschützten Datenkopie proben.
Version, Datenbanken, Tablespaces, Encoding, Locale, Rollen, Erweiterungen und
abweichende Server- und Zugriffsregeln erfassen. Die Beispiele setzen die
Projekt-Defaults für Authentifizierung und Locale, eine separat benannte
Anwendungsdatenbank und einen zuvor schreibbaren Bestand voraus.
Zusätzliche Datenbanken, eigene Tablespaces, TLS, Replikation oder individuelle
HBA-/Serverkonfiguration benötigen einen entsprechend erweiterten Transfer.
Während des Transfers dieselben Anwendungsversionen und dasselbe Liquibase-Schema verwenden.

Alle Blöcke in derselben Bash-Sitzung im Installationsverzeichnis ausführen.
Bei einem Fehler anhalten. Das Verzeichnis unter `backup` enthält vertrauliche
Daten und Rollen-Hashes. Eine zusätzliche, wiederherstellbare Sicherung getrennt vom
Datenbankhost aufbewahren. Den Pfad für einen Rückfall festhalten.

```bash
set -euo pipefail
umask 077
base=(docker compose --env-file .env.coding-box -f docker-compose.coding-box.yaml -f docker-compose.coding-box.prod.yaml)
mkdir -p backup
backup=$(mktemp -d "$PWD/backup/pg-upgrade.XXXXXXXX")
cp -p .env.coding-box "$backup/environment.before"
old=$("${base[@]}" ps -q db)
dbuser=$(docker exec "$old" printenv POSTGRES_USER)
dbname=$(docker exec "$old" printenv POSTGRES_DB)
sql() { docker exec -i "$1" psql -XqAt -v ON_ERROR_STOP=1 -U "$dbuser" -d "$2" "${@:3}"; }
mount_name() { docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$1"; }
oldvol=$(mount_name "$old")
oldid=$(docker inspect -f '{{.Image}}' "$old")
oldref=$("${base[@]}" config --images db)
image17=$(POSTGRES_IMAGE_SUFFIX=-pg17 "${base[@]}" config --images db)
[[ -n $oldvol && $image17 == "${oldref}-pg17" ]]
[[ $(docker image inspect -f '{{.Id}}' "$oldref") == "$oldid" ]]
[[ $dbname != postgres && $dbname != template0 && $dbname != template1 ]]
[[ $(sql "$old" "$dbname" -c 'SHOW server_version') == 14.* ]]
[[ $(sql "$old" "$dbname" -c 'SHOW default_transaction_read_only') == off ]]
[[ $(sql "$old" postgres -c "SELECT count(*) FROM pg_roles WHERE rolname='pg17_restore'") == 0 ]]
docker image save "$oldref" > "$backup/image14.tar"
docker pull "$image17"
docker run --rm --entrypoint postgres "$image17" --version
```

Die letzte Ausgabe muss zum vorgesehenen 17er-Release passen. Den Image-Tag im
Wartungsfenster beibehalten. Die neue Instanz erhält ein eigenes leeres Volume
und ist zunächst nur per `docker exec` erreichbar.

```bash
newvol=$(docker volume create)
[[ -n $newvol && $newvol != "$oldvol" ]]
stage=$(POSTGRES_PASSWORD=$(openssl rand -hex 32) docker run -d --network none --no-healthcheck \
  --shm-size "$(docker inspect -f '{{.HostConfig.ShmSize}}' "$old")" \
  -e POSTGRES_PASSWORD -e POSTGRES_USER=pg17_restore -e POSTGRES_DB=postgres \
  -v "$newvol:/var/lib/postgresql/data" "$image17")
for i in {1..60}; do
  if docker exec "$stage" psql -XAtqh 127.0.0.1 -U pg17_restore -d postgres -c 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$stage" psql -XAtqh 127.0.0.1 -U pg17_restore -d postgres -c 'SELECT 1'
printf 'Backup %s\nQuelle %s %s\nZiel %s %s\n' "$backup" "$oldref" "$oldvol" "$image17" "$newvol"
```

## 2. Schreiber anhalten und sichern

Wartungszugang sperren, laufende Jobs abschließen lassen und externe SQL-Clients,
Importer, weitere Worker sowie zeitgesteuerte Zugriffe für das gesamte Fenster
anhalten. Die Sitzungsprüfung zeigt nur einen Zeitpunkt. Die Zugangssperre muss
bis zur Freigabe bestehen bleiben. Die folgenden Befehle verwenden die
17er-Clientwerkzeuge am Quellserver. Dadurch werden auch die ursprünglichen
Eigentümer und Rechte des Schemas `public` beim Restore übertragen.

```bash
for service in backend backend-export-worker frontend; do
  "${base[@]}" ps --status running -q "$service"
done > "$backup/app-containers"
"${base[@]}" stop frontend backend backend-export-worker
[[ $(sql "$old" postgres -v db="$dbname" <<'SQL'
SELECT count(*) FROM pg_stat_activity WHERE datname=:'db' AND backend_type='client backend';
SQL
) == 0 ]]
dump14() {
  PGPASSWORD=$(docker exec "$old" printenv POSTGRES_PASSWORD) docker run --rm \
    --network "container:$old" -e PGPASSWORD --entrypoint "$1" "$image17" \
    -h 127.0.0.1 -U "$dbuser" "${@:2}"
}
dump14 pg_dumpall --database=postgres --roles-only > "$backup/roles.sql"
dump14 pg_dump --format=custom --create --dbname="$dbname" > "$backup/database.dump"
(cd "$backup" && sha256sum roles.sql database.dump image14.tar > SHA256SUMS)
```

Vor dem Vergleich müssen alle Schreiber weiterhin angehalten sein. Die folgende
Prüfsumme berücksichtigt Namen und Inhalte aller normalen Tabellen in `public`,
Duplikate sowie Sequenzstände. Es werden nur Hashwerte gespeichert. Die Sortierung
kann bei großen Tabellen Zeit und temporären Plattenplatz beanspruchen.

```bash
bestand() {
  sql "$1" "$dbname" <<'SQL' | sha256sum
SET timezone='UTC';
SET datestyle='ISO, YMD';
SET extra_float_digits=3;
SELECT format('SELECT %L', 'table '||tablename),
       format('COPY (SELECT to_jsonb(t)::text FROM public.%I t ORDER BY (to_jsonb(t)::text) COLLATE "C") TO STDOUT', tablename)
FROM pg_tables WHERE schemaname='public' ORDER BY tablename COLLATE "C"
\gexec
SELECT format('SELECT %L, last_value, is_called FROM public.%I', sequencename, sequencename)
FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename COLLATE "C"
\gexec
SQL
}
zugriff() {
  sql "$1" "$dbname" <<'SQL'
SELECT datname, pg_get_userbyid(datdba), pg_encoding_to_char(encoding), datcollate, datctype
FROM pg_database WHERE datname=current_database();
SELECT nspname, pg_get_userbyid(nspowner), acl::text FROM pg_namespace
LEFT JOIN LATERAL unnest(nspacl) acl ON true WHERE nspname='public' ORDER BY acl::text COLLATE "C";
SELECT extname FROM pg_extension ORDER BY extname COLLATE "C";
SELECT count(*) FROM databasechangelog;
SQL
}
zugriff "$old" > "$backup/access.before"
bestand "$old" > "$backup/before.sha256"
declare -p base backup dbuser dbname oldvol oldid oldref > "$backup/rollback-context.bash"
declare -f sql mount_name bestand >> "$backup/rollback-context.bash"
"${base[@]}" stop db
```

## 3. Wiederherstellen und vergleichen

```bash
(cd "$backup" && sha256sum -c SHA256SUMS)
docker exec -i "$stage" psql -Xq -v ON_ERROR_STOP=1 -U pg17_restore -d postgres < "$backup/roles.sql"
docker exec -i "$stage" pg_restore --exit-on-error --create -U pg17_restore -d postgres < "$backup/database.dump"
sql "$stage" "$dbname" -c 'ANALYZE'
sql "$stage" postgres -v db="$dbname" <<'SQL'
ALTER DATABASE :"db" SET default_transaction_read_only=on;
ALTER ROLE pg17_restore NOLOGIN;
SQL
zugriff "$stage" > "$backup/access.restored"
diff -u "$backup/access.before" "$backup/access.restored"
bestand "$stage" > "$backup/restored.sha256"
cmp "$backup/before.sha256" "$backup/restored.sha256"
sql "$stage" "$dbname" -c 'SELECT count(*) FROM pg_index WHERE NOT indisvalid'
sql "$stage" "$dbname" -c 'SELECT count(*) FROM databasechangelog'
```

Nur bei identischen Prüfsummen fortfahren. Die Anzahl ungültiger Indizes soll
null sein. Die Liquibase-Historie, Locale, Erweiterungen, Rollen, Owner und
Berechtigungen mit dem Ausgangsbestand abgleichen. Individuelle Einstellungen
auf dem Ziel übernehmen und den Zugriff mit dem Anwendungskonto prüfen.

## 4. Umschalten und vor der Schreibfreigabe prüfen

Den separaten Zielcontainer stoppen. In der **aktiven** `.env.coding-box` die drei
Werte zusammen setzen, vorhandene Einträge ersetzen. `POSTGRES_IMAGE_SUFFIX=-pg17`,
`POSTGRES_DATA_VOLUME` gleich dem oben ausgegebenen Zielvolumenamen und
`POSTGRES_DATA_VOLUME_EXTERNAL=true`. Der Release-Tag bleibt gleich.

```bash
docker stop "$stage"
[[ $(docker inspect -f '{{.State.Running}}' "$stage") == false ]]
[[ $("${base[@]}" config --images db) == "$image17" ]]
"${base[@]}" config --format json > "$backup/compose17.json"
```

Vor dem Start müssen der aufgelöste Volumename und die externe Volume-Verwaltung
mit dem geprüften Ziel übereinstimmen. Dann den regulären Datenbankdienst starten.

```bash
jq -e --arg vol "$newvol" '.volumes.db_vol | .name == $vol and .external == true' "$backup/compose17.json"
"${base[@]}" up -d --no-deps --wait db
target=$("${base[@]}" ps -q db)
[[ $(mount_name "$target") == "$newvol" ]]
[[ $(sql "$target" "$dbname" -c 'SHOW server_version') == 17.* ]]
[[ $(sql "$target" "$dbname" -c 'SHOW default_transaction_read_only') == on ]]
bestand "$target" > "$backup/cutover.sha256"
cmp "$backup/before.sha256" "$backup/cutover.sha256"
```

**Jetzt zwischen Freigabe und Rückfall entscheiden.** Für die Freigabe auf 17 den
Schreibschutz aufheben und die zuvor gestoppten Dienste wieder starten.

```bash
sql "$target" postgres -v db="$dbname" <<'SQL'
ALTER DATABASE :"db" RESET default_transaction_read_only;
SQL
[[ $(sql "$target" "$dbname" -c 'SHOW default_transaction_read_only') == off ]]
while IFS= read -r container; do docker start "$container"; done < "$backup/app-containers"
```

Anmeldung, Replay, Kodierung mit Speichern und Export prüfen und den Wartungszugang
öffnen. Auch Hintergrundjobs können direkt beim Start schreiben. Das alte Volume und
die Sicherung für die vereinbarte Aufbewahrungsfrist behalten. Die drei Werte in der
aktiven Umgebung gelten auch für spätere Anwendungsupdates. Der gestoppte
Transfercontainer kann nach erfolgreicher Prüfung mit `docker rm "$stage"` entfernt werden.

## Rückfall vor der Schreibfreigabe

Bei abgebrochenem Transfer oder fehlgeschlagenem Vergleich bleiben die Anwendungen
gestoppt. Vor der Schreibfreigabe kann der reguläre Dienst wieder das ursprüngliche
Image und Volume verwenden. Falls die Shell beendet wurde, im selben Installationsverzeichnis
die eigene, unter Schritt 2 gesicherte Datei mit `source /pfad/zum/backup/rollback-context.bash`
laden und `set -euo pipefail` aktivieren. Bei einem früheren Abbruch lief der Dienst
noch auf der alten Quelle. Dann die Ursache klären, Quellversion und Volume prüfen und
die zuvor laufenden Container anhand von `app-containers` wieder starten. Das gesicherte Image bei Bedarf mit
`docker image load -i "$backup/image14.tar"` wiederherstellen.

```bash
"${base[@]}" stop db
cp -p "$backup/environment.before" .env.coding-box
[[ $("${base[@]}" config --images db) == "$oldref" ]]
[[ $(docker image inspect -f '{{.Id}}' "$oldref") == "$oldid" ]]
"${base[@]}" up -d --no-deps --wait db
restored=$("${base[@]}" ps -q db)
[[ $(mount_name "$restored") == "$oldvol" ]]
[[ $(sql "$restored" "$dbname" -c 'SHOW server_version') == 14.* ]]
bestand "$restored" > "$backup/rollback.sha256"
cmp "$backup/before.sha256" "$backup/rollback.sha256"
while IFS= read -r container; do docker start "$container"; done < "$backup/app-containers"
```

Nach der Schreibfreigabe auf 17 würde eine Rückkehr zum alten Volume zwischenzeitlich
gespeicherte Kodierungen und Jobänderungen verlieren. Bei einer Störung die Schreiber
anhalten, den aktuellen 17er-Bestand sichern und auf diesem Bestand weiterarbeiten.
