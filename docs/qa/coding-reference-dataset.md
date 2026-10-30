# Technischer Prüfbericht: Kodierbox-Referenzdatensatz

Stand: 30.10.2026. Zuständigkeit: Entwicklung.

## Ergebnis und Status

Ein eigenständiger synthetischer Referenzbestand liegt unter
[`scripts/reference/coding-box`](../../scripts/reference/coding-box/README.md).
Eingaben, Sollmatrizen, Issue-Fälle, Quellen und unabhängig ausgeführte
Python-/R-Prüfungen sind versioniert. Die Jest-Suite verwendet echte
Produktfunktionen und simuliert ausschließlich die Repository-Transporte.

Die Referenz integriert die bereits vorhandene lokale Reihenfolgekorrektur
für #1116 (`d3b9caaa8dfbf11b31d8fb4a8258902b61322c1e`, im Arbeitsbranch separat
übernommen). Ohne diese Korrektur kann die Kodierbox die erwartete tatsächliche
Bearbeitungsreihenfolge nicht einhalten. Sichtbare Itemspalten bleiben erhalten.

| Ebene | Status |
|---|---|
| Im Arbeitsbranch implementiert | Ja |
| Nach develop gemergt | Nein |
| Veröffentlicht oder auf Testinstanz deployed | Nicht Bestandteil dieses Nachweises |
| Unabhängige technische Sollwertprüfung | Python-Standardbibliothek, eingefrorene eatPrepTBA-R-Implementierung und separate R-Rechnung ausgeführt |
| Automatisierte Produktregression | Ergebnis siehe folgende Tabelle |
| Fachliche Freigabe | Nicht erteilt; bestehende Abnahmen bleiben unverändert |

## Prüfungen und reproduzierbare Befehle

Voraussetzungen und Aktualisierungsablauf stehen im Referenz-README. Für R wurde
lokal eine zusätzliche Bibliothek unter `/tmp/coding-reference-r-library`
verwendet; das Projekt erhält dadurch keine neue Laufzeitabhängigkeit.

| Prüfung | Befehl ab Repository-Wurzel | Ergebnis |
|---|---|---|
| Externe Missing-Referenz | `Rscript scripts/reference/coding-box/verify-upstream.R --check` | Bestanden: 18 Fälle × zwei Modi |
| Zweite Sollwertprüfung | `Rscript scripts/reference/coding-box/verify-independent.R` | Bestanden: Workshop, Partial Credit, Kappa, Auswahl-/Versionstabellen, Aggregation und 640 Matrixzellen mit Code und Score |
| Reproduzierbarkeit und Prüfnachweis | `python3 scripts/reference/coding-box/verify.py` | Bestanden: 37 gebundene Dateien; deterministische Neuerzeugung bestätigt |
| Gezielte Produktsuite | `npx nx run backend:test-reference --skipNxCache` | Bestanden: 356 Tests, keine übersprungenen Fälle |
| Backend-Lint | `npx nx lint backend` | Bestanden; automatische Formatkorrekturen ausschließlich im neuen Test und einer Einrückung der übernommenen Exportkorrektur |
| Gesamte Backend-Suite | `npx nx test backend --runInBand --skipNxCache` | Bestanden: 254 Suites / 4.420 Tests; 15 bestehende Suites / insgesamt 135 Tests übersprungen |
| Backend-Build | `npx nx build backend` | Bestanden: Webpack-Kompilierung |

Die 135 übersprungenen Tests umfassen die bestehenden optionalen Integrations-
prüfungen und sechs ausdrücklich mit `it.skip` markierte Unit-Fälle. Diese
Ausnahmen wurden nicht verändert.

Die Referenz prüft sowohl erwartete Ergebnisse als auch genaue Fehlermeldungs-
klassen. Es gibt keine übersprungenen Referenzfälle. Die R-Abweichung bei
`NO_CODING` und die abweichende Behandlung inaktiver Personen sind ausdrücklich
beschrieben. Zufällig wechselnde Eingaben und Netzwerkzugriffe sind aus dem
normalen Testlauf ausgeschlossen.

## Nachweis, dass die Regression erkannt wird

Die frühere Sortierung nach `itemOrder` wurde ausschließlich für einen lokalen
Fehlereinbau im Resolver wieder aktiviert. Die neue Suite schlug daraufhin
bei zehn Tests fehl, darunter beide Varianten von Missing-Fall 14. Anschließend
wurde die Korrektur wiederhergestellt; der gesamte Backend-Lauf bestand.
Der endgültige Quellstand enthält diesen Fehlereinbau nicht.

Im ersten vollständigen Lauf scheiterte außerdem die vorhandene Prüfung der
Bundle-Reproduzierbarkeit an abweichenden Pfaden einer verlinkten
`node_modules`-Installation. Eine lokale Kopie ausschließlich von
`@iqb/responses` korrigierte die Testumgebung; der Bundle-Inhalt wurde nicht
geändert. Der Wiederholungslauf bestand vollständig.

Maschinenlesbare Zusammenfassung: [Prüfevidenz](coding-reference-evidence.json).

## Grenzen und fachliche Nutzung

Die vollständige Issue-Zuordnung und die jeweils getestete Verantwortung stehen
im Referenz-README. Dieser Bericht ist keine fachliche Abnahmeplanung und weist
keinen echten Upload, Datenbankimport, Browserlauf oder realen Produktionsfall
nach. Die vorhandenen PostgreSQL-Spezialtests bleiben optional. Er verändert
keine Ticketzustände und fordert keine Wiederholung gültiger Abnahmen an.

Die vier lesbaren Soll-CSV-Dateien ermöglichen eine spätere gezielte fachliche
Prüfung. Vor einer Abnahme muss der tatsächliche Testserver-Build festgestellt
werden; die Testergebnisse dieses Arbeitsbranches sind keine Deployment-Evidenz.
