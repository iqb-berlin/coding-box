# Große Angular-Komponenten: Bestand und nächste Schnitte

Ausgangspunkt: `develop` nach PR #1089, Commit
`cdc9f9b6dea0f80c00768157e025f2747aaa017c` (22.10.2026).
Gezählt werden physische Zeilen einschließlich Kommentaren und Leerzeilen in
`apps/frontend/src/app/**/*.component.ts`, ohne HTML und SCSS. Vor und nach der
Formularauslagerung überschreiten 17 Komponenten 1.000 Zeilen. Diese Grenze ist
eine Suchhilfe; entscheidend sind Verantwortlichkeiten und unabhängig prüfbares
Verhalten.

## In diesem Schritt umgesetzt

Die drei großen Besitzer komplexer Reactive Forms delegieren Aufbau, Typen und
Validierungsregeln an lokale Formularmodule:

- `coding-job-definition-form.ts`: Erstellungs-/Bearbeitungsmodus,
  Definitionsname, numerische Grenzen, Profilvorgaben, schreibgeschützte Felder.
- `coder-training-form.ts`: Hauptformular und Variablen-FormArray, bedingter
  Referenzmodus, Stichprobengrenzen und verfügbare Fälle einschließlich
  Ableitungsfehlern. Aktuelle Metadaten werden zusätzlich zu den im Control
  hinterlegten Grenzen geprüft.
- `test-center-import-form.ts`: Anmeldung und Importoptionen, bedingte
  individuelle Testcenter-Adresse sowie Auswahl-/Löschregeln für Importoptionen.

Die Komponenten behalten ihre bestehenden Abonnements und deren Lebensdauer,
Recovery, Rechteprüfung, UI-Rückmeldung und API-Aufrufe. API-Payloads,
Formularvorgaben und fachliche Entscheidungen bleiben erhalten. Die neuen
Formularregeln sind ohne Komponententemplate separat testbar. Einfache
Filter-Controls in anderen Ansichten werden nicht künstlich ausgelagert.

Lokal geprüft am 22.10.2026, Node 22.23.1:

- `nx lint frontend`: bestanden, keine Warnungen.
- `nx run frontend:test --configuration=ci --maxWorkers=2`: 294 Spezifikationen,
  3.246 Tests bestanden, einschließlich 26 neuer Tests der Formularregeln.
- `nx run frontend:zoneless-approval`: Inventar und risikobezogene
  Testreferenzen bestanden.
- `nx build frontend --configuration=production`: bestanden.
- `nx run frontend:e2e --configuration=ci --browser=electron` mit
  `manual-preparation.cy.ts` und `testcenter-import.cy.ts`: 20 Fälle gegen den
  frisch gebauten Produktionsstand bestanden, ohne Wiederholungen. API-Antworten
  sind in diesen Browserfällen synthetisch; reale Testcenter-Verbindungen und
  Backend-Persistenz sind damit nicht nachgewiesen.

Alle Nx-Aufrufe liefen über die lokale Installation mit
`NX_DAEMON=false npx --no-install nx`. Diese Ergebnisse belegen lokale Prüfungen;
die entfernte CI ist separat am jeweiligen PR-Head zu prüfen.

## Fachliche Aufteilung der vier priorisierten Ansichten

Die Folgeimplementierung basiert auf dem gepushten Formularstand
`962be95cd1762e0c56ad51bea1bc5076ea573d1b` von PR #1090, aktualisiert am
23.10.2026 auf `develop` bei `474dd5125f9962e4b4d8b60b3f23c0f5637bda9d`.
Der ursprüngliche Stand war `5cd02a0bccb0c52e5b7cddb573cdcb9a2210cfa0`;
PR #1090 wurde am 23.10.2026 mit `669f3fb2a802e6498171c5f96cc3754e9d957590`
in `develop` gemergt; #1091 wird jetzt gegen `develop` geprüft. Die vier Ansichten haben folgende lokale
Teilansichten; die anderen 13 Komponenten wurden nicht umgebaut:

