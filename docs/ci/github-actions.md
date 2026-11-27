# GitHub Actions

`.github/workflows/ci.yml` prüft Pull Requests auf dem von GitHub erstellten
Merge-Commit und unterstützt Merge Queues. Pushes auf `develop` und `main` sowie
Versions-Tags haben eigene Läufe. Der verbindliche GitHub-Check heißt
`Kodierbox required checks` und benötigt Erfolg von allen anwendbaren Pflichtjobs.

- Installation, getrennte Produktionsbuilds, Typprüfung, Unit-Tests mit
  Coverage, Lint und Dependency-Audit.
- Backend-Integration mit den im Workflow festgelegten PostgreSQL-14- und
  PostgreSQL-17-Versionen sowie Redis. Beide Matrix-Jobs sind verbindlich.
- Die zwei Datenbank-Images und das Liquibase-Image werden lokal im Runner
  gebaut. Die Matrix prüft Migrationen und Rollback gegen beide PostgreSQL-Versionen.
  Der Scan des PostgreSQL-17-Images ist ebenfalls verbindlich.
- Cypress-Komponententests, Browser-E2E, Replay, Auth und Workflows verwenden die
  bestehenden Nx-Targets. Die Live-Suiten verwenden die Build-Artefakte dieses
  Laufs. Fehlende, fehlerhafte oder übersprungene Pflichtfälle führen über die
  Cypress-Berichtsauswertung zum Fehler.
- Die Produktions-Dockerfiles werden gebaut. Das Backend-Image muss seine
  Abhängigkeiten laden, ungültige Konfiguration ablehnen sowie API und Worker
  gegen eigene PostgreSQL- und Redis-Container starten und sauber stoppen.
  PRs nach `main` prüfen zusätzlich Typen, Tests, Lint und Audit in den Testimages.
- Versions-Tags müssen zu den drei npm-Versionsfeldern passen. Die
  Produktionsimage-Scans sind für Versions-Tags verbindlich.

Berichte und Logs stehen in den Artefakten des jeweiligen GitHub-Laufs. Der
Branch-Schutz für die Umstellung muss den Check aus der GitHub-Actions-App
verlangen und wird durch die Workflow-Datei selbst nicht gesetzt.

## Docker-Images veröffentlichen

Der Publish-Job läuft bei einem Push eines Versions-Tags nach erfolgreichem
`Kodierbox required checks`. Er lädt die fünf geprüften Image-Archive aus
demselben Workflow-Lauf. Die Images werden direkt aus diesen Archiven veröffentlicht.

| GitHub Container Registry | Versions-Tag | Zusätzlicher Tag bei stabilen Releases |
| --- | --- | --- |
| `ghcr.io/iqb-berlin/coding-box-db` (PostgreSQL 14) | `<Version>` | `latest` |
| `ghcr.io/iqb-berlin/coding-box-db` (PostgreSQL 17) | `<Version>-pg17` | `latest-pg17` |
| `ghcr.io/iqb-berlin/coding-box-liquibase` | `<Version>` | `latest` |
| `ghcr.io/iqb-berlin/coding-box-backend` | `<Version>` | `latest` |
| `ghcr.io/iqb-berlin/coding-box-frontend` | `<Version>` | `latest` |

Bei einem Vorab-Release ist `<Version>` der vollständige Git-Tag, zum Beispiel
`1.17.5-beta.2`. Die stabilen Aliase werden erst nach allen fünf Versions-Tags
aktualisiert. Bei leerem `REGISTRY_PATH` verwendet die Compose-Datei des
Ziel-Releases GHCR. Ein gesetzter `REGISTRY_PATH` verwendet den angegebenen
Registry-Pfad mit dem bisherigen Namensraum `iqbberlin/`. Für das erste
GHCR-Release einen vorhandenen Registry-Override aus `.env.coding-box` entfernen.
Die installierte PostgreSQL-Version bestimmt weiterhin den Wert von
`POSTGRES_IMAGE_SUFFIX`.

### Einmalige Freischaltung

1. Das GitHub-Environment `ghcr-release` auf Versions-Tags beschränken. Der
   Publish-Job meldet sich mit dem eingebauten `GITHUB_TOKEN` und
   `packages: write` an. Wenn ein Zielpaket schon existiert, braucht dieses
   Repository dort Schreibzugriff unter **Manage Actions access**.
2. Die Repository-Variable `GHCR_RELEASE_ENABLED` zur Release-Freigabe auf
   `true` setzen.

### Ablauf pro Release

1. Den Versions-Tag vom vorbereiteten Release-Commit mit dem GitHub-Workflow zu
   GitHub pushen.
2. Warten, bis `Publish checked images to GHCR` erfolgreich war. Beim ersten
   Push sind neue Pakete zunächst privat. Alle vier Pakete in GitHub Packages
   auf **Public** setzen und die fünf Versions-Images ohne Registry-Anmeldung
   abrufen.
3. Das GitHub-Release zum vorhandenen Tag veröffentlichen. Vorab-Releases dabei
   als Pre-release markieren. `make coding-box-update` prüft, ob zum gewählten Tag
   ein GitHub-Release vorliegt, und schlägt standardmäßig das jüngste stabile
   Release vor.

Bei einem fehlgeschlagenen Push können einzelne Tags bereits existieren.
Den fehlgeschlagenen Publish-Job im selben Lauf erneut ausführen, solange die
Archive verfügbar sind (sieben Tage). Stabile Releases nacheinander
veröffentlichen, da jeder stabile Publish die `latest`-Aliase aktualisiert.

Der Pflichtcheck `Test image publishing on a local registry` prüft die Namen,
die Tags und die Identität aller Images in einer kurzlebigen Registry auf dem
Runner. Er prüft auch die Image-Referenzen für beide PostgreSQL-Versionen in
der Produktions-Compose-Datei und den Abbruch bei einem fehlenden Archiv.
