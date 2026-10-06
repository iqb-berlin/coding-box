# Zoneless-Prüfung: risikobasierte Freigabe

## Status

Seit 01.10.2026 gilt auf ausdrücklichen Nutzerwunsch eine **risikobasierte Freigabe**.
Die Prüfung jedes einzelnen UI-Elements und aller zehn Szenarien pro Bindung
ist kein Abschlusskriterium mehr. Maßgeblich sind die sechs Fachbereiche,
sieben asynchronen Mechanismen und die Regressionen bestätigter Fehler in
`zoneless-risk-coverage.json`. Die Freigabe ist noch nicht erteilt:
Abschlussläufe und erfolgreicher CI-Nachweis des endgültigen Commits fehlen.
Ausgangspunkt: PR #1039, Commit `aaae7be16c7aeadb2abbb8d1001e367d7bccf598`.
Prüfschritte, Korrekturen und zugehörige Testergebnisse sind unten dokumentiert.
Lokale Nachweise, gepushte Änderungen und entfernte CI-Ergebnisse werden getrennt ausgewiesen.

## Prüfinfrastruktur

Alle Befehle im Repository-Verzeichnis; Validierungen nacheinander ausführen.

```sh
npx nx run frontend:zoneless-inventory
npx nx run frontend:test-zoneless --runInBand
npx nx lint frontend
npx nx test frontend --runInBand
npx nx e2e frontend --spec=cypress/e2e/zoneless-dialogs.cy.ts --browser=electron
npx nx run frontend:test-e2e-harness
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

Aktueller Umfang: 155 Komponenten, 73 Services, fünf Pipes und 24 externe
Bibliotheken. Insgesamt 8.729 Einträge einschließlich Template-Ereignissen,
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
Das Inventar bleibt eine Suchhilfe und wird kompakt mit einem Eintrag pro Zeile
gespeichert. Seine offenen Einzelprüfungen blockieren die risikobasierte Freigabe
nicht. `zoneless-approval` verlangt die sechs Fachbereiche, sieben Mechanismen,
Testreferenzen für alle dokumentierten Fehlerkorrekturen, benannte Restgrenzen
und keine offenen bestätigten Befunde. Dieser Strukturtest führt die referenzierten
Tests nicht aus; deren erfolgreiche Ausführung ist eine zusätzliche Voraussetzung.
Die alte Vollprüfung bleibt unter `zoneless-exhaustive-approval` optional verfügbar.

Die CI führt die Inventarprüfung, den separaten Jest-Lauf, Browserprüfungen
und Live-Prüfungen aus. `test-zoneless-approval` verwendet jetzt die risikobasierte
Matrix und bleibt verpflichtend. Fehlende Inventarzuordnungen und ungültige
Risikonachweise schlagen weiterhin fehl. Pipeline `102590` hat das Risikogate
und `test-frontend-zoneless` erfolgreich ausgeführt. Eine vollständige grüne CI
steht wegen der unten dokumentierten Fehler im Testaufbau noch aus.

### CI-Befunde vom 01.10.2026

Pipeline `102590`, Commit `15630c38`, bestätigt Build, allgemeine Tests,
native Zoneless-Prüfungen, Risikogate und Live-Replay. Zwei Browserjobs bestehen
jeweils 80 von 81 Fällen; der Auth-Job scheitert vor dem ersten Browsertest.

- **Linux-Rechte des Auth-Fixtures:** Keycloak läuft als UID 1000, der CI-Prozess
  erzeugte die bind-gemountete Realm-Datei als root mit Modus 0600. Das Stack-Log
  von Job `464027` bestätigt `Permission denied` beim Realm-Import. Unter Linux
  mit root wird nur diese private synthetische Datei UID 1000 zugeordnet; der
  Modus bleibt 0600. Ein Linux-Containercheck bestätigt Eigentümer, Modus und
  Lesen als UID 1000. Bestehende Dateien und Berechtigungen werden nicht geändert.
- **Budget für Guard-Weiterleitungen:** Jobs `464024` und `464025` scheitern
  bei der Kodiermanager-Weiterleitung nach 4 Sekunden. Der Fehlerscreenshot des
  Produktionsjobs zeigt bereits `/coding/statistics`. Der Test wartet jetzt
  ausdrücklich auf die erste neue Rechteantwort und gibt der Folge mehrerer
  verzögerter Guards und Lazy-Routen bis zu 15 Sekunden. Er prüft weiter die
  Zielansicht und das Ausbleiben unberechtigter Datei-/Konfigurationsanfragen.
  Retries und feste Wartepausen bleiben deaktiviert.

Diese beiden Korrekturen betreffen ausschließlich den Testaufbau. Die grüne
Ausführung des korrigierten Standes muss durch eine neue Pipeline bestätigt werden.

Pipeline `102597` bestätigt anschließend beide vollständigen Browserläufe,
allgemeine und native Zoneless-Tests, Build, Lint, Risikogate und Live-Replay.
Der Realm-Import startet; der Auth-Job erreicht jetzt alle elf Browsertests.
Sie scheitern am gemeinsamen Fehler `Web Crypto API is not available`, weil
`http://docker:<port>` kein sicherer Browserkontext ist.

Der isolierte Auth-Aufbau leitet deshalb die drei entfernten Docker-Ports für
Backend, Frontend und Keycloak auf getrennte `127.0.0.1`-Ports des Testrunners
weiter. Auch lokale Auth-Läufe verwenden diesen Weg. Die Anwendung erhält die
native Web-Crypto-API eines regulären Loopback-Kontexts; weder Browserflags noch
Crypto-Mocks oder Exception-Filter umgehen den Fehler. Der Auth-Test prüft
`isSecureContext` und `crypto.subtle` vor dem Login. Drei Harness-Tests prüfen
echte HTTP-Weiterleitung, offene Streams beim Aufräumen und Freigabe zuvor
gestarteter Listener bei einem fehlgeschlagenen Start. Sie laufen ebenfalls im
verpflichtenden Auth-CI-Job. Eine vollständige grüne Pipeline bleibt Voraussetzung.

Lokal sind die drei Harness-Tests und beide Auth-Läufe über Loopback mit jeweils
elf Fällen bestanden; alle drei Nx-Kommandos endeten mit Exit-Code 0 und die
isolierten Compose-Ressourcen wurden entfernt. Die Produktionskonfiguration
verwendet ebenfalls den echten Keycloak- und Backend-Aufbau.

CodeQL meldete am Loopback-Testaufbau zunächst eine reflektierte HTTP-Antwort
im privaten Harness-Testserver (`loopback-forwarders.test.mjs`). Dieser antwortet
jetzt mit festem Klartext und explizitem `Content-Type: text/plain`; Methode und
Pfad der empfangenen Anfrage werden separat geprüft. Es wird kein Befund
unterdrückt. Der endgültige Stand benötigt weiterhin einen grünen CodeQL- und
GitLab-Nachweis.

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

