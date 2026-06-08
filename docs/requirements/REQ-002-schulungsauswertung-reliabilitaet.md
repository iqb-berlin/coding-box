# REQ-002 Schulungsauswertung Reliabilitaetskennwerte

## Metadaten

- Status: `In Klaerung`
- Ansprechpartner Fachseite: Methoden-Team / Kodierforum
- Ansprechpartner Entwicklung:
- Zugehoeriges Issue: https://github.com/iqb-berlin/coding-box/issues/506
- Verwandte Issues: https://github.com/iqb-berlin/coding-box/issues/194, https://github.com/iqb-berlin/coding-box/issues/334, https://github.com/iqb-berlin/coding-box/issues/426
- Prioritaet: `mittel`
- Zieltermin / Meilenstein: nach fachlicher Freigabe

## Kontext / Problem

Fuer die Schulungsauswertung wurden ICC, Modalwert sowie spezielle Kappa-Auswertungen wie "0,1-Kappas" und "0,6,8,9-Kappas" genannt. Die Begriffe Code-Ebene und Score-Ebene sind inzwischen fachlich geklaert, fuer ICC fehlt aber weiterhin eine eindeutige Shrout/Fleiss-Variante und eine Entscheidung zum Umgang mit geplant unvollstaendigen Designs.

Diese Anforderung dokumentiert den umsetzbaren Reliabilitaets-Scope ohne ICC und grenzt die noch offenen Methodenentscheidungen ab.

## Zielbild

Studien- bzw. Kodierungsmanager koennen in der Schulungsauswertung nachvollziehbar sehen, auf welcher Ebene ein Reliabilitaetskennwert berechnet wurde. Die Anzeige und Exporte machen kenntlich, ob Codes direkt verglichen werden oder ob Codes zuerst auf Scores abgebildet wurden. Referenzdatensaetze mit erwarteten Werten ermoeglichen reproduzierbare Tests.

## Nutzerrollen

- Studienmanager
- Kodierungsmanager
- Methoden-Team
- Entwicklung

## Scope

### Muss-Anforderungen

- [ ] Code-Ebene und Score-Ebene werden in UI, API und Export eindeutig benannt.
- [ ] "0,6,8,9-Kappas" wird als Kappa auf Code-Ebene verstanden.
- [ ] "0,1-Kappas" wird als Kappa auf Score-Ebene verstanden.
- [ ] Cohen's Kappa bleibt fuer den ersten Umsetzungsschnitt der Standardkennwert.
- [ ] Die Berechnung filtert unvollstaendige Kodierer-Paare, bei denen mindestens eine Seite keinen Code bzw. Score hat.
- [ ] Modalwerte werden bei Gleichstand deterministisch dargestellt oder eindeutig als Gleichstand gekennzeichnet.
- [ ] Referenzdatensaetze und erwartete Werte werden fuer Tests dokumentiert.

### Soll-Anforderungen

- [ ] Die spaetere Kennzahl-Auswahl kann Cohen's Kappa, Brennan-Prediger-Korrektur und Fleiss' Kappa aufnehmen, sobald #426 fachlich entschieden ist.
- [ ] Exporte enthalten Kennwert, Berechnungsebene, Gewichtungsmethode und Umgang mit fehlenden Werten.
- [ ] Exporte mit Modalwert enthalten zusaetzlich `Modalwert-Gleichstand` und `Modalwert-Kandidaten`.
- [ ] Category-wise Details bei Fleiss' Kappa werden nur angezeigt/exportiert, wenn sie fachlich benoetigt werden.

### Nicht-Ziele / Abgrenzung

- ICC wird im ersten Umsetzungsschnitt nicht berechnet und nicht als auswaehlbarer Kennwert angeboten.
- `irr::kappam.fleiss` ist eine Referenz fuer Fleiss' Kappa, nicht fuer ICC.
- Diese Anforderung fuehrt keine neue `libs/api-dto`-Struktur ein.
- Diese Anforderung veraendert keine Kodierschema- oder Score-Mapping-Logik; sie nutzt die vorhandenen Codes und Scores.

## Gewuenschter Ablauf

1. Eine Schulung enthaelt mehrere Kodierer und gemeinsame Faelle.
2. Die auswertende Person oeffnet die Schulungsauswertung.
3. Die Auswertung zeigt pro Variable und Kodierer-Paar Uebereinstimmung und Cohen's Kappa.
4. Die Person kann zwischen Code-Ebene und Score-Ebene wechseln.
5. Die Anzeige benennt die Ebene explizit:
   - Code-Ebene: "Code-Kappa"
   - Score-Ebene: "Score-Kappa"
6. Exporte uebernehmen dieselbe Benennung und dokumentieren, ob unvollstaendige Paare ausgeschlossen wurden.

