# Antwortwert- und Codehäufigkeiten

Unter **Testergebnisse → Antwortwertanalyse** wird vor dem Start eines Auftrags
die Auswertungsgrundlage gewählt:

- **Antwortwerte und Kategorien**: gespeicherte Rohwerte; Mehrfachantworten werden
  in einzelne Antwortkategorien aufgelöst. Labels stammen aus passenden Kodierregeln oder den Wert- und
  Positionsmetadaten der Unit. Eine passende Kodierregel ergänzt Code, Score und
  die Kennzeichnung „Schema“, auch bei beobachteten Werten aus einem Zahlenbereich.
  Dabei wird die Regel auf den Antwortwert angewendet; eine bloße Übereinstimmung
  zwischen Rohwert und Code-ID begründet keine Zuordnung. Nicht beobachtete,
  ausdrücklich hinterlegte Antwortalternativen können mit Anzahl 0 ergänzt werden.
- **Vergebene Codes**: `code_v1`, `code_v2` oder `code_v3` des ausgewählten
  Kodierlaufs. Labels und optionale Scores stammen aus den Code-Definitionen des
  Kodierschemas. Eine Mehrfachantwort liefert in dieser Auswertung einen
  vergebenen Code, unabhängig von ihren einzelnen Antwortkategorien.

Jeder Auftrag speichert seine Grundlage und seinen Kodierlauf. Beim Laden eines
vorhandenen Ergebnisses bleibt diese Zuordnung erhalten. Eine geänderte Auswahl
gilt für den nächsten Auftrag. Nach dem Update müssen bestehende Analysen neu
gestartet werden: Bereits gespeicherte Ergebnisse werden nicht neu berechnet.
Alte Aufträge ohne Auswertungsgrundlage werden in der Auftragsliste als
Antwortwertanalysen behandelt. Ergebnisse älterer Berechnungsversionen können
nicht mehr geöffnet oder exportiert werden; die Oberfläche fordert eine neue
Analyse an.

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

Für Antwortwerte gelten SQL-`NULL`, leere oder nur aus Leerzeichen bestehende
Zeichenketten und leere Listen als leer. Der eingegebene Text `null` ist ein
regulärer Antwortwert; der Import speichert ihn getrennt von fehlenden Nullwerten.
Boolesche Listen ohne ausgewählte Option gelten ebenfalls als leer.
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
Kodierlauf und enthalten dieselben Bezugsgrößen. Der Dateiname wird beim Start des
Exports festgelegt und behält diese Zuordnung auch beim Wechsel zu einem anderen
Analyseergebnis während des Downloads.

„Fehlend/ungültig“ und „Leere Rohwerte“ dürfen gleich groß sein: zum Beispiel bei
100 Antworten mit 90 gültigen, nicht leeren Antworten und 10 leeren Antworten.
Dann sind beide Angaben 10. Hat zusätzlich eine nicht leere Antwort einen
ungültigen Status, bleiben 89 gültige Antworten; „Fehlend/ungültig“ beträgt dann
11 und „Leere Rohwerte“ weiterhin 10. Die konkreten Exporte von MGV090_01 und
MDV007 sind damit noch nicht als korrekt bestätigt; dafür müssen die verwendete
Version und die zugehörigen Antwortdatensätze geprüft werden.

## Tabellen und ausgelassene Werte

Oberfläche und Export ordnen zuerst Aufgabe/Variable und die Angaben zur gesamten
Variable an, danach den einzelnen Antwortwert bzw. Code und dessen Häufigkeiten.
Die Statusverteilung erscheint in der Oberfläche zusätzlich einmal je Variable
auf der aktuellen Seite. Im flachen Export werden die Angaben zur Variable je
Wertzeile wiederholt.

„Weitere Werte nicht enthalten“ zählt unterschiedliche beobachtete Werte ohne
eigene enthaltene Zeile, nicht die Anzahl der zugehörigen Antworten. Regulär
werden die 20 häufigsten Werte gespeichert; beobachtete Werte aus den
hinterlegten Definitionen kommen zusätzlich hinzu. Beispiel: 25 unterschiedliche
Werte, davon 20 enthalten, ergeben 5 weitere Werte. Suche und Leerwertfilter wählen ganze Variablen aus. Alle berücksichtigten
Antwortdatensätze der jeweiligen Variable bleiben
in den Nennern für die Prozentwerte enthalten; die sichtbaren Häufigkeiten müssen
deshalb nicht 100 % ergeben. Bei Mehrfachantworten sind außerdem mehrere
Kategorien je Antwort möglich.

## Prüfung

Die Prozessor- und Servicetests prüfen Kategorien, Code-Metadaten, die drei
Kodierläufe, fehlende Werte, den Antworttext `null`, Null-Nenner sowie CSV/XLSX.
Die zusätzliche `variable-analysis.processor.integration.spec.ts` führt die erzeugten SQL-Abfragen
gegen PostgreSQL aus. Sie benötigt `VARIABLE_ANALYSIS_TEST_DB_URL` mit einer
Verbindung zu einer Wegwerfdatenbank und arbeitet ausschließlich mit temporären
Tabellen. Ohne diese Variable wird sie übersprungen.

Die fachliche Abnahme mit MGV090_01 und MDV007 im Testarbeitsbereich steht noch aus.