## Abschlusskriterien der risikobasierten Freigabe

- Repräsentative Prüfungen für die sechs Fachbereiche und sieben Mechanismen
  ausführen; vorhandene Regressionen bestätigter Fehler bleiben erhalten.
- Verzögerte Antworten, Fehler/Wiederholung, Fortschritt, Antwortreihenfolge,
  Kontextwechsel und Aufräumen anhand der dafür geeigneten Abläufe prüfen.
- Browsernachweise für echte Bibliotheken sowie isolierte Backend-/Keycloak-
  Nachweise für Speichern, Rechte und Sitzungswiederherstellung beibehalten.
- Lint, allgemeine Suite, native Zoneless-Suite, Browser, Live-Backend/Replay
  und Produktionskonfiguration an einem Abschlussstand erfolgreich prüfen.
- CI desselben Commits bestätigen; lokale Ergebnisse, Push und CI getrennt ausweisen.
- Keine bestätigten Fehler offen lassen; die Restgrenzen der Risikomatrix
  im Abschlussbericht ausdrücklich nennen.

Ein erfolgreicher Strukturtest allein erteilt keine Freigabe. Historische Aussagen
über eine wegen offener Einzelabdeckung gesperrte Gesamtfreigabe im folgenden
Arbeitsprotokoll beschreiben die inzwischen abgelösten Kriterien.

## Umstellung auf Risikofreigabe und Rollenprüfung am 01.10.2026

Die ursprüngliche Vollabdeckung wurde auf ausdrücklichen Nutzerwunsch durch die
oben beschriebenen Risikokriterien ersetzt. Der Commit-Review mit acht möglichen
Paketen steht in `zoneless-commit-review.md`; die veröffentlichte Historie wurde
dabei nicht umgeschrieben. Die JSON-Werte des kompakten Inventars wurden vollständig
gegen den gepushten Stand `5ff9d430` verglichen und sind identisch.

Die isolierte Keycloak-Fixture enthält zusätzlich Workspace-Rollen 0–3 und einen
persistierten Systemadministrator ohne Realm-Adminrolle. Sechs neue Browserfälle
prüfen echte Backend-Autorisierung, gespeicherte Regex-/Content-Pool-Einstellungen
und die Dateiansicht mit kontrolliert verzögerten echten Serverantworten. Verweigerte
Schreibanfragen werden anschließend über die gespeicherten Werte kontrolliert.
Die aktuelle Rechte-API vergibt keine Stufe 4; diese historische Variante bleibt
eine ausdrücklich benannte Restgrenze.

Der erste neue Lauf bestand neun von elf Fällen (Exit 1). Zwei Testaufbaufehler
betrafen ETag-Antworten mit HTTP 304; dadurch blieb eine kontrolliert angehaltene
Anfrage bis zum Test-Timeout offen. Die Tests entfernen jetzt den bedingten
Cache-Header dieser Requests und prüfen echte neue Backend-Antworten. Der frühere
unterbrochene Lauf erwartete für fehlende Adminrechte fälschlich HTTP 403; der
vorhandene AdminGuard liefert HTTP 401. Dafür war keine Produktänderung notwendig.

| Prüfung der Umstellung | Ergebnis | Exit-Code | Lokales Artefakt |
|---|---|---:|---|
| Isolierter Backend-/Keycloak-Lauf, Zoneless | 11 von 11 Browserfällen bestanden; Compose-Ressourcen entfernt | 0 | `tmp/zoneless-audit/risk-auth-zoneless-final.log` |
| Isolierter Backend-/Keycloak-Lauf, Produktionskonfiguration | 11 von 11 Browserfällen bestanden; Compose-Ressourcen entfernt | 0 | `tmp/zoneless-audit/risk-auth-production.log` |
| Inventar-/Risiko-Schutztests | Zwei Tests einschließlich Negativfällen bestanden | 0 | `tmp/zoneless-audit/risk-matrix-tests.log` |
| Risikobasierte Referenzprüfung | Sechs Bereiche, sieben Mechanismen, 25 Befunde zugeordnet | 0 | `tmp/zoneless-audit/risk-approval.log` |
| Frontend-Lint | bestanden | 0 | `tmp/zoneless-audit/risk-lint.log` |
| Allgemeine Frontend-Suite | 2.482 Tests in 222 Suites bestanden | 0 | `tmp/zoneless-audit/risk-frontend-tests.log` |
| Native Zoneless-Suite | 737 Tests in 28 Suites bestanden | 0 | `tmp/zoneless-audit/risk-native-tests.log` |
| Produktionsbuild | bestanden | 0 | `tmp/zoneless-audit/risk-production-build.log` |

Dies sind lokale Nachweise. Der zuletzt ausgelesene entfernte Stand `5ff9d430`
meldet erfolgreiches CodeQL und eine fehlgeschlagene GitLab-Pipeline 102578.
Die GitLab-Detailseite verlangt eine Anmeldung; der konkrete Jobfehler ist nicht
bestätigt. Die Umstellung selbst hat noch keinen erfolgreichen CI-Nachweis.

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

## ZL-016: Metadatenabruf nach Schließen der Dateivalidierung

16 kontrollierte Fälle reproduzieren Folgeanfragen, Metadatendialoge oder
Fehlermeldungen nach Schließen beziehungsweise Zerstörung in allen vier
Phasen: Dateisuche, Download, Unit-Profil und Item-Profil. Erfolg und Fehler
sind je Phase geprüft (`/tmp/zoneless-metadata-lifecycle-red.log`, 16 Fehler,
29 bestehende Tests bestanden, Exit 1).

Der Abruf erhält einen gemeinsamen Abbruchkanal, der sowohl HTTP-Observables
als auch das Warten auf Resolver-Promises beendet. Ladebenachrichtigung und
Schließ-/Zerstörungslistener werden aufgeräumt. Der Workspace wird einmal
beim Start erfasst. Die 16 Fälle bestehen; acht zusätzliche Fälle prüfen
Erfolg und Fehler bei weiterhin geöffnetem Dialog. Insgesamt 53 Tests der
Dateivalidierung bestehen (`/tmp/zoneless-metadata-lifecycle-expanded.log`,
Exit 0). Abbruchtests warten auf das Ende der Methode, bevor sie die alte
Antwort liefern; nach Abbruch ist kein HTTP-Subscriber mehr vorhanden.

Technische Grenze: MetadataResolver 0.2.0 bietet am verwendeten öffentlichen
Aufruf keinen AbortSignal-Parameter. Bereits laufende Profilauflösung samt
bibliotheksinternen Vokabularabrufen kann daher weiterlaufen. Ihr Ergebnis
und ihre Fehler werden nach Abbruch verworfen; der Aufrufer startet keine
weitere Phase und öffnet keine Ansicht mehr. Workspace-Wechsel über den
produktiven Aufrufer bleibt separat offen.

