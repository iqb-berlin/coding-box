# Zoneless-Prüfung: Nachweise und offene Abdeckung

## Status

Die umfassende Prüfung ist **noch nicht abgeschlossen**. Ein erfolgreicher Testlauf
ist keine vollständige Freigabe aller Komponenten und Aktionen.
Ausgangspunkt: PR #1039, Commit `aaae7be16c7aeadb2abbb8d1001e367d7bccf598`.
Die Erweiterungen bis einschließlich CSV-Export und Seiten-Lebenszyklus wurden
mit `467fe811` auf den PR-Branch gepusht. Weitere Prüfschritte sind unten dokumentiert.

## Prüfinfrastruktur

Alle Befehle im Repository-Verzeichnis; Validierungen nacheinander ausführen.

```sh
npx nx run frontend:zoneless-inventory
npx nx run frontend:test-zoneless --runInBand
npx nx lint frontend
npx nx test frontend --runInBand
npx nx e2e frontend --spec=cypress/e2e/zoneless-dialogs.cy.ts --browser=electron
npx nx run frontend:e2e-auth-live --configuration=zoneless
npx nx run frontend:e2e-replay-live --configuration=zoneless
npx nx run frontend:e2e-auth-live --configuration=production
npx nx run frontend:zoneless-approval
```

Der separate Jest-Prozess verwendet `setupZonelessTestEnv()` und prüft vor und
nach jedem Test, dass `globalThis.Zone` fehlt. Gemeinsame Mocks importieren keinen
Zone-Testaufbau. Die bestehende allgemeine Suite bleibt erhalten. Chart- und
Snackbar-Mocks bestehen in Jest weiter; echte Bibliotheken müssen im Browser
geprüft werden.

Die Live-Targets erzeugen eigene Compose-Projekte mit synthetischen Daten und
entfernen ausschließlich die von ihnen erzeugten Ressourcen. Bestehende
Entwicklungsdaten und Produktion gehören nicht zur Prüfung.

## Matrix

Aktueller Umfang: 154 Komponenten, 72 Services, fünf Pipes und 21 externe
Bibliotheken. Insgesamt 8.706 Einträge einschließlich Template-Ereignissen,
Bindungen und asynchronen Quellen. Alle Gesamteinträge sind noch offen.

`zoneless-coverage.json` erfasst Komponenten, Services, Pipes, Template-Ereignisse,
asynchrone Aufrufe, `await`, Browser-Callbacks und Observer. Template-Bindungen,
Interpolationen, Bedingungen sowie externe Bibliotheken werden ebenfalls erfasst. Die IDs verbinden Pfad,
Klasse, Quellentyp und Vorkommen. Aufrufer- und Testkandidaten sind Suchhinweise,
keine geprüften Erreichbarkeits- oder Abdeckungsnachweise.

Nach Quelländerungen:

```sh
node scripts/qa/zoneless-inventory.mjs --update
```

Geänderte Fingerprints setzen die betreffende Prüfung auf `open` zurück.
Komponenten-Fingerprints berücksichtigen den Klasseninhalt und das Template.
Das normale Inventar-Target erkennt neue, veränderte und entfernte Einträge.
`zoneless-approval` scheitert zusätzlich an offenen Prüfungen, fehlenden
Testdateien und nicht begründeten Szenario-Ausschlüssen. Die Szenarien sind im
Prüfskript festgelegt und lassen sich nicht durch Kürzen der Matrix umgehen.

Die CI führt die Inventarprüfung, den separaten Jest-Lauf, Browserprüfungen
und Live-Prüfungen aus. Der zusätzliche Job `test-zoneless-approval` bleibt bei
offener Matrix absichtlich rot; er ist kein `allow_failure`-Job. Die Konfiguration
ist noch nicht durch einen entfernten CI-Lauf bestätigt.

Ein Matrixeintrag darf erst `passed` werden, wenn Aufrufer, Rollen, Testreferenz,
Nachweise und alle zehn Szenarien geprüft sind. Einzelne erfolgreiche Szenarien
lassen den Gesamteintrag weiterhin offen. Kein Eintrag wird allein wegen einer
grünen allgemeinen Testsuite freigegeben.

## Neu bestätigte Befunde

