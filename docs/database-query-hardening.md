# PostgreSQL-Diagnose und Schemaabsicherung


## Standardverhalten und optionale Zeitgrenzen

Ohne zusätzliche Konfiguration wartet das Backend wie bisher ohne Zeitgrenze
auf eine freie PostgreSQL-Verbindung. Das gilt auch für den Export-Worker.
`POSTGRES_POOL_ACQUIRE_TIMEOUT_MS=0`, ein leerer oder ein ungültiger Wert
deaktivieren die Zeitgrenze. Ein positiver ganzzahliger Wert aktiviert sie in
Millisekunden, zum Beispiel `POSTGRES_POOL_ACQUIRE_TIMEOUT_MS=10000`.

Die Grenze gilt sowohl beim Warten auf den Verbindungspool als auch beim Aufbau
einer neuen Verbindung. Sie beendet keine bereits laufende SQL-Abfrage und
ändert keine PostgreSQL-`statement_timeout`-Einstellung. Die unabhängige
Einstellung `POSTGRES_IDLE_IN_TRANSACTION_TIMEOUT_MS` bleibt unverändert.

Compose gibt die Einstellung an API und Export-Worker weiter.
`EXPORT_WORKER_POSTGRES_POOL_ACQUIRE_TIMEOUT_MS` erlaubt eine abweichende
Worker-Einstellung: leer oder nicht gesetzt übernimmt den gemeinsamen Wert,
`0` deaktiviert die Grenze für den Worker ausdrücklich.

Ein abgelaufener Verbindungstimeout führt bei unbehandelten HTTP-Fehlern und den
Replay-Routen zu HTTP 503. Die Antwort enthält die Request-ID und keine
Treiber-, SQL- oder Zugangsdaten. Bereits vorhandene HTTP-Ausnahmen sowie
andere Fehler behalten ihren bisherigen Status.

## Slow-Query-Logging

Das zusätzliche Logging ist standardmäßig deaktiviert:
`POSTGRES_SLOW_QUERY_MS=0`. Auch ohne Variable sowie bei leeren oder ungültigen
Werten bleiben der bisherige TypeORM-Logger und das bisherige Logging erhalten.

Zum zeitweiligen Untersuchen langsamer Abfragen kann beispielsweise
`POSTGRES_SLOW_QUERY_MS=1000` gesetzt werden. Dann erzeugt **jede** erfolgreich
beendete Abfrage über einer Sekunde eine Warnung mit Dauer und SQL-Fingerprint.
Es gibt keine Drosselung und keine Zusammenfassung gleicher Abfragen. Viele
langsame Abfragen, etwa bei einem großen Import oder Export, können deshalb
viele Meldungen erzeugen. Für den Dauerbetrieb bleibt die Diagnose aus; für eine
gezielte Messung sind eine passende höhere Schwelle und ein begrenzter
Messzeitraum sinnvoll. Die Einstellung gilt für API und Export-Worker.

SQL-Text, Antwortwerte und Parameter erscheinen nicht in diesen Meldungen.
Ein Fingerprint bezeichnet den Hash des SQL-Texts; er ist keine vollständige
Abfrage und kein Ersatz für eine Datenbank-Leistungsanalyse.

Eine lesende Bestandsaufnahme ist mit `npx nx run backend:database-diagnostics`
möglich. Sie erwartet ausdrücklich gesetzte `POSTGRES_HOST`, `POSTGRES_DB` und
`POSTGRES_USER` sowie bei Bedarf `POSTGRES_PORT` und `POSTGRES_PASSWORD`.
`--reportFile=/geschuetzter/pfad/report.json` schreibt den Bericht in eine Datei.
Der Bericht enthält auch dann Einstellungen, Tabellen, Indizes und Warteereignisse,
wenn die Statistikansicht fehlt oder PostgreSQL die Erweiterung beim Start
nicht über `shared_preload_libraries` geladen hat. In beiden Fällen ist
`pgStatStatementsAvailable` auf `false` gesetzt und `queries` ist leer.

## Vorabprüfung der neuen Log-/Session-Primärschlüssel

Die Migration erhält alle vorhandenen Zeilen und IDs. Sie ergänzt die
Eindeutigkeit von `bookletlog.id`, `unitlog.id` und `session.id`, statt Daten zu
löschen, zusammenzuführen oder umzunummerieren.