## ZL-017: Metadateneditor nach Timer und Webkomponenten-Ereignissen

Mit echtem Angular-Template und kontrolliertem Bootstrap der Webkomponente
bleibt die Ladeanzeige nach dem Initialisierungstimer stehen. Ein natives
metadataChange-Ereignis aktualisiert den Speichern-Button ebenfalls nicht.
Weitere Tests zeigen einen weiterlaufenden Initialisierungstimer und einen
noch aktiven Listener nach Zerstörung. Der bereinigte Reproduktionslauf
gegen den bisherigen Editor bestätigt alle vier Fehler
(`/tmp/zoneless-metadata-dialog-red-final.log`, Exit 1). Der Timertest
prüft Auswirkungen auf ein nachfolgendes Formular; eine frühere globale
Timerzählung war wegen zusätzlicher Framework-Timer ungeeignet.

Die Komponente benachrichtigt Angular nach Initialisierung und Metadaten-
Änderungen, entfernt Timer und Listener bei Zerstörung und startet nach
verspätetem Bootstrap keine Initialisierung mehr. Die vier Regressionen
bestehen (`/tmp/zoneless-metadata-dialog-green-final.log`, Exit 0).

Der erweiterte Browserfall nutzt die echte Metadatenbibliothek und ein
synthetisches Textprofil. Er prüft den verzögerten Abruf über die
Dateivalidierung, das Ende der Ladeanzeige, gesperrtes und editierbares
Textfeld sowie den sichtbaren Speichern-Button nach Eingabe. Alle drei
Browserfälle bestehen (`/tmp/zoneless-metadata-browser-green.log`, Exit 0).
Die früheren Browserläufe scheiterten an Sichtbarkeitsprüfungen leerer
Host-Elemente und sind keine Reproduktionsnachweise des Zoneless-Fehlers.
Keine Backend-Persistenz wird behauptet; dieser Aufrufer öffnet Metadaten
zur Ansicht. Mehrere gleichzeitig geöffnete Metadatendialoge, sämtliche
Feldtypen und weitere Einbettungen bleiben offen.

Abschlussprüfungen dieses Schritts: Frontend-Lint
(`/tmp/zoneless-metadata-all-lint.log`), 643 native Tests in 24 Suites
(`/tmp/zoneless-metadata-native.log`) und 2.388 allgemeine Frontend-Tests
in 218 Suites (`/tmp/zoneless-metadata-regular.log`) bestehen jeweils mit
Exit 0. Die Matrix ordnet die Teilnachweise den Metadaten-Abrufen sowie
Timer und Ereignislistener des Editors zu; Gesamtfreigaben bleiben offen.

## ZL-018: Gleichzeitig geöffnete Metadatendialoge

Vier neue native Tests mit zwei echten Dialogtemplates reproduzieren die
globale Formularzuordnung: Initialisierung überschreibt das erste Formular,
Bearbeitungsmodus und Profilwechsel treffen die falsche Instanz, und ein
Metadatenereignis des zweiten Formulars erreicht nicht dessen Dialog.
`/tmp/zoneless-metadata-multiple-red.log`: vier neue Fehler, vier bestehende
Tests bestanden, Exit 1.

MetadataDialogComponent verwendet jetzt ViewChild mit einer lokalen
Template-Referenz für Initialisierung, Profilwechsel und Bearbeitungsmodus.
Die mehrfach vergebene globale DOM-ID entfällt. Alle acht nativen Fälle
bestehen (`/tmp/zoneless-metadata-multiple-green.log`, Exit 0).

Drei zusätzliche Browserfälle öffnen über den produktiven Dateivalidierungs-
aufrufer per Doppelklick zwei Metadatendialoge, während beide Anfragen noch
laufen. Download-Verzögerungen 150/150, 300/150 und 150/300 Millisekunden
prüfen unterschiedliche Antwortreihenfolgen ohne Test-Retries. Die tatsächliche
Metadatenbibliothek erhält unterschiedliche synthetische Werte. Beide Werte
werden angezeigt; Bearbeiten und Texteingabe im oberen Dialog lassen Wert,
Sperre und Speichern-Schaltfläche des unteren Dialogs unverändert. Zusammen
mit den drei bisherigen Fällen bestehen sechs Browsertests
(`/tmp/zoneless-metadata-multiple-browser.log`, Exit 0).

Die Prüfung deckt diese konkrete Mehrfachöffnung mit Textfeldern ab. Sie
ersetzt weder die Prüfung aller Metadatenfeldtypen und Einbettungen noch
den abschließenden dreifachen Lauf sämtlicher asynchroner Kernabläufe.

Abschlussprüfungen dieses Schritts bestehen mit Exit 0: Frontend-Lint
(`/tmp/zoneless-metadata-multiple-lint.log`), 647 native Tests in 24 Suites
(`/tmp/zoneless-metadata-multiple-native.log`), 2.392 allgemeine Frontend-
Tests in 218 Suites (`/tmp/zoneless-metadata-multiple-regular.log`).
Die Matrix enthält Teilnachweise für die Instanzzuordnung und die drei
Antwortreihenfolgen; keine pauschale Komponentenfreigabe.

CI-Zwischenstand: GitHub meldet für e349759c CodeQL SUCCESS und die
GitLab-Pipeline 102471 FAILURE. Die Pipeline-Seite
https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/102471 leitet am
30.09.2026 beim lesenden Abruf auf `/users/sign_in` um. Die konkreten
fehlgeschlagenen Jobs und ihre Ursachen sind damit nicht bestätigt.
Der Status darf nicht allein dem weiterhin offenen Abdeckungsgate
zugeschrieben werden. Dieser CI-Stand gehört zum vorherigen Commit.

## Laufende Erweiterung: Vokabulare und Dateivalidierungsabschluss

Die echte Metadatenbibliothek erwartet `vocabularyProvider`; die bisher gesetzte
Eigenschaft `resolver` versorgte die Inline-Auswahl nicht. Der lokale Adapter
normalisiert optionale Resolver-Felder ohne Änderung der Quelldaten. Zusätzlich
fehlte dem separat gestarteten Bibliotheks-Injektor der TranslateService für den
Vokabulardialog. Die lokale Registrierung nutzt nun die Injektorhierarchie der
Anwendung. Elf fokussierte native Tests bestehen
(`/tmp/zoneless-metadata-integration-native.log`, Exit 0). Diese Änderungen sind
noch nicht abschließend freigegeben.