## Fachliche Regeln

- Code-Ebene: Die vergebenen Codes werden direkt verglichen. Missing- und Sondercodes bleiben unterscheidbar. Beispiel: Code `0` und Code `6` gelten als Abweichung.
- Score-Ebene: Die vergebenen Codes werden vor der Kappa-Berechnung auf die bewertungsrelevanten Scores abgebildet. Beispiel: Code `0` und Code `6` koennen beide Score `0` ergeben und dann als Uebereinstimmung gelten.
- Cohen's Kappa nutzt die Standardformel `kappa = (P_o - P_e) / (1 - P_e)`.
- Bei perfekter Uebereinstimmung wird Kappa als `1` ausgegeben, auch wenn wegen nur einer vorkommenden Kategorie `P_e = 1` ist. Das entspricht der im Code dokumentierten eatPrep-Konvention.
- Fehlende Werte werden paarweise ausgeschlossen: Ein Fall geht fuer ein Kodierer-Paar nur ein, wenn beide Seiten auf der gewaehlten Ebene einen Wert haben.
- Der Default fuer bestehende Kappa-Endpunkte bleibt konservativ `level=code` und `weightedMean=true`.
- Modalwert: Bei mehreren gleich haeufigen Codes wird der kleinste numerische Code als deterministische Anzeige verwendet. UI und Exporte machen den Gleichstand sichtbar; Exporte behalten den numerischen Wert stabil und ergaenzen bei aktivierter Modalwert-Option `Modalwert-Gleichstand` sowie `Modalwert-Kandidaten`. In breiten Most-Frequent-Aggregatexporten werden diese Metadaten pro Variable als `<Variable> Modalwert-Gleichstand` und `<Variable> Modalwert-Kandidaten` ausgegeben.

## Referenzimplementierungen

- Cohen's Kappa: bisherige eatPrep-Referenz `meanKappa` aus `rater_functions.R`.
- Fleiss' Kappa: `irr::kappam.fleiss`.
- Fleiss-Parametrisierung fuer eine spaetere Umsetzung:
  - `ratings`: Zeilen = Faelle/Antworten, Spalten = Rater
  - `exact = FALSE` fuer Fleiss 1971
  - `exact = TRUE` waere Conger 1980 und ist nicht der Default fuer diese Spezifikation
  - `detail = TRUE` nur fuer category-wise Ausgaben
  - fehlende Werte werden fuer Fleiss listwise ausgeschlossen

Beispielaufrufe in R:

```r
# Cohen's Kappa: Referenz gegen eatPrep pruefen
# eatPrep::meanKappa(...)

# Fleiss' Kappa: Referenz fuer 3+ Rater
irr::kappam.fleiss(ratings, exact = FALSE, detail = FALSE)
```

## Referenzdaten

### Datensatz A: Code-Ebene gegen Score-Ebene

| Fall | Rater A Code | Rater B Code | Rater A Score | Rater B Score |
| --- | ---: | ---: | ---: | ---: |
| F01 | 0 | 0 | 0 | 0 |
| F02 | 0 | 6 | 0 | 0 |
| F03 | 6 | 6 | 0 | 0 |
| F04 | 8 | 9 | 0 | 0 |
| F05 | 9 | 9 | 0 | 0 |
| F06 | 0 | 0 | 0 | 0 |
| F07 | 6 | 0 | 0 | 0 |
| F08 | 8 | 8 | 0 | 0 |
| F09 | fehlt | 0 | fehlt | 0 |

Erwartung Code-Ebene:

- gueltige Paare: `8`
- Kategorien: `0, 6, 8, 9`
- Confusion-Matrix:

| A \\ B | 0 | 6 | 8 | 9 |
| --- | ---: | ---: | ---: | ---: |
| 0 | 2 | 1 | 0 | 0 |
| 6 | 1 | 1 | 0 | 0 |
| 8 | 0 | 0 | 1 | 1 |
| 9 | 0 | 0 | 0 | 1 |

- beobachtete Uebereinstimmung `P_o = 0.625`
- erwartete Uebereinstimmung `P_e = 0.265625`
- Cohen's Kappa `0.4893617021`
- erwartete Kodierbox-Ausgabe bei aktueller Rundung auf drei Nachkommastellen: `0.489`

Erwartung Score-Ebene:

- gueltige Paare: `8`
- alle gueltigen Score-Paare sind `0 / 0`
- Cohen's Kappa `1` nach Perfect-Agreement-Konvention

### Datensatz B: Score-Kappa mit zwei Score-Kategorien

