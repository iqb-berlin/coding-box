# REQ-563 Variablenanalyse Referenzabgleich

## Kontext

GitHub-Issue #563 verlangt, dass die Analyseergebnisse der Variablenanalyse gegen bekannte Referenzdaten bzw. gegen die Logik aus `eatPrepTBA::evaluate_psychometrics()` validiert werden.

Die Referenzlogik liefert unter anderem:

* absolute Code- und Kategoriehaeufigkeiten
* Nenner fuer Gesamtfaelle und gueltige Antworten
* relative Haeufigkeiten bezogen auf Gesamtfaelle und gueltige Antworten
* nicht beobachtete, aber im Schema definierte Codes/Kategorien mit Haeufigkeit 0
* Point-Biserial-Korrelationen auf Code- und Kategorieebene

Kodierbox speichert relative Haeufigkeiten als Prozentwerte, waehrend eatPrepTBA Anteile im Bereich `0..1` ausgibt.

## Referenzdatensatz

Der Regressionstest nutzt eine kleine synthetische Datenbasis mit einer Einheit `UNIT_REF` und zwei Variablen. Das erwartete Golden-Ergebnis wird aus einer eingecheckten, manuell normalisierten Referenztabelle im Spaltenformat von `eatPrepTBA::evaluate_psychometrics()` erzeugt. Die Spalten und Bedeutungen orientieren sich am dokumentierten Referenzstand `16e3567adefb7341a3e93fd3d97aa25a207d0c99`.

Die Referenztabelle ist kein unveraenderter Raw-Export aus einer externen R-Session. Sie ist das MVP-Artefakt fuer #563, bis ein echter `eatPrepTBA::evaluate_psychometrics()`-Export inklusive Provenance vorliegt. Die Tabelle wird nicht in CI erzeugt. Dadurch bleibt der Regressionstest stabil und unabhaengig von R-Paketinstallationen, GitHub-Remotes und transitiven CRAN-Abhaengigkeiten.

### VAR_BASE

Schema:

| Wert | Label | Score |
| --- | --- | --- |
| A | Alpha | 1 |
| B | Beta | 0 |
| C | Gamma | 0 |

Antworten:

| Wert | Status | Gueltig |
| --- | --- | --- |
| A | 3 | ja |
| A | 3 | ja |
| B | 3 | ja |
| D | 3 | ja |
| leer | 7 | nein |

Erwartungen:

| Wert | Anzahl | Gueltige Anzahl | Anteil gesamt | Anteil gueltig |
| --- | ---: | ---: | ---: | ---: |
| A | 2 | 2 | 40.0 | 50.0 |
| B | 1 | 1 | 20.0 | 25.0 |
| C | 0 | 0 | 0.0 | 0.0 |
| D | 1 | 1 | 20.0 | 25.0 |
| leer | 1 | 0 | 20.0 | 0.0 |

`C` ist im Schema definiert, aber nicht beobachtet. Es muss im Ergebnis mit Haeufigkeit 0 enthalten sein, wenn Schema-Codes einbezogen werden.

### VAR_MULTI

Schema:

| Wert | Label |
| --- | --- |
| A | Alpha |
| B | Beta |
| C | Gamma |

Antworten:

| Wert | Status | Gueltig |
| --- | --- | --- |
| ["A","B"] | 3 | ja |
| ["B"] | 3 | ja |
| [] | 7 | nein |
| ["A","C","C"] | 3 | ja |

Erwartungen:

| Wert | Anzahl | Gueltige Anzahl | Anteil gesamt | Anteil gueltig |
| --- | ---: | ---: | ---: | ---: |
| A | 2 | 2 | 50.0 | 66.6666666667 |
| B | 2 | 2 | 50.0 | 66.6666666667 |
| C | 1 | 1 | 25.0 | 33.3333333333 |

Mehrfachnennungen desselben Werts innerhalb einer Antwort werden fuer diese Antwort nur einmal gezaehlt.

## Abweichungen zur R-Referenz

* Kodierbox gibt Prozentwerte aus, eatPrepTBA gibt Anteile aus. Beispiel: `40.0` in Kodierbox entspricht `0.4` in eatPrepTBA.
* Kodierbox nutzt das lokale Response-Statusmodell. Fuer den Gueltig-Nenner werden die Status `0, 1, 2, 4, 7, 9, 10` ausgeschlossen.
* Point-Biserial-Korrelationen (`code_pbc`, `category_pbc`) werden in diesem Regressionstest nicht verglichen, weil die aktuelle Kodierbox-Variablenanalyse keine Domaenen- bzw. Gesamtscore-Berechnung fuer diese Kennwerte erzeugt. Die DTOs und die Anzeige koennen vorhandene Werte durchreichen; die Berechnung selbst bleibt ein separater Methoden-/Implementierungsschritt.

## Technische Verankerung

Die Referenzartefakte liegen unter:

* `scripts/reference/variable-analysis-eatpreptba/reference-responses.csv`
* `scripts/reference/variable-analysis-eatpreptba/reference-schema.csv`
* `scripts/reference/variable-analysis-eatpreptba/eatpreptba-shaped-reference.csv`
* `scripts/reference/variable-analysis-eatpreptba/README.md`

Der Normalizer liegt unter:

* `scripts/reference/variable-analysis-eatpreptba/normalize-eatpreptba-reference.mjs`

Das daraus erzeugte Golden-Ergebnis liegt unter:

* `apps/backend/src/app/job-queue/processors/__fixtures__/variable-analysis-eatpreptba-reference.golden.json`

Der Regressionstest liegt in:

* `apps/backend/src/app/job-queue/processors/variable-analysis.processor.spec.ts`

## Akzeptanzkriterien

* Der Referenzdatensatz ist in dieser Datei dokumentiert.
* Das Golden-Ergebnis ist aus einer eingecheckten, intern validierten Referenztabelle im eatPrepTBA-Spaltenformat reproduzierbar.
* Die erwarteten Haeufigkeiten stimmen innerhalb der im Golden definierten Toleranz.
* Die Abweichung `Prozentwert` vs. `Anteil` ist dokumentiert.
* Die derzeit nicht berechneten PBC-Werte sind als Abweichung dokumentiert.
* Ein Backend-Regressionstest prueft das Golden-Ergebnis.