Der anschließende Browserlauf reproduzierte NG0100 in TestFilesComponent beim
Öffnen der Vokabularauswahl. Fortschritt und Abschluss der Dateivalidierung
benachrichtigen Angular jetzt ausdrücklich. Im Folgelauf ist die strikte
Console-Prüfung erfolgreich; Auswahl, Bestätigung und Entfernen eines
Vokabularchips funktionieren. Der Lauf bleibt mit sieben bestandenen und einem
fehlgeschlagenen Fall rot (`/tmp/zoneless-validation-notification-browser.log`,
Exit 1): Die Dauer entspricht nach der Eingabe nicht dem erwarteten Wert.
Eine unmittelbar nach der Eingabe ergänzte Assertion lokalisiert das Problem
bereits auf das Minutenfeld (`/tmp/zoneless-duration-input-browser.log`, Exit 1).
Die Bibliothek formatiert ein geleertes Feld sofort als „00“. Der Test prüft
als Nächstes das Ersetzen einer markierten Eingabe; Leeren und Neueingabe bleibt
als eigener Bedienungsbefund offen. Keine Exception wird unterdrückt.

Auch das Ersetzen der markierten Eingabe zeigt einen Bibliotheksfehler:
Minuten „2“ werden korrekt als „02“ angezeigt, aber die nacheinander getippten
Sekunden „15“ erscheinen als „51“ (`/tmp/zoneless-duration-replace-browser.log`,
Exit 1, sieben übrige Browserfälle bestanden). Die sofortige Rückformatierung
bei jedem ngModelChange verändert die Eingabeposition. Dieser Befund ist noch
nicht behoben; der Test behält die Erwartung „15“ bei.

### Dauer-Eingabe: Korrektur und Browsernachweis

Die Eingabeereignisse zeigen keinen Fokuswechsel zwischen Leeren und Tippen.
ProfileFormComponent liest native Zahlenfelder bereits in der Capture-Phase
und schreibt den berechneten Wert über das Formular zurück. Deshalb reicht
es nicht, nur die Formatierung in durationChange zu verschieben.
Die lokale MetadataDurationComponent bewahrt während des Fokus eigene
Eingabetexte und normalisiert beim Verlassen des Feldes. Der Bibliotheksselektor
`iqb-formly-duration` bleibt erhalten, weil der übergeordnete native Handler
hierüber Minuten und Sekunden zusammenliest. Umrechnung und Grenzwerte
werden weiterhin aus der Bibliothekskomponente übernommen. Externe
Control-Änderungen benachrichtigen Angular; Subscriptions enden bei Zerstörung.

Der Browser prüft weiterhin echtes Leeren und Tippen, sichtbare Werte 02:15,
Inline-Vokabulare, Dialogauswahl und Entfernen des Chips. Alle acht Fälle
bestehen (`/tmp/zoneless-duration-draft-browser.log`, Exit 0). Dreizehn
fokussierte native Tests bestehen (`/tmp/zoneless-duration-draft-native.log`,
Exit 0); der Regressionstest wird zusätzlich um die Rückmeldung des
übergeordneten Controls während jeder Eingabe erweitert. Die vollständigen
Suites, aktualisierte Matrix und Veröffentlichung dieses Schritts stehen noch aus.


Abschlussprüfungen für die Metadatenkorrekturen: 652 native Zoneless-Tests
(`/tmp/zoneless-metadata-complete-native.log`) und 2.397 allgemeine Frontend-Tests
(`/tmp/zoneless-metadata-complete-regular.log`) bestehen mit Exit 0. Frontend-Lint
besteht (`/tmp/zoneless-duration-final-lint.log`, Exit 0). Der erweiterte
Regressionstest mit Control-Rückmeldungen besteht ebenfalls
(`/tmp/zoneless-duration-echo-native.log`, 13 Tests, Exit 0).
Das aktualisierte Inventar umfasst 8.728 Einträge; Teilnachweise sind zugeordnet,
Gesamtfreigaben bleiben offen.
Der Produktionsbuild besteht ebenfalls
(`/tmp/zoneless-metadata-production-build.log`, Exit 0), ebenso die erneute
Inventarprüfung (`/tmp/zoneless-metadata-inventory-final.log`, Exit 0).
Dieser Build ersetzt keinen Browserlauf gegen das Produktionsartefakt.

## ZL-019: Vokabularzustand gleichzeitig geöffneter Formulare

Die gesamte vorhandene Zoneless-Browsersuite besteht am gepushten Commit
c4007124: 50 Tests in zehn Dateien, Exit 0
(`/tmp/zoneless-all-browser-c4007124.log`). Ein anschließend ergänzter Fall
mit unterschiedlichen Vokabularen bestätigt zunächst die korrekte
Inline-Darstellung. Die später geöffnete Baum-Auswahl des ersten Dialogs ist
nach Bearbeiten und Schließen des zweiten jedoch leer
(`/tmp/zoneless-distinct-vocab-dialog-red.log`, acht bestehende Fälle bestanden,
ein neuer Fehler, Exit 1). Die Bibliothek liest für diesen Dialog den zuletzt
gesetzten Provider aus dem gemeinsamen MetadataService.

Die Registrierung erzeugt nun für jede Webkomponenteninstanz einen eigenen
MetadataService über einen Element-Injektor. Übersetzungen und gemeinsame
Formly-Konfiguration werden weiterhin von der Anwendung geerbt. Der native
Test prüft getrennte Serviceinstanzen und denselben Übersetzungsdienst;
14 fokussierte Metadatentests bestehen
(`/tmp/zoneless-vocab-isolation-native.log`, Exit 0). Der erste Browserversuch
nach der Korrektur scheiterte an der abstrakten Rückgabetypisierung von
createCustomElement (TS2656); die konkrete HTMLElement-Konstruktorschnittstelle
ist nun explizit typisiert. Dieser Compilerfehler war kein Laufzeitbefund.

Die erweiterte Browserprüfung besteht nach der Korrektur mit neun Fällen
(`/tmp/zoneless-vocab-isolation-browser-final.log`, Exit 0): Beide
Inline-Auswahlen bleiben getrennt; nach Schließen des zweiten Dialogs lädt
die Baum-Auswahl des ersten weiterhin dessen Begriff und übernimmt ihn als
sichtbaren Chip. Frontend-Lint besteht
(`/tmp/zoneless-vocab-isolation-lint-final.log`, Exit 0). Die Elementklasse liegt
als eigene Factory in metadata-profile-element.ts, entsprechend der
Projektregel für eine Klasse je Datei.

Abschluss dieses Schritts: 653 native Tests
(`/tmp/zoneless-vocab-isolation-full-native.log`), 2.398 allgemeine Tests
(`/tmp/zoneless-vocab-isolation-full-regular.log`), erneute Inventarprüfung
(`/tmp/zoneless-vocab-isolation-inventory-final.log`) sowie neun Browserfälle
mit der endgültigen Factory-Datei
(`/tmp/zoneless-vocab-isolation-factory-browser.log`) bestehen jeweils mit
Exit 0. Die Gesamtfreigabe bleibt offen. CodeQL für c4007124 ist erfolgreich;
GitLab-Pipeline 102483 war beim letzten lesenden Abruf weiterhin Pending.

