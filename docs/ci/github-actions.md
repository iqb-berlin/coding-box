# GitHub Actions parallel zu GitLab

Der Workflow `.github/workflows/ci.yml` bildet die GitLab-Prüfungen für einen
parallelen Laufzeitvergleich ab. GitLab bleibt während der Erprobung aktiv.
Die Veröffentlichung in die GitLab Registry und nach Docker Hub bleibt bei
GitLab. Die neuen Workflows benötigen keine Registry-Schreibrechte oder Secrets.
Branch-Schutz und erforderliche Checks werden durch diese Dateien nicht geändert.

## Zuordnung der Jobs

| GitLab | GitHub Actions | Verhalten |
| --- | --- | --- |
| `install-dependencies` | `install-dependencies` | `npm ci`, Node aus `.nvmrc`, npm-Downloadcache; komprimiertes Dependency-Artefakt innerhalb desselben Runs |
| `build-app` | `build-app` | Produktionsbuilds von Frontend und Backend in getrennten Schritten |
| `test-backend` | `test-backend` | JUnit-Reporter, strenge Typprüfung, Jest mit Coverage und zwei Workern |
| `test-frontend` | `test-frontend` | Quality-Gates, Jest mit Coverage und zwei Workern, Zoneless-Inventar und Freigabe |
| `test-browser` | `test-browser` | Cypress Component Tests und Browser-E2E gegen das gebaute Frontend, Electron |
| `test-replay-live` | `test-replay-live` | Unveränderter Nx-Target, Produktion, eigener PostgreSQL-/Redis-/Keycloak-Stack |
| `test-auth-live` | `test-auth-live` | Harness-Tests und Auth-E2E, eigener Stack |
| `test-workflows-live` | `test-workflows-live` | Harness-Tests und Workflow-E2E, eigener Stack |
| `lint-app` | `lint-app` | Beide Projekte; seriell statt `run-many --parallel=2` |
| `audit-app` | `audit-app` | Dependency-Patch-Tests und `npm audit --audit-level high` |
| `build-db-image`, `build-liquibase-image` | gleichnamige Matrix-Jobs | Bestehende Dockerfiles; Images als kurzlebige Artefakte |
| `test-db`, `test-main-pr-db` | `test-db` | Liquibase `status`, `validate`, `updateSQL`, `updateTestingRollback`, `history` gegen eine eigene leere Datenbank |
| `gemnasium-dependency_scanning` | `dependency-scanning` | Derselbe Gemnasium-6-Analyzer, Digest aus Referenzjob 480744; wie bei GitLab optional |
| Produktions-Image-Builds und Trivy-Scans | `production-images` → `images.yml` | Vorhandene Dockerfiles, Base-Image-Weitergabe als Artefakt, fünf optionale Scans |
| Debug-Regel-Jobs | `check-config` | Revision, CPU, RAM, Speicher und Docker-Version; keine Secret-Ausgabe |

Alle fachlichen Gates sind verbindlich. `quality-gates` schlägt auch bei einem
fehlgeschlagenen oder übersprungenen Vorgänger fehl. JUnit, Cobertura, LCOV und
HTML liegen in den Coverage-Artefakten; GitHub erhält diese Dateien als Downloads,
es wird kein zusätzlicher Reporting-Dienst eingeführt. Browser-/Live-Artefakte und
Datenbanklogs werden auch nach Fehlern hochgeladen. Actions sind auf Commit-SHAs
festgelegt, Repository-Zugangsdaten werden nach dem Checkout nicht gespeichert.

## Auslösung und Abweichungen für den Vergleich

- Pushes auf alle Branches und Tags sowie manuelle Runs führen die Prüfungen aus.
- Same-Repository-PRs verwenden den vollständigen Push-Run. Der zusätzliche
  PR-Run wird übersprungen. Fork-PRs nach `develop`/`main` werden ohne Secrets
  geprüft. Getestet wird jeweils die konkrete Head-SHA, kein synthetischer Merge.
- Produktionsimages und Trivy laufen zusätzlich für `develop`, `main`, Tags oder
  beim manuellen Start mit `build_images=true`. Sie werden nicht veröffentlicht.
  Release-Versionstests, Release-Retags und Registry-Pushes aus GitLab sind damit
  noch kein Bestandteil einer umgeschalteten Release-Pipeline.
- Die GitLab-Abhängigkeit `test-frontend` → `test-backend` bleibt für die erste
  Messung bestehen. Andere unabhängige Jobs dürfen auf getrennten GitHub-Runnern
  parallel laufen. Die lokale Regel für serielle Frontend-/Backend-Prüfungen gilt
  weiterhin; Build und Lint verwenden getrennte Schritte.
- Nx-Ergebnis-Caches sind auf GitHub für die Messung deaktiviert. npm und Cypress
  dürfen ihre Downloadcaches verwenden. GitLab verwendet seine bestehenden
  npm-/Image-/Nx-Caches. Ein Vergleich misst daher die gesamte jeweilige
  CI-Umgebung, keinen isolierten CPU-Geschwindigkeitsunterschied.
