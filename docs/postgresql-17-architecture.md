# PostgreSQL 17.12: Architektur- und Codeprüfung

Stand: 17.11.2026, PR #1186. PostgreSQL 17.12 wird verbindlicher Standard der
Anwendungsdatenbank. Die folgenden Vorschläge beruhen auf den unten verlinkten
Codestellen und den PostgreSQL-Release-Notes. Sie sind Empfehlungen für gezielte
Folgeänderungen; ein Nutzen im Produktionsbestand ist erst durch Messungen belegt.

## Abgleich mit der bestehenden PR-Kette

Die unten beschriebenen Codestellen zeigen den Stand von #1186. Der zusätzliche
Abgleich mit den offenen Folge-PRs am 17.11.2026 ergibt:

| Vorhaben | Bereits bearbeitet? |
|---|---|
| Kappa ohne wachsende OFFSET-Abfragen | **Ja, in [#1188](https://github.com/iqb-berlin/coding-box/pull/1188).** Der Code verwendet einen serverseitigen Cursor mit `FETCH` in einer schreibgeschützten Repeatable-Read-Transaktion; Missing-Profile werden über dieselbe Verbindung aufgelöst. Der geschlossene, nicht gemergte #1187 ist darin enthalten. |
| Personenimport: Upsert-Ergebnisse mit RETURNING nutzen und Nachladen vermeiden | **In den geprüften offenen PRs nicht umgesetzt.** `person-persistence.service.ts` führt weiterhin Upserts und anschließend separate Leseabfragen aus. Die Batch-/Importarbeiten in #1188/#1190 ersetzen diesen konkreten Ablauf nicht. |
| Dauerhaft getrennte DB-Rollen für API/Worker, Liquibase und Wartung | **Noch offen.** #1186 ergänzt nur den temporären Restore-Administrator; die regulären Dienste verwenden weiterhin dieselben POSTGRES-Zugangsdaten. |
| Erweiterte I/O-/Planungsdiagnose | **Teilweise in #1186.** Lesende Tabellen-/Index-/Wartezustandsdiagnose, optionale aggregierte `pg_stat_statements`-Daten, Slow-Query-Logging und Benchmark-Pläne sind vorhanden. `pg_stat_io`, `pg_stat_checkpointer` und die erweiterten EXPLAIN-Messungen sind weitere Schritte. |

Die Cursor-Umstellung ist deshalb kein zusätzlich neu zu implementierender
Folgevorschlag. Zuerst #1188 einschließlich seiner Snapshot-/Pool-Regressionen
prüfen und übernehmen. Diese Einordnung ersetzt keine vollständige Review der
weiteren PRs; sie gleicht die hier genannten Architekturvorschläge mit deren Code ab.

## Bewertung

Die vorhandene Architektur mit NestJS/TypeORM, PostgreSQL, Redis/BullMQ und einem
separaten Export-Worker kann bestehen bleiben. Der Versionswechsel erfordert
weder einen ORM-Wechsel noch eine neue Queue-/Cache-Architektur. Die bestehende
SQL-Filterung und begrenzte Batch-Verarbeitung bleiben sinnvoll. Funktionale
Änderungen an Kodierung, Dublettenregeln, Import-Modi oder Exportsortierung gehören
in eigene Änderungen mit fachlichen Vergleichstests.

Für den vorbereiteten Rückfall muss dasselbe Anwendungsimage zunächst auch auf
der 14er Quelle funktionieren. Solange dieses Rückfallfenster offen ist, gehören
17-spezifische SQL-Funktionen nicht in zwingende Laufzeitpfade. Cursor-Paginierung
und `INSERT ... ON CONFLICT ... RETURNING` sind dagegen bereits auf 14 verfügbar.

| Priorität | Konkreter Ansatz | Erwarteter Nutzen / Prüfung | Versionsbezug |
|---|---|---|---|
| Hoch | Aggregierte DB-Diagnose um I/O- und Checkpoint-Messungen ergänzen | Engpässe zwischen SQL, Speicher und Datenübertragung unterscheiden; geringe Logmenge | `pg_stat_io` seit 16, zusätzliche EXPLAIN-/Checkpoint-Daten in 17 |
| Hoch | Kappa-Paginierung und Exportabfragen mit realistischen großen Beständen profilieren | Weniger wiederholt übersprungene Zeilen und geringerer Speicherbedarf | Neue Planner-/I/O-Funktionen helfen; Cursor-Paginierung war bereits auf 14 möglich |
| Mittel | Import-Upsert und anschließendes Nachladen zusammenfassen | Weniger SQL-Roundtrips bei großen Personenimporten | `RETURNING` existiert bereits; `MERGE RETURNING` in 17 ist kein automatischer Ersatz |
| Mittel | Rollen für Anwendung, Migration und Wartung trennen | Weniger Rechte im laufenden API-/Worker-Prozess, klarere Betriebsverantwortung | 17 ergänzt `MAINTAIN` und `pg_maintain` |
| Nach Messung | Physische inkrementelle Backups mit Restore-Probe | Kürzere regelmäßige Sicherungen großer Bestände | Native inkrementelle Base-Backups in 17; anderes Verfahren als der Major-Transfer |

## 1. Beobachtbarkeit vor weiterer Optimierung

[`inspect-postgres.mjs`](../scripts/qa/inspect-postgres.mjs) erfasst bereits
Tabellen-/Indexgrößen, Wartezustände und optional aggregierte `pg_stat_statements`-
Daten ohne SQL-Texte/Antwortwerte. Sinnvolle Ergänzungen sind `pg_stat_io` und
`pg_stat_checkpointer` als zeitlich verglichene Zählerstände. Die I/O-Zähler gelten
für den Cluster; sie sind keine Kostenmessung einer einzelnen Anfrage und
unterscheiden den Betriebssystem-Pagecache nicht von physischen Plattenzugriffen.
[Statistiksystem](https://www.postgresql.org/docs/17/monitoring-stats.html).

Auf einer realistischen Datenkopie bekannte SELECT-Abfragen mit
`EXPLAIN (ANALYZE, BUFFERS, MEMORY, SERIALIZE TEXT, FORMAT JSON)` untersuchen.
`MEMORY` zeigt Planungsaufwand; `SERIALIZE` ergänzt die serverseitige Umwandlung
für die Übertragung. Netzwerkzeit, TypeORM-Hydration und JavaScript-/Excel-Verarbeitung
müssen daneben separat gemessen werden. Das ist für breite Exportzeilen relevant.
[EXPLAIN](https://www.postgresql.org/docs/17/sql-explain.html).

Slow-Query-Logging bleibt eine einschaltbare Diagnose mit einem Ereignis pro
langsamer Abfrage. Aggregierte Statistiken können bei dauerhaft hoher Last die
erste Anlaufstelle sein, ohne dieselbe Menge einzelner Warnungen zu erzeugen.
`pg_stat_statements` muss dazu ausdrücklich vorgeladen und in der betreffenden
Datenbank eingerichtet werden; dieser PR aktiviert es nicht pauschal.

## 2. Kappa und Exporte: Abfragen und Arbeitsspeicher

[`getCodedVariablesForKappa`](../apps/backend/src/app/database/services/coding/double-coding-review-query.service.ts)
filtert bereits in SQL, lädt 5.000 Zeilen pro Batch, paginiert mit `OFFSET` und
behält die gruppierten Ergebnisse in einer Map. Bei tiefen Seiten und großen
Beständen sind deshalb sowohl wiederholte DB-Arbeit als auch Node-Speicher zu
messen. PostgreSQL 17 beseitigt diese Eigenschaften des Anwendungscodes nicht.

[#1188](https://github.com/iqb-berlin/coding-box/pull/1188) ersetzt diesen OFFSET-Pfad
bereits durch einen serverseitigen Cursor. Das ist am Code des
[Batch-Helfers](https://github.com/iqb-berlin/coding-box/blob/609b133d25b5ff6d5960c8f44d33c2c7f3db51bf/apps/backend/src/app/database/services/shared/postgres-query-batches.util.ts)
und dessen Aufruf in `getCodedVariablesForKappa` geprüft. Nach der Übernahme bleiben
frühe/späte Batches, ungefilterte Ergebnisse und der Node-Speicherverbrauch zu messen.
Die nachfolgenden Anforderungen gelten für die Abnahme dieser Änderung:
Dabei die vollständige aktuelle Sortierung einschließlich `cju.id` und `cjc.id`,
die verwendete Collation und den Umgang mit NULL erhalten. Bei laufenden
Kodierungen muss außerdem ein konsistenter Datenstand festgelegt werden. Eine
Umstellung nur auf `response_id > lastId` würde den bestehenden Vertrag nicht
abbilden. Für Gruppierung/Kappa-/Exportwerte bestehende Golden-/PostgreSQL-Tests
und Grenzfälle über mehrere Batch-Grenzen verwenden.

[`test-results-export.service.ts`](../apps/backend/src/app/database/services/test-results/test-results-export.service.ts)
und [`coding-export-query.service.ts`](../apps/backend/src/app/database/services/coding/coding-export-query.service.ts)
nutzen u. a. `IN`-Filter. Die verbesserten B-Tree-Mehrfachsuchen und CTE-Planung von
17 können bestehende Abfragen ohne Umschreiben begünstigen. Einen pauschalen neuen
Index oder höhere Parallelität daraus nicht ableiten: zuerst Pläne, tatsächliche
Zeilenmengen und Temp-I/O unter Nebenläufigkeit vergleichen.
[PostgreSQL-17-Änderungen](https://www.postgresql.org/docs/17/release-17.html).

## 3. Import: weniger Roundtrips, gleiche Semantik

[`processPersonBooklets`](../apps/backend/src/app/database/services/test-results/person-persistence.service.ts)
führt Personen-Upserts in 25er-Batches aus und lädt die betroffenen Personen
anschließend über weitere Abfragen nach. Ein geeignetes `INSERT ... ON CONFLICT
... RETURNING` könnte einen Teil dieses Nachladens ersetzen. Das ist auch auf
14 möglich und kein Grund, während des Major-Wechsels die Importlogik zu ändern.
Vor einer Umsetzung Personen-/Workspace-Scope, alle drei Import-Modi,
Audit-Transaktion, Fehlermeldungen und gleichzeitige Importe vergleichen.

`MERGE ... RETURNING` ist neu nutzbar, ersetzt aber das vorhandene Upsert nicht
semantikgleich. Konflikte bei konkurrierenden Inserts und Mehrfachtreffern müssen
gesondert behandelt werden. [MERGE](https://www.postgresql.org/docs/17/sql-merge.html).
Insbesondere bleiben inhaltlich gleiche Chunks/Logs/Sessions mit verschiedenen
IDs erhalten; daraus keine neue fachliche Eindeutigkeit ableiten.

`JSON_TABLE` bietet gezielte Möglichkeiten für wohldefinierte JSON-Dokumente.
`response.value` ist jedoch ein Textvertrag, der auch Whitespace und nicht als
JSON interpretierte Werte bewahrt. Eine globale Umstellung auf JSONB oder eine
automatische SQL-Konvertierung würde diesen Vertrag ändern. `COPY ON_ERROR ignore`
wäre ebenfalls keine passende Standardstrategie für vollständig zu übernehmende
Antwortdaten. [Neue SQL-/JSON- und COPY-Funktionen](https://www.postgresql.org/docs/17/release-17.html).

## 4. Rollen und Betriebsarchitektur

Die normalen Compose-Dienste verwenden bisher dieselben `POSTGRES_USER`-/Passwort-
Variablen für API, Worker und Liquibase. Der Migrationsplan behält bestehende Rollen
und ACLs bei. Eine gesonderte Änderung sollte Runtime-DML, Schema-Migrationen und
Wartung trennen, einschließlich eigener Zugangsdaten und Rollen-/Default-Privilege-
Tests für neu angelegte Tabellen und Sequenzen. PostgreSQL 17 bietet für Wartung
`MAINTAIN` bzw. `pg_maintain`, ohne dem Wartungskonto die Anwendungsrolle als Owner
zu geben. [Vordefinierte Rollen](https://www.postgresql.org/docs/17/predefined-roles.html).

Redis/BullMQ bleibt für Queue-/Cache-Zustände zuständig. Ein Wechsel zu einer
PostgreSQL-Queue würde Jobwiederholungen, Sperren, Fortschritt und Ausfallverhalten
betreffen; aus dem Update ergibt sich dafür kein begründeter Änderungsbedarf.

## 5. Backups als eigener Betriebsbaustein

Für große produktive Bestände sind physische inkrementelle Backups ein möglicher
Folgeschritt. WAL-Summaries, Vollbackup-/Inkrementketten, Aufbewahrung,
Wiederzusammenbau mit `pg_combinebackup` und Restore-Zeit müssen zusammen geplant
und getestet werden. Das ersetzt weder den geprüften 14→17-Dump/Restore noch
einen Rückfallplan für einen Major-Wechsel.
[pg_basebackup](https://www.postgresql.org/docs/17/app-pgbasebackup.html).

## Messstand

Die funktionalen Nachweise und der Vergleichslauf auf 14/17 stehen in
[der Validierung](qa/postgresql-17.12-validation.md). Der zusätzliche Kappa-Benchmark
vergleicht dieselben synthetischen Daten und prüft gleiche fachliche Ergebnisse.
Messungen auf einer warmen lokalen Einzelinstanz begründen keine Zusage zu
Produktionslaufzeiten oder zur Kapazität bei vielen gleichzeitigen Nutzern.