## ZL-020: Dateivalidierung nach Verlassen der Ansicht

Zwei neue native Tests mit echtem TestFilesComponent-Template zeigen
weiter abonnierte Anfragen beim Anlegen eines Validierungsjobs und beim
Laden des Ergebnisses nach Zerstörung der Ansicht
(`/tmp/zoneless-files-validation-lifecycle-red.log`, zwei Fehler, ein
bestandener Fehler-/Wiederholungsfall, Exit 1). Die gesamte Validierungskette
endet jetzt über takeUntilDestroyed; dies umfasst auch Timer und laufende
Polling-Anfragen. Beide Regressionen bestehen.

Drei weitere Szenarien prüfen den sichtbaren Fehlerzustand mit erneuter
Ausführung, Fortschritt 10/55 mit anschließendem Abbruch des Pollings sowie
100 Prozent mit verzögertem Ergebnis und Ende des Overlays. Insgesamt fünf
Fälle bestehen (`/tmp/zoneless-files-validation-completion.log`, Exit 0).
Nach Antworten gibt es keine manuell erzwungene Änderungserkennung. Dialog
und Snackbar sind an der Komponentengrenze gemockt. Der erste Polling-Test
blockierte durch mitgefälschte Angular-Scheduler-Timer; queueMicrotask und
requestAnimationFrame bleiben im korrigierten Aufbau echt. Workspace-Wechsel,
überlappende Starts und automatische Testtaker-Erstellung bleiben gesondert offen.

## ZL-021: Workspace und überlappende Dateivalidierungen

Vier Fälle reproduzieren verspätete Erfolge beziehungsweise Fehler nach
Workspace-Wechsel in den Phasen Jobanlage und Ergebnisabruf. Ein fünfter
Fall zeigt zwei Jobanlagen bei doppeltem Start
(`/tmp/zoneless-files-workspace-red.log`, fünf Fehler, fünf bestehende Fälle
bestanden, Exit 1). Folgeanfragen, Ergebnisdialoge und Fehlermeldungen prüfen
jetzt den beim Start erfassten Workspace. Ein aktiver Lauf verhindert eine
zweite Jobanlage.

Zwei zusätzliche Polling-Fälle prüfen verspäteten Zwischenstand und Abschluss
nach einem Workspace-Wechsel. Der alte Zwischenstand ließ das Overlay stehen
(`/tmp/zoneless-files-poll-context-red.log`, ein Fehler, elf bestandene Fälle,
Exit 1). Eine weitere Prüfung ohne eintreffende Statusantwort zeigte, dass
die aktive Anfrage trotz Workspace-Wechsel weiter abonnierte
(`/tmp/zoneless-files-pending-context-red.log`, ein Fehler, zwölf bestandene
Fälle, Exit 1). Beim nächsten regulären Polling-Intervall wird jetzt die alte
Anfrage abbestellt und der Lauf ohne Folgeabruf beendet. Die Verzögerung
beträgt höchstens das vorhandene 300-ms-Intervall.

Alle 13 fokussierten Fälle bestehen
(`/tmp/zoneless-files-context-expanded-green.log`, Exit 0). Die Tests verwenden
weiterhin das echte Template und erzwingen nach Antworten keine Erkennung.
Ein Wechsel hin und zurück vor Eintreffen einer Antwort und die automatische
Testtaker-Erstellung sind dadurch noch nicht geprüft. Die vollständigen
Abschlussläufe und Browsernachweise dieses Schritts folgen separat.

Abschlussläufe für ZL-020/ZL-021 bestehen mit Exit 0: Frontend-Lint
(`/tmp/zoneless-files-context-lint-corrected.log`), 666 native Tests in 27 Suites
(`/tmp/zoneless-files-context-full-native.log`), 2.411 allgemeine Frontend-Tests
in 221 Suites (`/tmp/zoneless-files-context-full-regular.log`) und zehn
Browserfälle (`/tmp/zoneless-files-progress-browser.log`). Der neue Browserfall
prüft die produktive Dateiansicht, Doppelklick, genau eine Jobanlage sowie
sichtbaren Fortschritt 10/55/100, Ende des Overlays und echten Ergebnisdialog.
Die neuen Workspace-/Abbruchfälle haben weiterhin ausschließlich native
Nachweise; die Browserprüfung behauptet deren Abdeckung nicht.

Die Inventarmatrix ordnet diese Teilnachweise den Validierungsquellen zu und
bleibt insgesamt offen. CI für den vorherigen Commit bacdc625 meldet CodeQL
SUCCESS und GitLab-Pipeline 102491 FAILURE. Die konkrete Jobursache ist ohne
Zugriff auf deren Logs nicht bestätigt.

## ZL-022: Rückkehr zum selben Workspace während einer Validierung

Vier neue Fälle prüfen Jobanlage und Ergebnisabruf, jeweils mit Erfolg und
Fehler nach einem Workspace-Wechsel 1 → 2 → 1. Ein fünfter Fall startet nach
der Rückkehr eine frische Validierung und liefert anschließend das alte
Ergebnis. Alle fünf reproduzieren die fehlende dauerhafte Abmeldung
(`/tmp/zoneless-files-roundtrip-red.log`, fünf Fehler, 13 bestehende Fälle
bestanden, Exit 1). Der Vergleich der aktuellen ID allein erkennt den
zwischenzeitlichen Wechsel nicht.

Die Anfragekette wird jetzt durch das vorhandene selectedWorkspaceId$-Ereignis
bereits beim ersten Wegwechsel beendet. Der Polling-Abbruch wartet dadurch
nicht mehr auf das 300-ms-Intervall. Die Prüfungen verwenden den echten
AppService samt dessen Workspace-Setter; nur LogoService liefert eine
kontrollierte leere Antwort. Ein zusätzlicher globaler Aktualisierungs- oder
Überwachungstimer wird nicht benötigt. Die frühere Polling-Prüfung der aktuellen
ID entfällt zugunsten des Abbruchs der gesamten Kette.

Drei weitere Fälle prüfen verspäteten Zwischenstand, Abschluss und Fehler
eines abgebrochenen Pollings nach Rückkehr zum gleichen Workspace.
Alle 21 Fälle bestehen (`/tmp/zoneless-files-roundtrip-expanded.log`, Exit 0).
Eine alte Antwort verändert weder den frischen Ladezustand noch dessen
Subscription. Diese neuen Kontextfälle haben native Nachweise mit echtem
Template; Browser- und vollständige Abschlussläufe folgen separat.

