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

GitHub meldet für `22ab592a` CodeQL erfolgreich und GitLab-Pipeline 102457
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

## ZL-009: Workspace-Navigation nach verzögerten Rechten

Die Browserprüfung mit Workspace-Level 3 und 4 reproduzierte eine leere
Testergebnisansicht nach erfolgreicher Navigation: Die Rechteantwort änderte
normale Komponentenfelder, ohne Angular zu benachrichtigen. Zwei Tests mit
`RouterTestingHarness` und echtem Template bestätigen denselben Fehler.
Nachweise: `/tmp/zoneless-validation-access-initial.log` (zwei Fehler) und
`/tmp/zoneless-workspace-navigation-red.log` (zwei Fehler), jeweils Exit 1.

Drei weitere Tests reproduzierten alte Rechte nach einem Workspace-Wechsel,
Jobanfragen nach Zerstörung der Ansicht und mehrfach angelegte Auth-Abonnements
(`/tmp/zoneless-workspace-context-red.log`, drei Fehler, Exit 1).

`WsAdminComponent` beobachtet Route und Auth-Daten jetzt gemeinsam. Neue
Kontexte beenden die vorherigen Rechte- und Jobanfragen; beim Zerstören werden
alle Abonnements beendet. Die Navigation benachrichtigt Angular nach einer
Aktualisierung. Beim Kontextwechsel werden alte Zugriffs- und Jobanzeigen
zurückgesetzt. Die Berechtigungsregeln bleiben unverändert.

Neun Regressionstests verwenden echtes Routing und Templates. Sie prüfen
verzögerte Rechte für Level 3/4, alte Rechte- und Jobantworten, Zerstörung,
einmalige Auth-Verarbeitung sowie erfolgreiche, leere und fehlerhafte
Jobantworten ohne zusätzliche UI-Interaktion. Vollständiger Zoneless-Lauf:
456 Tests bestanden (`/tmp/zoneless-workspace-context-suite.log`, Exit 0).

Zwei zusätzliche Regressionstests sichern Rechteaktualisierungen ab: Solange
für denselben Nutzer und Workspace eine neue Antwort aussteht, bleibt die
aktuelle Ansicht erhalten. Enthält die Antwort den Nutzer nicht mehr, werden
seine bisherigen Zugriffsanzeigen entfernt. Beide Fehler wurden zuerst durch
fehlgeschlagene Tests nachgewiesen (`/tmp/zoneless-workspace-refresh-red.log`
und `/tmp/zoneless-workspace-revoke-red.log`, Exit 1). Anschließend bestehen
alle elf Workspace-Tests (`/tmp/zoneless-workspace-revoke-green.log`, Exit 0).

## ZL-010: Verspätete Weiterleitung der Startseite

Die Rollenprüfung im Browser zeigte, dass eine ausstehende Rechteantwort der
Startseite eine bereits begonnene Navigation durch `/coding` ersetzen konnte.
Die Startseite ist während ausstehender Route-Guards noch nicht zerstört;
`takeUntilDestroyed` allein verhindert diesen Konflikt deshalb nicht.

Zwei Regressionstests reproduzieren dies mit ausstehender Rechteantwort und
mit ausstehender Auth-Aktualisierung (`/tmp/zoneless-home-navigation-red.log`,
2 Fehler, Exit 1). Die Startseite merkt sich jetzt `NavigationStart` und
verwirft danach ihre automatische Weiterleitung. Normale automatische
Weiterleitungen bleiben durch die bestehenden Rollentests abgesichert.
Die Home-Tests laufen zusätzlich im nativen Zoneless-Target. Der vollständige
Lauf bestand mit 485 Tests in 18 Suites (`/tmp/zoneless-navigation-suite.log`,
Exit 0); der danach ergänzte Rechteentzugsfall wurde separat geprüft.

Die Browserprüfung aller fünf Rollen besteht ohne Zone.js und ohne Retries
(`/tmp/zoneless-navigation-access-browser.log`, 5 Tests, Exit 0). Die
vollständigen Abschlussprüfungen für diesen Arbeitsstand sind noch offen.
Diese Befunde erteilen keine vollständige Zoneless-Freigabe.