| ID | Befund | Korrektur / Regression |
|---|---|---|
| ZL-001 | Reset-Fortschritt der CodingManagement-Ansicht aktualisiert sich nach Service-Ereignis nicht | Benachrichtigung bei Statistik-/Fortschritts-Subscriptions; echte Template-Prüfung mit drei festen Fortschrittsfolgen |
| ZL-002 | Manueller Kodierfortschritt bleibt nach verzögerter Antwort in der Ladeansicht | Benachrichtigung nach Abschluss der Anfrage; Erfolg, leere Antwort und Fehler mit Wiederholung geprüft |
| ZL-003 | Ältere Fortschrittsantwort überschreibt einen neueren Stand | Anfrageversion und Workspace-Prüfung; veraltete Antworten und Abschlussaktionen nach Zerstörung werden verworfen |
| ZL-004 | Meine Kodierjobs bleibt nach verzögerter Anmeldung ohne Workspaces leer | Benachrichtigung beim Laden und im Fehlerpfad; echte Template-Prüfung des Leerzustands |

| ZL-005 | Fehler beim Nachladen von Validierungsseiten lassen Tabellen gesperrt | Angular-Benachrichtigung in den fünf Panels mit serverseitiger Pagination; HTTP-Fehler im echten Dialog reproduziert und abgesichert |

Regressionen befinden sich in den beiden `coding-management*.component.spec.ts`
und in `my-coding-jobs.component.spec.ts`.
Sie erzwingen nach einer Antwort keine Änderungserkennung.

`validation-dialog.zoneless.spec.ts` prüft alle sechs Panels im echten
übergeordneten Dialog mit echten Templates und dem echten gemeinsamen
Zustandsservice. Verzögerte Fehlermeldungen sowie Fortschritt 10/55/100 und
Abschluss werden durch die Benachrichtigung des Dialogs gerendert. Diese
Einbettung benötigt für Status-/Fortschrittsmeldungen keine zusätzliche Panel-Korrektur.
Seitenfehler veröffentlichen jedoch kein gemeinsames Zustandssignal: Deshalb
benötigen die fünf Panels mit serverseitiger Pagination eine eigene Benachrichtigung.
Die ergänzten Tests prüfen HTTP-500-Antworten und das Ende der Ladesperre; bei
Variablen, Variablentypen und Antwortstatus zusätzlich erfolgreiche Seitenantworten.

## Noch notwendige Arbeit für die vollständige Freigabe

- Jede produktive Aufrufkette, Rolle, UI-Aktion und sichtbaren Zustände fachlich
  zuordnen; statische Kandidaten allein reichen nicht.
- Alle zehn Szenarien je relevantem Ablauf prüfen, einschließlich weiterer
  Management-Anfragen, Timer, Dateioperationen, Player-Nachrichten und Dialoge.
- Browserabdeckung aller erreichbaren Ansichten und wesentlichen Aktionen
  ergänzen; echte Diagramme, Overlays, Metadateneditoren und Player prüfen.
- Ausschlüsse durch nachgewiesene Nichterreichbarkeit begründen.
- Abschließende Suite-, Browser-, Backend- und Produktionsläufe auf demselben
  unveränderten Commit durchführen und deren CI-Ergebnisse dokumentieren.

Solange diese Punkte offen sind, muss `frontend:zoneless-approval` fehlschlagen.

## Bisherige lokale Ausführung

Umgebung: macOS, Node 22.23.1, Angular 21.2.24, Cypress 15.13.1 mit Electron 138;
Docker 29.5.2 für die isolierten Live-Läufe. Es wurden keine Produktionsdaten
verwendet, keine bestehenden Entwicklungsdaten bereinigt und nichts deployed.

| Prüfung | Ergebnis | Exit-Code | Log |
|---|---|---:|---|
| Zoneless-Jest mit Lebenszyklus und CSV-Export | 420 Tests / 16 Suites bestanden | 0 | `/tmp/zoneless-lifecycle-export-suite.log` |
| Allgemeine Frontend-Suite mit Lebenszyklus und CSV-Export | 2.223 Tests / 213 Suites bestanden | 0 | `/tmp/zoneless-lifecycle-export-regular.log` |
| Zoneless-Browser vor Panel-Erweiterung | 18 Tests bestanden, Nx erfolgreich | 0 | `/tmp/zoneless-comprehensive-browser-final.log` |
| Frontend-Lint mit CSV-Export-Korrekturen | bestanden | 0 | `/tmp/zoneless-lifecycle-export-lint.log` |
| Backend + Keycloak, Zoneless | fünf Browserfälle bestanden | 0 | `/tmp/zoneless-auth-live-initial.log` |
| Backend + Keycloak, Produktionskonfiguration | fünf Browserfälle bestanden | 0 | `/tmp/zoneless-comprehensive-auth-production.log` |
| Replay mit echtem Aspect-Player und Item-Matrix-Export | zwei Fälle bestanden | 0 | `/tmp/zoneless-comprehensive-replay.log` |
| Schutztests der Inventarprüfung | fehlende, geänderte und unvollständige Einträge werden zurückgewiesen | 0 | `/tmp/zoneless-inventory-guard-tests.log` |
| Vollständige Matrixfreigabe | 8.706 Einträge ohne vollständige Freigabenachweise | 1 | `/tmp/zoneless-inventory-approval.log` |

