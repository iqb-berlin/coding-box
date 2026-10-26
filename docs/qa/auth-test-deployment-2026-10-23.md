# Aktualisierung der Auth-Testinstanz am 23.10.2026

## Ergebnis und Herkunft

`https://kodierbox-test.iqb.hu-berlin.de` wurde um **11:41 MESZ** auf den Quellstand `474dd5125f9962e4b4d8b60b3f23c0f5637bda9d` aktualisiert. Git-Baum: `da3d8be60121640cd7fd7221fc8457cf36ea38bb`, Paketversion **1.17.5**. Die Startseite zeigt weiterhin **1.17.4**, da `apps/frontend/src/app/components/home/home.component.html` diese Zeichenfolge im geprüften Quellstand fest enthält. Im angemeldeten Chrome wurde das neue Hauptskript `main-Z2UXTY2E.js` bestätigt.

Die Registry-Anmeldung war ungültig. Statt der ursprünglichen CI-Images wurden deshalb aus dem exakten Git-Archiv neue Images auf dem Testserver gebaut. Sie sind **keine identischen CI-Binärartefakte**. Backend- und Frontend-Produktionsbuild waren getrennt erfolgreich, mit Node 22.23.4 und npm 11.18.0. Die Runtime-Dockerfiles stammen unverändert aus dem geprüften Commit. Die grüne Merge-Pipeline 105032 belegt den Quellstand; die folgenden Prüfungen belegen die tatsächlich neu gebauten Images.

| Komponente | Referenz | Lokale Image-ID |
| --- | --- | --- |
| backend | `local/coding-box-backend:auth-474dd5125f99-20261023` | `sha256:c7b60cb989ab21feda13fd8b102d25a57e9de43f2b722864b4f3bfa90ae431a3` |
| frontend | `local/coding-box-frontend:auth-474dd5125f99-20261023` | `sha256:2d18250da5b1a8d49a8eea4d0de215dd1df67c55185e896a07a8db948b07ac9b` |
| liquibase | `local/coding-box-liquibase:auth-474dd5125f99-20261023` | `sha256:b8b07d95927a962b2477418b9a6f2875903bf94a88e4b3ba28cb67aff10c8900` |

API und Export-Worker verwenden dasselbe Backend-Image. Die Datenbank bleibt auf `iqbberlin/coding-box-db:1.17.4` / PostgreSQL 14.23. Datenbank, Redis, lokales Keycloak samt Datenbank, Traefik, Grafana und Prometheus wurden durch dieses Anwendungsupdate nicht neu erstellt oder neu gestartet.

## Neue Sicherung

Ziel auf dem Testserver: `/home/user/kodierbox-backups/20261023-before-auth-update-474dd512`, Verzeichnisrechte 0700, sensible Dateien 0600.

Gesamtumfang: **8.198.812.531 Bytes / rund 7,64 GiB**. Enthalten sind die vollständige Kodierbox-Datenbank im PostgreSQL-Custom-Format, globale DB-Rollen, lokale Keycloak-Datenbank und Rollen, Backend-Assets, Exportverzeichnis, frischer Redis-RDB-Abzug sowie die bisherigen Compose-/Umgebungs-/Bind-Konfigurationen. Der Haupt-Dump umfasst 8.023.605.887 Bytes. `SHA256SUMS` enthält 32 Einträge.

API und Export-Worker waren für die konsistente Sicherung zwischen 10:52:56 und 11:15:29 MESZ angehalten. Die alten Anwendungsdienste liefen danach wieder, bis das Update begann. Beide Datenbankarchive wurden vollständig mit `pg_restore --file=/dev/null` gelesen und dekomprimiert; TAR-Mitglieder und GZIP-Prüfsummen wurden vollständig gelesen. Schema und gesamte Migrationshistorie wurden aus der Sicherung in eine isolierte Datenbank zurückgespielt; beide neuen Migrationen bestanden dort nach erfolgreicher Checksum-Validierung. **Ein vollständiger isolierter Restore sämtlicher Nutzdaten wurde nicht durchgeführt.** Die Sicherung liegt auf demselben Server, nicht extern.

Alle **853 zuvor vorhandenen Sicherungsdateien** sind nach Pfad, Größe und Änderungszeit unverändert. Bestehende Sicherungen und alte Images wurden nicht gelöscht. Nach dem Update waren rund **15,81 GiB frei**.

## Migration und Datenbestand