Weitere Prüfungen des Navigationsstands: Frontend-Lint besteht
(`/tmp/zoneless-navigation-lint.log`, Exit 0), ebenso die reguläre Suite mit
2.263 Tests in 214 Suites (`/tmp/zoneless-navigation-regular.log`, Exit 0).
Die Matrix ist auf die aktuellen Quellen aktualisiert und enthält weiterhin
8.706 Einträge. Die Inventarprüfung besteht
(`/tmp/zoneless-navigation-inventory.log`, Exit 0). Teilnachweise für Home und
Workspace-Navigation sind zugeordnet; ihre Gesamteinträge bleiben offen.

Der erste vollständige Browserlauf dieses Stands bestand mit 36 von 37 Tests;
der Kodierendenfall landete erneut auf `/coding`
(`/tmp/zoneless-navigation-browser-all.log`, Exit 1). Der frühere erfolgreiche
Einzellauf ist deshalb kein Nachweis für eine zuverlässige Antwortreihenfolge.
Die Rollen-Fixture hält jetzt die Home-Rechteantwort zurück, wartet auf die
sichtbare Startseite und gibt die Antwort nach dem Hash-Navigationsereignis
frei. Eine erste Variante, die auf einen weiteren HTTP-Aufruf wartete, lief in
einen Timeout und wurde ersetzt. Der kontrollierte Rollenlauf besteht mit fünf
Tests (`/tmp/zoneless-navigation-controlled-browser-2.log`, Exit 0); ein neuer
vollständiger Browserlauf ist gestartet. Es gibt weiterhin keine Test-Retries.

Der vollständige Browserlauf mit kontrollierter Rollen-Fixture besteht:
37 Tests in acht Specs, keine übersprungenen Tests, keine Retries
(`/tmp/zoneless-navigation-browser-final.log`, Exit 0). Die zuvor fehlgeschlagenen
Läufe bleiben als Gegenbelege zur ursprünglichen Fixture dokumentiert.

Der abschließende native Zoneless-Lauf enthält auch den Rechteentzugsfall:
486 Tests in 18 Suites bestanden
(`/tmp/zoneless-navigation-native-final.log`, Exit 0).

## ZL-011: Validierungsergebnisse beim Workspace-Wechsel

31 neue Regressionstests reproduzierten falsche Workspace-Zuordnungen
(`/tmp/zoneless-validation-context-all-red.log`, 31 Fehler, Exit 1):

- Alle sechs Validierungsarten: Wechsel während Erstellung, Polling oder Ergebnisabruf.
- Alle fünf paginierten Validierungsarten: verspätete Seitenantwort.
- Acht Lösch-/Auflösungsaktionen: verspätete Bestätigung der Auftragserstellung.

Die Dienste halten nun den beim Start erfassten Workspace für Task-Zuordnung,
Polling, Ergebnisabruf, Cache-Schreiben und Abschlussbereinigung fest. Die
Anfragen und fachlichen Auswertungen bleiben ansonsten unverändert.
Alle 31 Tests bestehen (`/tmp/zoneless-validation-context-green.log`, Exit 0).

Drei weitere Regressionstests verwenden die echten übergeordneten Dialoge und
Templates für Variablen, Variablentypen und Antwortstatus. Während eine Seite
für Workspace 5 aussteht, wird ein Dialog für Workspace 6 geöffnet. Die alte
Antwort darf dessen sichtbaren Inhalt und Cache nicht überschreiben. Der
Dialog-Testlauf besteht (`/tmp/zoneless-validation-context-dialog.log`, Exit 0).
Nach der Antwort wird keine Erkennung von Änderungen erzwungen.

Die Lebensdauer eines weiterhin geöffneten Dialogs beim Workspace-Wechsel und
seine anschließenden Aktionen benötigen separate Prüfung. Diese Korrektur
belegt die Zuordnung bereits begonnener Anfragen, keine vollständige Freigabe
sämtlicher Workspace-Wechselabläufe.

