# Bestehende Auth-Konfiguration aktualisieren und zurücknehmen

Bezug: #565, Grundlage für #571. Die fachliche Abnahme erfolgt separat.

## Unterstützter Umfang

`scripts/migration/2.0.0.sh` migriert die lokale, vom Betreiber kontrollierte
`.env.coding-box`. Sie importiert keinen Realm, lädt keine Dateien herunter,
ändert keine Client-Geheimnisse und startet keine Dienste. Die Migration
ist kein Keycloak-Versionsupgrade und keine Datenbankschema-Rückmigration.
Der vorhandene Realm und seine Nutzer, Rollen, Sitzungen und Client-Einstellungen
bleiben Eigentum des Betreibers.

Eine vollständige OIDC-Konfiguration wird unverändert erhalten, einschließlich
abweichender öffentlicher Issuer, interner Token-/JWKS-Adressen, Client-ID,
Client-Geheimnis und Callback mit eigenem Pfadpräfix. Auch andere Einstellungen
wie TLS-Resolver, Datenbankzugang und Infrastrukturpfade bleiben erhalten.
Fehlt nur der Callback, wird `//${SERVER_NAME}/api/auth/callback` ergänzt.
Bei Pfadpräfix, abweichendem API-Port oder Reverse-Proxy muss der Betreiber den
richtigen Callback vorher ausdrücklich setzen und im bestehenden Client freigeben.

Nur wenn noch **keine** `OIDC_*`-Einträge existieren, kann eine ausdrückliche
Legacy-Konfiguration aus `KEYCLOAK_URL`, `KEYCLOAK_REALM`,
`KEYCLOAK_CLIENT_ID` und `KEYCLOAK_CLIENT_SECRET` übersetzt werden.
Der bestehende URL-Kontextpfad bleibt erhalten; die Endpunkte werden unter
`${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}` ergänzt. Bei getrennten öffentlichen
und internen Adressen müssen die vollständigen OIDC-Werte vor der Migration
explizit eingetragen werden. Die Discovery-Metadaten des konkreten Providers
sind maßgeblich; eine allgemeine OIDC-Installation erhält keine geratenen
Keycloak-Endpunkte.

Doppelte Auth-Schlüssel (auch gleichlautende), unvollständiges OIDC, fehlende
Legacy-Konfiguration oder unbrauchbare Endpunkte führen zum Abbruch. Der
Betreiber korrigiert die Datei gezielt und startet die Migration erneut.
Ein Client ohne Geheimnis benötigt einen ausdrücklich leeren
`OAUTH2_CLIENT_SECRET=`-Eintrag. Eine vorhandene geheime Einstellung wird nie
durch einen neuen Standard ersetzt. Die Datei wird wie im bisherigen Skript
als Bash-Konfiguration gelesen: nur vertrauenswürdige Betreiberdateien verwenden;
keine fremden dotenv-Dateien ausführen. Symlinks werden vor Änderungen abgewiesen;
das tatsächliche Installationsverzeichnis ausdrücklich auswählen. Eine während
der Vorbereitung erkannte konkurrierende Dateiänderung führt zum Abbruch;
Konfigurationsänderungen während des Wartungsfensters koordinieren.

## Vorbedingungen und Sicherung

1. Wartungsfenster, verantwortliche Person und ausreichend freien Speicher
   festlegen. Laufende und pausierte Hintergrundaufträge vor einem zusätzlichen
   Anwendungs-/Queue-Upgrade nach `backend-hardening.md` klären.
2. Exakte Image-Digests, Compose-Dateien, effektive Konfiguration, Realm/Client,
   interne und öffentliche Endpunkte sowie Callback-Allowlist dokumentieren.
   Geheimnisse und Token gehören ausschließlich in zugriffsbeschränkte Dateien.
3. Schreibende API/Worker und Keycloak für einen zusammengehörigen Sicherungspunkt
   anhalten. Die tatsächlich verwendeten Datenbanken, Assets und gegebenenfalls
   Redis sichern, nicht bloß die Realm-JSON-Vorlage. Vorhandene Sicherungen erhalten.
4. PostgreSQL mit `pg_dump --format=custom` sichern: getrennt Anwendungsdatenbank
   und Keycloak-Datenbank, jeweils gegen den überprüften Compose-Service und dessen
   konfigurierte Datenbank/User. Rollen/Extensions und externe Providerkonfiguration
   separat berücksichtigen. Dumps mit `pg_restore --list` und einem tatsächlichen
   isolierten Restore prüfen. Ein Verzeichnis-Tar allein sichert keinen externen Realm.
5. `.env.coding-box`, Compose-/Proxy-/Realm-Konfiguration, Themes und verwendete
   Signaturschlüssel geschützt mitsichern. Asset-Volumes passend zum DB-Snapshot
   archivieren. Backups mit `umask 077`, Hashes und eindeutiger neuer Zielkennung
   anlegen; keine bestehenden Sicherungen überschreiben.

Die Migration erstellt vor einer tatsächlichen Änderung zusätzlich eine private
Kopie der ursprünglichen Datei in `.auth-upgrade-2.0.0.XXXXXX/.env.coding-box`.
Das ersetzt keinen Datenbank-/Realm-/Asset-Backup. Bei einer unveränderten
Konfiguration entsteht keine weitere Sicherung. Diese Verzeichnisse sind
Git-ignoriert und werden nicht automatisch entfernt.

## Ausführung und Fehlerfall

Im Installationsverzeichnis zunächst mit dem ausdrücklich ausgewählten Skript:

```bash
bash scripts/migration/2.0.0.sh
```

