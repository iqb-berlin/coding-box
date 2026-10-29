# Dateivalidierung: Darstellung aus expliziten Ergebnissen ableiten

Basis: `b551329189357095f5eca7a4ccb54a1cce4f8a07` auf
`angular21-toolchain-type-safety`, 28.10.2026. Dieses Paket ist unabhängig vom
Replay-Paket und separat gegen denselben Basisbranch reviewbar.

`files-validation-view-model.ts` enthält die bisherigen lokalen Datentypen und
reine Funktionen für Abschnittskennzahlen, Vollständigkeit, eindeutige fehlende
Dateien sowie die Beziehung zu Booklets beziehungsweise Units. Die Eingaben sind
Validierungsergebnisse und ein expliziter Kontext aus ignorierten Units,
Booklets, Testlets und bereits geladenen Booklet-Informationen. Das Modul
verwaltet keine Abonnements, Angular-Signale, Auswahl oder Backend-Aufträge.

Der Dialog bleibt Besitzer der ursprünglichen Ergebnisse, Einstellungen,
Auswahl, aufgeklappten Abschnitte, Bestätigungen und Dateiaktionen. Er erstellt
bei den bisherigen Aktualisierungspunkten ein neues View Model und übergibt
dessen Ergebnis und Zusammenfassung an die vorhandenen Signale. Es gibt keinen
zweiten gespeicherten Ausschlusszustand und keine neue Anfrage- oder
Speicherstrategie. Template und Styles bleiben erhalten.

Folgende Regeln werden bewusst beibehalten:

- Nur explizit ungültige TestTaker-XMLs zählen als ungültig; ein fehlendes Flag
  wird weiterhin als gültig behandelt.
- Abschnittsvollständigkeit berücksichtigt das bisherige `complete`-Flag und
  leere Fehlend-Listen. Nur der Unit-Abschnitt kann zusätzlich durch die direkte
  Ignore-Liste vollständig werden.
- Rohzahlen fehlender Units bleiben verfügbar; gefilterte Anzeige und
  Zusammenfassung berücksichtigen direkte Unit-Ausnahmen. Die Zeilenprüfung
  mit übergebenen Eltern berücksichtigt weiterhin auch Booklet- und
  Testlet-Ausnahmen. Diese beiden bisherigen Aufrufkontexte werden erhalten.
- Zusammenfassungen deduplizieren fehlende Dateinamen abschnittsweise und
  sortieren sie. Die Einzelansicht behält ihre ursprünglichen Einträge.
- Fehlende Referenzen werden wie bisher nach vollständigem Pfad, Dateinamen
  oder Dateinamen ohne Erweiterung zugeordnet, einschließlich Groß-/
  Kleinschreibung und Windows-Pfadtrennern. Beziehungslisten deduplizieren in
  ursprünglicher Reihenfolge, zeigen zunächst drei Einträge und zählen den Rest.

Der Dialog umfasst nach dem Schnitt 1.560 statt 1.915 TypeScript-Zeilen. Der
fachliche Schnitt ist das Abnahmekriterium. Die bestehende Auswahlverarbeitung
für große TestTaker-Mengen, Ausschluss-/Wiederaufnahmeaktionen und Datei-Editoren
bleiben beim Dialog.

Die Regressionen umfassen reine Berechnungsfälle, einen nativen Zoneless-Test
für verzögert geladene Ignore-Einstellungen mit `whenStable()` ohne zusätzliche
manuelle Change Detection sowie einen Browserfall für die sichtbaren,
eindeutigen Fehlend-Zahlen nach dem Einstellungsabruf. Die vorhandenen
Browserfälle für Informationsdialoge und TestTaker-Auswahl werden mitgeprüft.
Die Browserdaten sind synthetische API-Antworten; reale Persistenz und fachliche
Abnahme sind damit nicht nachgewiesen.

## Lokale Prüfung

Am endgültigen Stand mit Node 22.23.1 über die lokale Nx-Installation:

| Prüfung | Ergebnis |
| --- | --- |
| Frontend-Lint | Bestanden, keine Warnungen. |
| Vollständige native Zoneless-Suite | 318 Suites, 3.502 Tests bestanden; 16 neue Regressionen gegenüber der Basis. |
| Frontend-Produktionsbuild | Mit normalen Projektoptionen bestanden. |
| Backend-Produktionsbuild | Nach Abschluss der Frontend-Prüfungen separat bestanden. |
| Quality Gates | Alle 51 Tests bestanden. |
| Inventar / Risikogate | Beide Inventartests und Risikoreferenzen bestanden; 409 Quelldateien und 9.358 Einträge. |
| Browser | 17/17 Fälle aus `file-validation-info.cy.ts` und `file-validation-selection.cy.ts` in Chrome gegen den frischen Build bestanden, ohne Retries oder übersprungene Fälle. |
| `git diff --check` | Bestanden. |

Das Eigenreview hat keine offenen Befunde. Es prüfte insbesondere den Erhalt
von direkten gegenüber geerbten Ausnahmen, die Behandlung leerer Testlet-IDs,
die bisherige Referenznormalisierung und die unveränderten Aufrufer für
Auswahl, Speicherung und Dateiaktionen. Remote-CI und fachliche Abnahme bleiben
separat zu prüfen.