Frontend-Lint besteht nach Formatkorrekturen in den neuen Tests
(`/tmp/zoneless-validation-context-lint-fixed.log`, Exit 0). Der vollständige
native Zoneless-Lauf besteht mit 520 Tests in 19 Suites
(`/tmp/zoneless-validation-context-native.log`, Exit 0).
Die reguläre Frontend-Suite besteht mit 2.297 Tests in 215 Suites
(`/tmp/zoneless-validation-context-regular.log`, Exit 0). Die aktualisierte
Inventarprüfung besteht (`/tmp/zoneless-validation-context-inventory.log`,
Exit 0); die sechs Validierungsdienste enthalten nun konkrete Teilnachweise
für den Kontextwechsel. Ihre Gesamteinträge bleiben offen.
Die 14 betroffenen Browserfälle für CSV-Export, Löschen und Duplikatauflösung
bestehen ebenfalls (`/tmp/zoneless-validation-context-browser.log`, Exit 0,
keine Retries). Ein Browsernachweis für den Workspace-Wechsel selbst bleibt
separat offen; hierfür liegen bislang native Dienst- und Dialogtests vor.

## ZL-012: XML-Abruf und Kopierbestätigung

Ein Regressionstest mit echtem Validierungsdialog bestätigt, dass der
Unit-XML-Abruf beim Zerstören weiterlief. Der Abruf wird nun in dessen
bestehende Subscription-Bereinigung aufgenommen. Der verzögerte Erfolgsfall
verwendet den echten Material-Inhaltsdialog mit XML-Viewer. Nach Ergänzung der
Übersetzungsprovider in der Testumgebung bestehen beide neuen Fälle und die
75 bestehenden Dialogfälle (`/tmp/zoneless-validation-xml-green.log`, Exit 0).
Der Abbruchtest war zuvor rot (`/tmp/zoneless-validation-xml-red.log`, Exit 1;
der zusätzliche Providerfehler in diesem ersten Lauf war ein Fixturefehler).

Drei neue Tests mit echtem XML-Viewer-Template bestätigten außerdem:
Die Kopierbestätigung wurde nach 1,5 Sekunden nicht sichtbar zurückgesetzt,
ein alter Timer setzte eine spätere Kopierbestätigung zurück, und nach
Zerstörung blieb der Timer aktiv (`/tmp/zoneless-xml-copy-red.log`, 3 Fehler,
Exit 1). Der Viewer benachrichtigt jetzt Angular beim Ablauf und beendet
vorherige Timer bei erneutem Kopieren sowie beim Zerstören. Alle drei Tests
bestehen (`/tmp/zoneless-xml-copy-green.log`, Exit 0). Die Zeit wird kontrolliert
vorgespult; nach Timerablauf erzwingen die Tests keine UI-Aktualisierung.

Die Browsererweiterung öffnet XML über die Links aller drei betroffenen Panels.
Der erste Lauf erreichte die noch eingeklappten Details nicht; der Test wurde
um den regulären Klick auf „Details anzeigen“ ergänzt. Der nächste Lauf
öffnete die XML-Dialoge, erhielt im Headless-Browser beim nativen Kopieren aber
keinen Erfolgswert. Für den UI-Erfolgsfall wird deshalb ausschließlich
`document.execCommand('copy')` kontrolliert beantwortet und der übergebene
synthetische XML-Text geprüft. Material-Dialog, XML-Viewer und CDK-Clipboard
bleiben real. Dies ist kein Nachweis für die Betriebssystem-Zwischenablage.
Fehlgeschlagene Läufe: `/tmp/zoneless-validation-xml-browser.log` und
`/tmp/zoneless-validation-xml-browser-fixed.log`, jeweils Exit 1.
Der Browserlauf mit kontrollierter Clipboard-Antwort besteht mit 17 Tests,
ohne Retries (`/tmp/zoneless-validation-xml-browser-controlled.log`, Exit 0).

