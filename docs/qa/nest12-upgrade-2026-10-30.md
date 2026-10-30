# Nest-12-Upgrade: technischer Testbericht

Stand: 30.10.2026. Basis ist PR #1138 bei
`cc9cb2971072d403d613cc65f3fa4f21244a93da`; Arbeitsbranch `upgrade-nest-12`.
Geprüft wurde die hier vorbereitete Änderung mit Nest 12.3.2 und Node 24.22.1,
nicht der frühere Nest-11-Stand. Betriebssystem: macOS ARM64, PostgreSQL 14.24,
Redis 7.4.2, npm 11.19.1, Nx 22.7.12, Jest 30.5.2, ts-jest 29.4.15.

## Verfügbarkeit und Abnahme

| Zustand | Status |
| --- | --- |
| Implementierung | Auf eigenständigem Branch vorbereitet |
| Zusammenführung | Nicht erfolgt; #1138 ist die Voraussetzung |
| Release / Deployment einer Testinstanz | Nicht erfolgt |
| Technische Prüfung | Native Builds, isolierter Produktionsstart und Browserfälle bestanden; Linux-Containerbuild lokal blockiert |
| Fachliche Abnahme | Nicht erfolgt; dieser Bericht ist keine fachliche Freigabe |

Es werden keine bestehenden Abnahmen aufgehoben und keine Tickets geschlossen.
Die wesentlichen Regressionsrisiken sind das Laden der ESM-Pakete aus CommonJS,
Dekoratormetadaten, Authentifizierung, Uploads sowie Initialisierung und Beenden
von API und Queue-Workern. Die Änderung enthält keine neue fachliche Funktion.

## Ergebnisse der Entwicklung

Alle Frontend- und Backend-Prüfungen liefen als getrennte Nx-Aufrufe; eine
Frontend-Prüfung lief nicht parallel zu einer Backend-Prüfung.

| Prüfung | Ergebnis | Nachweis / Notiz |
| --- | --- | --- |
| Backend-Vollsuite mit eigenem Redis | Bestanden | 4.136 Tests in 255 ausgeführten Suites; 124 umgebungsabhängige Tests übersprungen |
| PostgreSQL-/Redis-Integration | Bestanden | 129 Tests in 16 Suites; ausschließlich der optionale Kappa-Benchmark übersprungen |
| ESM-/Upload-Regression im CI-Konfigurationspfad | Bestanden | 4 Tests; `--runInBand` und explizite Coverage-Überschreibung funktionieren |
| Strikter Backend-Typecheck | Bestanden | 0 Diagnosen; Metadaten aller 43 PostgreSQL-Entities gültig |
| Backend-Lint | Bestanden | Keine Fehler |
| Backend-Produktionsbuild | Bestanden | Webpack unter Node 24.22.1 |
| Frische Produktionsinstallation | Bestanden | npm 11.19.1, `npm ci --omit=dev`; Manifeste unverändert; alle verwendeten Nest-Integrationen und native Module geladen |
| Start aus dieser isolierten Installation | Bestanden | API und Export-Worker ohne VM-Testschalter; echte PostgreSQL-/Redis-Verbindungen; HTTP-Healthcheck; SIGTERM; alle Verbindungen wieder geschlossen |
| Ungültige Startkonfiguration | Bestanden | Fehlendes JWT-Secret führt vor Infrastrukturverbindungen zu Exit 1 |
| Nest-/Jest-Peer-Abhängigkeiten | Bestanden | `npm ls` ohne ungültige oder fehlende Peers |
| Frontend-Vollsuite | Bestanden | 3.657 Tests in 324 Suites; keine übersprungenen Tests |
| Frontend-Produktionsbuild | Bestanden | Angular 21 unverändert, Build unter Node 24.22.1 |
| Frontend-Qualitätsgates | Bestanden | Alle 52 Prüfungen, einschließlich Weitergabe der CI-Konfiguration an den ESM-Teststarter |
| Browser-Workflows | Bestanden | 10/10 Fälle, keine übersprungen; echte Rollen-Anmeldung, Upload/Kodierung/Export, Audit-Rollback und Queue-Isolation |
| Vollständiger Linux-Containerbuild | Blockiert | Eigener Imagebau wegen weniger als 1 GiB freiem Hostspeicher kontrolliert abgebrochen; vor Browserstart, kein Erfolg behauptet |
| Remote-CI | Noch nicht geprüft | Separat vom lokalen Nachweis zu bewerten |

Der geprüfte native Produktionsbuild hat SHA-256
`ee335a4b4b49a4a2674d851d59484ecf2c09e41f3b0b13986aa412efe048ed58`.
Der Browserlauf verwendete den Implementierungscommit
`57e9e31f3ef33665071a276f48fae99ac34eb463` und denselben Backend-Build.
Ein temporärer Adapter startete die nativen Produktionsbuilds, einen lokalen
Static-/API-Proxy sowie ausschließlich vorhandene PostgreSQL-/Redis-/Keycloak-
Images. Die unveränderten Cypress-Fixtures und Assertions wurden mit Electron
138 / Cypress 15.21.1 unter Node 24.22.1 ausgeführt. Die Schutzprüfungen der
Fixtures blieben aktiv. Die erfolgreiche Wiederholung führte alle zehn Fälle
erneut aus. Alle eigenen Container und Testprozesse wurden danach beendet;
fremde Caches, Images und Volumes wurden nicht gelöscht.

