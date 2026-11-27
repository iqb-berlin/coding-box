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
  Produktionsimage-Scans sind für Versions-Tags verbindlich. Die Images dieses
  Pilots bleiben Workflow-Artefakte.

Berichte und Logs stehen in den Artefakten des jeweiligen GitHub-Laufs. Der
Branch-Schutz für die Umstellung muss den Check aus der GitHub-Actions-App
verlangen und wird durch die Workflow-Datei selbst nicht gesetzt.