Der erste abschließende Zoneless-Jest-Lauf konnte wegen `ENOSPC` eine Suite nicht
starten (371 Tests bestanden, Exit-Code 1). Log:
`/tmp/zoneless-comprehensive-native-final.log`. Nach erneuter Prüfung des freien
Speicherplatzes bestand der explizite Wiederholungslauf; es wurden keine
Test-Retries eingerichtet und keine Datenbereinigung vorgenommen.

Die Live-Läufe beziehen sich auf Zwischenstände dieser Umsetzung. Insbesondere
folgte die Korrektur in `MyCodingJobsComponent` erst nach dem Produktionslauf.
Ein abschließender Nachweis auf einem gemeinsamen unveränderten Commit fehlt.
Ein erfolgreicher entfernter CI-Lauf wird nicht behauptet; der aktuelle
Publikationsstatus wird beim Push separat bestätigt. Browser-Videos liegen lokal unter
`cypress/replay-artifacts/videos/`; die Logs außerhalb des Repositorys sind
lokale Nachweise und keine dauerhaft veröffentlichten CI-Artefakte.

### Reproduktionsnachweise ZL-005

- `/tmp/zoneless-panel-pagination-red.log`: Variablenpanel bleibt nach HTTP 500 gesperrt.
- `/tmp/zoneless-related-panels-red.log`: Variablentypen und Antwortstatus ebenfalls betroffen.
- `/tmp/zoneless-group-duplicate-red.log`: Gruppenantworten und Duplikate ebenfalls betroffen.
- `/tmp/zoneless-panels-full-green.log`: korrigierte Pfade und gesamter separater Zoneless-Lauf bestanden.

Die Tests verwenden den produktiven Dialog, echte Panel-Templates und echte
Validierungsservices mit kontrolliertem HTTP-Testbackend. Nach HTTP-Antworten
wird ausschließlich auf Angular-Stabilität gewartet; keine zusätzliche
Änderungserkennung, kein weiterer Klick und kein erneutes Öffnen.

Der Debounce-Test für veraltete Analyseantworten verwendet jetzt kontrollierte
Jest-Timer statt einer Wartezeit genau an der 300-ms-Grenze. Der vorherige
Fehlerlauf steht in `/tmp/zoneless-panels-regular-final.log`; der anschließende
vollständige Lauf bestand ohne Test-Retries.

## Erweiterung: Lebenszyklus der Validierungsseiten

Für die fünf Panels mit serverseitiger Pagination bestehen zusätzlich 20 Tests:
Fehler mit anschließendem leerem Wiederholungsversuch, Abbruch der älteren
Seitenanfrage, Abbruch beim Zerstören des übergeordneten Dialogs und erneutes
Öffnen ohne alte Ladesperre. Der neue Dialog rendert anschließend ein frisches
Ergebnis. Die echten HTTP-Anfragen werden kontrolliert; Abbrüche werden am
HTTP-Testbackend nachgewiesen. Es waren keine weiteren Produktkorrekturen nötig.

Nachweis: `/tmp/zoneless-panel-lifecycle.log`, 40 Tests der Dialog-Suite, Exit 0.
Die fünf Pagination-Einträge erhalten dafür Szenarionachweise. Sie bleiben
insgesamt offen, insbesondere wegen ausstehender Workspace-/Berechtigungsprüfung.

## ZL-006: CSV-Export nach Fehler wieder freigeben

Alle fünf Validierungs-Panels mit CSV-Export ließen nach einer verzögerten
HTTP-Fehlerantwort den Exportknopf gesperrt. Reproduktion mit echten Buttons im
produktiven übergeordneten Dialog: `/tmp/zoneless-all-panel-export-red.log`
(fünf fehlgeschlagene Exportfälle, 40 bestandene übrige Fälle).
Die Panels benachrichtigen Angular jetzt bei Erfolg und Fehler des Exports.
Die Regression prüft Fehler, erneuten Button-Klick, erfolgreichen HTTP-Abschluss
und genau einen Download-Aufruf. Nur der Download-Helper wird ersetzt; dieser
Test behauptet keine Prüfung einer tatsächlich heruntergeladenen Datei.

