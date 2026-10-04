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

### Zusätzliche Regressionen vom 03.10.2026

- **Browserabdeckung für manuelle Vorbereitung:** 16 zusätzliche Fälle prüfen
  verzögerte Schulungslisten und Referenzauswahl, Filter und Auswahl im
  Schulungsvergleich, Variablenkarten nach echtem Debounce, Speicherfehler mit
  Wiederholung, verzögerte Rollenrechte und den erreichbaren Bulk-Definitionsablauf.
  Die neue Workspace-Navigation reproduzierte einen weiteren Fehler in der
  Bulk-Vorschau (**ZL-046**); die Korrektur und Nachweisgrenzen stehen unten.
  Die vorhandenen CI-Jobs `test-browser-zoneless` und `test-browser-production`
  erfassen die drei betroffenen Cypress-Dateien automatisch.
- **ZL-041 – Schemer-Rückmeldungen:** `vosReadNotification` und der Timer zum
  Ausblenden aktualisierten ein normales Feld ohne Angular-Benachrichtigung.
  Die Meldung ist jetzt ein Signal. Ein neuer Hinweis ersetzt den bisherigen
  Ausblendetimer; beim Schließen wird der Timer beendet. Die native Regression
  `unit-schemer.component.zoneless.spec.ts` prüft Anzeige und Ausblenden im echten
  Template ohne zusätzliche Change Detection.
- **ZL-042 – Workspace-Benutzerliste:** Die Tabelle hing für verzögerte Antworten
  an einer Änderung des globalen Ladesignals. Wenn eine andere Anfrage dieses
  bereits auf `false` setzte, blieb die normale Datasource-Zuweisung unsichtbar.
  Die Datasource ist jetzt ein Signal und aktualisiert auch leere Ergebnisse.
  Leseanfragen und Initialisierungstimer beider Benutzeransichten enden beim
  Verlassen der Ansicht; der Ladezustand wird bei Abschluss oder Abbruch
  freigegeben. `ws-users.component.zoneless.spec.ts` prüft verzögerte Antworten
  mit unverändertem Ladesignal, leere Ergebnisse, Auswahlrücksetzung und verspätete
  Antworten nach dem Zerstören beider Ansichten.

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
Bibliotheken. Insgesamt 8.783 Einträge einschließlich Template-Ereignissen,
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

### ZL-026: Replay-Statistik bleibt nach der Serverantwort im Ladezustand

Ausgangspunkt ist PR #1039, Commit `2351fc108e2dae9cfbfc07bb3b3b41959de1b2bd`.
Die Statistikantworten änderten gewöhnliche Felder. Ohne Zone.js blieb der
Spinner stehen, obwohl alle Antworten vorlagen. Ladezustand, Statistik- und
Diagrammdaten sowie die durch ResizeObserver aktualisierten Diagrammgrößen
sind jetzt Signals. Sortierte Daten werden als neue Arrays veröffentlicht.

Die native Regression verwendet das echte Template und verzögerte Subjects.
Sie prüft den erfolgreichen Abschluss sowie Fehler beim Frequenzabruf und
bei der letzten Anfrage, ohne nach den Antworten `detectChanges()` oder
`markForCheck()` aufzurufen. Der damalige Browserfall verwendete echte ngx-charts (in der Migration
vom 03.10.2026 durch native SVG-Diagramme ersetzt) und prüft das Ende des Ladezustands, die Kennzahlen und den gerenderten Balken
nach der verzögerten letzten Antwort. `window.Zone` muss fehlen.

### ZL-027: Kodierbuch-Fortschritt und Abschluss aktualisieren die Ansicht nicht

Jobstatus, Fortschritt und Fehleranzeige wurden nach asynchronen Antworten
in gewöhnliche Felder geschrieben. Dadurch blieben Fortschrittsanzeige und
Export-Schaltfläche veraltet. Diese Felder sowie die asynchron geladenen
Auswahllisten sind jetzt Signals. Ausgewählte Einheiten und Exportoptionen
werden unveränderlich aktualisiert; der Validierungszustand wird abgeleitet.

Sechs native Regressionen prüfen verzögerte Einheitenlisten, deren Ladefehler,
64 Prozent Fortschritt, Jobabschluss, Pollingfehler mit Zurücksetzen sowie
Start- und Downloadfehler. Zwei Browserfälle öffnen den echten Material-Dialog,
ändern eine Exportoption und prüfen den Request sowie Fortschritt und beide
Job-Ausgänge. API-Antworten sind synthetische Fixtures; Produktion und externe
CI sind kein Bestandteil dieses lokalen Nachweises.

### Lokale Abschlussläufe für ZL-026 und ZL-027 am 02.10.2026

Die App- und Testquellen blieben während aller Abschlussläufe unverändert.
Aktualisiert wurden ausschließlich Inventar, Testreferenzen und Dokumentation.

| Nx-Prüfung | Ergebnis | Exit |
|---|---|---|
| `frontend:test --maxWorkers=2` | 2.527 Tests / 227 Suites bestanden | 0 |
| `frontend:test-zoneless --maxWorkers=2` | 765 Tests / 32 Suites bestanden, darunter neun neue Regressionen | 0 |
| `frontend:e2e --configuration=zoneless --spec=cypress/zoneless/statistics-codebook.cy.ts` | Drei neue Browserfälle bestanden | 0 |
| `frontend:lint` | bestanden | 0 |
| `frontend:build --configuration=production` | bestanden | 0 |
| `frontend:zoneless-approval` | Inventar ohne Abweichung, sechs Bereiche / sieben Mechanismen / 27 Befunde referenziert | 0 |

Die vorhandenen Zoneless- und Browser-Targets erfassen die neuen Spezifikationen
automatisch. Diese lokalen Ergebnisse sind kein CI-Nachweis. Die CI des
veröffentlichten Commits ist gesondert zu prüfen.


### ZL-028: Cohen-Kappa-Dialog bleibt nach verzögerter Antwort im Ladezustand

Ausgangspunkt ist PR #1039, Commit `214646b01814bfcc18376c349612e9f145425de9`.
Im echten Template blieb nach einer verzögerten Statistikantwort der Spinner
stehen. Auch der Fehlerpfad und die Freigabe der Exportbuttons schrieben
gewöhnliche Felder ohne Angular-Benachrichtigung. Ladezustand, Statistik,
Zusammenfassung, Trainings- und Kodiererauswahl, Filter sowie Exportzustand
verwenden jetzt Signals; abhängige Freigaben und Hinweistexte sind Computeds.
Die bestehenden Anfrage- und Scope-Regeln bleiben erhalten.

Elf Regressionen in `cohens-kappa-statistics.component.zoneless.spec.ts` prüfen
verzögerten Erfolg, Leerzustand, Fehler, vertauschte Trainingsantworten,
Gewichtungswechsel über das gebundene Material-Control sowie Erfolg und Fehler
aller drei Exportvarianten. Die Tests liefern Antworten über echte Timer und
warten anschließend auf Angular-Stabilität, ohne manuelles `detectChanges()`
oder `markForCheck()`. Der bestehende Zoneless-Target erfasst die Datei automatisch.

`cypress/zoneless/cohens-kappa.cy.ts` öffnet den Dialog über die Durchführung der
manuellen Kodierung. Die drei Fälle prüfen verzögerten Erfolg einschließlich
Gewichtungswechsel und Exportfehler sowie Leerzustand und HTTP-Fehler. Die App
läuft mit `frontend:serve:zoneless`; `window.Zone` muss fehlen. Alle API-Antworten
und die Anmeldung sind synthetische Fixtures. Beim HTTP-Fehler bildet der echte
Service wie bisher eine leere Statistik, während der Komponententest zusätzlich
den direkten Observable-Fehlerpfad prüft.

### Lokale Abschlussläufe für ZL-028 am 02.10.2026

| Nx-Prüfung | Ergebnis | Exit |
|---|---|---|
| `frontend:test --maxWorkers=2` | 2.538 Tests / 228 Suites bestanden | 0 |
| `frontend:test-zoneless --maxWorkers=2` | 776 Tests / 33 Suites bestanden | 0 |
| `frontend:e2e --configuration=zoneless --spec=cypress/zoneless/cohens-kappa.cy.ts` | Drei Browserfälle bestanden | 0 |
| `frontend:lint` | bestanden | 0 |
| `frontend:build --configuration=production` | bestanden | 0 |
| `frontend:zoneless-approval` | Inventar ohne Abweichung, sechs Bereiche / sieben Mechanismen / 28 Befunde referenziert | 0 |

Nach den Gesamt-Testläufen wurden ausschließlich die von ESLint verlangten
Formatkorrekturen vorgenommen. Der vollständige Lint-Lauf, der Produktionsbuild
und die elf neuen Regressionen im nativen Zoneless-Target bestehen anschließend.
Das Inventar umfasst weiterhin 8.777 Einträge aus 325 Produktionsdateien.
Diese lokalen Ergebnisse bestätigen keinen Push oder erfolgreichen CI-Lauf
am veröffentlichten Commit; die Veröffentlichung ist gesondert zu prüfen.


### ZL-029: Testcenter-Import aktualisiert nach verzögerten Antworten nicht

Ausgangspunkt ist PR #1039, Commit `b639e193942de93b60c1f8f8008015ac5a42d4a0`.
Nach einer verzögerten Testcenter-Anmeldung war intern `authenticated` gesetzt,
das echte Template zeigte jedoch weiterhin das Anmeldeformular. Auch Gruppen,
Importfortschritt, Fehlermeldungen und die Ladezustände wurden asynchron in
gewöhnliche Felder geschrieben. Diese angezeigten Zustände verwenden jetzt
Signals. Uploadfehler werden zusätzlich in den Dateiimport-Optionen angezeigt.
Veraltete Anmeldeantworten nach Abmeldung oder einer neueren Anfrage werden
verworfen. Offene Anfragen werden beim Schließen abbestellt; der sequenzielle
Ergebnisimport startet danach keinen weiteren Gruppenimport.