Abschließende lokale Prüfungen für diesen Stand: Frontend-Lint besteht
(`/tmp/zoneless-xml-lint.log`, Exit 0), der native Zoneless-Lauf besteht mit
530 Tests in 20 Suites (`/tmp/zoneless-xml-native.log`, Exit 0), die reguläre
Frontend-Suite mit 2.307 Tests in 216 Suites (`/tmp/zoneless-xml-regular.log`,
Exit 0). Die Inventarprüfung besteht (`/tmp/zoneless-xml-inventory.log`, Exit 0).
Die zusätzlichen XML-Viewer-Tests prüfen auch Kopierfehler, Input-Wechsel,
leeres/fehlerhaftes XML und Zeilenumbruch. Die Matrix nennt die weiteren
Einbettungen in BookletInfoDialog und UnitInfoDialog ausdrücklich als offen.

## Erweiterung: Booklet- und Unit-Informationsdialoge

Zehn neue native Tests öffnen beide Komponenten über echte Material-Dialoge.
Sie prüfen sämtliche vorhandenen Tabs, den eingebetteten Kopier-Timer,
minimale Daten ohne optionale Tabs sowie beide Schließen-Schaltflächen und
erneutes Öffnen nach einer aktiven Kopierbestätigung. Es wurde dabei kein
weiterer Produktionsfehler bestätigt. Die initialen Daten werden vom Aufrufer
vor dem Öffnen geladen; die Dialoge selbst starten keinen Serverabruf.

Nachweise: `/tmp/zoneless-info-dialogs-expanded.log` (10 Tests),
`/tmp/zoneless-info-native.log` (540 Tests), `/tmp/zoneless-info-regular.log`
(2.317 Tests) und `/tmp/zoneless-info-dialogs-lint.log`, jeweils Exit 0.

Zwei Browserfälle öffnen die Dialoge über die echte Ergebnistabelle und
kontrollierte Serverantworten. Sie prüfen einen fehlgeschlagenen Abruf mit
anschließendem erfolgreichen Versuch, Metadaten, XML-Kopieranzeige und
Schließen (`/tmp/zoneless-info-browser.log`, Exit 0). Der anschließende Ausbau
prüft zusätzlich sämtliche optionalen Tabs, Zeilenumbruch und Kopierfehler
mit erneutem Versuch. Die Clipboard-API bleibt dabei eine kontrollierte
Browsergrenze; ein Betriebssystem-Clipboard-Nachweis wird nicht behauptet.

Weitere produktive Aufrufer sind der hierarchische Ergebnisbrowser,
FilesValidationComponent, BookletSearchDialog, UnitSearchDialog und
CodingVariablesDialog. Ihre asynchronen Aufrufe sowie Navigation und
Workspace-Wechsel während des Ladens bleiben gesondert offen. Die neuen
Nachweise decken nicht automatisch alle diese Aufrufketten ab.
Der erweiterte Browserlauf besteht mit beiden Fällen
(`/tmp/zoneless-info-browser-expanded.log`, Exit 0). Die aktualisierte
Inventarprüfung besteht (`/tmp/zoneless-info-inventory.log`, Exit 0).
Diese Erweiterung enthält ausschließlich Tests und Abdeckungsnachweise.

## ZL-013: Informationsabrufe nach Verlassen der Ergebnistabelle

Drei Tests mit der echten Tabellenkomponente reproduzieren verspätete
Folgeaktionen nach Zerstörung: Booklet-Antwort und Unit-Info-Antwort öffneten
noch Dialoge; eine verspätete Personen-/Testheftantwort startete noch den
Unit-Info-Abruf (`/tmp/zoneless-info-navigation-red.log`, 3 Fehler, Exit 1).
Diese drei Abonnements enden jetzt mit dem Lebenszyklus der Komponente.

Zwei zusätzliche Prüfungen innerhalb derselben Fälle bestätigten, dass die
Ladebenachrichtigung beim Abbruch stehenblieb
(`/tmp/zoneless-info-loading-red.log`, Exit 1). Die Informationsabrufe räumen
sie nun auch beim Abbestellen auf. Der fokussierte Lauf besteht mit 20 Tests
(`/tmp/zoneless-info-loading-green.log`, Exit 0).