## ZL-007: Löschaktionen nach Fehler wieder freigeben

Bei Variablen, Variablentypen und Antwortstatus blieben sowohl „Alle löschen“
als auch „Ausgewählte löschen“ nach HTTP 500 gesperrt. Sechs Tests reproduzieren
jeweils den Klick im echten übergeordneten Dialog mit echten Panel-Templates.
Der Fehlerlauf `/tmp/zoneless-delete-red.log` enthält sechs fehlgeschlagene und
45 bestandene Fälle (Exit 1). Die Komponenten benachrichtigen Angular jetzt
bei Erfolg und Fehler der Löschanfragen. Die Tests prüfen nach der Fehlerantwort
allein mit `whenStable()`, dass der Button wieder bedienbar ist und seinen
normalen Text zeigt. Ein erfolgreicher erneuter Löschvorgang und die tatsächliche
Backend-Persistenz sind damit noch nicht nachgewiesen.

Der vollständige Zoneless-Lauf besteht mit 426 Tests in 16 Suites
(`/tmp/zoneless-delete-green.log`, Exit 0).

Die allgemeine Frontend-Suite besteht mit 2.229 Tests in 213 Suites
(`/tmp/zoneless-delete-regular.log`, Exit 0).

Frontend-Lint besteht ebenfalls (`/tmp/zoneless-delete-lint-green.log`, Exit 0).
Die sechs Löschquellen sind mit Testreferenzen erfasst; ihre Szenarien bleiben
bis zur vollständigen Prüfung offen.

## ZL-008: Duplikatauflösung und Abbruch von Änderungsanfragen

Alle drei Duplikataktionen ließen nach einer verzögerten HTTP-Fehlerantwort die
Bedienelemente gesperrt. Zusätzlich liefen ihre Anfragen nach Zerstörung des
übergeordneten Dialogs weiter. Sechs neue Fälle reproduzieren beide Probleme
(`/tmp/zoneless-duplicate-lifecycle-red.log`, sechs Fehler, Exit 1).

Auch die sechs Löschaktionen für Variablen, Variablentypen und Antwortstatus
brachen ihre laufenden Änderungsanfragen beim Schließen nicht ab. Weitere sechs
Fälle reproduzieren dies (`/tmp/zoneless-delete-destroy-red.log`, sechs Fehler,
Exit 1). Alle neun Änderungsanfragen verwenden jetzt `takeUntilDestroyed`.
Die Duplikataktionen benachrichtigen Angular bei Erfolg und Fehler.

Die neun Fehlerfälle prüfen zusätzlich einen erfolgreichen Wiederholungsversuch
mit echten Services: Task erstellen, kontrolliertes Polling, Task-Abschluss,
anschließende Neuvalidierung und sichtbares Entfernen der alten Ergebniszeile.
Nur HTTP-Antworten und Timer werden kontrolliert; keine erzwungene
Änderungserkennung nach einer Antwort. Dies ist ein Komponentennachweis und
kein Nachweis der Datenbankpersistenz.

Nachweise:
- Vollständiger Zoneless-Lauf nach Abbruchkorrektur: 438 Tests / 16 Suites,
  Exit 0, `/tmp/zoneless-mutation-lifecycle-suite.log`.
- Erweiterte Dialog-Suite einschließlich erfolgreicher Wiederholung: 63 Tests,
  Exit 0, `/tmp/zoneless-mutation-retry.log`.

Der Abbruch einer HTTP-Beobachtung verspricht keinen serverseitigen Rollback
bereits gestarteter Löschjobs. Die Tests sichern ab, dass zerstörte Dialoge
keine Folgevalidierung oder Benachrichtigung mehr auslösen.

## CI-Zugriff am 30.09.2026

GitHub meldet für `068c118e` CodeQL erfolgreich und GitLab-Pipeline 102447
fehlgeschlagen. Die GitLab-Jobdetails erfordern eine angemeldete Sitzung;
die Pipeline-URL leitet im verfügbaren Browser auf die Anmeldung um.
Die konkrete Jobursache ist deshalb noch offen. Der Abdeckungsgate bleibt
unabhängig davon ohne vollständige Matrixnachweise gesperrt.

### Bereits angenommene Jobs beim Schließen