Die Abschlussläufe für ZL-022 bestehen mit Exit 0: Frontend-Lint
(`/tmp/zoneless-files-roundtrip-lint.log`), 674 native Tests in 27 Suites
(`/tmp/zoneless-files-roundtrip-full-native.log`) und 2.419 allgemeine Tests
in 221 Suites (`/tmp/zoneless-files-roundtrip-full-regular.log`).
Zwölf Browserfälle bestehen (`/tmp/zoneless-files-roundtrip-browser.log`).
Zwei neue Browserfälle verlassen die produktive Dateiansicht während Jobanlage
beziehungsweise Ergebnisabruf und öffnen sie erneut. Sie warten auf die
kontrollierte alte Serveranfrage und prüfen anschließend, dass kein alter
Ergebnisdialog und kein altes Overlay erscheinen. Eine alte Jobantwort löst
keinen Ergebnisabruf aus. Diese Browsernavigation zerstört und erzeugt die
Dateiansicht; das Wiederverwenden derselben Instanz bei ID-Wechsel wird durch
die nativen Tests mit echtem AppService geprüft.
Die Matrix ordnet diese Nachweise den zwei Quellen zu; die Gesamtfreigabe
bleibt wegen weiterer Abläufe und Rollen offen.

## ZL-023: Automatische Testtaker-Erstellung und Folgeaktionen

Acht neue Fälle reproduzieren weiter aktive Bestätigungsdialog-Abonnements,
Datei-Anfragen und den Wiederholungstimer nach Zerstörung der Ansicht oder
Workspace-Wechsel 1 → 2 → 1. Bei Fehler beziehungsweise false-Antwort bleibt
außerdem das Ladeoverlay stehen (`/tmp/zoneless-dummy-lifecycle-red.log`,
acht Fehler, 21 bestehende Fälle bestanden, Exit 1).

Die Bestätigung, Datei-Anfrage und der Timer verwenden nun den erfassten
Workspace sowie takeUntil und DestroyRef. Nach Abbruch werden Ladezustand
und Angular-Benachrichtigung aufgeräumt. Erfolgreiche Erstellung lädt die
Dateiliste neu und validiert nach dem bisherigen Ein-Sekunden-Timer erneut.
Das Ende der Erstellungsanfrage setzt den inzwischen begonnenen
Dateilisten-Ladezustand nicht zurück. Die Schließabonnements der beiden
Ergebnisdialogpfade enden ebenfalls bei Navigation und Workspace-Wechsel.

35 fokussierte Fälle bestehen (`/tmp/zoneless-dummy-dialog-expanded.log`,
Exit 0). Zusätzliche Fälle prüfen die erfolgreiche Erstellung mit noch
laufendem Dateilistenabruf, den regulären Wiederholungstimer, Ablehnung der
Erstellung und vier Abbruchfälle der Ergebnisdialog-Rückmeldung. Diese
nativen Prüfungen verwenden das echte Dateiansicht-Template und den echten
AppService; MatDialog und Snackbar sind an ihrer Grenze gemockt.
Frontend-Lint besteht (`/tmp/zoneless-dummy-lint-final.log`, Exit 0).


Abschlussprüfungen für ZL-023: 688 native Tests in 27 Suites
(`/tmp/zoneless-dummy-full-native.log`) und 2.433 allgemeine Tests in 221 Suites
(`/tmp/zoneless-dummy-full-regular.log`) bestehen mit Exit 0. Vierzehn Browserfälle
bestehen (`/tmp/zoneless-dummy-browser.log`, Exit 0). Zwei neue Browserfälle
prüfen den echten Bestätigungsdialog: Ablehnen startet keine Erstellung;
HTTP 500 löst eine sichtbare Fehlermeldung aus, eine erneute Bestätigung führt
zu erfolgreicher Erstellung, sichtbarem Dateilisten-Ladezustand und anschließend
zur automatischen Validierung. API-Fixtures zählen zwei Erstellungsversuche
und drei Validierungsjobs. Backend-Persistenz wird hier nicht nachgewiesen.
Das Inventar enthält nun 8.729 Einträge. Teilnachweise sind den sechs Quellen
zugeordnet; die Gesamtfreigabe bleibt offen.


## ZL-024: Dateiliste, Antwortreihenfolge und verzögerte Suche

15 neue native Fälle reproduzieren das Überschreiben neuer Dateilisten durch
alte Antworten, das vorzeitige Ende des Ladeoverlays durch alte Abschlüsse
und weiter aktive Anfragen nach Zerstörung oder Workspace-Wechsel
(`/tmp/zoneless-file-list-fixture-red.log`, 15 Fehler, 37 bestandene Fälle,
Exit 1). Filter, Pagination und erneutes Laden werden jeweils mit drei festen
Antwortfolgen geprüft: alte Antwort zuerst, neue Antwort zuerst und alter Fehler.
Der erste Versuch enthielt eine unvollständige Testdatei ohne file_type und
scheiterte im echten Template; die oben angegebene Reproduktion verwendet die
vollständige synthetische Dateizeile.

Ein weiterer Fall mit dem echten SearchFilterComponent zeigt nach dessen
300-ms-Debouncing und dem folgenden 300-ms-Timer der Dateiansicht eine
laufende Anfrage ohne sichtbares Ladeoverlay
(`/tmp/zoneless-file-list-debounce-red.log`, ein Fehler, Exit 1).

Beim Beginn eines neuen Abrufs wird nun die vorherige Subscription beendet,
bevor der neue Ladezustand gesetzt wird. Workspace-Ereignisse und DestroyRef
beenden den Abruf auch ohne weitere Antwort; ein Wechsel 1 → 2 → 1 kann den
alten Abruf nicht wieder aktivieren. Der neue Ladezustand benachrichtigt Angular
bereits beim Start, sodass auch die verzögerte Suche sichtbar lädt.
API-Parameter und fachliche Filterregeln bleiben unverändert.

53 fokussierte native Fälle bestehen nach der Korrektur
(`/tmp/zoneless-file-list-green.log`, Exit 0). Zwei zusätzliche Fälle prüfen das
Zerstören der Ansicht während beider Debouncing-Phasen. Die Tests verwenden
das echte Dateiansicht- und Suchfeld-Template und erzwingen nach Antworten
keine Änderungserkennung. Snackbar und Dialog bleiben an ihrer Grenze gemockt.