Liquibase `validate`, `status` und der SQL-Plan wurden vorab gegen die echte Testdatenbank geprüft. Ausschließlich zwei additive Changesets wurden angewandt:

- `iqb:833-resource-ownership`: vier optionale Eigentümer-Spalten samt Indizes.
- `iqb:testcenter-durable-import-runs`: neue Import-Lauftabelle.

Die Historie stieg von **161 auf 163 Changesets**. Der geprüfte Plan enthält kein DROP, TRUNCATE oder DELETE. Unmittelbar vor und nach den Migrationen waren die gezählten Bestände identisch:

| Tabelle | Zeilen |
| --- | ---: |
| response | 7.629.117 |
| unit | 677.796 |
| coding_job | 1.073 |
| job_definitions | 30 |
| user | 48 |
| variable_bundle | 52 |
| workspace | 21 |

## Auth-Konfiguration und Betrieb

Der tatsächliche Provider ist der externe, gemeinsam genutzte Realm `https://keycloak.kodierbox.iqb.hu-berlin.de/realms/coding-box`. Der verwendete Client `coding-box` ist öffentlich. Der tatsächliche Login akzeptiert den Callback `https://kodierbox-test.iqb.hu-berlin.de/api/auth/callback` und verwendet PKCE S256. Die neuen OIDC-Endpunkte wurden nur für die Testanwendung gesetzt. Das vorhandene JWT-Secret, DB-/Redis-Verbindungen, Daten-Mounts und Routing blieben erhalten. Die Provider-Konfiguration wurde nicht geändert. Die lokale Keycloak-Sicherung sichert **nicht** den externen Provider.

Das vollständige Compose-Setup mit allen bisherigen Overrides und dem neuen `auth.override.json` ist über folgenden privaten Operator-Aufruf verfügbar:

```sh
/home/user/kodierbox-deploy/auth-update-474dd512-20261023/compose.sh ps
```

Für spätere Operationen diesen Wrapper verwenden: Ein Aufruf nur mit den ursprünglichen Root-Compose-Dateien lässt auch die bisherigen historischen Overrides aus und könnte auf alte Images zurückwechseln. Die Root-Dateien wurden für dieses Anwendungsupdate nicht editiert. Die genaue Argumentliste liegt daneben in `compose-command.json`; geheime Werte gehören nicht ins Repository.

Zur Rücknahme der Anwendung stehen die vorherigen Images und die gesicherte Konfiguration bereit. Aus der vollständigen Compose-Argumentliste wird ausschließlich das letzte `-f auth.override.json` entfernt; anschließend können Backend, Export-Worker und Frontend gezielt mit `up --detach --no-deps --force-recreate --pull never` gestartet werden. Die additiven DB-Erweiterungen bleiben dabei bestehen. Eine Datenbankrücknahme ist ein eigener Vorgang und wurde nicht ausgeführt.

## Technische Prüfung der laufenden Instanz

Prüfung um **11:42:41 MESZ**:

- Frontend HTTP 200; ausgeliefertes `main-Z2UXTY2E.js` und deutsche Sprachdatei stimmen bytegenau mit dem neuen Build überein.
- API-Health und Redis-Health HTTP 200 / gesund.
- Nicht angemeldetes `/api/auth-data`: HTTP 401 mit korrelierter Anfrage-ID.
- Synthetisch ungültiger Refresh gegen den echten Provider: HTTP 401, `session-invalid`. Anfrage-ID `deployment-auth-20261023` stimmt in HTTP und tatsächlichem Backend-Log beim Ereignis `oidc-refresh-failed` überein.
- Login-Initiierung: HTTP 302, tatsächliche Provider-Loginseite HTTP 200, richtiger Client und Callback, PKCE S256.
- Synthetisches JWT mit unbekanntem Schlüssel am echten JWKS-Pfad: HTTP 401 statt Konfigurations-503.
- API, Export-Worker und Frontend laufen mit den dokumentierten Image-IDs; jeweils RestartCount 0.

Diese Prüfungen sind **keine vollständige fachliche Abnahme F01–F07**. Angemeldete Kodierung, Entwurfswiederherstellung, Fehler-Recovery und Benutzerwechsel werden separat im [Abnahmeprotokoll](auth-acceptance-2026-10-23.md) dokumentiert. #566 und #1018 bleiben offen. Zum Abschluss dieser Betriebsprüfung waren keine Ticketänderung und kein Kommentar erfolgt; die spätere PR-Vorlage wird im Abnahmeprotokoll dokumentiert.