Der zusätzliche Fall `/tmp/zoneless-accepted-job-close-red.log` reproduzierte
einen hängenbleibenden Taskstatus, wenn der Dialog erst nach Annahme eines
Löschjobs geschlossen wurde. Die Änderungsservices verfolgen angenommene Jobs
nun unabhängig vom Dialog bis zum Abschluss (`shareReplay` ohne `refCount`).
Nur die Taskverfolgung bleibt bestehen; zerstörte Komponenten erhalten keine
Antwort und starten keine anschließende Validierung.

Neun Fälle prüfen das Schließen nach Taskannahme mit anschließendem Wechsel auf
Workspace 6: Gepollt und invalidiert wird weiterhin Workspace 5, der Cache von
Workspace 6 bleibt erhalten. Vor Taskannahme werden die HTTP-Abonnements beim
Schließen weiterhin beendet. Eine spätere Serverantwort auf eine bereits
abgebrochene Erstellung und ein Workspace-Wechsel bei offenem Dialog sind
separate, weiterhin offene Szenarien.

Abschließende lokale Läufe für diese Erweiterung: 447 Zoneless-Tests / 16 Suites
(`/tmp/zoneless-background-mutations-suite.log`), 2.250 allgemeine Tests /
213 Suites (`/tmp/zoneless-background-mutations-regular.log`) und Frontend-Lint
(`/tmp/zoneless-background-mutations-lint.log`), jeweils Exit 0.

Die vorhandenen 18 Browserfälle bestehen ebenfalls auf diesem Arbeitsstand
(`/tmp/zoneless-background-mutations-browser.log`, Exit 0). Die zusätzlichen
Validierungsfälle sind bislang Komponententests; der Browserlauf ersetzt deren
noch ausstehende Browser-/Backend-Abdeckung nicht. Im Browserlauf erschien eine
unbeantwortete Freshness-API-Anfrage am lokalen Proxy; die Testfixtures müssen
diese reguläre Anfrage ebenfalls abbilden.

## Browserabdeckung des Validierungsdialogs

`cypress/zoneless/validation-dialog.cy.ts` öffnet den produktiven Dialog über
`/workspace-admin/5/test-results` und lässt alle sechs Validierungs-Panels über
Task-Erstellung, Polling und Ergebnismeldungen laden. Die Material-Panels werden
über ihre sichtbaren Header geöffnet.

Fünf Exportfälle prüfen HTTP 500, erneute Freigabe, Wiederholung und den Inhalt
der tatsächlich gespeicherten CSV-Datei. Neun Änderungsfälle prüfen HTTP 500,
Wiederholung, Task-Abschluss, Neuvalidierung und den sichtbaren Erfolgszustand.
Die Tests ersetzen HTTP-Antworten, nicht die Komponenten oder Material-Controls.
Jeder Fall prüft, dass `window.Zone` fehlt. Ein nicht vorbereiteter API-Aufruf
schlägt fehl; die reguläre Freshness-Anfrage ist nun im Workspace-Fixture enthalten.

Die Aufrufkette wurde anhand von `ws-admin.routes.ts`, dem Template von
`TestGroupsComponent` und `TestResultsComponent.openValidationDialog()` geprüft.
Die Route erfordert Workspace-Zugriff ab Level 3; Systemadmins umgehen diese
Zugriffsprüfung. Die bisherigen Browserfälle verwenden einen Systemadmin.
Varianten mit eingeschränkten Rechten und die Datenbankpersistenz bleiben offen.

Die 14 neuen Browserfälle bestehen: `/tmp/zoneless-validation-browser-mutations.log`,
Exit 0. Die fünf CSV-Dateien wurden unter `cypress/downloads/` tatsächlich
geschrieben und auf ihre synthetischen Nutzdaten geprüft.

Der vollständige Zoneless-Browserlauf besteht mit 32 Fällen in sieben Specs
(`/tmp/zoneless-browser-expanded-suite.log`, Exit 0). Neben Freshness wurde
auch der reguläre Abruf der Exportprofile als Workspace-Fixture ergänzt.
Generierte CSV-Downloads bleiben lokale Testartefakte und sind in Git ignoriert.

Nach Ergänzung der Exportprofil-Fixture bestehen die vier betroffenen
Itemdatensatz-Exportfälle erneut ohne Proxy-Verbindungsfehler
(`/tmp/zoneless-export-fixture-browser.log`, Exit 0). Die Inventarprüfung
besteht (`/tmp/zoneless-browser-expanded-inventory.log`, Exit 0).