Elf native Regressionen prüfen Anmeldung, Fehler und Wiederholung, Gruppenlisten
mit Daten und Leerzustand, Gruppenfortschritt und Ladefehler, Dateiimport mit
Fortschritt und Fehler/Wiederholung sowie den sequenziellen Ergebnisimport und
Schließen während offener Anfragen. `cypress/zoneless/testcenter-import.cy.ts`
öffnet den echten Dialog über die Testdateien-Ansicht und prüft Anmeldung,
Dateifortschritt, HTTP-Fehler und Wiederholung mit verzögerten API-Fixtures.

### ZL-030: Testpersonenkodierung zeigt verspätete Jobdaten nicht zuverlässig

Jobliste, Gruppen, laufender Job, Fortschritt und Ladezustände verwenden jetzt
Signals. Anfragekennungen verhindern, dass ältere Listen neuere Ergebnisse
überschreiben. Statusantworten werden nur für den aktuellen Job, Workspace und
Pollinglauf angewendet. Offene Anfragen werden beim Zerstören abbestellt.
Ein reproduzierter Fehler im zweistufigen Ablauf »Alle Testpersonen kodieren«
ist korrigiert: Der Abschluss der Personensuche darf den Button nicht freigeben,
während die anschließend gestartete Kodieranfrage noch läuft.

Zwölf native Regressionen prüfen verspätete Listen, leere Service-Fallbacks,
Wiederholung, Jobstart, Fortschritt, Abschluss und Fehler, Job-/Workspace-Wechsel,
vertauschte Listenantworten, erneutes Polling desselben Jobs sowie Erfolg,
Leerzustand und Fehler der verzögerten Personensuche und das Zerstören der Ansicht.

### ZL-031: Auth-Daten erneut laden lässt den Button gesperrt

`UserWorkspacesComponent` verwendet für `authDataReloadRunning` ein Signal.
Vier native Regressionen klicken den gebundenen Wiederholen-Button und prüfen
dessen automatische Freigabe nach verzögertem Erfolg, Fehlerergebnis und
Observable-Fehler sowie das Abbestellen beim Zerstören. Mehrfachklicks während
der laufenden Anfrage starten keinen zusätzlichen Ladevorgang.

### ZL-032: Auth-Zustände besitzen jeweils eine führende Quelle

Die zuvor parallel beschriebenen Signals und `BehaviorSubject`s für Auth-Daten
und Bootstrapstatus sind vereinheitlicht: Jeweils ein `BehaviorSubject` führt
den Zustand; `toSignal(..., { requireSync: true })` liefert dessen schreibgeschützte
Signalansicht. Die bestehenden Observable-APIs benachrichtigen Auth-Guards
weiterhin synchron und geben späten Abonnenten den aktuellen Zustand.
`selectedWorkspaceId` bleibt ein Signal mit einem zustandslosen, ausschließlich
Änderungen meldenden Eventstream; dessen bestehende Semantik bleibt erhalten.

Fünf native Regressionen prüfen Signalzugriffe innerhalb synchroner
Observable-Benachrichtigungen, rasche Statuswechsel, späte Abonnenten sowie die
automatische Darstellung verzögerter HTTP-Auth-Daten und der Abmeldung.
Der globale Auth-Retry läuft auch nach dem Abbestellen durch eine Ansicht weiter;
Antworten aus einer nach Abmeldung oder erneutem Anmeldelauf veralteten Sitzung
werden verworfen. Zwei HTTP-Regressionen sichern die Verantwortung des AppService und
das Verwerfen einer Antwort nach Abmeldung ab.

Die neuen Tests verwenden echte Templates, liefern Antworten erst nach der
initialen Darstellung und warten danach mit `whenStable()` auf Angular.
Beim sequenziellen Promise-Import wird zuvor die Promise-Microtask abgewartet.
Kein neuer Test erzwingt die Darstellung nach einer Antwort mit
`detectChanges()` oder `markForCheck()`. Die Browser-Anmeldung und API-Daten
sind synthetisch; Produktionslast und reale Testcenter-Verbindungen werden
damit nicht nachgewiesen.


### Lokale Abschlussläufe für ZL-029 bis ZL-032 am 02.10.2026

App- und Testquellen blieben während dieser abschließenden Läufe unverändert.
Anschließend wurden ausschließlich Inventar und Dokumentation aktualisiert.

| Nx-Prüfung | Ergebnis | Exit |
|---|---|---|
| `frontend:test --maxWorkers=2` | 2.570 Tests / 232 Suites bestanden | 0 |
| `frontend:test-zoneless --maxWorkers=2` | 808 Tests / 37 Suites bestanden, darunter 32 neue Regressionen | 0 |
| `frontend:e2e --configuration=zoneless` mit `testcenter-import.cy.ts` und `test-files-upload.cy.ts` | Beide Browserfälle in Electron bestanden; `window.Zone` fehlt | 0 |
| `frontend:lint` | bestanden | 0 |
| `frontend:build --configuration=production` | bestanden | 0 |
| `frontend:zoneless-approval` | Inventar ohne Abweichung, sechs Bereiche / sieben Mechanismen / 32 Befunde referenziert | 0 |

Das neue Browser-Szenario läuft bei 1.280 × 900 Pixeln mit synthetischer Anmeldung
und verzögerten HTTP-Fixtures. Der bestehende Datei-Upload bleibt zusätzlich
geprüft. Das Inventar enthält 8.780 Einträge aus 325 Produktionsdateien und bleibt
eine Suchhilfe; diese Ergebnisse bestätigen keine lückenlose Prüfung jedes
UI-Elements. CI am veröffentlichten Commit und reale Testcenter-Verbindungen
sind gesondert zu prüfen.


### ZL-033: Terminale Jobmeldungen gehen bei früherer Jobliste verloren

Im Review von `f92c7379` wurde folgende Reihenfolge reproduziert: Die Jobliste
meldet den aktiven Job als abgeschlossen, fehlgeschlagen, abgebrochen oder
pausiert und beendet das Polling. Die anschließende Statusantwort wird durch
die Prüfung von aktivem Job und Pollinggeneration verworfen. Da nur die
Statusabfrage die Snackbar auslöste, fehlten die Abschlussmeldung und
gegebenenfalls Warnungen oder Fehlerdetails.

Jobliste und Statusabfrage verwenden jetzt dieselbe Statusverarbeitung.
Sie merkt den letzten Jobstatus, aktualisiert den Freshness-Guard und beendet
bei terminalem Status das Polling, bevor die passende Meldung ausgegeben wird.
Das Stoppen invalidiert weitere Antworten; identische Meldungen und globale
Abschlussereignisse werden dadurch nicht doppelt ausgelöst. Die bestehenden
Prüfungen gegen Antworten alter Jobs, Workspaces und Pollingläufe bleiben
bestehen. Eine Pause verhindert keinen späteren Abschluss desselben Jobs.

Elf neue native Tests verwenden das echte Komponententemplate und die echte
Angular-Material-Snackbar. Sie prüfen alle fünf Meldungsfälle (Abschluss,
Abschluss mit Warnung, Fehler, Abbruch und Pause) in beiden Antwortreihenfolgen
sowie Pause und erneutes Polling desselben Jobs. Nach jeder Antwort wird
`whenStable()` abgewartet; `detectChanges()` und `markForCheck()` werden nicht
verwendet. Vor der Korrektur scheiterten sechs Fälle an der fehlenden Meldung.
Eine zusätzliche Regression erhält die bisherige Unterdrückung wiederholter
Statusabfragefehler, auch wenn die unabhängige Jobliste erfolgreich antwortet.
Im finalen Stand bestehen alle 24 Tests dieser Datei.

`cypress/zoneless/test-person-coding-feedback.cy.ts` öffnet den echten Dialog
über »Automatisch Kodieren« und startet einen Job. Zwei Browserfälle liefern
Warnung beziehungsweise Fehler über eine frühere Jobliste und prüfen die
Snackbar automatisch, während die verzögerte Statusantwort noch aussteht.
Die Anmeldung und API-Daten bleiben synthetisch.


### Lokale Abschlussläufe für ZL-033 am 02.10.2026

Die endgültigen App- und Testquellen blieben während dieser Abschlussläufe
unverändert. Anschließend wurde nur diese Prüfdokumentation ergänzt.

| Nx-Prüfung | Ergebnis | Exit |
|---|---|---|
| `frontend:test --maxWorkers=2` | 2.582 Tests / 232 Suites bestanden | 0 |
| `frontend:test-zoneless --maxWorkers=2` | 820 Tests / 37 Suites bestanden, darunter zwölf neue Regressionen | 0 |
| `frontend:e2e --configuration=zoneless --spec=cypress/zoneless/test-person-coding-feedback.cy.ts` | Beide Browserfälle in Electron bestanden; `window.Zone` fehlt | 0 |
| `frontend:lint` | bestanden | 0 |
| `frontend:zoneless-approval` | Inventar ohne Abweichung, sechs Bereiche / sieben Mechanismen / 33 Befunde referenziert | 0 |

Das aktualisierte Inventar enthält weiterhin 8.780 Einträge aus 325
Produktionsdateien. CI am veröffentlichten Commit und reale Backend-Jobs
sind durch diese lokalen Prüfungen mit synthetischen Daten nicht bestätigt.


### ZL-034: Asynchrone Bulk-Vorschau bleibt beim Spinner stehen

Wird `CodingJobBulkCreationDialogComponent` ohne vorberechnete Verteilung
geöffnet, setzt die verzögerte Backendantwort nach `firstValueFrom()` die Vorschau; zuvor
meldeten weder diese Felder noch das Zurücksetzen von `isLoading` eine
Templateänderung. Dadurch konnten Spinner und gesperrte Bestätigung trotz
erfolgreicher Berechnung sichtbar bleiben.