| Ablaufbesitzer | Neue fachliche Teilansichten | Erhaltener Vertrag |
| --- | --- | --- |
| `CodingJobDefinitionDialog` | `JobVariableSelection`, `JobBundleSelection`, `JobCoderCapacity`, `JobDistributionPreview` | Auswahl-/Verfügbarkeitsentscheidungen, Kapazitätsnormalisierung, Recovery und Payload bleiben zentral. Die Vorschau erhält den vorhandenen Workload-Snapshot. |
| `CoderTraining` | `TrainingParticipantSelection`, `TrainingSampleEditor` | Dieselben typisierten Controls und dasselbe FormArray; keine zweite Variablenauswahl. Stichprobengrenzen und bedingter Referenzmodus kommen weiter aus dem Formularmodul. Create/Edit, Rechte und Recovery bleiben am Besitzer. |
| `TestCenterImport` | `TestCenterLoginStep`, `TestCenterOptionsStep`, `TestCenterGroupsStep`, `TestCenterImportProgress` | Anmeldung, Abfragen/Polling, Gruppenwahl, Import, Überschreibbestätigung, Retry und unklarer Ergebnisstatus werden weiterhin von einer Instanz koordiniert. |
| `CodingResultsComparison` | `TrainingComparisonSelection`, `TrainingComparisonTable`, `TrainingDiscussionEditor` | Tabelle meldet Paging/Sortierung; Diskussionsfelder melden Eingabe/Commit. Speicheraktionen, Recovery und der bestehende Reliabilitäts-SignalStore bleiben dialoglokal; Exporte beziehen sich auf die volle Kohorte. |

Die Grenzen sind über lesbare Eingaben und benannte Ereignisse verbunden. Die
Teilansichten haben keine eigenen Backend-Abonnements und greifen nicht über
eine injizierte Elternkomponente auf deren Interna zu. Vorhandene Styles sind
an die rendernde Teilansicht verschoben; gemeinsame Abschnitts-/Feedbackregeln
liegen in lokalen Sass-Mixins. Zuvor vom Besitzer angewendete Überschriften-,
Feldbreiten- und mobile Aktionsregeln liegen ebenfalls an der rendernden Ansicht.

Zusätzlich ist die Kontextannahme beim Vergleich gehärtet: Alte
Diskussionsabschlüsse werden auch nach Schulung A → B → A verworfen. Der erste
Workspace-Wechsel beendet die alten Dialogabonnements und schließt den Dialog.
Projektionszeilen der Tabelle besitzen eine stabile Response-ID; Eingaben
behalten beim Aktualisieren der Draft-Signals ihren DOM-Knoten und den Fokus.
Das Paging bleibt vom Reliabilitätsexport entkoppelt. Eine verspätete, unveränderte
Workspace-Einstellung für die Regex-Suche erzeugt keine zusätzliche Erstseitenabfrage
und setzt die aktuelle Seite nicht zurück.

Lokal geprüft am 22.10.2026 mit Node 22.23.1, ausschließlich im verwalteten
Worktree auf Branch `split-angular-feature-views`. Alle Nx-Aufrufe liefen über
`NX_DAEMON=false npx --no-install nx`:

| Prüfung | Ergebnis |
| --- | --- |
| `run frontend:test --configuration=ci --maxWorkers=2 --skipNxCache` | 3.256 Tests in 294 Spezifikationen bestanden; zehn zusätzliche Vertrags-/Verhaltensfälle gegenüber der Formularbasis. Erneuter vollständiger Lauf mit Coverage: 79,95 % Statements/Zeilen, 79,78 % Branches, 79,21 % Functions. |
| `lint frontend` | Bestanden, keine Warnungen. |
| `build frontend --configuration=production` | Bestanden, keine Budget-/Compilerwarnungen. |
| `run frontend:zoneless-approval` | Aktuelles Inventar und Risikoreferenzen bestanden; 9.065 Einträge, 172 Komponenten. Die 17 betroffenen Besitzer/Teilansichten haben konkrete Test- und Aufruferreferenzen. Keine vollständige Freigabe aller Inventarszenarien. |
| `run frontend:e2e --configuration=ci --browser=electron --spec=cypress/zoneless/manual-preparation.cy.ts,cypress/zoneless/testcenter-import.cy.ts,cypress/zoneless/training-comparison.cy.ts` | 27 Fälle bestanden: 18 manuelle Vorbereitung, zwei Testcenter-Dateiimport, sieben Ergebnisvergleich. Keine Retries oder übersprungenen Fälle; frisch gebautes Produktionsartefakt. |
| `run frontend:component-test --browser=electron --spec=cypress/component/test-center-import.component.cy.ts` | Fünf Browser-Komponentenfälle bestanden: Teilimport bei 1.200/420 px, Options-/Überschreibwechsel mit Retry ohne bestätigte Gruppen, abgewiesener Import und Bestätigung eines unklaren Serverstatus. Keine Retries oder übersprungenen Fälle. |
| `git diff --check` | Bestanden. |

