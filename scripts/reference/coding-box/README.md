# Kodierbox-Referenzdatensatz, Version 1

Synthetischer, versionierter Regressionstestbestand mit getrennt festgelegten
Eingaben und Sollwerten. Keine Daten realer Testpersonen und keine Serverzugänge.

## Inhalt und Herkunft

- `study.json`: normalisierte Workshopdaten mit 40 Personen, sechs Units,
  zwei Testheften, 193 gespeicherten Person–Unit-Antworten, 39 vorgegebenen
  manuellen Bewertungen und acht Itemspalten. Die vier `expected-matrix-*.csv`
  enthalten die lesbaren Sollmatrizen für Codes/Scores und beide Missing-Modi.
- `missing-cases.json`: die 18 Missing-Szenarien aus eatPrepTBA, jeweils mit
  und ohne Umkodierung abschließender Auslassungen. Enthält die Unit-Metadaten,
  Eingaben und explizite Sollwerte. Die Tests berechnen die Reihenfolge selbst
  aus VOUD/VOCS; sie übernehmen dafür keine Sollpositionen als Eingabe.
- `edge-cases.json`: zusätzliche Issue-Fälle, Missing-Aggregation, Partial Credit,
  Null-/Leerwertsemantik, MNR-Reichweiten, Versionsauflösung, diagnostizierte
  Exportfehler, doppelte Persistenzziele sowie Code-/Score-Kappa und Fleiss.
- `missing-oracle.json`: Ergebnisse des separat ausgeführten, eingefrorenen
  eatPrepTBA-R-Quellstands. `workshop-units.json` normalisiert nur RDS-Metadaten.
- `upstream/`: festgehaltene Originaleingaben und benötigte Quelltexte.
  Textkopien haben normalisierte abschließende Leerzeilen und Leerzeichen; RDS-Dateien sind
  unveränderte Binärdateien. Die MIT-Lizenz der eatPrepTBA-Quellen liegt bei.
- `sources.json`: unveränderliche Repository-Referenzen und Issue-Zuordnung.
- `verification.json`: SHA-256-Bindung sämtlicher Eingaben, Generatoren,
  Prüfskripte und Sollwerte an die erfolgreiche unabhängige Gegenprüfung.

Quellstände:

