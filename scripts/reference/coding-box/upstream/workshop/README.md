# Datenbeschreibung

Vollständig synthetische Lesestudie. Keine realen Personen, Studienergebnisse oder Serverantworten.
Erzeugung: scripts/generate_data.R, Seed 20260923. Ein Testzeitpunkt, ein Kompetenzbereich.

| Datei | Inhalt |
|---|---|
| units.rds | sechs Units mit Kodierschemata, Variablen, Seiten und Item-Verknüpfungen |
| design.rds | 340 vorgesehene Person–Variable-Kombinationen |
| Responses.csv | 193 gespeicherte Person–Unit-Kombinationen im semikolongetrennten Testcenter-Lehrformat |
| persons.csv | 40 Personen, Booklet-Zuordnung, synthetische Schlüssel |
| booklets.csv | zwei Booklets mit jeweils fünf geordneten Units in einem Testlet |
| codes_manual.csv | 39 Freitextantworten (`value`) aus U4/TEXT mit manuellen Bewertungen |
| codebook.csv | vereinfachte Übersicht aus den Kodierschemata |
| Logs.csv | 15 künstliche Logereignisse, zwei Sessions |

B1: U1/U2/U3/U4/U5. B2: U1/U2/U3/U4/U6.
U1 und U5 haben zwei Items; U2, U3, U4 und U6 je ein Item. U3/TOTAL wird aus zwei
Basisvariablen abgeleitet; diese beiden Basisvariablen sind keine eigenen Items.
Die lokalen Itemnummern sind als Text `01` und `02` gespeichert. Zusammen mit
dem vereinfachten Unit-Kurznamen entstehen Kennungen wie `U101` und `U301`.

Bei U4/TEXT geht es um die Öffnung der Bibliothek am Samstag. Die sechs kurzen
Antwortvarianten stehen identisch in `Responses.csv` und `codes_manual.csv`.
Code 2 bezeichnet eine passende Aussage mit Textbeleg, Code 1 eine passende
Aussage ohne Beleg und Code 0 eine unzutreffende oder unbegründete Antwort.
Die leere Antwort von P005 erhält Code -99.

Prüffälle: P002/U2 ausgelassen; P003/U5 nicht erreicht; P004/U1/Q1 ungültig;
P005/U4 manuelle Auslassung; P006/U5 als DISPLAYED gespeicherte abschließende
Auslassungen; P040 ohne Status. By design: etwa P001/U6.

Die künstlichen Antwortwahrscheinlichkeiten und Kodiermuster dienen dem Lehren
der Datenverarbeitung. Die Kennwerte sind keine realen Itemqualitätsbefunde.
Zeitstempel in Logs.csv sind Unix-Millisekunden. Session P002 enthält gezielt
widersprüchliche Seiteninformation und technische Fehlereignisse.
P001 enthält einen abgeschlossenen Fokusverlust von 2,5 Sekunden; bei P002
fehlt der Wiedergewinn. Unit-Zeit und Fokusdauer sind verschiedene Auswertungen.

Die lokale Codebuchtabelle wird als Excel und CSV exportiert. Der DOCX-Download
ist ausschließlich als Vorlage für einen eigenen IQB-Studio-Zugang enthalten.
Die separate Partial-Credit-Demo ist in `demo-README.md` beschrieben.