- GitLab verwendet Container und Docker-in-Docker, GitHub Ubuntu 24.04 mit
  nativem Docker. Die Live-Harness-Konfiguration verwendet deshalb Loopback.
  Der Live-Harness startet wie unter GitLab als root, damit die bestehende
  Besitzerkorrektur der privaten Realm-Datei für Keycloak-UID 1000 greift.
  Die Datei behält ihre Rechte `0600`; Cypress nutzt den Cache des Runners.
  Anschließend erhalten ausschließlich die beiden Artefaktordner wieder den
  Runner als Besitzer, damit der Upload auch nach Testfehlern funktioniert.
  Es gibt keine Änderung an den getesteten Live-Szenarien.
- GitLab baut auf Feature-Branches das Frontend immer und das Backend nur bei
  Betroffenheit. GitHub baut beide vollständig. GitLabs technische CICD-Images,
  Registry-Transfers und Main-PR-Image-Testduplikate werden nicht künstlich auf
  GitHub ergänzt. Testumfang und Infrastrukturkosten sind im Bericht getrennt
  zu bewerten; eine vollständige Job-für-Job-Identität wird nicht behauptet.

## Laufzeiten messen

Der letzte Job schreibt einen vorläufigen Bericht in die Job Summary und das
Artefakt `ci-timings`. Er kann seinen eigenen abgeschlossenen Workflowstatus noch
nicht lesen. Nach Abschluss werden die finalen Werte mit dem folgenden Skript
erneut abgefragt. Es benötigt Node 22 und eine angemeldete GitHub CLI mit Leserecht
für Actions. GitLab-Abfragen verwenden optional `GITLAB_TOKEN` aus der Umgebung.
Tokens werden nicht in Dateien geschrieben.

```sh
node scripts/ci/compare-ci-runtimes.mjs \
  --github-run GITHUB_RUN_ID \
  --gitlab-pipeline GITLAB_PIPELINE_ID \
  --output tmp/ci-comparison
```

Falls die GitLab-API Bot-Protection-HTML liefert, wird das als Fehler behandelt.
Alternativ kann ein authentifiziert exportiertes JSON-Objekt mit den Feldern
`pipeline` und `jobs` über `--gitlab-file DATEI.json` eingelesen werden. Der
historische Export `docs/ci/gitlab-baseline-104992.json` dient nur als Referenz.

Der Bericht enthält Gesamtdauer ab Erstellung, erste Wartezeit, Ausführungsspanne,
Summe der Joblaufzeiten und einen Vergleich gemeinsamer Jobs. GitLabs
`queued_duration` wird nicht mit GitHubs Zeit zwischen Job-Erstellung und Start
gleichgesetzt: Letztere enthält auch Abhängigkeiten. Die Joblaufzeitensumme ist
weder Gesamtdauer noch eine Kostenabrechnung.

Nur erfolgreiche, abgeschlossene Runs derselben SHA erlauben Prozentvergleiche
gemeinsamer Jobs. Eine Gesamtverbesserung wird zusätzlich nur bei gleichen
Jobmengen ausgewiesen. Unterschiedliche Jobs werden aufgelistet. Bei Retries
verwendet GitHub nur den gewählten Run-Versuch und GitLab die jeweils neuesten
Jobversuche. Retries sind deshalb zusätzlich bei der Interpretation zu beachten.

Für die erste Messserie denselben neuen Branch-Commit in beiden Systemen laufen
lassen, drei erfolgreiche Versuche sammeln und kalte/warmgelaufene Downloadcaches
sowie Runner-Wartezeiten dokumentieren. Den Median der Gesamtdauer und die
einzelnen gemeinsamen Jobs vergleichen. Eine einzelne Messung bleibt eine
Momentaufnahme.

## Verifizierte Referenz vom 22.10.2026

[GitLab-Pipeline 104992](https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/104992)
war für `632df084023fe2982b5995590419d70f00d3c9b7` erfolgreich (16 Jobs).
Die Daten wurden aus den authentifizierten Pipeline-/Jobs-API-Ansichten gelesen.

| Messwert | Dauer |
| --- | ---: |
| Ab Erstellung bis Abschluss | 28:33 |
| Erste Wartezeit, aus Job-Zeitstempeln | 0:04 |
| Summe aller Joblaufzeiten | 106:59 |
| Installation | 3:48 |
| Backend-Tests | 10:26 |
| Frontend-Tests | 13:59 |
| Browser-Tests | 20:40 |
| Replay-Live | 16:12 |
| Auth-Live | 16:14 |
| Workflows-Live | 9:00 |
| Lint | 2:55 |
| Audit | 2:04 |

Der vorhandene GitHub-Run
[39779797048](https://github.com/iqb-berlin/coding-box/actions/runs/39779797048)
derselben SHA enthält nur `Analyze (javascript-typescript)` (CodeQL, 1:41 Jobzeit).
Er ist keine Nachbildung dieser Pipeline und liefert keinen belastbaren
Geschwindigkeitsvergleich. Für die neuen Workflows liegen vor dem ersten Push
noch keine Remote-Laufzeiten vor.

Offizielle API- und Workflow-Referenzen:
[GitHub-Workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[GitHub-Run-API](https://docs.github.com/en/rest/actions/workflow-runs),
[GitLab-Pipeline-API](https://docs.gitlab.com/api/pipelines/).