`isLoading`, `jobPreviews`, `distributionMatrix`, `doubleCodingPreview`,
`warnings`, `showWarningsPanel` und `warningsConfirmed` sind jetzt Signals.
Die Initialisierung erzeugt neue Listen und veröffentlicht sie mit `set()`;
`finally` beendet den Ladezustand auch bei leerer Antwort oder Fehler. Das
Template liest diese Quellen direkt. Die Bestätigung von Warnungen bleibt
ein eigener Schritt vor dem Schließen des Dialogs.

`apps/frontend/src/app/coding/components/coding-job-bulk-creation-dialog/coding-job-bulk-creation-dialog.component.zoneless.spec.ts`
verwendet das echte Template und ein verzögert freigegebenes Subject. Die
Regressionen prüfen Spinner, Vorschau, Doppelkodierungsübersicht und
Bestätigungsbutton, den zweistufigen Warnungsablauf sowie Leerzustand und
Anfragefehler. Nach dem Fortsetzen der Promise wird `whenStable()` abgewartet;
es gibt keinen erzwungenen Render nach der Antwort.

Für diesen asynchronen Bulk-Antwortpfad wird derzeit nur die native
Templateabdeckung referenziert. Der erreichbare Definitionsablauf übergibt
bereits eine fertige Verteilung. Der direkte Neuauftrag, der die interne
asynchrone Berechnung verwenden würde, hat derzeit keinen Template-Einstieg.
Die Verteilungsprüfung in
`cypress/zoneless/async-coding-dialogs.cy.ts` betrifft
`VariableAnalysisDialogComponent` und ist kein Bulk-Browsernachweis.

### ZL-035: Verzögerte Trainingsoptionen erscheinen nicht im Vergleich

`CodingResultsComparisonComponent` lud die Trainingsliste asynchron in normale
Arrays. Nach dem initialen Material-Rendering konnte eine spätere Antwort
ohne weitere Benutzeraktion deshalb keine Trainingsoptionen anzeigen.

`availableTrainings` ist jetzt die führende Signalliste. Ein privates Signal
führt den normalisierten Filter; `filteredTrainings` ist ein `computed`, das
ausschließlich aus diesen beiden Quellen ableitet. Beide Auswahltemplates
lesen die Signalwerte. Die ursprüngliche Reihenfolge, Suche nach Label, ID
und Metadaten sowie Filterreset beim Moduswechsel bleiben erhalten. Die
vorhandenen Anfrage- und Workspace-Prüfungen verwerfen überholte Antworten.

`apps/frontend/src/app/coding/components/coding-results-comparison/coding-results-comparison.zoneless.spec.ts`
prüft das echte Template mit kontrollierten, verzögerten Trainingsantworten.
Vor deren Freigabe wartet die Suite nach `whenStable()` zusätzlich reale
50 Millisekunden und erneut `whenStable()`, damit initiale Material-Termine
die fehlende Änderungsbenachrichtigung nicht verdecken. Weitere Fälle prüfen
Filter und Reset, Leerantwort mit Wiederholung, Ladefehler mit Wiederholung
sowie die ältere Antwort nach einem neueren erfolgreichen Ladevorgang.
Seit 03.10.2026 prüft `cypress/zoneless/training-comparison.cy.ts` zusätzlich die
verzögerte Schulungsliste und beide Auswahlen über den erreichbaren Menüablauf,
einschließlich Filter, Auswahlbeibehaltung und Reset beim Moduswechsel. Die
Liste ist bei diesem Einstieg bereits im gemeinsamen Backend-Service gecacht;
eine separate verspätete HTTP-Antwort erst innerhalb des Vergleichsdialogs
wird weiterhin durch die native Regression geprüft.

### ZL-036: XLSX-Parsefehler blockiert Upload und Wiederholung

Im Exportdialog kann eine beschädigte XLSX-Datei erst nach FileReader und
ExcelJS-Promise scheitern. Der `ValidationStateService` meldete den Fehler
bereits, während die aus normalen Subscriber-Feldern gerenderte Ansicht
weiter Fortschritt und gesperrte Buttons zeigen konnte.

Die bestehenden `BehaviorSubject`s für Fortschritt und Ergebnisse bleiben
die führenden Quellen. `toSignal(..., { requireSync: true })` liefert daraus
schreibgeschützte Templateansichten; `isValidating` und `validationCacheKey`
sind abgeleitete `computed`s. Der Download hat ein unabhängiges Signal, das
durch `finalize()` beendet wird. Weitere Ergebnismeldungen setzen einen noch
laufenden Download dadurch nicht vorzeitig zurück. Der Ergebnisdialog erhält
den Cache-Key direkt aus der jeweiligen Ergebnismeldung; sein Abonnement
endet mit `takeUntilDestroyed()`.

`apps/frontend/src/app/coding/components/export-dialog/export-dialog.component.zoneless.spec.ts`
prüft im echten Template eine beschädigte Datei über den echten FileReader
und ExcelJS-Parser: Fortschritt verschwindet, Fehler erscheint und Upload
sowie Wiederholung werden freigegeben. Weitere Fälle verwenden eine echte
generierte XLSX-Datei mit verzögertem Backend-Erfolg beziehungsweise -Fehler,
prüfen die unabhängige Downloadsperre und das Ausbleiben neuer Ergebnisdialoge
nach dem Zerstören der Ansicht. Sie erzwingen nach den Antworten keinen Render.

`cypress/zoneless/async-coding-dialogs.cy.ts` öffnet den Export über »Kodierliste«,
lädt eine beschädigte Datei hoch und prüft Fehler, verschwundenen Fortschritt
und verfügbare Wiederholung. Danach erzeugt der Browserfall eine gültige
ExcelJS-Datei und prüft nach verzögerter synthetischer Validierungsantwort
den Ergebnisdialog und die aktualisierte Exportansicht.

### ZL-037: Debouncte Variablenfilter aktualisieren die Karten nicht

`VariableBundleDialogComponent` rendert Karten mit `@for`; dort ist keine
Material-Tabelle angeschlossen, die Änderungen des `MatTableDataSource`
meldet. Der verzögerte Filtercallback änderte dessen `filteredData`, ohne
die Karten zu benachrichtigen. Erst eine weitere Benutzeraktion konnte die
bereits berechnete Filterung sichtbar machen.

`filteredVariables` verwendet jetzt
`toSignal(this.dataSource.connect(), { initialValue: [] })` als Templatequelle.
Der DataSource bleibt für Filter und sichtbare Karten maßgeblich; »Alle
auswählen« arbeitet weiterhin mit dessen `filteredData`. Die verfügbare Liste
und Ladezustände sind Signals. Bestehende Abonnements werden beim Zerstören
beendet und der DataSource wird getrennt.

`apps/frontend/src/app/coding/components/variable-bundle-dialog/variable-bundle-dialog.component.zoneless.spec.ts`
dispatcht echte Input-Ereignisse im vollständigen Template und wartet reale
350 Millisekunden auf den 300-Millisekunden-Debounce. Die Fälle prüfen
Einheiten- und Variablenfilter, leere Treffer, Wiederherstellung nach dem
Leeren der Filter sowie Auswahl und Rückgabe ausschließlich sichtbarer
Variablen. Verzögerter Listenerfolg, Leerantwort und Fehler prüfen zusätzlich
die Karten und Ladeanzeige ohne weiteren Klick. Seit 03.10.2026 hält
`cypress/zoneless/manual-preparation.cy.ts` den Variablenabruf am realen
Erstellbutton zurück und prüft anschließend Einheiten- und Variablenfilter,
leere Treffer, Reset, Auswahlbeibehaltung und den tatsächlich gesendeten
Speicherinhalt im Browser. Der erreichbare Dialog erhält die fertige Liste
vom Manager; sein zusätzlicher interner Ladepfad bleibt nativ geprüft.

### ZL-038: Gespeicherte Rechte behalten nach Auth-Fehler den Änderungsstatus

Nach erfolgreichem Speichern der Workspace-Rechte und fehlgeschlagener
Auth-Aktualisierung setzt die Komponente die gespeicherten Werte als neue
Ausgangslage. Das bisher normale `hasChanged`-Feld im enthaltenen
`WorkspaceUserToCheckCollection` änderte dabei jedoch nicht die Identität des
äußeren `workspaceUsers`-Signals. Der Speichern-Button konnte deshalb weiterhin
aktiv bleiben, obwohl die Änderung bereits angenommen war.

Der Änderungsstatus hat jetzt mit dem privaten `hasChangedState`-Signal eine
eigene führende Quelle; der bestehende `hasChanged`-Getter liest dieses Signal
auch im Template. `setChecks()`, `updateHasChanged()` und
`setHasChangedFalse()` aktualisieren dieselbe Quelle. Die neue Ausgangslage
enthält weiterhin die gespeicherten Rechte. Ein fehlgeschlagener
Speichervorgang lässt den Änderungsstatus bestehen; eine fehlgeschlagene
nachgelagerte Auth-Aktualisierung zeigt die Meldung für bereits gespeicherte
Änderungen und setzt den Status zurück.

`apps/frontend/src/app/ws-admin/components/ws-access-rights/ws-access-rights.component.zoneless.spec.ts`
klickt Checkbox und Speichern im echten Template. Getrennte Subjects geben
Speicherantwort und Auth-Aktualisierung erst danach frei. Die Fälle prüfen
die Auth-Ergebnisse `updated`, `failed` und `invalidated`, die gesperrte
Speichern-Aktion nach erfolgreicher Mutation, eine danach erneut erkennbare
Änderung sowie den weiterhin aktiven Button bei fehlgeschlagener Mutation.
Die tatsächliche Material-Snackbar gehört zur Prüfung.

`cypress/zoneless/workspace-access-rights.cy.ts` prüft denselben Ablauf im
Browser mit verzögert erfolgreichem PATCH und danach fehlschlagender
Auth-Antwort. Der Speichern-Button wird gesperrt, die ausgewählte Rechtstufe
bleibt sichtbar und die Meldung enthält den Speichererfolg. API und Anmeldung
sind synthetisch; dieser Fall bestätigt keine reale Backend-Persistenz.

### Lokale Abschlussläufe für ZL-034 bis ZL-038 am 02.10.2026

