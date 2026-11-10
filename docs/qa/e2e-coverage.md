# E2E-Abdeckung und Ergebnisse

`docs/qa/e2e-workflows.json` ist der versionierte Katalog zentraler fachlicher
Abläufe. Er enthält 15 kritische Workflows mit Live-Testreferenzen und zwei
bekannte Lücken bei externen Integrationen. Dieser erste Katalog ist keine
vollständige Bestandsaufnahme aller Funktionen oder Kombinationen von Rollen.
Bei neuen Kernfunktionen oder kritischen Regressionen wird er mitgepflegt.

Jeder Workflow benennt Risiko, Priorität und sämtliche für seinen Nachweis
erforderlichen Tests. Referenzen bestehen aus Suite, Dateipfad und eindeutigem
Testtitel. Die Prüfung liest den TypeScript-Syntaxbaum: umbenannte, entfernte,
doppelte sowie mit `skip` oder `only` markierte Nachweise sind ungültig. Alle
referenzierten Tests laufen in den vorhandenen Live-Suiten mit echtem Backend.
Diese kombinieren Browser-, API- und PostgreSQL-Prüfungen; etwa die atomare
Löschung ist ein direkter Datenbanknachweis über den Test-Harness.

Es gibt zwei verschiedene Messungen:

- **Planabdeckung:** Workflows mit gültigen Live-Testreferenzen / alle Workflows
  im Katalog, zusätzlich separat für kritische Workflows.
- **Bestätigte Abdeckung:** Workflows, für die alle referenzierten Tests in den
  vorliegenden Ergebnissen bestanden haben / derselbe Nenner. Fehlende,
  fehlgeschlagene oder übersprungene Tests bestätigen keinen Workflow.

Ein erfolgreicher Katalogcheck bestätigt die Zuordnung. Er führt keine
Browser-Tests aus. Die 60-%-Grenzen der Jest-Code-Coverage bleiben eigenständige
Unit-Test-Gates. Die Zoneless-Risikomatrix bleibt für ihren technischen Umfang
zuständig. Externer Testcenter und Content Pool sind ausdrücklich als Lücken
erfasst; simulierte Gegenstellen werden nicht als Live-Nachweise gezählt.

## Lokal prüfen

Mit der Node-Version aus `.nvmrc`, jeweils nacheinander:

```sh
NX_DAEMON=false npx nx run frontend:test-e2e-quality
NX_DAEMON=false npx nx run frontend:e2e-coverage
NX_DAEMON=false npx nx run frontend:e2e-replay-live --configuration=production
NX_DAEMON=false npx nx run frontend:e2e-auth-live --configuration=production
NX_DAEMON=false npx nx run frontend:e2e-workflows --configuration=production
NX_DAEMON=false npx nx run frontend:e2e-report --suites=auth-live,replay-live,workflows-live
```

Die Live-Ziele erstellen und entfernen ausschließlich ihre eigenen temporären
Compose-Stacks. Die Auth-Suite bereitet vor **jedem** Test einen frischen
Workspace mit einem eigenen Kodierauftrag vor. Speicherung/Navigation/Abschluss,
Sitzungswarnung, Provider-Ausfall, konkurrierende Speicherantworten und
Wiederanmeldung sind eigenständige Tests. Der Verwaltungstest bereitet seine
benötigten abgeschlossenen Ergebnisse selbst vor. Kein Fall benötigt den Erfolg
eines vorigen Tests. Der durchgängige Import-bis-CSV-Test bleibt als gemeinsamer
fachlicher Ablauf erhalten, damit die Identität der Daten über alle Schritte
geprüft wird.

## Berichte und CI

Alle fünf Cypress-Suiten schreiben unter `coverage/cypress/<suite>/`:

- `junit.xml`: Testnamen, Laufzeiten, Fehler und übersprungene Tests für GitLab.
- `results.json`: dieselben Zustände, Versuche, Commit und CI-Pipeline als
  maschinenlesbare Grundlage. Browser-Diagnosen und Request-Inhalte werden
  nicht übernommen; Details stehen im vorhandenen Joblog und in Screenshots.

Neue Läufe entfernen veraltete Dateien der jeweiligen Suite. Die Berichte
werden auch bei Testfehlern und fehlgeschlagener Fixture-Bereinigung geschrieben.
Browser- und Komponentenberichte gehören zu den Nx-Ausgaben. Die CI-Pipeline-ID
gehört zu deren Cache-Eingaben, damit jede Pipeline eigene Messungen erhält.

Die bestehenden Browserjobs veröffentlichen JUnit und Artefakte auch bei
Fehlern. `test-e2e-report` sammelt die Ergebnisse der drei verpflichtenden
Live-Jobs und schreibt `coverage/cypress/summary.json` und `summary.md`.
Dieses zusätzliche Gate läuft auch nach fehlgeschlagenen Tests und blockiert
die Veröffentlichung bei fehlenden Suiten, Fehlern, übersprungenen kritischen
Nachweisen oder Ergebnissen aus verschiedenen Commits/Pipelines. Die vorhandene
Auswahl der Mock- und Komponentensuite auf Feature-Branches/PRs bleibt erhalten;
ihre eigene Auswertung läuft in `test-browser`.

Die Auswertung nennt ausgeführte und übersprungene Tests, Fehlerrate unter
ausgeführten Tests, Laufzeit der Suiten und die zehn langsamsten Fälle.
`retriedPasses` zählt Tests mit einem fehlgeschlagenen Versuch und anschließendem
Erfolg. Die vorhandenen Test-Retries werden nicht erhöht. Ein einzelner grüner
Lauf liefert keine historische Flakiness-Rate. Für Zeitvergleiche können die
30 Tage aufbewahrten JSON-Artefakte nach Commit und Pipeline verglichen werden;
es wird keine nicht gemessene Stabilitätsquote behauptet.

Für eine Teilmenge kann `frontend:e2e-report --suites=auth-live` verwendet werden.
Dann werden nur die in dieser Teilmenge vollständig nachweisbaren kritischen
Workflows als Gate geprüft; der Bericht kennzeichnet andere Abläufe als nicht
bestätigt. `frontend:e2e-coverage` schreibt den reinen Plan unter
`coverage/cypress/workflow-plan.json` und `workflow-plan.md`.