Acht neue Browserfälle bestehen
(`/tmp/zoneless-file-list-browser-focused.log`, Exit 0): verzögerte Suche samt
sichtbarer Ladeanzeige und deaktivierter Validierung, leerer Zustand,
HTTP 500 mit Wiederholung, echter Paginator mit zurückgesetzter Auswahl,
drei Antwortfolgen sowie Navigation während des Abrufs mit erneutem Öffnen.
Die drei Überlappungsfälle senden die zweite Suche mit force trotz des
Ladeoverlays; sie prüfen gezielt einen Kontextwechsel während der Anfrage,
keine reguläre Bedienbarkeit durch das Overlay. Die übrigen Fälle verwenden
regulär verfügbare Controls. Der erste Browserlauf scheiterte bei vier
Suchfeldeingaben am überlagernden Material-Label; vorheriger Fokus behebt den
Testaufbau. Es gibt keine Exception-Unterdrückung oder Test-Retries.
Rollen und Backend-Persistenz bleiben separat offen.

Die vollständigen Jest-Läufe bestehen mit Exit 0: 708 native Tests in 27 Suites
(`/tmp/zoneless-file-list-full-native.log`) und 2.453 allgemeine Tests in
221 Suites (`/tmp/zoneless-file-list-full-regular.log`). Der allgemeine
TestFilesComponent-Aufbau stellt nun auch selectedWorkspaceId$ als
kontrollierten Subject bereit. Die beiden zusätzlichen Abbruchprüfungen
während des Debouncings sind in beiden Läufen enthalten.

Die gesamte vorhandene Zoneless-Browsersuite besteht mit 64 Tests in elf
Spezifikationen (`/tmp/zoneless-file-list-all-browser.log`, Exit 0).
Die Inventarmatrix bleibt bei 8.729 Einträgen. Die Dateilisten-Subscription
und die beiden Debouncing-Quellen erhalten gezielte Teilnachweise; Rollen,
weitere Refresh-Aufrufer und die vollständige fachliche Abdeckung bleiben offen.

Frontend-Lint (`/tmp/zoneless-file-list-lint-final.log`), Inventarprüfung
(`/tmp/zoneless-file-list-inventory-final.log`) und Produktionsbuild
(`/tmp/zoneless-file-list-production-build.log`) bestehen mit Exit 0.
22 ausgewählte Browserfälle für Dateiliste, Validierung und echte Metadaten-
Web-Components bestehen außerdem mit der optimierten Produktionskonfiguration
(`/tmp/zoneless-file-list-production-browser.log`, Exit 0). Der vorhandene
CI-Browserjob nimmt die neue Dateilisten-Spezifikation über das Zoneless-
Konfigurationsmuster automatisch auf. Der Gesamtfreigabegate bleibt wegen
8.729 unvollständiger Gesamteinträge gesperrt
(`/tmp/zoneless-file-list-approval.log`, Exit 1).


## CI-Prüfung der vollständigen Produktions-Browsersuite

Der neue Job test-browser-production erweitert test-browser-zoneless und
verwendet frontend:e2e mit configuration=production sowie
cypress.zoneless.config.ts. Dadurch laufen alle vorhandenen Zoneless-
Browserspezifikationen auch mit optimierten Produktionsbundles. Der Job
erbt Image, Regeln, Dependencies und Fehlerartefakte; allow_failure wird
nicht gesetzt. Die vorhandene Keycloak-/Backend-Prüfung bleibt ein separater
Live-Nachweis.

Der vollständige lokale Produktionslauf besteht mit 64 Fällen in elf
Spezifikationen (`/tmp/zoneless-production-all-browser.log`, Exit 0).
Die Konfiguration lässt sich mit js-yaml und dem vorhandenen GitLab-
!reference-Sequenztyp parsen. Der entfernte CI-Lauf dieses neuen Jobs ist
noch nicht bestätigt. Alle Browserdaten bleiben synthetische API-Fixtures;
diese Suite ersetzt weder Backend-Persistenztests noch die offene fachliche
Gesamtabdeckung.


## ZL-025: Verzögerte Dateiansicht-Einstellungen und Suchmodus

Elf native Fälle reproduzieren die fehlende Darstellung einer geänderten
Regex-Einstellung und weiter aktive Settings-Subscriptions nach Navigation,
Workspace-Wechsel und Rückkehr 1 → 2 → 1
(`/tmp/zoneless-file-settings-red.log`, elf Fehler, 59 bestandene Fälle,
Exit 1). Beide Einstellungsabrufe binden sich jetzt an den beim Start erfassten
Workspace und DestroyRef. Die Regex-Antwort benachrichtigt Angular.
Normale aktivierte, deaktivierte und tokenlose Content-Pool-Konfigurationen
waren bereits korrekt dargestellt und behalten ihre Regeln.

Vier zusätzliche Fälle zeigen, dass ein zunächst als Textsuche gesendeter
Abruf nach dem verspäteten Wechsel auf Regex aktiv bleibt und keine passende
Regex-Anfrage entsteht
(`/tmp/zoneless-file-settings-query-context-red.log`, vier Fehler, Exit 1).
Bei geändertem Modus und vorhandenem Suchtext endet nun die alte Anfrage.
Eine gültige Suche wird erneut geladen; ein ungültiger Regex sendet keinen
neuen Abruf. Drei feste Antwortfolgen sichern alte Erfolge und Fehler gegen
die neue Suche ab.

82 fokussierte native Fälle in zwei Suites bestehen
(`/tmp/zoneless-file-settings-expanded-green.log`, Exit 0). Acht davon verwenden
die echten WorkspaceSettingsService- und ContentPoolIntegrationService-
Implementierungen mit HttpTestingController. Sie prüfen Darstellung, HTTP-500-
und JSON-Fallback sowie Abbruch der Content-Pool-Anfrage. Der bestehende
WorkspaceSettingsService hält seine gemeinsam genutzte HTTP-Anfrage für den
Cache absichtlich bis zum Abschluss aktiv. Eine danach eintreffende Antwort
des alten Workspaces verändert die abgemeldete Ansicht nicht. Der gemeinsame
Cache wurde nicht verändert.

16 Dateilisten-Browserfälle bestehen nach Ergänzung der neuen Abläufe
(`/tmp/zoneless-file-settings-browser-ready.log`, Exit 0). Sie prüfen die
verzögerte Regex-Einstellung, Content-Pool-Konfiguration mit und ohne Token,
HTTP-500 mit erneutem Öffnen, Navigation während einer alten Config-Anfrage
und drei Antwortfolgen beim Wechsel des Suchmodus.
Ein zuvor gezielt unterbrochener Lauf geriet beim Reload einer Hash-Route
in eine Auth-Mock-Schleife mit wiederholt angehängten #code-Fragmenten.
Der Browserzustand und ein CPU-Profil belegten den noch laufenden Prozess
(`/tmp/zoneless-file-settings-browser-stall.cpuprofile`). Nx meldete beim
Beenden des Cypress-Prozesses Exit 0, ohne vollständige Cypress-Zusammenfassung.
Dieser Lauf wird ausdrücklich nicht als bestanden gewertet. Der erneute
Browserstart verwendet die vorhandene Auth-Fixture an der Startseite.
Drei weitere Testaufbaufehler entstanden durch Navigation vor Ende der
Anmeldesequenz; der sichtbare Home-Zustand dient nun als Bereitschaftsnachweis.
Keine Produkt-Authentifizierung wurde geändert.