Die Korrekturen wurden im isolierten Checkout auf Basis von PR-Head
`ec84464cd974161c0e39dab757156f2a5c3e2731` geprüft. Die fünf neuen nativen
Testdateien ergänzen 23 Regressionen. Die Produktquellen und nativen Tests
blieben während der vollständigen Prüfungen unverändert. Danach wurden die
Cypress-Sichtbarkeitsprüfungen an den tatsächlich scrollbaren Dialoginhalt
angepasst und beide Browserdateien gemeinsam abschließend ausgeführt.

| Nx-Prüfung | Ergebnis | Exit |
|---|---|---|
| `frontend:test --maxWorkers=2` | 2.630 Tests / 246 Suites bestanden | 0 |
| `frontend:test-zoneless --maxWorkers=2` | 868 Tests / 51 Suites bestanden | 0 |
| `frontend:e2e --configuration=zoneless --port=cypress-auto --browser=electron` mit `async-coding-dialogs.cy.ts` und `workspace-access-rights.cy.ts` | Alle zwölf Browserfälle bestanden; `window.Zone` fehlt | 0 |
| `frontend:lint` | bestanden | 0 |
| `frontend:build --configuration=production --verbose` | bestanden mit `NG_BUILD_MAX_WORKERS=2` | 0 |
| `frontend:zoneless-approval` | Inventar ohne Abweichung; sechs Bereiche, sieben Mechanismen und 38 Befunde referenziert | 0 |

Der Produktionsbuild brach in der lokalen Sandbox zweimal ohne
Compilerdiagnose ab; der Abschlusslauf außerhalb der Sandbox bestand.
Der lokale Angular-Server und Electron liefen ebenfalls außerhalb der
Sandbox. Die beiden Browserfälle für ZL-036 und ZL-038 verwenden synthetische
Anmeldung und API-Antworten. Der XLSX-Fall prüft das Erscheinen des Fehlers,
das Ende des Fortschritts und freigegebene Buttons vor dem Scrollen; die
anschließende Sichtbarkeitsprüfung bezieht sich auf den Dialoginhalt.

Das aktualisierte Inventar umfasst weiterhin 8.780 Einträge aus 325
Produktionsdateien. Der risikobasierte Nachweis bestätigt keine vollständige
Prüfung jedes UI-Elements. Spezifische Browsernachweise für die Trainingswahl
und Variablenkarten sowie ein erreichbarer asynchroner Bulk-Browserpfad
fehlen wie oben beschrieben. Die Abschlussprüfungen fanden vor Commit und
Push statt; CI am veröffentlichten Commit und echte Backend-Persistenz sind durch
diese lokalen Prüfungen nicht bestätigt.


### ZL-039: Externer Kodierimport benachrichtigt den Vergleichsdialog nicht

Der erreichbare Importvergleich behielt nach der globalen Zoneless-Aktivierung
normale Felder für Ladezustand und Fortschritt. Verzögerte Statusantworten
änderten das Modell, während die Anzeige bei 0 Prozent blieb. Nach einem
fehlgeschlagenen Start oder einer fehlgeschlagenen Statusabfrage blieb die
Wiederholung deaktiviert; eine echte Snackbar konnte zusätzlich NG0100 auslösen.

`isLoading` und `applyProgress` sind jetzt Signals und werden im Template gelesen.
Alle Schreibpfade einschließlich Excel-Download, Start, Polling und Ergebnisabruf
aktualisieren diese führenden Zustandsquellen.
`import-comparison-dialog.component.zoneless.spec.ts` prüft mit echtem Template
und Material-Snackbar verzögerten Fortschritt, Start- und Statusfehler, einen
fehlgeschlagenen Job, Abschluss mit nachfolgendem Ergebnisabruf und das
Beenden einer laufenden Statusabfrage beim Zerstören. Nach Antworten wird
keine Änderungserkennung erzwungen.

### ZL-040: Gespeicherter Managerentwurf bleibt in vorhandener Spalte unsichtbar

Enthielt eine Reviewseite bereits eine angewendete Entscheidung des aktuellen
Managers, existierte seine Tabellenspalte auch für andere offene Zeilen.
Der verzögerte Entwurfserfolg änderte dort die verschachtelte Draft-Liste per
`splice`, ohne die Tabelle zu benachrichtigen. Das Modell enthielt den Entwurf,
die Zelle zeigte weiterhin einen Strich. Der Ausschluss eigener Entwürfe bei
der Spaltenerzeugung verhindert diesen gemischten Seitenzustand nicht.

Die Facade veröffentlicht erfolgreiche Speicher- und Löschantworten über
`managerDraftUpdates$`. Die Komponente übernimmt sie immutable in die aktuelle
Zeile und aktualisiert den Tabellen-DataSource. Neuere Auswahlwerte und
Entscheidungen anderer Manager bleiben erhalten; Antworten aus einem früheren
Workspace oder Benutzerkontext werden verworfen. Das Abonnement endet vor
dem abschließenden Flush beim Zerstören. Bereits gestartete und eingereihte
Backend-Schreibvorgänge dürfen weiterhin abschließen.

Native Regressionen in `double-coded-review.component.spec.ts` verwenden das
vollständige Template und die echte Facade mit verzögerten Speicherantworten.
Sie prüfen den gemischten Managerzustand, unveränderte frühere Snapshots und
die Aktualisierung der dargestellten Zeile ohne erzwungene Änderungserkennung.

### Signal-Konsistenz beim Aufklappen der Dateilisten

`toggleFilesList()` ersetzt die Map und ihren betroffenen Eintrag über `.update()`.
Es verändert weder frühere Snapshots noch Einträge anderer Testtaker. Der
gebundene Klick aktualisierte die Ansicht bereits zuvor; diese Korrektur stellt
zusätzlich die Benachrichtigung reaktiver Leser sicher. Der bestehende native
Dateivalidierungstest prüft einen `computed`-Leser und die Snapshot-Isolation.

### Lokale Abschlussläufe für ZL-039 und ZL-040 am 02.10.2026

Die Korrekturen wurden in einem isolierten Checkout auf Basis von PR-Head
`1f7af8e577cb9777966236a62c735978eb8cd8c6` geprüft. Zwölf ergänzte native
Regressionen decken die beiden Zoneless-Befunde und die immutable Map-Aktualisierung
ab. Nach den vollständigen Testläufen wurden ausschließlich Formatverstöße
in ergänzten Zeilen korrigiert. Der anschließende Lint- und Produktionsbuild
bestand mit diesen Formatkorrekturen.

| Nx-Prüfung | Ergebnis | Exit |
|---|---|---|
| `frontend:test --maxWorkers=2` | 2.642 Tests / 247 Suites bestanden | 0 |
| `frontend:test-zoneless --maxWorkers=2` | 880 Tests / 52 Suites bestanden | 0 |
| `frontend:e2e --configuration=zoneless --port=cypress-auto --browser=electron` mit `review-notifications.cy.ts` | Beide Browserfälle bestanden; `window.Zone` fehlt | 0 |
| `frontend:lint` | bestanden | 0 |
| `frontend:build --configuration=production` | bestanden mit `NG_BUILD_MAX_WORKERS=2` | 0 |
| `frontend:zoneless-approval` | Inventar ohne Abweichung; sechs Bereiche, sieben Mechanismen und 40 Befunde referenziert | 0 |

Der Import-Browserfall öffnet den Vergleich über den realen CSV-Upload und
prüft Fortschritt, HTTP-409 beim Start, einen fehlgeschlagenen Job, Wiederholung
und Abschluss. Der Review-Browserfall hält die Speicherantwort zurück und
prüft die Managerzelle, die aktuelle Auswahl und die Kodierer-Markierung vor
und nach der Antwort. Die Reviewdaten werden dabei nur einmal geladen.
Beide Fälle erkennen API-Aufrufe ohne explizite Fixtures; Anmeldung und
API-Antworten sind synthetisch und bestätigen keine reale Backend-Persistenz.

Der erste Produktionsbuild endete in der Sandbox mit einem esbuild-Deadlock
ohne Compilerdiagnose. Der Wiederholungslauf außerhalb der Sandbox bestand;
der lokale Angular-Server und Electron liefen ebenfalls außerhalb der Sandbox.
Das aktualisierte Inventar umfasst 8.781 Einträge aus 325 Produktionsdateien.
Die Prüfungen erfolgten vor Commit und Push; CI für diese Korrekturen ist
durch die lokalen Läufe nicht bestätigt. Die oben dokumentierten Grenzen des
risikobasierten Nachweises gelten weiterhin.

### ZL-043: Verzögerte Kappa-Ergebnisse bleiben im Schulungsvergleich unsichtbar

Der Schulungsvergleich schrieb Kappa-Ergebnisse und Ladezustände in normale
Felder. Eine verzögerte Backend-Antwort füllte das Modell, während das Template
weiterhin „Berechne Interrater-Reliabilität“ zeigte. Ergebnisse, Optionen und
Ladezustände sind jetzt Signals; Variablenzusammenfassungen werden mit `computed`
abgeleitet. Die Berechnung der mittleren Übereinstimmung ersetzt das Ergebnis
und seine `workspaceSummary`, ohne frühere Snapshots oder die Backend-Antwort
zu verändern. Bei einem Fehler endet die Ladeanzeige ebenfalls.

### ZL-044: Diskussionsspeicherungen lassen die Speicheranzeige stehen

Verzögerte Speicherantworten änderten die Diskussionswerte und den Speicherstatus
in gewöhnlichen Records. Die Anzeige „Speichert ...“ blieb nach Erfolg bestehen.
Codes, Scores, Notizen, Fehler, Speicherstatus und Managername sind jetzt Signals.
Alle Änderungen an den Records erzeugen neue Objekte; die Initialisierung baut
lokale Records auf und veröffentlicht sie jeweils einmal. Replay-Übernahme,
eingereihte Notizen und Sitzungswiederherstellung verwenden dieselben Schreibpfade.

### ZL-045: Der initiale Vergleich beendet seine Ladeanzeige nicht

