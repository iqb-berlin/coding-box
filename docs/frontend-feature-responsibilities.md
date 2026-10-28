# Verantwortlichkeiten großer Frontend-Komponenten

Stand: 20.10.2026. Basis ist der nach Fetch geprüfte `origin/develop`-Commit
`df946eb3212cc18909c57c5a3d93a8191d8d0618`. Die Schnitte folgen dem
[Angular Style Guide](https://angular.dev/style-guide): zusammengehörige Feature-Dateien,
Darstellung in Komponenten, unabhängig prüfbare Fachentscheidungen außerhalb der Ansicht.
Die bisherigen Feature-Verzeichnisse und Importpfade bleiben erhalten.

## Umgesetzte Schnitte

Die neuen Facades werden **an der jeweiligen Seitenkomponente bereitgestellt**. Sie teilen
keinen veränderlichen Ansichtsstatus zwischen zwei geöffneten Seiten. Bestehende Backend-,
Upload-, Cache- und Session-Recovery-Services behalten ihre Zuständigkeiten.

| Bereich | Verantwortung |
| --- | --- |
| `coding-import-file.ts` | CSV-/Excel-Header lesen, normalisieren, Dateiformat und verfügbare Kodierungsversionen bestimmen; keine Angular-Zustände oder Backendaufrufe |
| `ManualCodingImportFacade` | Ein Importversuch: Formatauswahl, Datei lesen, Vorschau-Stream, Fortschritt, Fehler und Vorschau; Abbruch bei Ersetzung, Workspacewechsel und Zerstörung |
| `ManualCodingSettingsFacade` | Lokale gegenüber gespeicherten Matching-Flags, Initialeinstellungen, normalisierte Schwelle und serialisierte, entprellte Speicherung; ausstehende Eingaben werden nicht durch ältere Speicherantworten ersetzt |
| `ManualCodingAggregationSettingsComponent` | Vorhandene Material-Eingaben und ihre Sperrzustände; Seitenaktionen werden als Outputs weitergegeben |
| `ManualCodingAnalysisFacade` | Anfrageersetzung, Pagination, 5-Sekunden-Polling, Fehler-Retry und Übergabe des Analyse-Guards an den vorhandenen Hintergrundservice beim Verlassen der Ansicht |
| `ManualCodingStatisticsFacade` | Statistik-, Abdeckungs-, Job-/Konflikt- und Aktualitätsabfragen mit eigener Ladezustandsverwaltung und Ersetzung je Abfrage; keine Dialog- oder Tabsteuerung |
| `manual-coding-job-summary.ts` | Reine Regeln für aktive Schulungs-/Produktivjobs, Übernahmefähigkeit und Kodierungshinweise |
| `ManualCodingPlanning` | Reine Priorisierung von Planungsstatus, Erklärung und nächstem fachlichem Schritt anhand eines expliziten Zustandswertes; keine Referenz auf die Angular-Komponente |
| `ManualCodingPlanningFacade` | Vollständiges Planungsbündel laden, eine weitere Aktualisierung vormerken, fehlerhafte/noch laufende Bündel vom Cache ausschließen und vorhandene Snapshots wiederherstellen |
| `ManualCodingJobsRefreshFacade` | Produktive und Schulungsauftragslisten gezielt aktualisieren, Änderungen für ausgeblendete oder noch nicht gerenderte Listen zusammenfassen und Definitionsänderungen entprellen; View-Queries werden erst beim Reload gelesen, Timer und Benachrichtigungen enden mit der Seiteninstanz |
| `TestResultsStatisticsFacade` | Übersicht, bedarfsgesteuerte Logqualität, Workspace-Einstellungen und Aktualität der Kodierungen; eigene ersetzbare Abfragen |
| `TestResultsImportFacade` | Testcenter-Import mit Vorher-/Nachher-Übersicht, Fristen, Fortschrittsdialog und Ergebnisdarstellung; CSV-/JSON-/ZIP-Uploads bleiben im vorhandenen `TestResultsUploadStateService` |
| `TestResultsDeletionFacade` | Vorschau und bestätigte Lösch-/Bereinigungsjobs einschließlich Fortschritt, Ergebnis, Fehler und Cacheinvalidierung; Auswahl und Tabellenansicht bleiben in der Seite |
| `TestResultsExportFacade` | Exportoptionen, Start, Wiederaufnahme, Status, Abbruch und Download; Polling überlappt keine Statusabrufe und endet bei terminalem Status |
| `TestResultsOverviewComponent` | Kennzahlen und Antwortstatusverteilung mit expliziten Inputs/Outputs; vorhandene Gestaltung und Statusnavigation |

Die Seiten verbinden die fachlichen Ereignisse mit ihrer Darstellung. In der manuellen
Seite bleiben insbesondere Tab-/Scrollnavigation, Berechtigungsanzeige, Schulungs-Overlay
und Sitzungserholung, Exportdialogsteuerung sowie die Bestätigung der Ergebnisübernahme.
Die Testergebnisseite behält Suche, Paginator, Auswahl, Detail-/Replay-Navigation,
Einzelantwort-/Einzelaufgabenaktionen und die vorhandene Validierungsanzeige.
Es wurde keine komplette Komponentenklasse in einen Ersatzservice verschoben.

## Lebenszyklen und Verhaltensgrenzen

- Ersetzte Statistikabfragen werden abgemeldet; ihr späteres Ergebnis kann neue Daten
  nicht überschreiben. Anfrageabschluss eines Vorgängers beendet auch nicht den
  Ladezustand des Nachfolgers.
- Requests und Dialogantworten sind an den beim Start gültigen Workspace gebunden.
  Ein Wechsel A → B → A macht den ersten Versuch weiterhin ungültig. Entprellte
  Einstellungsaufträge tragen zusätzlich eine Kontextgeneration.
- Der manuelle Import übergibt ein optionales `AbortSignal` an den vorhandenen
  Streaming-Service. Nach Abbruch werden keine verspäteten Fortschritts-/Ergebnisdialoge
  angezeigt. Der Import setzt nur den Validierungsfortschritt zurück, den er selbst besitzt.
- Das Ende der Analyseansicht beendet deren Timer und Requests. Eine bereits laufende
  Serveranalyse bleibt beim vorhandenen Hintergrund-Guard registriert. Ein temporärer
  Pollingfehler führt weiterhin zum Retry, ohne den Guard voreilig freizugeben.
- Export-/Lösch-Polling verwendet `exhaustMap`: langsame Antworten werden abgewartet,
  statt weitere überlappende Abfragen zu starten oder jede Sekunde abgebrochen zu werden.
  Alte Wiederaufnahmeantworten überschreiben keinen neu gestarteten Export.
- Erfolgreich gestartete Serverjobs werden durch Verlassen einer Ansicht nicht rückgängig
  gemacht. Die vorhandene globale Uploadverfolgung und Cache-/Guard-Services bleiben aktiv.
- Die vorhandenen Komponenten-Regressionstests bleiben bestehen; echte
  `fixture.destroy()`-Aufrufe prüfen jetzt auch den Lebenszyklus der bereitgestellten Facades.
  Neue Tests laufen in der bestehenden nativen Zoneless-Testkonfiguration und prüfen
  verzögerte Darstellung mit `whenStable()` ohne nachträgliches `detectChanges()`.

## Einordnung der 17 großen Komponenten

Die historischen Zahlen wurden am Basiscommit bestätigt: manuelle Kodierverwaltung
5.387 TypeScript-Zeilen, Testergebnisse 3.452; insgesamt 17 Komponenten über 1.000 Zeilen.
Die übrigen Dateien wurden anhand ihrer konkreten Methoden eingeordnet, nicht verändert.
Ein Zeilenlimit ist kein Abnahmekriterium. Nach der Umsetzung haben die beiden
Seiten 3.275 beziehungsweise 2.251 TypeScript-Zeilen. Die neuen Facades umfassen
getrennte Abläufe und sind keine Ersatzklasse für die gesamte bisherige Seite.

| Komponente (Basiszeilen) | Konkrete weitere fachliche Grenze |
| --- | --- |
| Manuelle Kodierverwaltung (5.387) | Obige Schnitte umgesetzt; manuelle Exportkonfiguration/Größenschätzung und Ergebnisübernahme sind mögliche weitere eigenständige Abläufe |
| Testergebnisse (3.452) | Obige Schnitte umgesetzt; Person-/Heft-/Aufgabenauswahl und Replayvorbereitung könnten anschließend einen eigenen Detailbereich bilden |
| Jobdefinitionsdialog (2.912) | Definition/Formular gegenüber Verwendungs-/Änderungsvorschau und Review-Einreichung; `onSubmit`, `applyJobDefinitionUsage`, `previewAndApplyDefinitionUpdateRefresh` |
| Ergebnisvergleich (2.550) | Vergleichsdaten/Filter, Reliabilität und Diskussionskodierung mit Übernahme getrennt behandeln; `loadComparison`, `onDiscussionCodeBlur`, `applyTrainingDiscussionResults` |
| Replay (2.211) | Router-/Nachrichtenprotokoll gegenüber Playernavigation und Kodierungssitzung; `subscribeRouter`, `applyUnitChanged`, `restoreReplayRecoveryDraft`; bestehende Lifecycle-Services nutzen |
| Dateivalidierung (1.915) | Reine Zusammenfassung gegenüber Ein-/Ausschlussentscheidungen und Datei-/Metadateneditoren; `calculateSummary`, `markTestTakersAsExcluded`, `openMetadataFile` |
| Kodiertraining (1.862) | Auswahl/Formular gegenüber Referenzübernahme und Trainingsstart; `importJobDefinitionSelections`, `applyTrainingRecoveryDraft`, `onStartTraining` |
| Kodierverwaltung (1.842) | Status-/Antwortabfragen gegenüber Freshness-Jobsteuerung und Ergebnisdownload; `fetchResponsesByStatus`, `startFreshnessCoding`, `startFreshnessJobPolling` |
| Flache Testergebnistabelle (1.810) | Filter-/Spalteneinstellungen, paginierte Abfrage und Häufigkeitsberechnung; `openFlatSettings`, `fetchFlatResponses`, `loadFrequenciesForCurrentPage` |
| Kodierjobs (1.751) | Listen-/Auswahlzustand gegenüber Start/Neustart, Übernahme und Falltransfer; `restartCodingJob`, `applyCodingResults`, `openTransferCodingCasesDialog` |
| Testdateien (1.550) | Upload-/Importresultate, Validierung und ZIP-Download; `handleUploadResult`, `handleValidationResponse`, `downloadAllFilesAsZip` |
| Variablenanalyse (1.488) | Joblebenszyklus gegenüber paginierten Resultaten und reiner Zeilentransformation; `analyzeVariables`, `loadAnalysisResultsPage`, `createRowsFromCombos` |
| Doppelkodierungsprüfung (1.401) | Abfrage-/Filterzustand gegenüber Entscheidungen und Übernahme; `loadFilterOptions`, `loadData`, `sendDecisions` |
| Jobdefinitionen (1.218) | Einzel-/Sammeljoberstellung gegenüber Listenpflege und Verteilungsexport; `createCodingJobFromDefinition`, `createBulkJobsFromDefinition`, `exportDistributionCsv` |
| Testcenter-Importdialog (1.154) | Verbindung/Authentifizierung, Datenauswahl und eigentlicher Import; `authenticate`, `getTestGroups`, `performImport` |
| Codeauswahl (1.115) | Reine Navigations-/Indexbildung gegenüber Auswahl und Tastaturbedienung; `ensureUnitIndexes`, `navigationItems`, `handleKeyboardEvent` |
| Jobergebnisdialog (1.037) | Ergebnisabfrage/Filter gegenüber Schemaeditor und Übernahme; `loadCodingResults`, `createFilterPredicate`, `editCodingScheme` |

## Unabhängigkeit und Überschneidungen

Die Umsetzung liegt auf einem eigenen verwalteten Worktree/Branch
`split-coding-feature-responsibilities`. Fremde Änderungen im primären Checkout
wurden nicht bearbeitet. Es gibt keine Backend-, Schema- oder
DTO-Vertragsänderung; der zusätzliche Abort-Parameter des Frontend-Streaming-Service
ist optional.

Beim Basisabgleich waren [PR #1080](https://github.com/iqb-berlin/coding-box/pull/1080)
und [PR #1082](https://github.com/iqb-berlin/coding-box/pull/1082) offen und nicht gemergt.
Ihre Branches wurden nicht als Basis verwendet. Die Überschneidung mit #1080 wurde anhand des aktuellen Diffs geprüft:
Reihenfolge, Gültigkeit bereits während der Entprellphase und erneute Versuche
liegen hier in der Settings-Facade. Bei einer späteren Integration müssen die
Komponentenänderungen aus #1080 auf diese Zuständigkeit übertragen werden. Jobdefinitionsdialog und Trainingskomponente aus #1082 wurden
nicht geändert. Der Schutz bestehender Formular-/Recovery-Zustände wird über die
beibehaltenen Tests und die realen Browserabläufe geprüft.

## Lokale Prüfung

Alle folgenden Prüfungen wurden lokal auf dem Arbeitsstand ausgeführt:

| Befehl | Ergebnis |
| --- | --- |
| `NX_DAEMON=false npx nx lint frontend --skipNxCache` | Grün; keine Lintfehler |
| `NX_DAEMON=false npx nx test frontend --maxWorkers=2 --skipNxCache` | 286 Suites, 3.096 Tests bestanden; darunter 54 neue Fälle in sechs zusätzlichen Testdateien |
| `NX_DAEMON=false NG_BUILD_MAX_WORKERS=1 npx nx build frontend --configuration=production --skipNxCache` | Produktionsbuild erfolgreich |
| `NX_DAEMON=false npx nx e2e frontend --configuration=ci --port=cypress-auto --browser=chrome --spec='cypress/zoneless/manual-preparation.cy.ts,cypress/zoneless/test-results-view.cy.ts,cypress/zoneless/test-results-quick-search.cy.ts,cypress/zoneless/review-notifications.cy.ts' --skipNxCache` | Alle vier Suites mit 20 Tests bestanden; keine ausgelassenen Tests und keine automatischen Retries |
| `npx nx run frontend:zoneless-approval` | Inventar und Risikoreferenzen konsistent: 352 Quelldateien, 8.892 Einträge |
| `npx nx run frontend:zoneless-inventory-test` | Beide Werkzeugtests bestanden |
| `git diff --check` | Keine Whitespacefehler |

Die beiden neuen Browserfälle prüfen den Erhalt lokaler Matching-Optionen über einen
Tabwechsel einschließlich anschließender Schwellwertspeicherung sowie die erneute
Auswahl derselben CSV-Datei nach Abbruch. Die vorhandenen Fälle prüfen unter anderem
verzögerte Referenz-/Vorschaudaten, Fehler und Retry, Rollengrenzen, Kontextwechsel,
Uploadverfolgung nach Verlassen der Ansicht und verspätete Suchantworten. Die
Screenshots der Einstellungen und der Testergebnisübersicht wurden visuell geprüft.

**Nachweisgrenzen:** Cypress lief in Chrome gegen den hier erzeugten Produktionsbuild
mit expliziten API-Fixtures und prüft die Zoneless-Konfiguration. Ein realer
Backend-/Datenbank-/Keycloak-Lauf und Deployment wurden nicht durchgeführt. Der
Remote-CI-Status ist separat am jeweiligen PR-Head zu prüfen. Backend und DTO-Verträge
wurden nicht geändert. Die bestehenden
Datei-, Upload- und Cache-Services behalten ihre eigenen getesteten Rückfallwerte;
diese Refaktorierung ist keine erneute fachliche Abnahme aller Serverberechnungen.

Das Zoneless-Inventar wurde nach der Extraktion neu abgeglichen. Geänderte Fingerprints
liegen ausschließlich in betroffenen Quellen und den daraus folgenden Paketverweisen;
unbeteiligte Quellen erhielten keine neuen Fingerprints oder künstlichen Freigaben.
Die Risikomatrix ergänzt nur die betroffenen Testverweise. Die Inventardatei dient als
Nachweiszuordnung und ersetzt weder Testausführung noch vollständige Einzelabnahme.

Im abschließenden Review wurden außerdem die gekapselten Styles der leeren Übersicht
vervollständigt und die Schwellwerteingabe während des Speicherns des Matching-Modus
gesperrt. Damit entsprechen Darstellung und Eingabesperre wieder der jeweiligen
Zuständigkeit der neuen Komponenten.