Die Korrektur betrifft die Ergebnistabelle. Vergleichbare Aufrufer in anderen
Komponenten bleiben separat offen. Der Workspace-Fall folgt im nächsten Absatz.

Die gleiche Prüfung wurde um Workspace-Wechsel ohne Zerstörung und verspätete
Fehler erweitert. Sechs neue Fälle waren rot: alte Antworten öffneten Dialoge,
starteten Folgeabrufe oder meldeten Fehler im neuen Workspace
(`/tmp/zoneless-info-workspace-errors-red.log`, 6 Fehler, Exit 1).
Die Informationsaufrufe erfassen nun ihren Workspace und verwerfen Erfolg
sowie Fehler, wenn dieser nicht mehr aktuell ist. Der Unit-Folgeabruf verwendet
den erfassten Workspace. Insgesamt zwölf neue Lebenszyklus-/Kontextfälle und
17 bestehende Tabellentests bestehen
(`/tmp/zoneless-info-workspace-green.log`, 29 Tests, Exit 0).
Der erweiterte native Zoneless-Lauf besteht mit 552 Tests
(`/tmp/zoneless-info-navigation-native-final.log`, Exit 0), ebenso Frontend-Lint
(`/tmp/zoneless-info-navigation-lint-final.log`, Exit 0).

Die vollständige allgemeine Frontend-Suite besteht mit 2.329 Tests in 217
Suites (`/tmp/zoneless-info-navigation-regular.log`, Nx erfolgreich). Die beiden
Browserfälle mit echten Informationsdialogen bestehen ebenfalls
(`/tmp/zoneless-info-navigation-browser.log`, Exit 0). Die zwölf neuen
Abbruch-/Kontextfälle sind Komponententests; ein Browsernachweis dieser
negativen Folgeaktionen sowie ein Workspace-Wechsel hin und zurück fehlen
weiterhin. Die Matrix ordnet die neuen Nachweise den drei Informationsabrufen
zu und lässt deren Gesamtfreigabe offen.

## ZL-014: Informationsabrufe im hierarchischen Ergebnisbrowser

Acht neue Tests mit dem echten Template von TestResultsComponent reproduzieren
verspätete Booklet-/Unit-Dialoge und Fehlermeldungen nach Zerstörung der Ansicht
oder Wechsel von Workspace 1 zu 2. Beide Antwortarten (Erfolg und Fehler) sind
kontrolliert: `/tmp/zoneless-hierarchical-info-red.log`, acht Fehler, Exit 1;
die 26 bestehenden Komponententests bestanden bereits im nativen Lauf.

Die beiden Abonnements enden jetzt mit DestroyRef; finalize schließt die
Ladebenachrichtigung auch beim Abbruch. Erfolg und Fehler prüfen den beim
Start erfassten Workspace. Der fokussierte Lauf besteht mit 34 Tests
(`/tmp/zoneless-hierarchical-info-green.log`, Exit 0). Die bisherige Testsuite
dieser Komponente gehört nun zusätzlich zum separaten Lauf ohne Zone.js.
Keine Template-Ersetzung und keine erzwungene Erkennung nach einer Antwort
werden für die neuen Fälle verwendet. MatDialog und Snackbar sind an dieser
Komponentengrenze gemockt; die neuen negativen Fälle haben noch keinen eigenen
Browsernachweis. Auswahlwechsel innerhalb desselben Workspace und Wechsel
hin und zurück bleiben gesondert offen.

Abschlussprüfungen dieses Schritts: Frontend-Lint
(`/tmp/zoneless-hierarchical-info-lint.log`), 586 native Tests in 22 Suites
(`/tmp/zoneless-hierarchical-info-native.log`), 2.337 allgemeine Tests in 217
Suites (`/tmp/zoneless-hierarchical-info-regular.log`) und zwei bestehende
Browserfälle der Tabellenansicht (`/tmp/zoneless-hierarchical-info-browser.log`)
bestehen jeweils mit Exit 0. Die Browserfälle prüfen die echten Info-Dialoge,
sind aber kein Nachweis für die neuen negativen Fälle des hierarchischen
Aufrufers. Beide geänderten Quellen erhalten Teilnachweise in der Matrix;
die Gesamtfreigabe bleibt offen.