Die zehn zusätzlichen Jest-Fälle prüfen die gemeinsame Formular-/Control- und
Workload-Identität, Referenzvalidierung und DERIVE_ERROR-Verfügbarkeit, die
Schrittbefehle und Rückkehr zu denselben Importoptionen, den gesperrten
Gruppenschritt bei unklarem Status, verspätete Diskussionsantworten nach
Schulung A → B → A (Erfolg und Fehler), Workspace-Abbruch, den Fokus beim Tippen
sowie die erhaltene Tabellenseite bei unveränderten verspäteten Einstellungen.
Bestehende Tests prüfen weiter Create/Edit, Rechte, Recovery, Filterersetzung,
Fehler/Retry und Schließen/Wiederöffnen. Der Browserfall zum offenen CSV-Export
über einen Seitenwechsel ist unverändert bestanden.

Eigene Vertrags- und Aufruferprüfung: keine offenen P0/P1-Befunde. Die
Komponentenscreenshots wurden bei 420 und 1.200 px auf lesbare Statushinweise und
Umbrüche geprüft. Die Browserfälle verwenden synthetische API-/Serviceantworten;
reale Testcenter-Verbindungen, Backend-Persistenz und fachliche Abnahme sind damit
nicht nachgewiesen. Die lokale Validierung ersetzt weder die entfernte CI am
PR-Head noch eine fachliche Abnahme. Die Formularbasis aus PR #1090 ist
inzwischen in `develop` integriert; die Folgeänderung wird gegen `develop` geprüft.

SHA-256 des Produktionsartefakts laut `scripts/qa/hash-frontend-artifact.mjs`:
`05ea821ef9cd951407bae21736c5aecba12d5a62cc92110de9d0e944061d5855`.
Während der Browserprüfung ergänzt der statische Server den SPA-Fallback
`404.html` (inhaltlich identisch zu `index.html`); damit lautet der Hash
`ec7ea3ab135e75a089d08cd0f76e8b3157bddfd53cb79ef472a9ab5d910becb9`.
Beim Beenden des Servers wird dieser Fallback wieder entfernt.

Nach Integration der aktualisierten Formularbasis und des aktuellen `develop` am
23.10.2026 bestanden erneut alle 160 E2E-Fälle in 29 Specs, ohne Retries oder
übersprungene Fälle. Zusätzlich bestanden 13 Tests der E2E-Helfer, 27
OIDC-HTTP-Tests und die Zoneless-Prüfung. Die Frontend-Quelldateien und das
Produktionsartefakt sind gegenüber dem geprüften Stand `18ddf2a8` unverändert.
Die übernommenen Tests sichern den Schließen-Button der festen Schulungsmaske
gegen äußeres Scrollen ab; der Kappa-Test wartet vor der Workspace-Navigation
auf die gerenderte Home-Ansicht. Die Remote-CI bleibt am neuen PR-Head separat
zu prüfen.