Der SHA-256 der unveränderten Workflow-Konfiguration lautet
`6666295418fb1afa54c70c7cf61061d6eb266705aae6b64aa6ae4cd74608f899`.
Die lokale Evidenz liegt im verwendeten Checkout unter `tmp/nest12-tools/`
(Logs und `runtime-proof/report.json`); sie wird nicht als Quellcode eingecheckt.

Der erste Volltest mit nur einem Jest-Prozess überschritt dessen Heap-Limit.
Der Volltest-Runner nutzt nun wie CI zwei Worker mit dem vorhandenen
1-GiB-Recyclinglimit. Dieser vollständige Wiederholungslauf ist erfolgreich.
Ein bestehender Upload-Test wurde an die konkrete Nest-12-Meldung zur
vorgelagerten Array-Index-Grenze angepasst; HTTP 400 und der anschließende
normale Upload werden weiterhin geprüft.

## Reproduzierbare technische Prüfung

Zuständig: Entwicklung. Voraussetzungen: `nvm use` / Node 24.22.1,
`npm ci`, passende native Buildwerkzeuge und die angegebenen ausschließlich
wegwerfbaren Testdienste. Jeden Aufruf abschließen, bevor die andere
Anwendungsseite geprüft wird.

```sh
npx nx run backend:typecheck
npx nx lint backend
npx nx run backend:verify-bullmq-live --configuration=full
npx nx build backend --configuration=production
```

Der BullMQ-Runner benötigt `redis-server` auf PATH oder die Variable
`BULLMQ_REDIS_SERVER=/pfad/zu/redis-server`. Er startet und beendet seinen
eigenen Redis-Prozess. Erwartet: alle aktivierten Tests bestehen; keine
ESM-Ladefehler und kein Heap-Abbruch.

Für den vollständigen Datenbanklauf einen separaten PostgreSQL-Testserver mit
Recht zum Erstellen/Löschen von Datenbanken und einen ausschließlich für Tests
verwendeten Redis angeben. Der Runner erzeugt und entfernt seine eigene
Datenbank und wendet die vollständigen Schema-Changesets an:

```sh
BACKEND_INTEGRATION_TEST_DATABASE_URL='postgresql://testuser:testpassword@127.0.0.1:15441/postgres' \
BULLMQ_TEST_REDIS_HOST=127.0.0.1 BULLMQ_TEST_REDIS_PORT=16441 \
npx nx run backend:test-integration
```

Für den Produktionsstart die dedizierte Codebook-Testumgebung nach
[`scripts/e2e/codebook/README.md`](../../scripts/e2e/codebook/README.md)
bereitstellen: PostgreSQL `codebook_test` auf 15441 mit vollständigem Schema,
Redis auf 16441; Port 3333 muss frei sein. Diese Dienste dürfen von keiner
anderen Anwendung verwendet werden. Im lokalen Nachweis wurden dafür eigene
native Prozesse statt produktiver Dienste verwendet.

```sh
BACKEND_HARDENING_FIXTURE=true \
BACKEND_HARDENING_PROOF_DIR="$PWD/tmp/nest12-runtime-proof" \
npx nx run backend:verify-runtime-package --configuration=smoke
```

Erwartet: `success: true` im Bericht; beide Rollen starten und schließen ihre
Verbindungen nach SIGTERM; ungültige Konfiguration öffnet keine Verbindungen.
Die Prüfung installiert Abhängigkeiten frisch in einem temporären Verzeichnis,
kopiert den Produktionsbuild hinein und startet dessen `main.js` dort. Der
Installationsbaum wird anschließend entfernt; der Bericht bleibt erhalten.

Danach die Frontend-Prüfungen einzeln ausführen:

```sh
npx nx test frontend --maxWorkers=2
npx nx run frontend:test-quality-gates
NG_BUILD_MAX_WORKERS=2 npx nx build frontend --configuration=production
npx nx run frontend:e2e-workflows --configuration=production
```

Der letzte Aufruf benötigt Docker/Compose und erstellt eine eigene Umgebung
mit PostgreSQL, Redis und Keycloak. Er verwendet synthetische Daten und entfernt
anschließend nur die zu dieser Umgebung gehörenden Ressourcen. Erwartet:
alle Browserfälle ausgeführt und bestanden, keine übersprungenen Fälle.

## Offene technische Prüfung

Der native Runtime-Nachweis ersetzt keinen Linux-Containerbuild. Der reguläre
`frontend:e2e-workflows`-Aufruf wurde bereits beim Imagebau aus Speichergründen
abgebrochen. Die erfolgreiche Browserprüfung verwendete deshalb den oben
beschriebenen Adapter und die bestehenden Images; sie belegt nicht den Bau
der angepassten Produktions-Dockerfiles. Builder-/Runtime-Images und frische
native Linux-Abhängigkeiten müssen in CI oder auf einem Rechner mit ausreichend
Speicher geprüft werden. Bis zu einem grünen Ergebnis ist dieser Punkt offen.
Ein Release oder eine fachliche Freigabe wird daraus nicht abgeleitet.