## ZL-015: Folgeaktionen nach Schließen der Dateivalidierung

Die Informationsabrufe für Booklet, Unit und Kodierschema sowie der
TestTaker-XML-Abruf konnten nach Zerstörung des übergeordneten Dialogs oder
nach Beginn seiner Schließanimation noch weitere Dialoge beziehungsweise
Fehlermeldungen öffnen. Nach Korrektur der MatDialog-Mock-Zuordnung
(`overrideProvider` wegen des importierten MatDialogModule) reproduziert
der fokussierte Lauf alle 16 neuen Abbruchfälle zuverlässig:
`/tmp/zoneless-file-all-info-red.log`, 16 Fehler und sechs bestehende Tests
bestanden, Exit 1. Frühere rote Läufe enthielten zusätzlich Testaufbaufehler
und sind nicht der abschließende Reproduktionsnachweis.

Die vier Abrufe verwenden jetzt beforeClosed und DestroyRef. Die drei
Ladebenachrichtigungen werden außerdem durch finalize beim Abbruch entfernt.
Alle 16 Fälle bestehen (`/tmp/zoneless-file-all-info-green.log`, Exit 0).
Vier verzögerte erfolgreiche Abrufe sowie drei Fehler-/Wiederholungsfälle
sichern die weiterhin erlaubten Folgeaktionen ab; insgesamt 29 Tests
bestehen (`/tmp/zoneless-file-info-expanded.log`, Exit 0). Die Suite läuft
zusätzlich im nativen Target ohne Zone.js mit unverändertem Template.

Die Prüfung ersetzt keine Workspace-Prüfung über TestFilesComponent: Der
Dialog erhält eine feste Workspace-ID in MAT_DIALOG_DATA. Metadatenabrufe
mit mehreren await-Schritten, weitere Mutationen und deren Aufrufer bleiben
ausdrücklich offen. Die Abbruchtests prüfen die Dialog-/Snackbar-Grenze mit
Mocks; tatsächliche sichtbare Dialoginhalte werden separat im Browser geprüft.

Der neue Browserfall `cypress/zoneless/file-validation-info.cy.ts` öffnet
die Dateivalidierung über TestFilesComponent, wählt den TestTaker-Tab und
prüft HTTP 500, sichtbare Fehlermeldung, Wiederholung und den echten XML-Viewer
mit verzögerter HTTP-200-Antwort. Strikte API-Fixtures und die Prüfung auf
fehlendes window.Zone bleiben aktiv. Der erste Lauf scheiterte an der
Fixture ohne `?type=testFiles` (`/tmp/zoneless-file-info-browser.log`, Exit 1);
der korrigierte Lauf besteht (`/tmp/zoneless-file-info-browser-final.log`,
ein Browserfall, Exit 0). Kein Retry und keine Exception-Unterdrückung.
Frontend-Lint besteht (`/tmp/zoneless-file-info-lint-final.log`, Exit 0).

Der Browserfall für Booklet-Informationen prüft ebenfalls Fehler und
Wiederholung aus dem tatsächlichen Dateivalidierungsdialog. Der erste
erweiterte Lauf prüfte Metadaten noch im aktiven XML-Tab und scheiterte
(`/tmp/zoneless-file-info-browser-expanded.log`, Exit 1). Nach regulärer
Auswahl des Metadaten-Tabs bestehen beide Fälle
(`/tmp/zoneless-file-info-browser-expanded-final.log`, Exit 0).

Die vollständigen Läufe bestehen: 615 native Tests in 23 Suites
(`/tmp/zoneless-file-info-native.log`, Exit 0) und 2.360 allgemeine
Frontend-Tests in 217 Suites (`/tmp/zoneless-file-info-regular.log`, Exit 0).
Die vier geänderten asynchronen Quellen erhalten gezielte Teilnachweise
in der Matrix. Ihre Gesamtfreigabe bleibt offen.
