# Kappa: Unit- und Variablenfilter in PostgreSQL

Basis: Develop `ba001c3850cb4ad53e49af8071791a2056d22489` vom 26.10.2026, einschließlich der Service-Auslagerung aus PR #1094.

`CohensKappaStatisticsService` reicht die optionalen Textfilter an `DoubleCodingReviewQueryService` weiter. Die Query setzt parametrisierte Gleichheitsbedingungen auf `coding_job_unit.unit_name` und `variable_id`, bevor die bestehenden 5.000-Zeilen-Batches geladen werden. Damit entfallen das Laden, Auflösen von Missings und Gruppieren der nicht ausgewählten Zeilen. Statistik und Export bleiben in ihren bisherigen Services; die separate Workspace-Kappa-Summary-Abfrage bleibt unverändert. Es wird kein Index und keine Datenmigration eingeführt.

## Semantik und Regressionen

Die PostgreSQL-Suite erstellt eine eigene Datenbank und führt die SQL-Changesets des vollständigen aktuellen Liquibase-Changelogs aus; TypeORM `synchronize` ist aus. Query, Exclusion-Service, Missing-Profilauflösung, Statistikberechnung und Export sind echte Implementierungen. Nur Cache und Replay-URL-Erzeugung werden ersetzt.

Die Referenz lädt mit derselben bisherigen Query ohne Textfilter und wendet anschließend die bisherigen JavaScript-Bedingungen an. Der vollständige Rückgabewert wird mit der gefilterten Query verglichen, einschließlich Reihenfolge, Kodierergebnissen und Metadaten. Abgesichert sind:

- Unit, Variable, beide Filter sowie fehlende/leere Filter, unbekannte Werte, Groß-/Kleinschreibung, Leerzeichen und SQL-/LIKE-Sonderzeichen. Es findet keine Normalisierung statt. Wiederholte HTTP-Querywerte (Arrays) und NUL-Werte können wie zuvor keinen gespeicherten Text treffen und werden nicht an PostgreSQL gebunden.
- Code-/Score-Ebene einschließlich Score null versus 0, technischer Marker, profilabhängiger negativer Codes und manueller Missing-Optionen.
- Trainingsausschluss, Job-Definitionen und Trainings als OR-Scope, Legacy-Bundle-Mitgliedschaft, Kodiererfilter und Workspace-Isolation.
- Globale Unit-, Booklet- und Testlet-Ausschlüsse, Ausschluss interner Review-Jobs sowie Jobs mit mehreren verschiedenen Kodierern.
- Doppelte Zuweisungen desselben Kodierers und bevorzugte Ergebnisse hinter der Batchgrenze: 6.001 physische Duplikate ergeben durch doppelte Zuweisung über 12.000 Rohzeilen, aber weiterhin genau ein Ergebnis je Kodierer.
- Statistiken einschließlich Workspace-Aggregat, gewichtete und ungewichtete Mittelwerte, Detail-/Summary-CSV und alle Excel-Zellen. Nur der Exportzeitpunkt wird für den CSV-Vergleich fixiert.

Der Backend-CI-Job erhält einen isolierten PostgreSQL-14-Service und aktiviert diese Suite verbindlich. Ohne `KAPPA_QUERY_TEST_DATABASE_URL` bleiben die Datenbanktests lokal optional. Nx berücksichtigt Datenbank-Changelog und Aktivierungsvariablen im Test-Cache. Der Benchmark bleibt opt-in und enthält keine instabilen Zeitgrenzen als Testassertion.

## Vorher-Nachher-Messung

Lokaler PostgreSQL 14.24 (Homebrew), Node 22.23.1, macOS ARM64, eigene temporäre Instanz mit 16 MB `shared_buffers`, ausgeschaltetem fsync und warmem Cache. Benchmark-Workspace: 25.000 Antworten, 50.000 Kodierzeilen, zwei Kodierer, 20 Units und 10 Variablen, gleichmäßig verteilt. Die Semantik-Fixtures liegen in anderen Workspaces derselben Testdatenbank. Bestehende Schema-Indizes und Planner-Einstellungen gelten für beide Varianten identisch; vor der Messung wird `ANALYZE` ausgeführt.

