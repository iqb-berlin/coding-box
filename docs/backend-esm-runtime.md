# Backend-Laufzeit als ESM

Aufbauend auf der Entity-Vorbereitung aus PR #1145 erzeugt der reguläre
Backend-Build jetzt `dist/apps/backend/main.mjs`. Node lädt dieses Bundle als
ES-Modul; externe Pakete werden über native Imports mit ihren jeweiligen
Exportbedingungen geladen. Docker startet dasselbe Artefakt über `tini`.

## Modulgrenzen

`apps/backend/tsconfig.build.json` erhält ESM-Imports bis zum Webpack-Build.
Webpack löst lokale TypeScript-Imports auf und bündelt Anwendungscode sowie
den generierten CommonJS-Autocoder. Eine separate, ungebündelte Ausführung
aller Backend-Quelldateien durch Node wird nicht eingerichtet. Lokale Imports
benötigen daher keine flächendeckende Ergänzung von `.js`-Endungen.

Das Workspace-Root-Paket bleibt unverändert. Frontend, bestehende Buildwerkzeuge
und CommonJS-Jest-Tests behalten ihre Modulgrenzen. `tsconfig.app.json` bleibt
für bestehende direkte TypeScript-Prüfwerkzeuge im Node20-Modus; der reguläre
Webpack-Build wählt ausdrücklich die zusätzliche ESM-Konfiguration.

Aufrufbare CommonJS-Pakete wie AdmZip, FormData, Archiver sowie ExcelJS und
SQLite verwenden Default-Imports. Backend- und Jest-Konfiguration aktivieren
`esModuleInterop`, damit CommonJS-Kontrolltests dieselben Pakete korrekt laden.
Reine Interface-/Typimporte sind ausdrücklich markiert, damit die isolierte
Transpilierung keine nicht vorhandenen Runtime-Exporte für Dekorator-Metadaten
anfordert. Nest-Injektionstokens und TypeORM-Relations-Callbacks bleiben Werte.

## Technische Prüfung durch Entwicklung

Voraussetzungen: Node 24.22.1 und Installation des aktuellen Lockfiles.
Alle Nx-Aufrufe werden nacheinander ausgeführt:

```sh
NX_DAEMON=false NX_NO_CLOUD=true npx nx run backend:typecheck
NX_DAEMON=false NX_NO_CLOUD=true npx nx lint backend
NX_DAEMON=false NX_NO_CLOUD=true npx nx test backend --maxWorkers=2 --codeCoverage=false
NX_DAEMON=false NX_NO_CLOUD=true npx nx build backend --configuration=production
```

Erwartet: strikte Typprüfung ohne Diagnosen, identische PostgreSQL-Metadaten
für alle Entities in CommonJS und nativem ESM, erfolgreiche Tests und ein
ESM-Bundle `main.mjs`. `npx nx serve backend` verwendet ebenfalls dieses
Artefakt. Die bestehenden Integrationsprüfungen benötigen ausdrücklich
wegwerfbare PostgreSQL-/Redis-Instanzen; siehe `backend:test-integration`.

Das verpflichtende Feature-CI-Gate `test-backend-container` baut die tatsächlichen
Produktions-Dockerfiles aus den Quellen für Linux/amd64. Es prüft native
XML-/SQLite-Abhängigkeiten und den Fehler bei ungültiger JWT-Konfiguration.
Native ESM-Roundtrips für ZIP, XLSX, Multipart, Archiver und SQLite sichern die
erst bei Import-/Exportaufrufen benötigten CommonJS-Exporte ab.
Anschließend führt `scripts/qa/verify-backend-container.sh` mit diesem Image
API und Export-Worker gegen neu erzeugte PostgreSQL-/Redis-Container aus:
vollständiges SQL-Schema, HTTP 200 auf `/api/health`, echte Verbindungen,
SIGTERM und Rückkehr zum Ausgangswert der Verbindungen. Logs liegen im
CI-Artefakt `dist/backend-container-proof/`.

Für eine lokale Wiederholung mit einem bereits gebauten Produktionsimage:

```sh
BACKEND_IMAGE=lokales-backend-image sh scripts/qa/verify-backend-container.sh
```

Das Skript erzeugt ein eigenes internes Docker-Netz und ausschließlich
synthetische Testdaten. Es entfernt am Ende nur seine eigenen Container und
sein eigenes Netzwerk. Ein vollständiger Import-/Kodier-/Exportdurchlauf kann
zusätzlich mit der dokumentierten [Codebook-/Autocoder-Fixture](../scripts/e2e/codebook/README.md)
und den Browser-Workflowtests geprüft werden. Bestehende Jest-Tests sind
weiterhin CommonJS-Kontrollen; sie werden hier nicht als native ESM-Tests
ausgegeben.

## Rollout und Rücknahme

Backend und Export-Worker müssen das neue Image mit dem abgestimmten
`main.mjs`-Startkommando erhalten. Ein extern überschriebenes Kommando mit
`main.js` muss vor einem Deployment angepasst werden. Es gibt keine neue
Datenbankmigration und keine Änderung an HTTP-Verträgen durch diesen Schritt.
Die Rücknahme erfolgt durch Zurücksetzen beider Dienste auf das vorherige
CommonJS-Image samt dessen Startkommando; die Datenbank bleibt dabei erhalten.
Ein bestandener technischer Prüflauf ist kein Release oder Deployment.
