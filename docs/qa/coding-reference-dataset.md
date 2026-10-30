# Technischer Prüfbericht: Kodierbox-Referenzdatensatz

Stand: 30.10.2026. Zuständigkeit: Entwicklung.

## Ergebnis und Status

Ein eigenständiger synthetischer Referenzbestand liegt unter
[`scripts/reference/coding-box`](../../scripts/reference/coding-box/README.md).
Eingaben, Sollmatrizen, Issue-Fälle, Quellen und unabhängig ausgeführte
Python-/R-Prüfungen sind versioniert. Die Jest-Suite verwendet echte
Produktfunktionen und simuliert ausschließlich die Repository-Transporte.

Die Referenz baut auf dem separaten [PR #1139](https://github.com/iqb-berlin/coding-box/pull/1139)
für #1116 auf (`d3b9caaa8dfbf11b31d8fb4a8258902b61322c1e`, Branch
`correct-item-not-reached-order`). Ohne diese Korrektur kann die Kodierbox die erwartete tatsächliche
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
| Gezielte Produktsuite | `npx nx run backend:test-reference --skipNxCache` | Bestanden: 357 Jest-Tests einschließlich der Verpackungsprüfung, keine übersprungenen Fälle |
| Backend-Lint | `npx nx lint backend` | Bestanden; automatische Formatkorrekturen ausschließlich im neuen Test und einer Einrückung der übernommenen Exportkorrektur |
| Gesamte Backend-Suite | `npx nx test backend --runInBand --skipNxCache` | Bestanden: 254 Suites / 4.421 Tests; 15 bestehende Suites / insgesamt 135 Tests übersprungen |
| Backend-Produktionsbuild | `npx nx build backend --configuration=production --skipNxCache` | Bestanden |
| Frontend-Produktionsbuild | `npx nx build frontend --configuration=production --skipNxCache` | Bestanden |
| CI-Qualitätsprüfungen | `npx nx run frontend:test-quality-gates` | Bestanden: 52 Tests |
| Verpackungsprüfung | `npx nx run backend:verify-reference-packaging` | Bestanden: 8 Backend-, 135 Frontend-Dateien und 19 weitere Runtime-Eingaben |

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

## Referenzdaten und Produktionsimages

Die finalen Images erben nicht vom vollständigen Builder. Das Backend übernimmt
nur `dist/apps/backend`, die Paket-Manifeste und `vendor` für die Installation
der Produktionsabhängigkeiten. Das Frontend übernimmt `dist/apps/frontend` und
drei festgelegte Nginx-/Fehlerseiten-Dateien. Die Referenz bleibt im Builder für
Tests verfügbar; sie wird nicht als Anwendungs-Asset konfiguriert. Beide
TypeScript-Anwendungsbuilds schließen `*.spec.ts` aus.

`scripts/qa/verify-reference-packaging.mjs` prüft die tatsächlichen Build-
Artefakte und weiteren Runtime-Eingaben anhand der Inhalts-Hashes sämtlicher
Referenzdateien, eindeutiger eingebetteter Datensatzmerkmale sowie verbotener
Testpfade. Eine zusätzliche Prüfung verfolgt die von `prod` geerbten Docker-
Stages und erlaubt nur die genannten COPY-Eingaben und Runtime-Basisimages.

Der Docker-Builder führt die Artefaktprüfung nach beiden Builds aus. Der
Branch-/PR-Build führt sie ebenfalls aus; dort wird ein nicht betroffenes und
daher nicht gebautes Backend zugelassen, das Frontend bleibt verpflichtend.
Der Docker-Builder verlangt dagegen immer beide Artefaktverzeichnisse.
Neun Node-Prüffälle sichern unter anderem umbenannte CSV-Kopien, eingebettete
Testwerte, Symlinks und versehentlich kopierte oder geerbte Builder-Inhalte ab.
Sie sind über die Referenzsuite Teil der normalen Backend-Prüfung.

Lokal ausgeführt, nacheinander:

```sh
npx nx build backend --configuration=production --skipNxCache
npx nx build frontend --configuration=production --skipNxCache
npx nx run backend:verify-reference-packaging
```

Ergebnis: keine Referenzdaten in 8 Backend-Dateien, 135 Frontend-Dateien und
19 weiteren Runtime-Eingaben. Das ist ein Nachweis für die gebauten Dateien
und die Docker-Kopierpfade. Eine Inspektion tatsächlich gebauter Docker-Images
wurde lokal nicht durchgeführt, weil der Docker-Daemon nicht aktiv ist.

## Grenzen und fachliche Nutzung

Die vollständige Issue-Zuordnung und die jeweils getestete Verantwortung stehen
im Referenz-README. Dieser Bericht ist keine fachliche Abnahmeplanung und weist
keinen echten Upload, Datenbankimport, Browserlauf oder realen Produktionsfall
nach. Die vorhandenen PostgreSQL-Spezialtests bleiben optional. Er verändert
keine Ticketzustände und fordert keine Wiederholung gültiger Abnahmen an.

Die vier lesbaren Soll-CSV-Dateien ermöglichen eine spätere gezielte fachliche
Prüfung. Vor einer Abnahme muss der tatsächliche Testserver-Build festgestellt
werden; die Testergebnisse dieses Arbeitsbranches sind keine Deployment-Evidenz.
