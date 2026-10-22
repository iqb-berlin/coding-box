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

## Konkrete nächste Schritte

Alle folgenden Ansichtsschnitte sind Vorschläge für getrennte Folgeänderungen.
Die Formularauslagerungen in den Zeilen 2, 10 und 16 sind bereits umgesetzt.
P1 bedeutet zuerst, P2 anschließend, P3 nach den stärker vermischten Bereichen.
Pfade sind relativ zu `apps/frontend/src/app/`.

| Komponente / Pfad | Zeilen vorher → jetzt | Prio | Fachlicher Schnitt und zu erhaltender Vertrag |
| --- | ---: | :---: | --- |
| `coding/components/coding-management-manual/coding-management-manual.component.ts` | 2991 → 2991 | P2 | Vorhandene Import-/Export-/Einstellungs-/Statistik-Facades und Teilansichten weiterverwenden. Antwortanalyse mit Start, Fortschritt und Abbruch sowie Ausführungs-/Schulungsaktionen als eigene Bereiche abgrenzen. Workspace-Wechsel und verspätete Abschlüsse bleiben in der Ablaufsteuerung abgesichert. |
| `coding/components/coding-job-definition-dialog/coding-job-definition-dialog.component.ts` | 2680 → 2629 | P1 | Formularmodell ist ausgelagert. Als Nächstes Variablen-/Bundle-Auswahl, Kodierer-Kapazitäten und Verteilungsvorschau als Teilansichten schneiden. Eine gemeinsame Formular-/Auswahlquelle und der bestehende Workload-Snapshot verhindern widersprüchliche Vorschau- und Speicherdaten. Recovery und Payload-Aufbau separat prüfen. |
| `coding/components/coding-results-comparison/coding-results-comparison.component.ts` | 2464 → 2464 | P1 | Kodierer-/Trainingsauswahl, Vergleichstabelle und Diskussionseditor mit Kommentar-/Code-Speicherung trennen. Vorhandenen Reliabilitäts-SignalStore weiterverwenden; Exportkontext für die gesamte Vergleichsgruppe bleibt unabhängig von Tabellen-Paging. |
| `ws-admin/components/test-results/test-results.component.ts` | 2251 → 2251 | P2 | Testpersonenliste und Booklet-/Unit-Details mit Tags, Notizen, Logs und Medien abgrenzen. Bestehende Ergebnis-/Import-Facades nutzen; aktive Auswahl und kontextgebundene Detailanfragen zentral koordinieren. |
| `replay/components/replay/replay.component.ts` | 2211 → 2211 | P2 | Sitzungs-/Token-Erneuerung und Unit-Ladevorgang in eine Replay-Facade bündeln, Navigation und Aktionsleiste als Teilansichten schneiden. Player-Nachrichtenvertrag und Schutz ungespeicherter Kodierungen haben Vorrang; zuerst gezielte Lebensdauer-/Reauth-Tests. |
| `ws-admin/components/files-validation-result/files-validation.component.ts` | 1915 → 1915 | P2 | Abgeleitete Validierungsübersicht und Gruppierungen als reines View Model berechnen. Fehlende, doppelte und unbenutzte Dateien in eigene Abschnitte schneiden; Auswahl und Bereinigungsbefehle getrennt halten. Ignorierte Testlets/Booklets müssen identisch berücksichtigt werden. |
| `coding/components/coding-management/coding-management.component.ts` | 1842 → 1842 | P2 | Status-/Aktualitätsabfrage, Polling und Cache-Verantwortung bündeln. Automatische Kodierung mit Start, Zurücksetzen und Download als Aktionsbereich abgrenzen. Versionswechsel und angenommene Hintergrundjobs bleiben kontextgebunden. |
| `ws-admin/components/test-results/test-results-flat-table.component.ts` | 1825 → 1825 | P2 | Filterleiste einschließlich Mediengrenzen und gespeicherter Einstellungen vom Tabellenteil trennen. Häufigkeits-/Filteroptionsabfragen separat koordinieren; Filter-/Paging-Wechsel dürfen keine alten Antworten anzeigen. |
| `coding/components/coding-jobs/coding-jobs.component.ts` | 1751 → 1751 | P2 | Filter-/Auswahlleiste von Tabelle und Jobaktionen trennen. Neustart, Review, Übertragung und Ergebnisübernahme in einem Aktionskoordinator bündeln; Auswahl, Rechte und laufende Aktionen über Seitenwechsel erhalten. |
| `coding/components/coder-training/coder-training.component.ts` | 1778 → 1689 | P1 | Formular und fachliche Validierung sind ausgelagert. Als Nächstes Variablen-/Bundle-Stichprobeneditor sowie Kodierer-/Referenz-Auswahl als Teilansichten schneiden. Das bestehende FormArray bleibt einzige Quelle der Variablenauswahl; Recovery und Create-/Edit-Payloads separat testen. |
| `ws-admin/components/test-files/test-files.component.ts` | 1550 → 1550 | P2 | Upload-/Content-Pool-Bereich, Filter-/Dateitabelle und Dateiaktionen abgrenzen. Konfliktbehandlung, Metadaten und Download-/Löschaktionen behalten ihre Rechte- und Workspace-Grenzen. |
| `ws-admin/components/variable-analysis-dialog/variable-analysis-dialog.component.ts` | 1488 → 1488 | P2 | Analyseauftrag mit Fortschritt/Abbruch und Historie von Ergebniskennzahlen, Filtern und Ergebnistabelle trennen. Polling nach Schließen stoppen; späte Antworten dürfen keinen anderen Auftrag ersetzen. |
| `coding/components/double-coded-review/double-coded-review.component.ts` | 1401 → 1401 | P3 | Vorhandene Review-Facade samt Auswahlformular weiterverwenden. Filterleiste und Zeileneditor für Entscheidungen/Kommentare abgrenzen; dynamische Spalten und seitenübergreifende Auswahl bleiben erhalten. |
| `coding/components/coding-job-definitions/coding-job-definitions.component.ts` | 1218 → 1218 | P3 | Freigabe-/Ablehnungsaktionen sowie Verteilungs-/Bulk-Anlagebereich aus der Liste herauslösen. Bestehende Bestätigungen, Berechtigungen und Wiederherstellung beibehalten; keine neue parallele Jobanlage einführen. |
| `coding/components/code-selector/code-selector.component.ts` | 1115 → 1115 | P3 | Codeliste, Problem-/Kommentar-/Notizeditor und Variablen-/Bundle-Navigation abgrenzen. Tastenkürzel und Wechsel mit ungespeicherten Angaben müssen über die Teilansichten hinweg funktionieren. |
| `ws-admin/components/test-center-import/test-center-import.component.ts` | 1154 → 1098 | P1 | Anmelde- und Optionsformulare sind ausgelagert. Als Nächstes Anmeldung, Optionen/Gruppenauswahl und Fortschritt/Ergebnis als Schrittansichten schneiden. Laufender Import, Wiederholung, Überschreibentscheidung und unklarer Ergebnisstatus bleiben bei einem Ablaufbesitzer. |
| `coding/components/coding-jobs/coding-job-result-dialog/coding-job-result-dialog.component.ts` | 1037 → 1037 | P3 | Ergebnisfilter, Zeilenaktionen/Details und Aktualisierungssteuerung abgrenzen. Fokus-/Timer-Refresh darf manuelle Auswahl nicht überschreiben; Review, Übernahme, Schemaänderung und Replay behalten denselben Auftragskontext. |

Zuerst folgen die drei Formularansichten und der Vergleichseditor: Dort sind
konkrete, wiederkehrende Teilbereiche bereits erkennbar. Jeder weitere Schnitt
soll separat reviewbar bleiben und Verhaltenstests für seinen Auswahl-,
Speicher- und Lebensdauervertrag mitbringen. Die verbleibende Zeilenzahl ist
kein Abnahmekriterium.