Die Browserregression erreichte zunächst weder Kappa noch Diskussion: Auch nach
der verzögerten Vergleichsantwort blieb „Lade Vergleichsdaten“ sichtbar. Solange
nur der Ladeblock gerendert wurde, waren die Diskussions-Signals noch keine
Template-Abhängigkeiten. `isLoading` ist deshalb ebenfalls ein Signal; Erfolg,
Fehler und Abbruch benachrichtigen das Template über diesen Zustand.

Die nativen Regressionen in
`coding-results-comparison.zoneless.spec.ts` prüfen verzögerte Kappa- und
Speicherantworten einschließlich Fehlern mit echtem Template, ohne nach der
Antwort Änderungserkennung zu erzwingen. Der bestehende Komponententest prüft
zusätzlich, dass die Kappa-Berechnung eingefrorene frühere Snapshots erhält.
Vier Browserfälle in `cypress/zoneless/training-comparison.cy.ts` öffnen den
Schulungsvergleich über die Schulungsliste, laden Vergleichsdaten über HTTP und
prüfen Kappa beziehungsweise Diskussion bei Erfolg und Fehler. Der Kappa-Erfolg
prüft auch Gewichtung und Code-/Score-Ebene. Alle vier Fälle bestehen ohne
`window.Zone`; Anmeldung und Backend-Antworten sind synthetisch.

### Lokale Prüfungen für ZL-043 bis ZL-045 am 03.10.2026

Die Korrekturen wurden auf Basis von PR-Head
`d03c2f4ef70b15d292686a4de8504a8389f8a716` geprüft.

| Nx-Prüfung | Ergebnis | Exit |
|---|---|---|
| `frontend:test --runInBand` | 2.673 Tests bestanden; ein Regex-Timer-Test fehlgeschlagen | 1 |
| `frontend:test --runInBand --testPathPatterns='coding-results-comparison\|test-results-flat-table.component.spec'` | 91 Tests / drei Suites bestanden | 0 |
| `frontend:test-zoneless --runInBand` | 907 Tests / 58 Suites bestanden | 0 |
| `frontend:e2e:zoneless --spec=cypress/zoneless/training-comparison.cy.ts` | vier Browserfälle bestanden; `window.Zone` fehlt | 0 |
| `frontend:lint` | bestanden | 0 |
| `frontend:build:production` mit `NG_BUILD_MAX_WORKERS=2` | bestanden | 0 |
| `frontend:zoneless-approval` | 8.783 Inventareinträge ohne Abweichung; 45 Befunde referenziert | 0 |

Der fehlgeschlagene Test `should ignore an invalid-regex error for an edited
filter` wartet real 401 ms bei einer Debounce-Zeit von 400 ms. Er und seine
vollständige Suite mit 31 Tests bestehen separat im unveränderten PR-Stand;
die Suite besteht auch zusammen mit den Vergleichstests im korrigierten Stand.
Der Fehler trat nur im Gesamtlauf auf. Die Ergebnis-Tabelle und ihr Test wurden
nicht geändert. Der Gesamtlauf wird deshalb trotz erfolgreicher Gegenprüfungen
als fehlgeschlagen dokumentiert. Remote-CI und reale Backend-Persistenz sind
durch diese lokalen Läufe nicht bestätigt.

### ZL-046: Bulk-Fortsetzungen verlassen ihren Workspace-Kontext

Eine zurückgehaltene `create-job-preview`-Antwort öffnete den Bulk-Dialog noch,
nachdem die Jobdefinitionsansicht zerstört und ein anderer Workspace geöffnet
worden war. Ein bereits geöffneter Bestätigungsdialog wurde ebenfalls nicht
von seiner aufrufenden Ansicht geschlossen. Zusätzlich lösten verzögerte
Erfolgs- und Fehlerantworten einer bereits gestarteten Bulk-Anlage weiterhin
Snackbar-Meldungen, Listenabrufe und Aktualisierungsereignisse aus.

Die Vorschau endet jetzt mit der Lebensdauer der Jobdefinitionsansicht. Vor
Dialogöffnung, bestätigter Mutation und Verarbeitung einer Speicherantwort
werden Lebensdauer und ursprüngliche Workspace-ID geprüft. Die Ansicht hält
nur ihren eigenen Bulk-Dialog und schließt ihn beim Zerstören. Bereits
abgeschickte Mutationen werden nicht abgebrochen oder zurückgerollt; ihre
verspäteten UI-Fortsetzungen werden verworfen.

Fünf neue native Regressionen in `coding-job-definitions.zoneless.spec.ts`
prüfen Abonnementabbruch, einen Workspace-Wechsel vor der Vorschauantwort,
Schließen des eigenen Dialogs, eine verspätete Bestätigung sowie Erfolg und
Fehler eines bereits gestarteten Auftrags nach dem Verlassen des Workspaces.
Die letzten beiden Fälle scheiterten vor der ergänzten Kontextprüfung mit
einer Snackbar aus dem alten Auftrag. Die Browserregression für die alte
Vorschau scheiterte zuvor mit einem nach der Navigation geöffneten Dialog.

`cypress/zoneless/manual-preparation.cy.ts` verwendet den tatsächlichen
Erstellbutton einer genehmigten Definition. Es prüft Serververteilung,
Vorschaufehler mit Wiederholung, ausbleibende Anlage vor Bestätigung, Abbruch,
Ladeende nach Erfolg und Workspace-Wechsel während Vorschau, Bestätigung und
laufender Mutation. Weitere Fälle prüfen Schulungsanlage mit Referenzen,
Speicherfehler und Wiederholung, Dialogschließen während Referenzabruf,
Workspace-Stufen 0–3 und Variablenfilter mit dem tatsächlich gesendeten Bundle.

Die beiden ergänzten Fälle in `training-comparison.cy.ts` prüfen die verspätete
Schulungsliste vor dem realen Menüaufruf, Auswahl in beiden Vergleichsmodi,
Filter und Reset sowie Schließen und erneutes Öffnen während einer ausstehenden
Vergleichsantwort. Der normale Einstieg übernimmt die zuvor geladene Liste
aus dem gemeinsamen Cache. Die zwei ergänzten Fälle in
`workspace-access-rights.cy.ts` prüfen Rechte-Speicherfehler mit Wiederholung
als Realm-Admin und Studienleitung; die ausgewählten Rechte bleiben erhalten.

Alle neuen Browserfälle verwenden echte Angular-/Material-Ansichten ohne
`window.Zone`, synthetische Anmeldung und kontrollierte API-Antworten. Nicht
explizit vorbereitete API-Aufrufe lassen die Tests fehlschlagen. Die bereits
vorhandenen CI-Jobs erfassen sämtliche Fälle über
`cypress.zoneless.config.ts`, auch mit Produktionseinstellungen. Der interne
Bulk-Berechnungspfad ohne vorbereitete Serververteilung hat weiterhin keinen
Template-Einstieg; seine bestehenden nativen Regressionen bleiben der Nachweis.

### Lokale Abschlussprüfungen der Browserergänzung am 03.10.2026

Basis war PR-Head `1e29acee1bdb7d75fc22137465ea37f16c0c60bf`.

| Prüfung | Ergebnis |
|---|---|
| `frontend:test-zoneless --runInBand` | 914 Tests / 59 Suites bestanden |
| `frontend:test --runInBand` | 2.681 Tests / 254 Suites bestanden |
| `frontend:lint` | bestanden |
| `frontend:test-zoneless --runInBand --testPathPatterns=coding-job-definitions.zoneless.spec` | sechs Fälle nach der abschließenden Testformatierung bestanden |
| Betroffene Cypress-Spezifikationen, Zoneless | 26 Fälle bestanden: zwölf manuelle Vorbereitung, sechs Schulungsvergleich und acht Rechte; abschließende Läufe der Dateien getrennt |
| `frontend:serve --configuration=production` mit `NG_BUILD_MAX_WORKERS=2` | optimierte Bundles erfolgreich erzeugt und für die Browserprüfung bereitgestellt |
| `frontend:e2e --configuration=production --cypressConfig=cypress.zoneless.config.ts` | vollständige Suite: 128 Fälle / 23 Spezifikationen bestanden, keine Retries |
| `frontend:zoneless-approval` | 8.783 Inventareinträge ohne Abweichung; sechs Bereiche, sieben Mechanismen und 46 korrigierte Befunde referenziert |

Der erste vollständige Zoneless-Browserlauf bestand 125 von 127 Fällen; zwei
neue Fälle scheiterten im Testaufbau. Ein Variablenabruf wurde vor seinem
Erstellbutton erwartet, und eine zurückgehaltene Vergleichsantwort wurde als
Wartebedingung für die Wiederöffnung verwendet. Diese Bedingungen wurden
korrigiert. Vergleichsantworten werden außerdem nach Trainings-ID bzw.
Dialogöffnung unterschieden, damit zusätzliche Initialisierungsabrufe nicht
mit der getesteten Auswahl verwechselt werden. Die Tabelle weist die
abschließenden erfolgreichen Läufe aus. Die vollständige Produktionssuite
enthält sämtliche betroffenen Fälle; der vollständige Zoneless-Browserlauf
wird zusätzlich im bestehenden CI-Job ausgeführt.

Die lokalen Prüfungen erfolgten vor Commit und Push. Remote-CI für den neuen
Commit ist separat nachzuweisen. Live-Backend-/Keycloak- und Replay-Targets
wurden bei dieser Ergänzung lokal nicht erneut ausgeführt; die Browserfälle
belegen kontrollierte HTTP-Verarbeitung und UI-Zustände, keine tatsächliche
Backend-Persistenz oder Autorisierung. Die bestehenden Live-CI-Jobs bleiben
Teil der Freigabe.


### Zwischenstand: native Diagramme und sichere RxJS-Übergänge am 03.10.2026

Basis: PR-Head `1a8fac0c65f2198e4c301d2536b926a5f0380dfb`.