| Fall | Rater A Score | Rater B Score |
| --- | ---: | ---: |
| S01 | 1 | 1 |
| S02 | 1 | 1 |
| S03 | 1 | 0 |
| S04 | 0 | 0 |
| S05 | 0 | 0 |
| S06 | 0 | 1 |
| S07 | 1 | 1 |
| S08 | 0 | 0 |

Erwartung:

- gueltige Paare: `8`
- Confusion-Matrix:

| A \\ B | 0 | 1 |
| --- | ---: | ---: |
| 0 | 3 | 1 |
| 1 | 1 | 3 |

- `P_o = 0.75`
- `P_e = 0.5`
- Cohen's Kappa `0.5`

### Datensatz C: Fleiss' Kappa fuer 3 Rater

| Fall | Rater A | Rater B | Rater C |
| --- | ---: | ---: | ---: |
| K01 | 0 | 0 | 0 |
| K02 | 0 | 0 | 1 |
| K03 | 0 | 1 | 1 |
| K04 | 1 | 1 | 1 |
| K05 | 1 | 2 | 2 |
| K06 | 2 | 2 | 2 |

Erwartung fuer `irr::kappam.fleiss(ratings, exact = FALSE, detail = FALSE)`:

- Kategorien: `0, 1, 2`
- Kategorieanteile: `0.3333333333`, `0.3888888889`, `0.2777777778`
- mittlere beobachtete Uebereinstimmung `P_bar = 0.6666666667`
- erwartete Uebereinstimmung `P_e = 0.3395061728`
- Fleiss' Kappa `0.4953271028`

## Daten / Schnittstellen / Auswirkungen

- Frontend: Schulungsauswertung, Kappa-Umschaltung, Exportdialoge und Uebersetzungen.
- Backend: Statistikservice, Trainings-Kappa-Endpunkt, Exportservices.
- Datenmodell: keine Schemaaenderung erforderlich.
- Externe Schnittstellen: R-Referenzimplementierungen dienen nur der Validierung, nicht als Laufzeitabhaengigkeit.

## Akzeptanzkriterien

- [ ] Code-Kappa und Score-Kappa werden fachlich korrekt benannt.
- [ ] Datensatz A liefert auf Code-Ebene Kappa `0.4893617021` bzw. als aktuell gerundete Kodierbox-Ausgabe `0.489`.
- [ ] Datensatz A liefert auf Score-Ebene Kappa `1`.
- [ ] Datensatz B liefert auf Score-Ebene Kappa `0.5`.
- [ ] Datensatz C liefert fuer Fleiss' Kappa `0.4953271028`, falls Fleiss' Kappa umgesetzt wird.
- [ ] Fehlende Werte aus Datensatz A werden aus der Kappa-Berechnung ausgeschlossen.
- [ ] Modalwert-Gleichstaende sind reproduzierbar und nicht zufallsabhaengig.
- [ ] Modalwert-Gleichstaende sind in Backend-Exporten ueber eigene Spalten sichtbar, ohne den numerischen Modalwert zu veraendern.
- [ ] ICC ist als offener Methodenentscheid dokumentiert und blockiert den MVP ohne ICC nicht.

## Test- und Abnahmehinweise

- Backend-Unit-Tests fuer `calculateCohensKappa` sollten Datensatz A und B abdecken.
- Eine spaetere Fleiss-Implementierung sollte Datensatz C gegen `irr::kappam.fleiss(..., exact = FALSE)` pruefen.
- UI-Tests sollten pruefen, dass die Umschaltung zwischen Code- und Score-Ebene die Kennzahlen und Labels aktualisiert.
- Exporttests sollten pruefen, dass Ebene, Kennwert und gueltige Paaranzahl ausgegeben werden.

## Abhaengigkeiten / Risiken

- ICC bleibt fachlich offen: benoetigt werden Shrout/Fleiss-Variante, Schaetzmethode, Umgang mit geplant unvollstaendigen Designs und Referenzwerte.
- Brennan-Prediger und Fleiss' Kappa gehoeren fachlich zu #426 und sollten erst nach dortiger Entscheidung umgesetzt werden.
- Wenn Score-Mapping aus Kodierschemata geaendert wird, muessen Referenzwerte neu bewertet werden.

## Offene Fragen

- Soll Fleiss' Kappa fuer Schulungen mit mehr als zwei Kodierern im MVP enthalten sein oder erst als Folgeausbau?
- Soll Brennan-Prediger als eigene Kennzahl oder als Korrekturoption fuer Cohen's Kappa angeboten werden?
- Welche ICC-Variante nach Shrout/Fleiss soll nach dem Kodierforum verwendet werden?
- Soll bei Modalwert-Gleichstand nur der deterministische Wert mit Stern angezeigt werden oder zusaetzlich die vollstaendige Kandidatenliste?