Vor dem Start der neuen Anwendung die effektive Compose-Konfiguration privat
rendern und mit der Sicherung vergleichen. Geheimnisse nicht in Tickets oder
CI-Logs ausgeben. Erst danach gezielt die betroffenen Anwendungsdienste starten,
Gesundheit und einen vollständigen Login inklusive geschützter API prüfen.
Ein zweiter Migrationslauf muss dieselbe Datei ergeben. Für eine angepasste
bestehende Realm-Konfiguration ist kein erneuter JSON-Import erforderlich.
Insbesondere kein `kc.sh import --override` gegen einen bestehenden Realm ausführen.

Bei einer fehlgeschlagenen Migration wird die aktive Datei nicht ersetzt.
`scripts/update.sh` bricht nach fehlgeschlagener Migration standardmäßig ab;
nur ein ausdrücklich eingegebenes `y` übergeht dies. Die Ursache vor jedem
Fortsetzen klären. Bei fehlgeschlagenem Login keine wiederholten Realm-Imports
versuchen: konkrete Endpunkte, Client und Callback gegen den gesicherten Stand
vergleichen. Bei mehreren Migrationsskripten können frühere erfolgreiche Schritte
bereits Änderungen vorgenommen haben; deren Sicherungen berücksichtigen.

## Konkreter Restore-Ablauf

1. Betroffene API/Worker und Keycloak anhalten. Bestehende oder seit der Sicherung
   hinzugekommene Daten vor einer Rücknahme erneut gesondert sichern. Alle Aktionen
   auf überprüften Projektnamen, Container-IDs und Ziel-Datenbanken begrenzen.
2. Für eine reine Konfigurationsänderung die gesicherte `.env.coding-box` mit
   privaten Berechtigungen zurückkopieren und den vorherigen Image-/Compose-Stand
   starten. Die von der Migration nicht angefassten Realm-Daten benötigen keinen
   Import. Gesundheit, vollständigen Login und Arbeitsplatzzuordnung prüfen.
3. War auch ein DB-/Realm-Restore nötig: bei gestoppten Clients die geprüften
   Dumps in die ausdrücklich ausgewählten Zieldatenbanken einspielen, zum Beispiel
   `pg_restore --clean --if-exists --no-owner --exit-on-error --dbname=...`.
   Das überschreibt Daten im Ziel; zuerst in einer eigenen isolierten Datenbank
   ausführen und nie einen ungeprüften Standard-Service/Projekt verwenden.
   Assets konsistent zum gleichen Sicherungspunkt wiederherstellen.
4. Redis enthält temporäre Auth-Zustände. Einen alten Auth-Cache nicht über neue
   Sitzungen legen. Bei vollständigem Restore eine neue, leere, ausschließlich
   diesem Projekt gehörende Redis-Instanz verwenden; laufende Logins müssen dann
   neu begonnen werden. Produktive Queue-Daten verlangen einen gesondert geprüften
   Queue-Restore, kein pauschales Flush oder Löschen eines gemeinsamen Volumes.
5. Provider, API/Worker und Frontend auf dem gesicherten Stand starten. Prüfen:
   Gesundheit, neue Anmeldung, geschützte API, Benutzeridentität, Arbeitsbereichs-
   zuordnung und erhaltene Client-/Realm-Einstellungen. Sicherungen behalten.

## Auswirkungen auf Tokens

- Ein bestehender sicherer `JWT_SECRET` bleibt erhalten, auch bei einer
  `export JWT_SECRET=...`-Zuweisung. Damit bleiben korrekt
  ausgestellte Workspace-Tokens bis Ablauf und vorbehaltlich ihrer übrigen Rechte
  gültig. Der Schlüssel ist unabhängig vom RSA-Schlüssel des OIDC-Providers.
- Fehlender/leer vorkonfigurierter bzw. bekannter Platzhalter `JWT_SECRET` wird
  durch einen zufälligen Schlüssel ersetzt. Workspace-Tokens mit dem alten
  Schlüssel müssen neu ausgestellt werden. Einen unsicheren Schlüssel nicht zur
  Wiederherstellung alter Tokens produktiv zurückspielen.
- Ein reines Konfigurationsupgrade ändert keine OIDC-Signaturschlüssel oder
  Provider-Sitzungen. Bereits ausgestellte Access-Tokens werden weiterhin anhand
  von Issuer, Client, Signatur und Ablauf geprüft.
- Ein Keycloak-Neustart oder DB-Restore kann Refresh-/Browser-Sitzungen verlieren.
  Access-Tokens sind eigenständige signierte Daten und können bis zum Ablauf weiter
  gültig sein, wenn Signaturschlüssel und Prüfungskonfiguration erhalten bleiben.
  Ein Restore ist deshalb kein zuverlässiger globaler Tokenwiderruf. Bei Bedarf
  Schlüssel-/Sitzungswiderruf ausdrücklich planen und neu anmelden.
- Seit dem Sicherungspunkt erzeugte Nutzer, Berechtigungen oder Änderungen können
  beim vollständigen DB-Restore verloren gehen. Dies ist ein Wartungs-/Restore-
  Schritt mit eigenem Sicherungsbedarf, keine normale wiederholbare Migration.

## Prüfnachweise

Die Regression `scripts/tests/install-migration-regression.sh` prüft die tatsächliche
Migration: externe Endpunkte mit getrennten internen Adressen, Legacy-Kontextpfad,
Client/Callback/Geheimnis, Wiederholung, private unveränderte Sicherung, sichere
JWT-Rotation und unveränderte Dateien nach Fehlern. Docker-/Download-Aufrufe sind
im Test blockiert. Live-Nachweise und präzise Grenzen stehen im zugehörigen
QA-Protokoll; lokale Prüfungen sind weder Remote-CI noch fachliche Abnahme.