Die regulären Anwendungsimporte lassen diese IDs durch PostgreSQL-Sequenzen
erzeugen; sie übernehmen keine IDs aus den importierten Testlogs oder Sessions.
Ein erneuter fachlich identischer Import bedeutet deshalb nicht automatisch
doppelte Datenbank-IDs. Sequenzaufrufe liefern auch bei gleichzeitigen Importen
verschiedene Werte. Lücken nach Rollbacks sind normal und kein Konflikt.

Bei ausschließlich regulär erzeugten Daten ist das Risiko doppelter IDs daher
eher gering. Ohne Prüfung des konkreten Bestands lässt sich keine belastbare
Wahrscheinlichkeit nennen. Manuelle SQL-Importe mit vorgegebenen IDs, Restores
mit falsch zurückgesetzten Sequenzen oder historische Eingriffe können dennoch
Duplikate hinterlassen, da bisher keine physische Eindeutigkeit erzwungen wurde.

Vor dem Rollout auf einer aktuellen Datenkopie folgende **lesende** Prüfung
ausführen. Alle drei Ergebniszeilen müssen `duplicate_id_groups = 0` und
`extra_rows = 0` zeigen. Die Abfragen können bei großen Logtabellen entsprechend
lange dauern und ersetzen keine Prüfung der Sequenzstände nach einem Restore.

```sql
SELECT 'bookletlog' AS table_name, count(*) AS duplicate_id_groups,
       coalesce(sum(n - 1), 0) AS extra_rows
FROM (SELECT count(*) AS n FROM public.bookletlog GROUP BY id HAVING count(*) > 1) d
UNION ALL
SELECT 'unitlog', count(*), coalesce(sum(n - 1), 0)
FROM (SELECT count(*) AS n FROM public.unitlog GROUP BY id HAVING count(*) > 1) d
UNION ALL
SELECT 'session', count(*), coalesce(sum(n - 1), 0)
FROM (SELECT count(*) AS n FROM public.session GROUP BY id HAVING count(*) > 1) d;
```

Wenn Duplikate existieren, den Rollout anhalten und ihre Ursache anhand des
Bestands klären. Es gibt absichtlich keine automatische Datenbereinigung.
Eine Prüfung auf einer Datenkopie beschreibt deren Stand; spätere manuelle
Änderungen oder Restore-Vorgänge müssen erneut geprüft werden.

Auch ohne Duplikate sind Zeit, Platz für Indizes/WAL und kurz verfügbare
Tabellensperren nötig. Die Unique-Indizes werden mit `CONCURRENTLY` aufgebaut;
das anschließende Anhängen der Primärschlüssel benötigt eine Sperre und bricht
bei mehr als fünf Sekunden Sperrwartezeit ab. Eine fehlgeschlagene Migration
verhindert wegen der Compose-Abhängigkeit einen regulären Backend-Neustart.

Wurde ein Index vor der Unterbrechung vollständig aufgebaut, übernimmt Liquibase
ihn beim nächsten Lauf, sofern Name, Definition und Gültigkeit übereinstimmen.
Ein ungültiger Index oder ein gleichnamiges Objekt mit anderer Definition
stoppt die Migration. Die Fehlermeldung nennt den betroffenen Namen.
Die folgende Abfrage zeigt die ungültigen Indizes.

```sql
SELECT t.relname AS table_name, c.relname AS index_name,
       i.indisvalid, i.indisready
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND NOT i.indisvalid;
```

Bei einer Namenskollision zusätzlich die Definition des gemeldeten Index mit
`pg_get_indexdef(to_regclass('public.orm_bookletlog_id_unique'))` prüfen
und dabei den Namen aus der Fehlermeldung einsetzen.

Nur einen nachweislich durch den fehlgeschlagenen Aufbau entstandenen Index
gezielt bereinigen; keine pauschalen Indexlöschungen oder Zeilenlöschungen.
Siehe [PostgreSQL-Sequenzen](https://www.postgresql.org/docs/14/functions-sequence.html)
und [Concurrent-Indexaufbau](https://www.postgresql.org/docs/14/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY).

Beim Rollback werden die entfernten Indizes je Changeset in einer Transaktion
wiederhergestellt. Der Aufbau kann Schreibzugriffe auf die betroffenen Tabellen
blockieren. Dafür ist ein Wartungsfenster einzuplanen. Ein abgebrochener Rollback
kann nach Freigabe der Sperren wiederholt werden. Bereits gültige Indizes mit
passender Definition bleiben erhalten. Ein ungültiger Index mit passender
Definition wird neu aufgebaut. Bei einem gleichnamigen Objekt mit anderer
Definition bricht der Rollback ab und lässt das Objekt bestehen.