Die Anwendung benötigt keine globale Angular-Animationsengine mehr.
`provideAnimationsAsync()` ist entfernt. Der einzige Anwendungskonsument
von `@swimlane/ngx-charts` war der Replay-Statistikdialog mit acht vertikalen
Balkendiagrammen. Auch die installierte und zum Prüfzeitpunkt aktuelle
Version 25.0.2 importierte `trigger`, `transition`, `style` und `animate`
aus `@angular/animations`; lediglich den Provider zu entfernen wäre deshalb
keine sichere Migration gewesen.

Die acht Diagramme verwendeten in diesem Zwischenstand `VerticalBarChartComponent` mit nativen
SVG-Balken, Signal-Inputs, abgeleiteter Skalierung und OnPush. Achsentitel,
gekürzte Unit-Beschriftungen, volle Werte im Tooltip, Tastaturfokus und
Größenänderungen bleiben erhalten. `animate.enter` steuert eine CSS-Animation;
`prefers-reduced-motion` deaktiviert sie. Leere/Null-Daten, Bruchteile und
aktualisierte Inputs sind nativ ohne Animationsprovider geprüft. ngx-charts
und seine exklusiven D3-Abhängigkeiten sind aus dem Lockfile entfernt.
`@angular/animations` blieb zunächst als Dev-Abhängigkeit für vorhandene
`provideNoopAnimations()`-/`NoopAnimationsModule`-Testeinrichtungen, nicht
als Anwendungskonsument.

Die Aussage „toSignal wird nicht verwendet“ war bereits vor dieser Änderung
überholt: sieben Anwendungscalls. Geprüft wurden zwei synchrone Auth-Quellen
im AppService, zwei synchrone Validierungsquellen im Exportdialog, zwei
SelectionModel-Ereignisbrücken und eine MatTableDataSource-Brücke. Die
BehaviorSubjects besitzen jeweils die führende Zustandsquelle und sind mit
`requireSync: true` eingebunden; die Ereignis-/Tabellenbrücken haben explizite
Startwerte. Alle Aufrufe laufen im Injection-Kontext mit automatischer
Bereinigung. Sie sind keine HTTP-Streams mit unbehandelten Netzwerkfehlern.

Als achter Aufruf ersetzt `toSignal(exportJobService.jobs$, { requireSync:
true })` die manuelle Subscription mit Schreibkopie im Export-Toast. Dessen
BehaviorSubject bleibt die führende Quelle, der UI-Zustand ist schreibgeschützt.
Aktionsabonnements verwenden `takeUntilDestroyed(DestroyRef)`. Der neue native
Zoneless-Fall prüft initialen Zustand, verspäteten Fortschritt im echten
Template und Bereinigung von Zustands- sowie Aktionsabonnements. RxJS bleibt
für Polling, HTTP und Ereignisverarbeitung erhalten.

