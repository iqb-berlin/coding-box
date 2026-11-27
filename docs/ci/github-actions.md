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

| Docker-Hub-Repository | Versions-Tag | Zusätzlicher Tag bei stabilen Releases |
| --- | --- | --- |
| `iqbberlin/coding-box-db` (PostgreSQL 14) | `<Version>` | `latest` |
| `iqbberlin/coding-box-db` (PostgreSQL 17) | `<Version>-pg17` | `latest-pg17` |
| `iqbberlin/coding-box-liquibase` | `<Version>` | `latest` |
| `iqbberlin/coding-box-backend` | `<Version>` | `latest` |
| `iqbberlin/coding-box-frontend` | `<Version>` | `latest` |

Bei einem Vorab-Release ist `<Version>` der vollständige Git-Tag, zum Beispiel
`1.17.5-beta.2`. Die stabilen Aliase werden erst nach allen fünf Versions-Tags
aktualisiert. Der Server kann `TAG` und `POSTGRES_IMAGE_SUFFIX` wie bisher verwenden,
sobald der Publish-Job erfolgreich abgeschlossen ist.

### Einmalige Freischaltung

1. Das GitHub-Environment `dockerhub-release` anlegen, auf Versions-Tags
   beschränken und mit einer Freigabe schützen. Dort `DOCKERHUB_USER` und
   `DOCKERHUB_TOKEN` für ein Konto mit Schreibzugriff auf die vier
   Docker-Hub-Repositories hinterlegen.
2. Die bisherige Veröffentlichung derselben Tags deaktivieren.
3. Die Repository-Variable `DOCKERHUB_RELEASE_ENABLED` auf `true` setzen.
   Ein neuer Versions-Tag startet den ersten Release-Lauf.

Bei einem fehlgeschlagenen Push können einzelne Tags bereits existieren.
Den fehlgeschlagenen Publish-Job im selben Lauf erneut ausführen, solange die
Archive verfügbar sind (sieben Tage). Stabile Releases nacheinander
veröffentlichen, da jeder stabile Publish die `latest`-Aliase aktualisiert.

Der Pflichtcheck `Test image publishing on a local registry` prüft die Namen,
die Tags und die Identität aller Images in einer kurzlebigen Registry auf dem
Runner. Er prüft auch den Abbruch bei einem fehlenden Archiv.