Sieben Browser-Rollenfälle bestehen
(`/tmp/zoneless-file-settings-roles-browser-consistent.log`, Exit 0).
Zugriffsstufen 0/1/2 erreichen die Dateiansicht nicht und senden keinen
Dateilisten- oder Content-Pool-Konfigurationsabruf. Stufen 3/4 und beide
Systemadmin-Varianten sehen die echte Dateiansicht und korrekt aktualisierte
Settings. Ein erster Rollenlauf scheiterte an einer widersprüchlichen Fixture:
Keycloak admin mit authData.isAdmin=false. JwtStrategy.validateKeycloakPayload
ruft syncKeycloakUser auf; diese Methode setzt bei der Adminrolle auch das
persistierte isAdmin auf true. Die Fixture bildet nun diesen bestehenden
Backend-Vertrag ab. Berechtigungsregeln und Backend wurden nicht verändert.

Zwei zusätzliche Regressionen sichern überlappende Datei- und Validierungsanfragen:

- Das Neuladen der Dateiliste setzte `isValidating` zurück und entfernte die
  laufende Fortschrittsanzeige
  (`/tmp/zoneless-file-settings-validation-overlap-red.log`, ein Fehler, Exit 1).
- Ein erfolgreicher Validierungsabschluss setzte `isLoading` zurück und entfernte
  die Ladeanzeige einer noch laufenden Dateianfrage
  (`/tmp/zoneless-file-settings-validation-success-red.log`, ein Fehler, ein
  bestandener Fall, 74 gezielt nicht ausgewählte Fälle, Exit 1).

Die beiden Abläufe setzen jetzt nur ihren eigenen Zustand zurück. Die native
Regression prüft Erfolg und Fehler des Validierungsjobs während einer noch
aktiven Dateianfrage sowie die Sperre gegen einen zweiten Validierungsstart.
Die Browserfälle steuern Settings-, Datei- und Jobantworten mit getrennten
Freigaben und prüfen beide Abschlussreihenfolgen.

Der erste vollständige Browserlauf dieses Arbeitsstands besteht 79 von 80
Fällen; ein Fall scheitert an der strikten Prüfung unerwarteter Requests
(`/tmp/zoneless-file-settings-all-browser-final.log`, Exit 1). Der echte
Ergebnisdialog ruft zusätzlich die Workspace-Einstellungen ab. Die fehlende
synthetische Antwort wurde gezielt ergänzt; die Fehlerprüfung bleibt aktiv.

CI-Abfrage am 01.10.2026: Der PR-Head `45e12f4f` hat erfolgreiche CodeQL-Prüfungen
und einen fehlgeschlagenen GitLab-Status für Pipeline 102576. Der direkte Abruf
der Jobliste liefert eine Bot-Schutz-Seite anstelle von Jobdaten. Die
konkrete Fehlerursache ist damit nicht bestätigt; dieser Status wird weder
als Erfolg noch allein als Folge des offenen Abdeckungsgates interpretiert.

Nach beiden Korrekturen besteht der vollständige native Zoneless-Lauf mit
737 Tests in 28 Suites
(`/tmp/zoneless-file-settings-full-native-final.log`, Exit 0). Der vollständige
Browserlauf besteht 81 Fälle in zwölf Spezifikationen
(`/tmp/zoneless-file-settings-all-browser-green.log`, Exit 0). Enthalten sind
18 Dateilistenfälle und sieben Fälle mit den echten Browser-Guards. Die beiden
überlappenden Abläufe verwenden kontrollierte Freigaben statt zufälliger
Wartezeiten; alle Browserfälle dieser Suite laufen ohne Test-Retries.

Dieselben 81 Browserfälle bestehen mit Produktionseinstellungen
(`/tmp/zoneless-file-settings-production-all-browser.log`, Exit 0). Die Suite
prüft das Fehlen von `window.Zone`; echte Material-Overlays, Tabellen,
Auswahlzustände und Dialoge bleiben Bestandteil der Prüfung. Die API-Antworten
dieses Browserlaufs sind weiterhin synthetische Fixtures.

### Abschlussläufe für ZL-025

Die folgenden Läufe verwenden denselben unveränderten App- und Teststand.
Nachträglich wurden ausschließlich Nachweise und Matrix-Zuordnungen ergänzt.

| Prüfung | Ergebnis | Exit | Lokales Protokoll |
|---|---|---|---|
| Native Zoneless-Suite | 737 Tests / 28 Suites bestanden | 0 | `/tmp/zoneless-file-settings-full-native-final.log` |
| Allgemeine Frontend-Suite | 2.482 Tests / 222 Suites bestanden | 0 | `/tmp/zoneless-file-settings-general-suite-final.log` |
| Vollständige Zoneless-Browsersuite | 81 Fälle / zwölf Spezifikationen bestanden | 0 | `/tmp/zoneless-file-settings-all-browser-green.log` |
| Vollständige Browsersuite mit Produktionseinstellungen | 81 Fälle / zwölf Spezifikationen bestanden | 0 | `/tmp/zoneless-file-settings-production-all-browser.log` |
| Frontend-Lint | bestanden | 0 | `/tmp/zoneless-file-settings-lint-complete.log` |
| Produktionsbuild | bestanden | 0 | `/tmp/zoneless-file-settings-production-build.log` |
| Inventarprüfung | 8.729 Einträge, keine Abweichung | 0 | `/tmp/zoneless-file-settings-inventory-final.log` |
| Regression des Inventarprüfers | ein Test bestanden | 0 | `/tmp/zoneless-file-settings-inventory-tests.log` |
| Vollständige Zoneless-Freigabe | 8.729 Einträge ohne vollständigen Nachweis | 1 | `/tmp/zoneless-file-settings-approval-final.log` |

229 Matrixeinträge haben Testreferenzen, 67 haben Szenarionachweise. Alle
Gesamtfreigaben bleiben offen. Die Settings-Nachweise unterscheiden die
getesteten Browser-Guards von der noch ausstehenden Prüfung tatsächlicher
Backend-Berechtigungen und gespeicherter Konfiguration. Weitere Upload-,
Download-, Metadaten- und Refresh-Aufrufer bleiben ebenfalls offen.
Diese Ergebnisse geben ZL-025 lokale Regressionsevidenz; die gesamte
fachliche Abdeckung und erfolgreiche entfernte CI sind nicht bestätigt.
Die `/tmp`-Protokolle sind lokale Nachweise und keine veröffentlichten
CI-Artefakte.