Referenzen: [Angular-Animationsmigration](https://angular.dev/guide/animations/migration),
[provideAnimationsAsync](https://angular.dev/api/platform-browser/animations/async/provideAnimationsAsync),
[toSignal-Vertrag](https://angular.dev/ecosystem/rxjs-interop).


### Lokale Prüfungen der Animations- und Interop-Migration am 03.10.2026

| Prüfung | Ergebnis |
|---|---|
| `frontend:lint` | bestanden |
| `frontend:test --runInBand` | 2.685 Tests / 256 Suites bestanden |
| `frontend:test-zoneless --runInBand` | 918 Tests / 61 Suites bestanden |
| `frontend:build --statsJson=true` | Produktionsbuild bestanden; kein Input aus `@angular/animations` oder `@swimlane/ngx-charts` unter den 834 Bundle-Inputs |
| Cypress, abschließende vollständige Produktions-Browsersuite | 128 Fälle / 23 Spezifikationen bestanden, keine Retries; inklusive 25 Units in der Daueransicht nach der Spaltenkorrektur |
| Cypress, Produktions-Nachlauf `cypress/zoneless/app.cy.ts` | nach SPA-Fallback im lokalen Server alle vier Fälle bestanden; anschließend wurde die vollständige Suite erneut erfolgreich ausgeführt |
| Cypress, Zoneless-Entwicklungsbuild `cypress/zoneless/statistics-codebook.cy.ts` | drei Fälle mit allen acht Diagrammen, 25 Units in der Daueransicht, internem Scrollbereich und Größenänderung bestanden |
| Native betroffene Komponenten nach der abschließenden CSS-Korrektur | sieben Fälle / drei Suites bestanden |
| `frontend:zoneless-approval` | 8.773 Inventareinträge, sechs Bereiche, sieben Mechanismen und 46 korrigierte Befunde; Referenzen gültig |

Die Produktionsprüfung verwendet die optimierten Bundles über einen lokalen
HTTP-Server, kontrollierte API-Antworten und Electron. Der erste vollständige
Lauf bestand 127 von 128 Fällen; der direkte `/coding`-Aufruf scheiterte vor
App-Start mit HTTP 404 am einfachen lokalen Dateiserver. Der Nachlauf ergänzte
den SPA-Fallback, den der Nx-Server der CI-Browserjobs bereitstellt; er ist
kein Nachweis für die Nginx-Konfiguration eines Deployments. Im erweiterten
Diagrammfall ist die Ausgangsgröße 1280 × 900 explizit gesetzt, die
Verkleinerung auf 800 × 600 wird über die tatsächlich aktualisierte SVG-Breite
nachgewiesen. Die aktiven Material-Tabs und sichtbaren, in den Scrollbereich
gebrachten Balken werden geprüft. Die Screenshot-Erfassung verwendet den
Viewport statt des Inline-Dialoghosts.

Der zusätzliche Browsernachweis mit 25 Unit-Durchschnittswerten zeigte, dass
die SVG-Mindestbreite beide Flex-Spalten auseinanderdrückte (1.357 Pixel
Scrollbreite bei 1.078 Pixeln Zeilenbreite). `min-width: 0` begrenzt die
Spalten; die SVG-Breite bleibt im internen Scrollbereich. Der Fall prüft die
Zeilenbreite, den internen Überlauf und alle 26 Balken der beiden
Dauerdiagramme. Danach bestanden die sieben betroffenen nativen Fälle und
der Entwicklungs-Browserlauf erneut; die finalen Produktionsbundles wurden
neuerstellt und die vollständige Browser-Suite erfolgreich wiederholt.
Die vollständigen Jest-Läufe stammen vor dieser begrenzten CSS-Korrektur.

Live-Backend-/Keycloak- oder Replay-Targets wurden bei dieser Migration lokal
nicht erneut ausgeführt. Remote-CI für den neuen Commit ist separat
nachzuweisen; die vorhandenen Browserjobs führen die geänderte Spezifikation
automatisch aus.


### Chart.js und vollständige Bereinigung der Animationstests am 03.10.2026

Basis: PR-Head `dd81d74d263bf562e42a91d6bcaa1b4d2aea37fe`. Dieser Abschnitt
ersetzt den oben dokumentierten SVG-Zwischenstand für die acht Replay-Diagramme.

`VerticalBarChartComponent` verwendet Chart.js 4.5.1 direkt, mit expliziter
Registrierung ausschließlich von `BarController`, `BarElement`, `CategoryScale`,
`LinearScale` und `Tooltip`. Es gibt keinen Angular-Wrapper und keinen Import
von `chart.js/auto`. Die bisherige zehnfarbige Vivid-Palette, abgerundete Balken,
volle Tooltip-Namen und Werte sind vorhanden. Änderungen werden über 500 ms
animiert; bei `prefers-reduced-motion` sind Animationen deaktiviert. Ein Wechsel
der Bewegungseinstellung wird während der Lebensdauer berücksichtigt und beendet
laufende Animationen sofort, wenn reduzierte Bewegung eingeschaltet wird.

Signal-Inputs bleiben die führende Zustandsquelle. `afterRenderEffect` bindet
frische Datenarrays nach dem DOM-Rendering an die imperative Bibliothek; sie
erhält keine veränderbare Referenz auf die Signal-Eingaben. Die private Dataset-
und Balkenidentität bleibt bei Aktualisierungen erhalten, damit Chart.js Werte
interpolieren kann. Chart-Erstellung,
Aktualisierung und Zerstörung erfolgen außerhalb der Angular-Zone. `DestroyRef`
entfernt den Media-Query-Listener und ruft `Chart.destroy()` auf. Die beobachteten
Dialogmaße steuern Canvas und internen Scrollbereich ausdrücklich.

Die Diagramme besitzen einen zugänglichen Namen und einen Verweis auf die
aufklappbare HTML-Datentabelle. Der native `summary`-Schalter ist per Tastatur
mit der Leertaste bedienbar; das Öffnen und Schließen ist im Browser geprüft.
Tabelle und Tooltip enthalten die vollständigen Kategorienamen,
auch wenn Achsenbeschriftungen gekürzt sind. Die Tabelle hat Caption, Spalten-
und Zeilenüberschriften; sie bietet den vollständigen Inhalt unabhängig vom
Canvas. Das allein ist kein umfassendes Screenreader-Akzeptanzgutachten.

Alle 88 Testdateien mit `NoopAnimationsModule` oder `provideNoopAnimations()`
sind bereinigt. Das Paket `@angular/animations` ist aus den direkten
Abhängigkeiten, dem aufgelösten Lockfile-Paketbestand und der lokalen Installation
entfernt. Nur die unveränderte optionale Peer-Metadatenangabe von
`@angular/platform-browser` enthält noch den Paketnamen. In den Informations-
dialogtests ersetzen Material-Timingoptionen und das Warten auf `afterClosed()`
die implizite Annahme eines synchronen Dialogschlusses. JSDOM wird für Canvas
mit `jest-canvas-mock` ergänzt; Chart.js selbst wird in diesen Tests nicht gemockt.

Der im Review reproduzierte Abstandfehler bei 30 Tageswerten wird jetzt durch
Chart.js' gemessene Tickauswahl behandelt. Die Browserregression misst die
tatsächlich gezeichneten Labelpositionen und Textbreiten bei 800 × 600 Pixeln.
Sie prüft außerdem echte Canvas-Balkenpixel, Zwischenstände der Animation,
ungekürzte Tooltip-Texte, Tastaturöffnung der Tabelle, alle acht Diagramme,
25 Units, Größenänderung sowie Schließen und erneutes Öffnen des Dialogs.

Im optimierten Produktionsbuild stammen 151.626 unkomprimierte Bytes aus
Chart.js und dessen Farbmodul. Diese liegen im nachgeladenen Einstellungs-Chunk;
sie werden nicht mit dem initialen App-Bundle geladen. Unter den 837 Bundle-
Inputs findet sich weder `@angular/animations` noch `@swimlane/ngx-charts`.

Referenzen: [Chart.js-Integration und gezielte Imports](https://www.chartjs.org/docs/latest/getting-started/integration.html),
[Chart.js-Lebensdauer](https://www.chartjs.org/docs/latest/developers/api.html),
[Canvas-Barrierefreiheit](https://www.chartjs.org/docs/latest/general/accessibility.html).


### Lokale Abschlussprüfungen der Chart.js- und Testmigration am 03.10.2026

| Prüfung | Ergebnis |
|---|---|
| `frontend:lint` | bestanden |
| `frontend:test --runInBand` | 2.687 Tests / 256 Suites bestanden |
| `frontend:test-zoneless --runInBand` | 920 Tests / 61 Suites bestanden |
| `frontend:build --statsJson=true` | optimierter Produktionsbuild bestanden; 837 Bundle-Inputs ohne alte Animations-Engine oder ngx-charts |
| Cypress, vollständige Produktions-Browsersuite | 128 Fälle / 23 Spezifikationen bestanden, keine Retries; einschließlich der erweiterten Chart.js-Regression |
| `frontend:zoneless-approval` | 8.751 Inventareinträge; sechs Bereiche, sieben Mechanismen und 46 korrigierte Befunde; Referenzen gültig |
| Abhängigkeitsprüfung | kein direktes, aufgelöstes oder installiertes `@angular/animations`; keine alten Animationstesthelfer im Frontend |

Jest verwendet eine simulierte Canvas-API, führt aber die echte Chart.js-
Implementierung aus. Der Browserlauf verwendet Electron 138, optimierte
Produktionsbundles über einen lokalen HTTP-Server und kontrollierte API-
Antworten. Er beweist keine reale Backend-Persistenz oder Autorisierung.
Live-Backend-/Keycloak- und Replay-Targets wurden für diese Änderung nicht
nochmals ausgeführt. Die vorhandenen CI-Browserjobs übernehmen die erweiterte
Spezifikation automatisch; ihre Ergebnisse für den neuen Commit sind separat
zu prüfen.


### Typisierte Reactive Forms am 04.10.2026

Basis: PR-Head `fe5caf6a718cb89e098f63e6e8e8aa8de43148cb`.
Der Anwendungscode enthält keine `UntypedFormGroup`, `UntypedFormBuilder`
oder `UntypedFormControl` mehr. Die vier aktiven Formulargruppen für
Benutzerbearbeitung, Workspace-Bearbeitung und Testcenter-Anmeldung/-Import
verwenden `NonNullableFormBuilder`, konkrete Control-Typen beziehungsweise
vollständig inferierte Control-Maps. Optionale Felder des weiterhin vorhandenen
Benutzeranlage-Vertrags sind als optionale Controls modelliert. Es gibt keinen
Ersatz durch `FormGroup<any>` oder Typbehauptungen auf untypisierte Formulare.

Textfelder und Checkboxen setzen sich auf ihre Anfangswerte zurück, statt
bei `reset()` zu `null` zu werden. Die Testcenter-Auswahl ist `number | ''`,
mit leerem Anfangswert und bestehender Pflichtfeldprüfung; der Überschreibmodus
ist ausdrücklich `TestResultsOverwriteMode`. `getRawValue()` und konkrete
Controls erhalten auch deaktivierte Feldwerte und boolesches `false` bei der
DTO-Übergabe. Dialogdaten, Ergebnisse und Menü-Outputs sind für Benutzer- und
Workspace-Editoren typisiert; Abbruch und Schließen lösen keine Mutation aus.

Die typisierten Dialogdaten deckten fehlerhafte Workspace-Übergaben auf:
Der Anlagepfad übergab `wsg` statt `ws`, der Bearbeitungspfad nur eine ID
statt eines Workspace-Datensatzes. Der über die Tabelle ausgewählte Datensatz
wird jetzt bis zum Editor übergeben. `selectedWorkspaceRows` ist die einzige
Auswahlquelle im übergeordneten Baustein; IDs werden daraus mit `computed`
abgeleitet. Die beim Öffnen gewählte ID wird beim Speichern verwendet, auch
wenn sich die Auswahl während eines geöffneten Dialogs ändert. Browserfälle
belegen Pflichtfeld-/Mindestlängenprüfung, Vorbefüllung, Anlegen, Umbenennen
und Abbruch; ein Menütest prüft den zwischenzeitlichen Auswahlwechsel.

Testcenter-Importoptionen bleiben im Frontend boolesch. Erst der unveränderte
HTTP-Adapter serialisiert sie in die bestehenden String-Queryparameter.
Shared DTOs und Backend-Implementierung sind unverändert. Der Formulartyp
verhindert, dass String-Flags versehentlich als wahr interpretiert werden.
Für individuelle Testcenter-URLs bleibt Auswahl-ID 6 im Formular und im
Auswahlcache; bei der Anmeldung wird das vom vorhandenen Backend benötigte
leere Serverfeld gesendet. Ein unvollständiges Login per Enter sendet keine
Anmeldeanfrage. Die Browserregression prüft Standard-Testcenter und individuelle
URL einschließlich Request-Body, Importparametern, verzögerter Antwort,
Fehleranzeige und Wiederholung.

Veraltete FormGroup-Rückgabealternativen der Importdialog-Aufrufer sind
bereinigt; deren vorhandene Ergebnis-/Refreshpfade bleiben erhalten.

### Lokale Abschlussprüfungen der Formularmigration am 04.10.2026

| Prüfung | Ergebnis |
|---|---|
| `frontend:lint` | bestanden |
| `frontend:test --runInBand` | 2.699 Tests / 256 Suites bestanden |
| `frontend:test-zoneless --runInBand` | 920 Tests / 61 Suites bestanden |
| `frontend:build` | optimierter Produktionsbuild mit strenger Formular-/Template-Typprüfung bestanden |
| Cypress, gezielte Produktions-Browserregressionen | 14 Fälle / drei Spezifikationen bestanden, keine Retries: `admin-forms`, `testcenter-import`, `workspace-access-rights` |
| `frontend:zoneless-approval` | 8.750 Inventareinträge; sechs Bereiche, sieben Mechanismen und 46 korrigierte Befunde; Referenzen gültig |
| Quellcodeprüfung | keine `UntypedFormGroup`-/`UntypedFormBuilder`-/`UntypedFormControl`-Verwendungen oder `FormGroup<any>` im Anwendungscode |

Die Browserregressionen verwenden Electron 138, optimierte Produktionsbundles
über einen lokalen HTTP-Server und kontrollierte API-Antworten. Sie prüfen die
Formularzustände, Request-Daten und verzögerte Darstellung; reale Backend-
Persistenz und Autorisierung sind damit nicht belegt. Live-Backend-/Keycloak-
und Replay-Targets wurden für diese Änderung nicht erneut ausgeführt. Die
vollständige Produktions-Browsersuite wurde für die Formularmigration nicht
wiederholt. Der bestehende CI-Browserjob nimmt die neue Spezifikation über
sein Glob automatisch auf; Remote-CI-Ergebnisse sind separat zu prüfen.


### Anwendungsweite Komponenten-API-Migration am 04.10.2026

Basis: PR-Head `5fd872a28f8b9194e579422d977a431e6273ea79`.

Alle 111 verbliebenen Decorator-Inputs und 39 Decorator-Outputs in der
Anwendung sind auf `input()` beziehungsweise `output()` umgestellt.
Von 43 alten View-Queries verwenden 38 jetzt `viewChild()`/`viewChildren()`;
fünf ungenutzte oder nicht erreichbare Queries wurden entfernt (die beiden
Administrations-Elternkomponenten mit Tabellen in ihren Kindkomponenten,
TestFiles ohne MatSort sowie die ungenutzten Paginator-Referenzen der beiden
Suchdialoge). Es bleiben keine `@Input`-, `@Output`-, `@ViewChild`-,
`@ViewChildren`-, `@ContentChild`- oder `@ContentChildren`-Deklarationen im
Anwendungscode. Einschließlich der vorher bereits modernen APIs sind es
160 Signal-Inputs, 73 Outputs und 42 Signal-Queries. Alle API-Felder sind
`readonly`; `output()` ist eine Ereignis-API, kein Zustandssignal.

Die externe Benennung der Bindings und Ereignisse bleibt erhalten. Auch
`ngOnChanges` mit den bisherigen Property-Namen bleibt für bestehende
Initialisierungslogik erhalten. Nicht ausdrücklich verpflichtende Eingaben
im CodeSelector erhalten weiterhin sichere Leer-/Optionalwerte; ein früheres
Definite-Assignment-`!` wird dort nicht in eine neue Laufzeitpflicht umgedeutet.
Die Angular-Migration hat den automatisch umstellbaren Teil übernommen;
Schreibzugriffe, Setter und problematische Query-Lebensdauern wurden manuell
angepasst. Test-Stubs verwenden dieselben APIs, Fixture-Inputs werden mit
`componentRef.setInput()` gesetzt.

ResponseFilters und CodeSelector bearbeiten per `linkedSignal()` einen lokalen
Entwurf. Elternwerte bleiben unverändert; neue Input-Werte ersetzen den Entwurf.
Filteränderungen schreiben neue Objekte, statt das Input-Objekt zu mutieren.
Der eingebettete Schemer hält gemeldete Änderungen ebenfalls in einem lokalen
`linkedSignal()` und erhält Variablen und Schematyp. Beim UnitPlayer bleiben
die rohe JSON-Eingabe und die geparste Definition getrennt; die Startnachricht
enthält weiterhin genau eine JSON-Kodierung. Ein Reset verwirft die alte
geparste Definition und sendet keine alte oder undefinierte Definition.

Bedingt gerenderte Tabellen nutzen optionale Queries. Effects verbinden
Sortierung/Paginierung mit den tatsächlich vorhandenen Material-Instanzen
auch nach verspäteten Antworten, Reload und erneutem Rendern. Die
ViewChildren-/Wasserzeichen-Observer reagieren über `afterRenderEffect()` auf
die Queries und werden beim Zerstören bereinigt. SearchFilter initialisiert
seinen Wert vor dem Rendern und abonniert DOM-Ereignisse erst in
`ngAfterViewInit`; VariableBundleDialog verbindet seine Filter ebenfalls
nach der View-Initialisierung. Die ZIP-Auswahl setzt initiale Optionen direkt
über `[selected]`, ohne einen nachlaufenden Timer. Auch die derzeit nicht
über die Anwendung erreichbare CoderList wurde umgestellt: Der Ladezustand
ist ein Signal, die Sortierung folgt der bedingt gerenderten Tabelle und
ausstehende Lese-Subscriptions enden mit der Komponenten-Lebensdauer.

Neue Regressionen prüfen unveränderte Eltern-Inputs und lokale Filter-/Notiz-
Entwürfe, Schemer-Änderungen mit Variablenerhalt und Ersatz-Input, die
Bereinigung der Schemer-Streams, Sortierung bei synchroner Erstantwort und
nach einem Reload, Suchinitialisierung/Leeren/Debounce-Abbruch sowie die
JSON-Kodierung und den Reset im UnitPlayer. Zwei native CoderList-Fälle
prüfen verspätete Antworten, das Entfernen und erneute Erzeugen der Tabelle
sowie den Abbruch beim Zerstören. Die regulären UnitPlayer- und
CodeSelector-Reaktivitätssuiten sind zusätzlich Teil des nativen Zoneless-
Targets. Die Inventarmatrix wurde auf die neuen Fingerprints aktualisiert;
die risikobasierte Matrix verweist auf die ergänzten Fälle. Offen markierte
Inventareinträge werden dadurch nicht als vollständig geprüft behauptet.

### Lokale Abschlussprüfungen der Komponenten-API-Migration am 04.10.2026

| Prüfung | Ergebnis |
|---|---|
| `frontend:lint` | bestanden |
| `frontend:test --runInBand --cache=false` | 2.710 Tests / 259 Suites bestanden |
| `frontend:test-zoneless --runInBand --cache=false` | 951 Tests / 66 Suites bestanden |
| `frontend:build --configuration=production` | optimierter Produktionsbuild mit strenger Template-Typprüfung bestanden |
| `frontend:e2e --configuration=production --cypressConfig=cypress.zoneless.config.ts --browser=electron` | vollständige Produktions-Browserregression: 133 Fälle / 24 Spezifikationen bestanden, keine Retries |
| `frontend:zoneless-approval` | 8.748 Inventareinträge; sechs Bereiche, sieben Mechanismen und 46 korrigierte Befunde; Referenzen gültig |
| AST- und Quellcodeprüfung | 160 `input()`-, 73 `output()`- und 42 Signal-Query-Deklarationen, alle API-Felder `readonly`; keine alten Input-/Output-/View-/Content-Query-Decorator-APIs im Anwendungscode oder aktiven Test-Stubs |

Die regulären Tests verwenden `componentRef.setInput()` für Fixture-Eingaben
und Angular-Renderzyklen für View-Queries. Der Test eines verzögerten
Variablenfilters wartet auf die konkrete Folgeanfrage statt auf eine feste
401-ms-Pause. Die neuen nativen Spezifikationen werden vom vorhandenen
Test-Glob automatisch aufgenommen; UnitPlayer und CodeSelector-Reaktivität
sind zusätzlich explizit im Zoneless-Target enthalten.

Die Browserregressionen verwenden Electron 138, optimierte Produktionsbundles
und kontrollierte HTTP-Antworten. Sie prüfen Darstellung, asynchrone Zustände,
Dialoge, Rollenfälle und Request-Daten. Reale Backend-Persistenz und
Autorisierung sind damit nicht belegt. Live-Backend-/Keycloak- und Replay-
Targets wurden für diese Migration nicht erneut ausgeführt. Die nicht
erreichbare CoderList hat native Komponentennachweise und keinen künstlich
hinzugefügten Browserpfad. Remote-CI-Ergebnisse sind separat zu prüfen.

Abgebrochene Läufe wegen vollem Jest-Transformcache beziehungsweise ohne
Abschluss des Prüfprozesses werden nicht gezählt. Ein zusätzlicher Electron-
Lauf blieb im Codebook-Fall stehen und wurde abgebrochen; der vollständige
Wiederholungslauf am finalen Stand hat auch diesen Fall bestanden. Die Tabelle
nennt ausschließlich vollständig bestandene Abschlussläufe.

## Vollständige OnPush-Umstellung am 04.10.2026

Die AST-Prüfung des aktuellen Anwendungscodes erfasst 156 Komponenten.
Vor dieser Änderung waren acht explizit OnPush; die übrigen 148 verwenden
jetzt ebenfalls `ChangeDetectionStrategy.OnPush`. Das umfasst Root, Shell,
Administration, Testergebnisse, Kodierung, Replay, gemeinsame Komponenten
und Dialoge. Test-Hosts und externe Bibliothekskomponenten gehören nicht
zu dieser Zahl.

Der debouncte Suchfilter hält seinen lokalen Wert in einem Signal; der
Löschen-Button liest dieses Signal. Unit- und Booklet-Suchdialoge verwenden
Signals für Ladezustand, Ergebnislisten und Trefferzahl. Analyse-Aufträge
liegen in einem lokalen Signal, ohne die injizierten Daten des Aufrufers
zu verändern. Neue Such- beziehungsweise Refresh-Anfragen brechen ihre
Vorgänger ab; Subscriptions, Bestätigungen und Debounces enden beim
Zerstören der Dialoge. Ein Wechsel des Suchmodus verwirft die aktive
Anfrage und ignoriert Debounces des vorherigen Modus.

Die Workspace-Auswahl hält den ersetzten `MatTableDataSource` in einem
Signal. Dadurch werden auch der umgebende Suchfilter, die Vorauswahl und
die Signal-Query für die Sortierung nach einer verzögerten Antwort erneut
geprüft. Die manuelle Kodierverwaltung markiert nach einem asynchronen
Laden der Exportdefinitionen ihre Ansicht. Die Definitionserstellung
markiert ihre Ansicht zusätzlich beim Invalidieren der Vorschau aus
Reactive Forms beziehungsweise SelectionModel. Bestehende RxJS-Ströme,
Workspace-Prüfungen und Bibliotheks-Datenquellen bleiben erhalten.

19 zusätzliche native Tests prüfen verzögerte Suchergebnisse aller drei
Modi, Fehler, bestätigtes Löschen, überholte Antworten, Moduswechsel,
Dialogschließung, gefilterte Analyse-Aufträge, Abbruch mit anschließendem
Refresh, unveränderte Aufruferdaten, die debouncte Löschenschaltfläche und
eine verspätete Workspace-Vorauswahl ohne Parent-Output-Handler. Die
Vergleichstests markieren bei ihrer direkten synthetischen Vorbereitung
die tatsächliche Komponentenansicht; die anschließenden asynchronen
Antworten werden weiterhin ausschließlich über `whenStable()` geprüft.
Der Reauthentifizierungstest ändert den Bootstrap-Input wie der echte
Parent. Zwei bereits falsch geschriebene Übersetzungsschlüssel in der
Workspace-Ansicht wurden beim Nachlauf korrigiert.

Die UnitSearchDialog-, BookletSearchDialog- und
VariableAnalysisJobsDialog-Komponenten haben aktuell keinen Aufrufer im
Anwendungscode. Ihre zusätzlichen Tests rendern die echten Komponenten
mit kontrollierten Antworten. Der erreichbare Schnellsuche-Einstieg wird
weiterhin durch die vorhandene Browserregression geprüft. Die Umstellung
belegt durch die Funktionsprüfungen keine gemessene CPU-Ersparnis und
keine vollständige Fehlerfreiheit aller UI-Kombinationen.

### Lokale Abschlussprüfungen der OnPush-Umstellung

| Prüfung | Ergebnis |
|---|---|
| AST-Prüfung aller Anwendungskomponenten | 156 von 156 explizit OnPush; keine fehlende Deklaration |
| Komponenten-API-Nachprüfung | 160 Inputs, 73 Outputs und 42 Signal-Queries weiterhin readonly; keine alten API-Decorator |
| `frontend:lint --fix` | bestanden; Importformatierung an die vorhandenen Regeln angepasst |
| `frontend:test --runInBand --cache=false` | 2.729 Tests / 261 Suites bestanden |
| `frontend:test-zoneless --runInBand --cache=false` | 970 Tests / 68 Suites bestanden, ohne Zone.js |
| `frontend:build --configuration=production` | optimierter Produktionsbuild mit strenger Template-Typprüfung bestanden |
| `frontend:e2e --configuration=production --cypressConfig=cypress.zoneless.config.ts --skipServe=true --baseUrl=http://127.0.0.1:4260 --browser=electron` | 133 Fälle / 24 Spezifikationen bestanden, keine Retries; optimierte Bundles vom Produktionsbuild über lokalen SPA-Server |
| `frontend:zoneless-approval` | 8.748 Inventareinträge; Referenzen für sechs Bereiche, sieben Mechanismen und 46 frühere korrigierte Befunde gültig |

Die Nachweise sind lokale Abschlussläufe. Sie belegen keine erfolgreiche
Remote-CI, keinen erneuten Live-Backend-/Keycloak-Lauf und kein Deployment.