Gemessen werden Query-Batches, Übertragung, Missing-Auflösung, Gruppierung und der bisherige JavaScript-Filter. HTTP, Kappa-Mathematik und Exporte sind nicht Teil der Laufzeitmessung. Pro Szenario: ein Aufwärmdurchlauf und fünf Messdurchläufe, Vorher/Nachher in wechselnder Reihenfolge. In jedem Durchlauf müssen beide Varianten vollständig gleiche Ergebnisse liefern. Die Zählung umfasst auch einen terminalen leeren Batch bei genau 5.000 bzw. 50.000 Rohzeilen.

| Filter | Ergebnis-Antworten | Rohzeilen vorher → nachher | Batches vorher → nachher | Median vorher → nachher | Spanne vorher / nachher |
| --- | ---: | ---: | ---: | ---: | ---: |
| keiner | 25.000 | 50.000 → 50.000 | 11 → 11 | 1.565,0 → 1.560,0 ms | 1.542,6–1.730,3 / 1.523,9–1.578,7 ms |
| Unit | 1.250 | 50.000 → 2.500 | 11 → 1 | 1.647,5 → 44,0 ms | 1.569,8–1.727,0 / 40,8–44,3 ms |
| Variable | 2.500 | 50.000 → 5.000 | 11 → 2 | 1.651,5 → 90,1 ms | 1.566,8–1.994,9 / 89,1–92,1 ms |
| Unit + Variable | 125 | 50.000 → 250 | 11 → 1 | 1.558,1 → 12,0 ms | 1.557,1–1.571,4 / 11,4–12,1 ms |

Für den kombinierten Filter werden 99,5 % weniger Rohzeilen übertragen. Ohne Filter zeigt diese Messung keinen relevanten Laufzeitunterschied. Das ist synthetische lokale Evidenz für den vermiedenen Datenabruf, keine Prognose für Produktionslatenzen, andere Datenverteilungen oder konkurrierende Schreibzugriffe. OFFSET-Paging und dessen bestehende Konsistenzgrenzen bleiben bestehen.

[Rohmesswerte und vollständige EXPLAIN-ANALYZE-BUFFERS-Pläne](kappa-query-benchmark-2026-10-26.json) enthalten alle fünf Samples und den ersten Batch jeder Variante. Die EXPLAIN-Laufzeiten beziehen sich nur auf diesen ersten SQL-Batch und sind nicht mit der gesamten Abrufzeit gleichzusetzen.

## Wiederholung

Voraussetzung: ein separater PostgreSQL-14-Testserver, `psql` und ein Testbenutzer mit Berechtigung zum Erstellen/Löschen von Datenbanken sowie für `pg_trgm`. Die Suite erzeugt und entfernt ausschließlich ihre Datenbank `kappa_query_<pid>_<zeit>`; der Datenbankname der Server-URL wird nur für die Administration verwendet.

```sh
export KAPPA_QUERY_TEST_DATABASE_URL='postgresql://testuser:testpassword@127.0.0.1:5432/postgres'
# Optional bei einer nicht im PATH liegenden Installation:
# export PSQL_BIN=/pfad/zu/psql
NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx test backend \
  --runInBand --testPathPatterns=double-coding-kappa-query.postgres.spec.ts \
  --skipNxCache --cache=false

KAPPA_QUERY_BENCHMARK=1 \
KAPPA_QUERY_BENCHMARK_OUTPUT="$PWD/docs/qa/kappa-query-benchmark-local.json" \
NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx test backend \
  --runInBand --testPathPatterns=double-coding-kappa-query.postgres.spec.ts \
  --skipNxCache --cache=false
```

## Lokale Validierung

- `nx test backend --runInBand --skipNxCache --cache=false` mit aktiviertem PostgreSQL: 236 Suites und 3.912 Tests bestanden; 83 Tests übersprungen.
- Gesonderter PostgreSQL-Lauf mit Benchmark: alle 24 Tests bestanden, einschließlich der Exportvergleiche.
- `nx lint backend --skipNxCache`: bestanden.
- `nx run backend:typecheck`: 0 Diagnosen; Metadaten aller 43 PostgreSQL-Entities gültig.
- `nx build backend --configuration=production --skipNxCache`: bestanden.
- CI-YAML inklusive PostgreSQL-Service und Aktivierungsvariable geparst; Testzugangsdaten sind auf den PostgreSQL-Service begrenzt.

Die temporäre lokale PostgreSQL-Instanz wurde nach den Prüfungen beendet und entfernt. Remote-CI ist ein eigener Nachweis und hier nicht als lokales Testergebnis ausgewiesen.
