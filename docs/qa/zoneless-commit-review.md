# Review der Zoneless-Commit-Historie

Stand: 01.10.2026, PR #1039, gepushter Commit `5ff9d430`.
Verglichen wurde die PR gegen `develop`: 62 Commits, 164 geänderte Dateien,
188.366 hinzugefügte und 533 entfernte Zeilen. Die laufende Umstellung auf
risikobasierte Freigabe ist in diesen Zahlen noch nicht enthalten.

## Bewertung

Die untersuchten produktiven Korrekturen haben einen konkreten Nutzen:
Angular-Benachrichtigung nach asynchronen Antworten, korrekte Workspace-Zuordnung,
Schutz vor alten Antworten, Freigabe nach Fehlern und Aufräumen nach Navigation.
Die 25 dokumentierten Audit-Befunde besitzen gezielte Regressionen. Die früheren
Korrekturen für Speicherrennen, Rechteauswahl und Sitzungswiederherstellung sind
besonders wichtig, weil sie Eingaben und Berechtigungen betreffen.

Überzogen waren die vollständige Szenariomatrix pro Einzelbindung, immer neue
Gesamtläufe nach kleinen Ergänzungen und die kleinteilige Veröffentlichung
zusammengehöriger Fix-/Test-/Dokumentationsschritte. Das erzeugte mehr Nachweisarbeit
und Historie, ohne für jede zusätzliche Bindung ein eigenständiges Risiko zu prüfen.

Die Metadatenkorrekturen sind umfangreicher als ein `markForCheck()`: lokale
Formularwerte, Vokabularanbieter pro Formular und der Dauer-Adapter beheben
tatsächlich reproduzierte Probleme mit zwei Dialogen und vertauschten Eingabeziffern.
Der Dauer-Eingabefehler ist auch unabhängig von der Zoneless-Migration ein
Bedienungsproblem. Diese Änderungen verdienen einen zusammenhängenden Review;
ein pauschaler Rückbau würde die nachgewiesenen Fehler wieder einführen.

Das ist eine Bewertung von Umfang und Bündelung anhand der gesamten Historie
und der endgültigen Änderungen in den zentralen asynchronen Pfaden. Es ist keine
Behauptung, dass jede geänderte Zeile erneut unabhängig geprüft wurde.

## Konkrete Vereinfachung

| Priorität | Review-Befund | Maßnahme |
|---|---|---|
| P2 | Einzelfreigaben für 8.729 Inventareinträge blockierten die Freigabe trotz gezielter Regressionen | Auf ausdrücklich gewünschte Risikofreigabe umgestellt |
| P2 | Generiertes Inventar dominierte den PR-Diff | Semantisch unverändert kompakt gespeichert |
| P2 | Zusammengehörige Fehlerkorrektur und Nachweise sind über viele Commits verteilt | Squash-Merge empfohlen; acht Pakete als Alternative vorbereitet |
| P3 | Dauer-Eingabefehler ist auch unabhängig von Zoneless relevant | Im gemeinsamen Metadatenpaket erkennbar halten |

- Vorhandene Regressionen behalten; keine neuen Tests je Template-Bindung verlangen.
- Die kleine Risikomatrix ersetzt die Einzelabdeckung als Freigabekriterium.
- Das generierte Inventar wird mit einem Eintrag pro Zeile gespeichert:
  8.731 statt 178.170 Zeilen, bei unverändertem JSON-Inhalt.
- Die ausführliche Audit-Chronik bleibt als Herkunftsnachweis erhalten.
  Neue Ergebnisse werden an klaren Abschlussständen ergänzt.
- Tests und Produktkorrektur gehören beim Zusammenfassen in dasselbe Paket.

## Empfohlene Zusammenfassung

**Bevorzugt: ein Squash-Merge für die Migration nach erfolgreicher Freigabe.**
Dadurch erhält `develop` einen zusammenhängenden Commit, während die bisherigen
PR-Nachweise und Diskussionen erhalten bleiben. Es wird jetzt weder gemergt noch
deployed.

Soll schon die PR-Historie kürzer werden, sind diese acht zusammenhängenden
Pakete praktikabler als das Umordnen von 62 voneinander abhängigen Commits:

| Paket | Ursprünglicher Bereich, einschließlich Grenzen | Anzahl | Inhalt |
|---|---|---:|---|
| 1 | `b99ae8aa` bis `abb72a0a` | 6 | Auth-Lebenszyklus, reaktives Menü, Migrationseinstieg, Adapter und Speicherrennen |
| 2 | `1e4cb0c7` bis `bea1afd1` | 12 | Isolierter Keycloak-Aufbau, Replay, Upload, Administration und erste Nachweise |
| 3 | `05f20c70` bis `d2a11dda` | 8 | Speichern, Rechteauswahl, manueller Kodierablauf und Exporte |
| 4 | `f461f20b` bis `3bbe49a5` | 12 | Rechte-Pagination, Sitzungswarnungen, regulärer Zoneless-Build und CI-Anbindung |
| 5 | `aaae7be1` bis `22ab592a` | 7 | Dialog-/Fortschrittsupdates, Testaufbau und Validierungsfehler mit Wiederholung |
| 6 | `b3659af7` bis `5006cb55` | 6 | Navigation, Workspace-Zuordnung, XML und Informationsdialoge |
| 7 | `e349759c` bis `bacdc625` | 4 | Metadaten-Lebenszyklus, Formularisolation, Vokabulare und Dauer-Eingabe |
| 8 | `9106dded` bis `5ff9d430` | 7 | Dateivalidierung, automatische Erstellung, Suche, Settings und Produktionsbrowser |

Die neue risikobasierte Freigabe und die noch laufenden Rollenprüfungen gehören
anschließend zu den jeweiligen Test-/Freigabepaketen. Die Endzustände der Pakete
wären bei einer tatsächlichen Umschreibung erneut zu prüfen; ihre einzelnen
Zwischenstände sind hier nicht als grün bestätigt.

Eine lokale Vorschau steht unter `zoneless-consolidated-preview` bereit. Sie
verwendet die acht Endbäume der Pakete. Risikofreigabe, Persistenzprüfung und
abschließende CI-Korrekturen gehören ebenfalls zum achten Paket. Vor einer
Veröffentlichung wird dessen Endbaum gegen den aktuellen Arbeitsbranch verglichen.
Die Vorschau ist nicht gepusht und hat den aktuellen Arbeitsbranch nicht gewechselt.

Ein Squash der PR-Historie ändert veröffentlichte Commit-IDs und braucht einen
abgesicherten Push mit `--force-with-lease`. Vorher müssen der alte Head erhalten
und identische Endbäume bestätigt werden. Dieser Review hat die veröffentlichte
Historie nicht umgeschrieben.

## Freigabe

Die Konsolidierung allein ist kein Qualitätsnachweis. Entscheidend sind die
erfolgreichen Tests und CI des finalen Standes sowie die ausdrücklich benannten
Restgrenzen in `zoneless-risk-coverage.json`.