Pipeline [#105094](https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/105094)
bestand alle übrigen Jobs und 37 Komponentenfälle; im E2E-Lauf scheiterte einer
von 160 Fällen, weil die Workspace-Animation beim Schließen der Schulung noch
`opacity: 0` meldete. Der Browserhelfer beendet jetzt endliche Animationen entlang
der gesamten DOM-Vorfahrenkette des Dialogs. Endlose Animationen bleiben erhalten.
Der Regressionstest hält Workspace, Overlay und Modal am unsichtbaren Startbild
fest: Vor der Korrektur entstand derselbe Fehler wie in CI, danach bestanden alle
18 Fälle der manuellen Vorbereitung mit regulärer Sichtbarkeits-/Hit-Prüfung und
Klick. Die Anfragenabbruch- und Wiederöffnungsprüfungen bleiben unverändert.
Auch der anschließende vollständige Lauf bestand 160/160 E2E-Fälle in 29 Specs
ohne Retries oder übersprungene Fälle (6:45 Minuten).

## Bestandsaufnahme und weitere Schnitte

Die Tabelle behält die ursprüngliche Priorisierung bei und zeigt die aktuellen
Dateigrößen. Die vier P1-Ansichtsschnitte sind oben umgesetzt; die übrigen
Vorschläge bleiben mögliche Folgeänderungen.
P1 bedeutet zuerst, P2 anschließend, P3 nach den stärker vermischten Bereichen.
Pfade sind relativ zu `apps/frontend/src/app/`.

| Komponente / Pfad | Zeilen vorher → jetzt | Prio | Fachlicher Schnitt und zu erhaltender Vertrag |
| --- | ---: | :---: | --- |
| `coding/components/coding-management-manual/coding-management-manual.component.ts` | 2991 → 2991 | P2 | Vorhandene Import-/Export-/Einstellungs-/Statistik-Facades und Teilansichten weiterverwenden. Antwortanalyse mit Start, Fortschritt und Abbruch sowie Ausführungs-/Schulungsaktionen als eigene Bereiche abgrenzen. Workspace-Wechsel und verspätete Abschlüsse bleiben in der Ablaufsteuerung abgesichert. |
| `coding/components/coding-job-definition-dialog/coding-job-definition-dialog.component.ts` | 2680 → 2655 | P1 (umgesetzt) | Formularmodell, Variablen-/Bundle-Auswahl, Kodierer-Kapazitäten und Verteilungsvorschau sind getrennt. Gemeinsame Auswahl und Workload-Snapshot liefern konsistente Vorschau-/Speicherdaten; Recovery und Payload-Aufbau bleiben zentral geprüft. |
| `coding/components/coding-results-comparison/coding-results-comparison.component.ts` | 2464 → 2462 | P1 (umgesetzt) | Kodierer-/Trainingsauswahl, Vergleichstabelle und Diskussionsfelder sind getrennt. Kommentar-/Code-Speicherung und der vorhandene Reliabilitäts-SignalStore bleiben dialoglokal; der Exportkontext umfasst weiterhin die gesamte Kohorte unabhängig vom Paging. |
| `ws-admin/components/test-results/test-results.component.ts` | 2251 → 2251 | P2 | Testpersonenliste und Booklet-/Unit-Details mit Tags, Notizen, Logs und Medien abgrenzen. Bestehende Ergebnis-/Import-Facades nutzen; aktive Auswahl und kontextgebundene Detailanfragen zentral koordinieren. |
| `replay/components/replay/replay.component.ts` | 2211 → 2211 | P2 | Sitzungs-/Token-Erneuerung und Unit-Ladevorgang in eine Replay-Facade bündeln, Navigation und Aktionsleiste als Teilansichten schneiden. Player-Nachrichtenvertrag und Schutz ungespeicherter Kodierungen haben Vorrang; zuerst gezielte Lebensdauer-/Reauth-Tests. |
| `ws-admin/components/files-validation-result/files-validation.component.ts` | 1915 → 1915 | P2 | Abgeleitete Validierungsübersicht und Gruppierungen als reines View Model berechnen. Fehlende, doppelte und unbenutzte Dateien in eigene Abschnitte schneiden; Auswahl und Bereinigungsbefehle getrennt halten. Ignorierte Testlets/Booklets müssen identisch berücksichtigt werden. |
| `coding/components/coding-management/coding-management.component.ts` | 1842 → 1842 | P2 | Status-/Aktualitätsabfrage, Polling und Cache-Verantwortung bündeln. Automatische Kodierung mit Start, Zurücksetzen und Download als Aktionsbereich abgrenzen. Versionswechsel und angenommene Hintergrundjobs bleiben kontextgebunden. |
| `ws-admin/components/test-results/test-results-flat-table.component.ts` | 1825 → 1825 | P2 | Filterleiste einschließlich Mediengrenzen und gespeicherter Einstellungen vom Tabellenteil trennen. Häufigkeits-/Filteroptionsabfragen separat koordinieren; Filter-/Paging-Wechsel dürfen keine alten Antworten anzeigen. |
| `coding/components/coding-jobs/coding-jobs.component.ts` | 1751 → 1751 | P2 | Filter-/Auswahlleiste von Tabelle und Jobaktionen trennen. Neustart, Review, Übertragung und Ergebnisübernahme in einem Aktionskoordinator bündeln; Auswahl, Rechte und laufende Aktionen über Seitenwechsel erhalten. |
| `coding/components/coder-training/coder-training.component.ts` | 1778 → 1727 | P1 (umgesetzt) | Formularregeln, Variablen-/Bundle-Stichprobeneditor und Kodierer-/Referenzauswahl sind getrennt. Das bestehende FormArray bleibt einzige Quelle der Variablenauswahl; Recovery, Rechte und Create-/Edit-Payloads bleiben am Ablaufbesitzer geprüft. |
| `ws-admin/components/test-files/test-files.component.ts` | 1550 → 1550 | P2 | Upload-/Content-Pool-Bereich, Filter-/Dateitabelle und Dateiaktionen abgrenzen. Konfliktbehandlung, Metadaten und Download-/Löschaktionen behalten ihre Rechte- und Workspace-Grenzen. |
| `ws-admin/components/variable-analysis-dialog/variable-analysis-dialog.component.ts` | 1488 → 1488 | P2 | Analyseauftrag mit Fortschritt/Abbruch und Historie von Ergebniskennzahlen, Filtern und Ergebnistabelle trennen. Polling nach Schließen stoppen; späte Antworten dürfen keinen anderen Auftrag ersetzen. |
| `coding/components/double-coded-review/double-coded-review.component.ts` | 1401 → 1401 | P3 | Vorhandene Review-Facade samt Auswahlformular weiterverwenden. Filterleiste und Zeileneditor für Entscheidungen/Kommentare abgrenzen; dynamische Spalten und seitenübergreifende Auswahl bleiben erhalten. |
| `coding/components/coding-job-definitions/coding-job-definitions.component.ts` | 1218 → 1218 | P3 | Freigabe-/Ablehnungsaktionen sowie Verteilungs-/Bulk-Anlagebereich aus der Liste herauslösen. Bestehende Bestätigungen, Berechtigungen und Wiederherstellung beibehalten; keine neue parallele Jobanlage einführen. |
| `coding/components/code-selector/code-selector.component.ts` | 1115 → 1115 | P3 | Codeliste, Problem-/Kommentar-/Notizeditor und Variablen-/Bundle-Navigation abgrenzen. Tastenkürzel und Wechsel mit ungespeicherten Angaben müssen über die Teilansichten hinweg funktionieren. |
| `ws-admin/components/test-center-import/test-center-import.component.ts` | 1154 → 1083 | P1 (umgesetzt) | Anmeldung, Optionen, Gruppenauswahl und Fortschritt/Ergebnis sind getrennte Teilansichten. Laufender Import, Wiederholung, Überschreibentscheidung und unklarer Ergebnisstatus behalten einen gemeinsamen Ablaufbesitzer. |
| `coding/components/coding-jobs/coding-job-result-dialog/coding-job-result-dialog.component.ts` | 1037 → 1037 | P3 | Ergebnisfilter, Zeilenaktionen/Details und Aktualisierungssteuerung abgrenzen. Fokus-/Timer-Refresh darf manuelle Auswahl nicht überschreiben; Review, Übernahme, Schemaänderung und Replay behalten denselben Auftragskontext. |

Die vier priorisierten Schnitte sind umgesetzt. Die übrigen 13 Vorschläge sind
weiterhin eigenständige Folgearbeiten. Jeder weitere Schnitt soll separat
reviewbar bleiben und Verhaltenstests für seinen Auswahl-, Speicher- und
Lebensdauervertrag mitbringen. Die verbleibende Zeilenzahl ist kein
Abnahmekriterium.