- [eatPrepTBA ec12e07](https://github.com/iqb-research/eatPrepTBA/tree/ec12e07a35968b70a91ea344a25acf502e7f6a79),
  Paketversion 0.9.8.9044, insbesondere `missing-examples.Rmd` und `complete_design()`.
- [Workshop a210696](https://github.com/sachseka/eatPrepTBAworkshop/tree/a21069632fd795c7e7ed8df17bd04d3437924b2b),
  Mini-Studie (ursprünglicher Seed 20260923) und separate Partial-Credit-Demo.

## Was unabhängig geprüft bedeutet

`generate.py` verwendet ausschließlich die Python-Standardbibliothek. Es ruft
keinen Produktcode und keinen Autocoder auf. Einfache Bewertungsregeln werden
arithmetisch aus den Rohantworten abgeleitet; Kappa wird mit exakten Brüchen
berechnet. Auswahlentscheidungen und Fehlerfälle beruhen auf den dokumentierten
Issue-Verträgen.

`verify-upstream.R` führt die eingefrorene R-Missing-Implementierung auf allen
18 Vignettenfällen aus. `verify-independent.R` prüft zusätzlich die Python-
Erwartungen mit separat formulierter R-Arithmetik, Kreuztabellen und den
Issue-Falltabellen. Alle 640 Matrixzellen (40 Personen × 8 Items × 2 Modi,
mit je Code und Score) werden gegen `complete_design()` verglichen. Es wird
keine gegen sich selbst getestete Autocoder-Ausgabe als Sollwert gespeichert.

Erst nach erfolgreichen R-Prüfungen darf `verify.py --refresh` den Prüfnachweis
aktualisieren. Die normalen Jest-/CI-Läufe vergleichen Produktfunktionen mit
festen Sollwerten und prüfen deren Hash-Bindung; sie benötigen weder R noch
Netzwerk. Das ist eine unabhängige technische Gegenprüfung, keine menschliche
fachliche Freigabe und keine kryptografische Beglaubigung durch Dritte.

## Bewusste Anpassungen an den Kodierbox-Vertrag

1. Die R-Vignette beginnt mit vorbereiteten Codes. Die Kodierbox-Eingaben für
   v1 bleiben bei Missing-Fällen profilneutral; Codes/Scores entstehen erst an
   der Exportgrenze (REQ-741). Reguläre und manuelle Ergebnisse bleiben erhalten.
2. `preserve_not_reached=FALSE` ist die R-Vergleichseinstellung. Das separat in R
   verfügbare `TRUE` wird nicht als vorhandene Kodierbox-Option ausgegeben.
3. `NO_CODING` erhält in R Code -93. In der Kodierbox-Matrix ist ein ungeklärter
   Fall ein Exportfehler `unresolved-status`. Beide Erwartungen sind ausdrücklich
   dokumentiert; der Fall wird nicht übersprungen.
4. Die Sollmatrix enthält alle 40 Designpersonen, einschließlich der Person
   ohne Bearbeitung. Der R-Workshop-Skalierungsdatensatz filtert mit `id_used`
   und enthält 39 Personen. Die Test-Repositories liefern bewusst alle 40.
5. `NA` ist im Score-Export ein klassifiziertes Missing, kein Ersatz für einen
   fehlenden Score. Code 0 und Score 0 sind gültige Ergebnisse. Kappa-Agreement
   ist ein Anteil 0–1; Fleiss wird an der Produktgrenze auf drei Stellen gerundet.
6. Die Vergleichstests simulieren die Repository-Transporte. Die echte
   Kodierbox-Engine, VOUD-/VOCS-/Booklet-Parser, Resolver sowie CSV- und
   Excel-Serializer laufen unverändert. Ein Datenbankimport, Replay-Rendering
   oder Browserworkflow wird dadurch nicht nachgewiesen.

## Ausführen – Entwicklung

Voraussetzung für Jest: die normalen Node-22-Projektabhängigkeiten.

```sh
npx nx run backend:test-reference
npx nx test backend --runInBand
npx nx lint backend
python3 scripts/reference/coding-box/verify.py
```

Die Referenzsuite ist außerdem Teil des regulären verpflichtenden Backend-
Testlaufs. Beide Nx-Ziele berücksichtigen den gesamten Referenzordner im Cache.

Für eine bewusste Aktualisierung sind zusätzlich Python 3 und R mit `jsonlite`,
`dplyr`, `tidyr`, `purrr`, `magrittr`, `checkmate`, `cli`, `crayon`, `stringr` und
`rlang` erforderlich. Eine Installation von eatPrepTBA/eatAutoCode ist nicht nötig.
Eine eigene R-Bibliothek kann über `R_LIBS_USER` gewählt werden.

```sh
# Nur bei geänderten RDS-Quellen bzw. geändertem R-Referenzstand:
Rscript scripts/reference/coding-box/normalize-workshop.R
Rscript scripts/reference/coding-box/verify-upstream.R
# Spezifikation und Erwartungen bearbeiten, dann bewusst neu erzeugen:
python3 scripts/reference/coding-box/generate.py
# Prüft beide unabhängigen Wege; schreibt erst danach den Hash-Nachweis:
python3 scripts/reference/coding-box/verify.py --refresh
npx nx run backend:test-reference --skipNxCache
```

Bei Abweichungen zuerst Spezifikation, Parametrisierung und Produktverhalten
klären. Niemals Produkt-Istwerte automatisch als neue Sollwerte übernehmen.
Quelländerungen mit neuem Commit und Issue-Vertrag dokumentieren; die erzeugten
CSV-/JSON-Diffs fachlich lesen. Das Aktualisieren von Sollwerten erteilt keine
Ticket-Abnahme.

## Ausschluss aus Produktionsimages

Die Referenz bleibt im Builder und in der Testumgebung verfügbar. Die finalen
Backend-/Frontend-Images übernehmen nur festgelegte Runtime-Eingaben und die
Anwendungsbuilds. Eine Node-Prüfung vergleicht deren Inhalte mit den Referenz-
Hashes und eindeutigen Datensatzmerkmalen. Sie läuft im Docker-Builder und im
CI-Build; die Docker-Kopierpfade werden zusätzlich in der Backend-Suite geprüft.

Nach getrennten Produktionsbuilds beider Anwendungen ausführen:

```sh
npx nx run backend:verify-reference-packaging
```

Methodik, Ergebnisse und die Grenze zur tatsächlichen Image-Inspektion stehen
im [technischen Prüfbericht](../../../docs/qa/coding-reference-dataset.md).

## Issue-Abdeckung und Grenzen

| Issues | Neue Daten-/Regressionsevidenz | Grenze |
|---|---|---|
| #1116 | 18 Layout-/Missing-Szenarien; widersprüchliche Item-/Seitenreihenfolge; Abschnitte und Ableitungsketten; Transportreihenfolge invariant | Keine Wiederholung mit realen Studiendaten |
| #741, #777, #778 | Profile, 49 Aggregationspaare, By Design, drei MNR-Reichweiten, beide Umkodierungsmodi, vollständige Code-/Score-Matrizen | Keine neue fachliche Missing-Regel |
| #970, #973 | Rekursive Blattquellen, fehlende/doppelte Quellen, Zyklen, technischer Zielwert, 12 Partial-Credit-Konstellationen | Rückwirkende Datenreparatur aus #975 nicht ausgeführt |
| #972 | MC+Begründe: leere/beantwortete Begründung, mehrdeutige v1-Statuskombination | Auswahlfunktion geprüft; vollständiges persistentes Anwenden bleibt bestehender Service-/Integrationstest |
| #1043, #433 | Tatsächliches null, Text null, Leerstring, leeres Array, 0 und false bleiben unterscheidbar; IS_NULL | Der eigenständige nullable-Validator und sein UI-Hinweis sind nicht Gegenstand dieser Suite |
| #341 | Manuelle interne Missing-Codes -3/-4 und Profilauflösung in v1/v2/v3 | Job-UI nicht geprüft |
| #1012, #434 | Doppelte Persistenzziele werden abgelehnt; unterschiedliche Subforms bleiben getrennt | Transaktions-Rollback und Datenbankmigration bleiben bestehende PostgreSQL-Tests |
| #1014 | `derived-result-missing`, `derived-source-unresolved`, `derived-cycle`, fehlende Code-/Scorehälften | Dauerhaftigkeit der Diagnosearchive bleibt bestehende Archiv-/Live-Suite |
| #506, #426 | Exakte Code-/Score-Kappa-Werte, fehlende Paare, konstante Kategorien, vollständige Gegenabweichung, Fleiss-Kreuztabelle | Kein ICC-Methodenentscheid |

Weitere bestehende Evidenz: `coding-export.golden.spec.ts`,
`variable-analysis.processor.spec.ts`, `external-coding-import.postgres.spec.ts`,
`item-matrix-diagnostics-archive.spec.ts` und `scripts/e2e/replay/`. Die alte
Variablenanalyse-Referenz für #563 bleibt separat und weiterhin als manuell
normalisierte Tabelle gekennzeichnet. Diese Suite behauptet keine vollständige
Abdeckung aller historischen UI-, Auth-, Last- oder Infrastrukturprobleme.
