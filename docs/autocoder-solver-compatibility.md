# SOLVER-Kompatibilität der Kodierbox

Kodierbox verwendet `@iqb/responses` 5.3.1. Validierung, Abhängigkeitsgraph und
Codebook-Regeltexte verwenden weiterhin das unveränderte installierte Paket.
Für automatische Kodierung erhält dessen Engine die bisherige SOLVER-Mathematik.

## Produktionsweg

`CodingProcessService.codeAutocoderResponses` übergibt seine kanonisierten Daten
an `generated/autocoder-compatibility-engine.js`. Diese Datei wird aus dem
installierten öffentlichen `coding-scheme-factory`-Einstieg von Responses 5.3.1
mit esbuild erzeugt. Der Engine-Quellcode wird nicht manuell bearbeitet. Nur der
mathjs-Import wird auf `autocoder-solver-math.ts` umgeleitet.

Dieser Adapter verwendet eine private mathjs-12.4.3-Instanz mit der bisherigen
relativen Toleranz 1e-12. Die exakte bisherige Math-Version erhält auch Funktionen
jenseits von Vergleich und Rundung; nur die neue absolute Toleranz auf null zu
setzen würde nicht alle Unterschiede zwischen mathjs 12 und 15 ausschließen.
Die Konfiguration ist wie beim bisherigen Default-Einstieg schreibgeschützt,
auch in verschachtelten evaluate/parser-Aufrufen. Globale mathjs-Instanzen und
die normale Responses-Factory werden nicht verändert.

Ein NULL-Ergebnis löst vor der Rückgabe der Auswertung einen Fehler aus. Der
bestehende Fehlerpfad der 5.3.1-Engine ergibt dadurch wie bisher DERIVE_ERROR.
Die Korrektur wirkt innerhalb des ursprünglichen Ableitungsablaufs: Codeauswahl
und abhängige SUM_SCORE-/weitere Ableitungen sehen bereits den richtigen Status.
Es werden keine fertigen Ergebnisse nachträglich umgeschrieben.

## Nachweise

Drei Service-Regressionen sichern ceil nahe null, Gleichheit nahe null und einen
NULL-Zweig mit echten Regeln, Alias und Subform. Sie scheiterten vor dem Fix.
Die unabhängige Vergleichsmatrix prüft 11.760 Paare gegen das veröffentlichte
Responses 5.2.0: sieben Ableitungsarten, 14 Statuswerte, 14 Wertformen, Aliase,
Subforms und neun SOLVER-Ausdrücke. Weitere Fälle prüfen bestehende Zielzustände,
BASE_NO_VALUE, Ableitungsketten, nicht endliche Ergebnisse und Konfigurationsschutz.

`@iqb/responses-legacy-reference` ist ausschließlich eine Entwicklungsabhängigkeit
für diese unabhängige Referenz. Das erzeugte Produktionsbundle enthält Engine-Code
aus Responses 5.3.1, keine 5.2.0-Engine. Die Runtime benötigt das Referenzpaket nicht.

## Wartung

Nach einem bewusst geprüften Responses- oder Adapter-Update:

```sh
node scripts/build-autocoder-compat.mjs
node scripts/build-autocoder-compat.mjs --check
npx nx test backend --runInBand
npx nx build backend
```

Der Builder prüft die Responses-Version 5.3.1, mathjs 12.4.3 und genau einen
umgeleiteten Math-Import. Der Backend-Test baut das Artefakt erneut und vergleicht
es bytegenau mit der eingecheckten Datei. Änderungen an Paket, Adapter oder
Generator können somit nicht unbemerkt ein veraltetes Bundle freigeben.
Der generierte Header dokumentiert Herkunft und Lizenzen. Die Deklaration
übernimmt den öffentlichen Factory-Vertrag direkt aus Responses.

Frontend und Backend auf dem Entwicklungsrechner getrennt prüfen. Die gemeinsame
Bibliothek, Studios Schemer/Preview und beide Codebook-Generatoren erhalten diese
Kodierbox-spezifische Kompatibilität nicht; deren bisheriges Verhalten bleibt bestehen.
