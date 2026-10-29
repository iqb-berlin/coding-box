# Antwortwert- und Codehäufigkeiten

Unter **Testergebnisse → Antwortwertanalyse** wird vor dem Start eines Auftrags
die Auswertungsgrundlage gewählt:

- **Antwortwerte und Kategorien**: gespeicherte Rohwerte; Mehrfachantworten werden
  in einzelne Antwortkategorien aufgelöst. Labels stammen aus den Wert- und
  Positionsmetadaten der Unit. Schema-Code-IDs und Code-Scores werden hier nicht
  an gleichlautende Rohwerte angehängt.
- **Vergebene Codes**: `code_v1`, `code_v2` oder `code_v3` des ausgewählten
  Kodierlaufs. Labels und optionale Scores stammen aus den Code-Definitionen des
  Kodierschemas. Eine Mehrfachantwort liefert in dieser Auswertung einen
  vergebenen Code, unabhängig von ihren einzelnen Antwortkategorien.

Jeder Auftrag speichert seine Grundlage und seinen Kodierlauf. Beim Laden eines
vorhandenen Ergebnisses bleibt diese Zuordnung erhalten. Eine geänderte Auswahl
gilt für den nächsten Auftrag. Nach dem Update müssen bestehende Analysen neu
gestartet werden: Bereits gespeicherte Ergebnisse werden nicht neu berechnet.
Alte Aufträge ohne Auswertungsgrundlage werden als Antwortwertanalysen behandelt.

## Zählung und Gültigkeit

Die bestehenden Ausschlussregeln und die Auswahl eines Datensatzes je Person,
Booklet, Aufgabe, Variable und Subform gelten für beide Auswertungen. Bevorzugt
wird ein nicht leerer Rohwert, anschließend die jüngste Antwort-ID.

| Angabe | Bedeutung |
| --- | --- |
| Anzahl Antworten | Alle Vorkommen des Antwortwerts, der Kategorie oder des Codes |
| Anzahl gültiger Antworten | Davon gültige Vorkommen |
| Antworten gesamt | Alle berücksichtigten Antwortdatensätze für Aufgabe/Variable |
| Gültige Antworten | Davon für die gewählte Auswertung gültige Datensätze |
| Fehlend/ungültig | Antworten gesamt minus gültige Antworten |
| Leere Rohwerte | Unabhängig davon gezählte leere Rohantworten |

Für Antwortwerte gelten `NULL`, leere oder nur aus Leerzeichen bestehende
Zeichenketten, der Text `null` (ohne Beachtung der Großschreibung) und leere Listen
als leer. Boolesche Listen ohne ausgewählte Option gelten ebenfalls als leer.
Bei Mehrfachantworten zählen auch Antworten ohne ausgewählte Kategorie
als leer. Nicht leere Antworten sind gültig, wenn ihr ursprünglicher Status nicht
`UNSET`, `NOT_REACHED`, `DISPLAYED`, `DERIVE_ERROR`, `INVALID`, `CODING_ERROR` oder
`PARTLY_DISPLAYED` ist. Kodierergebnisse verändern diese Rohwertgültigkeit nicht.

Für Codes sind ein vorhandener Code und der Status `CODING_COMPLETE` oder
`INTENDED_INCOMPLETE` im ausgewählten Kodierlauf erforderlich. Code 0, Score 0 und
Codes ohne Score werden berücksichtigt. Andere Status und fehlende Codes zählen
zu Fehlend/ungültig. Ein leerer Rohwert und ein gültiges Kodierergebnis können
gleichzeitig vorliegen.

`Prozent gesamt = Anzahl Antworten / Antworten gesamt × 100`.
`Prozent gültig = Anzahl gültiger Antworten / Gültige Antworten × 100`.
Bei null gültigen Antworten wird kein gültiger Prozentwert ausgegeben.
Bei Mehrfachantworten wird jede Kategorie höchstens einmal pro Antwort gezählt;
die Kategorieprozente können sich deshalb zu mehr als 100 % summieren.

Die Statusübersicht zeigt pro Variable einmal die vollständige Verteilung auf
der aktuellen Ergebnisseite. Bei Antwortwerten verwendet sie den ursprünglichen
Antwortstatus, bei Codes den Status des gewählten Kodierlaufs. Sie ist keine
Statusverteilung einzelner Wertzeilen. CSV und XLSX kennzeichnen Grundlage und
Kodierlauf und enthalten dieselben Bezugsgrößen.

## Prüfung

Die Prozessor- und Servicetests prüfen Kategorien, Code-Metadaten, die drei
Kodierläufe, fehlende Werte, Null-Nenner sowie CSV/XLSX. Die zusätzliche
`variable-analysis.processor.integration.spec.ts` führt die erzeugten SQL-Abfragen
gegen PostgreSQL aus. Sie benötigt `VARIABLE_ANALYSIS_TEST_DB_URL` mit einer
Verbindung zu einer Wegwerfdatenbank und arbeitet ausschließlich mit temporären
Tabellen. Ohne diese Variable wird sie übersprungen.

Die fachliche Abnahme mit MGV090_01 und MDV007 im Testarbeitsbereich steht noch aus.
