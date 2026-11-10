# ORM-/SQL-Laufzeitprüfung vom 10.11.2026

## Entscheidung und Reichweite

**Keine Merge- oder Performancefreigabe aus dieser Prüfung. Kein Deployment.**
Die vereinbarten Ziele für Listen und kalte Filteroptionen sind in der verfügbaren
Umgebung verfehlt. Die vollständige Lastspitze und Erholung sind nicht abgeschlossen.
Eine gefundene Cache-Race wird mit diesem Änderungsstand korrigiert; die Messungen
am vorherigen Stand werden dadurch nicht zum Nachweis für den neuen Stand.

Die vollständige Offline-Kopie umfasst 1.928 Dateien und 16.602.145.818 Bytes.
Jede Datei wurde kopiert, synchronisiert und per SHA-256 nachgelesen. Die
Originalkopie blieb gestoppt und wurde nur lesend in die VM eingebunden.
Vor dem Vergleich wurde die gestoppte VM-Datendisk mit APFS `clonefile` gesichert;
zwischen den Ständen wurde derselbe Ausgangssnapshot wiederhergestellt.

Verglichen wurden `2b6672b7c5e4e8bdb50a8e8a300a02a872438bb6` und
`d2f20a1a541220470c6e584e91a704c7bea64cdc`, mit identischem Schema aus 182
Changesets. Dieser Vergleich betrifft die jüngsten PR-Nachbesserungen und ersetzt
keinen vollständigen HTTP-Vergleich gegen develop `7a4197c5`.

## Umgebung und Grenzen

- Eine Linux/arm64-VM mit zwei CPUs und 6 GiB RAM; PostgreSQL 14.24 mit zwei CPUs,
  3 GiB Containerlimit und 512 MiB Shared Memory; API-Pool 10, Exportworker-Pool 4.
- Echtes Redis, BullMQ-Queues, HTTP-API, Nginx und Produktionsbundles. Technische
  Grenzen unverändert: HTTP 30 Sekunden, Filteroptionen 125 Sekunden, API-SQL
  120 Sekunden. Diese Grenzen sind keine fachlichen Antwortzeitziele.
- Native ext4-Ablage innerhalb der VM, physisch auf externer USB-2-HDD in einem
  verschlüsselten APFS-Volume. Keine SSD- oder Produktionskapazitätsaussage.
- 20 synthetische Workspace-Nutzer mit signierten Bearer-Tokens und tatsächlicher
  Authentifizierungsprüfung; keine Messung des produktiven SSO-Anbieters oder
  von 20 gleichzeitig gerenderten Browsern.
- Der Mac ist ein geteilter Arbeitsplatz. Beobachtete zusätzliche lokale
  Testprozesse und wachsender Swap verhindern eine Aussage über exklusive
  Rechnerkapazität. Die Messwerte beschreiben diese Umgebung.

## HTTP-Ergebnisse am Stand d2f20a1a5

Der Anlauftest r9 begann direkt nach HTTP-Bereitschaft. Beide Stände scheiterten
bereits mit einem Nutzer: Listen liefen in 30-Sekunden-, Filteroptionen in
125-Sekunden-Zeitüberschreitungen. Die anschließend beobachtete Erholung bestand.
Der umfangreiche Startup-Warmup ist bereits am PR-Basisstand vorhanden und wird
nicht als neu eingeführter Fehler dargestellt.

Der zusätzliche Lauf r10 wartete auf beide abgeschlossenen Startup-Warmups und
15 Sekunden nachgewiesene Datenbankruhe. Die r9-Fehler bleiben gültig. Der alte
Stand scheiterte erneut im Vorabtest; der Kandidat lieferte 32 gültige Antworten
mit 1/2/5 Nutzern. Die ersten kalten Filteroptionen benötigten 41,5 Sekunden
(Altstand 64,6 Sekunden), die erste Liste 19,0 Sekunden. Bereits diese Zeiten
verfehlen die jeweiligen Ziele von 30 bzw. 2 Sekunden.

Nach 120 Sekunden Warmup wurde die Phase mit zehn Nutzern über die vollständigen
30 Minuten abgeschlossen:

| Operation | Aufrufe | Fehler | p95 inkl. Timeouts | Vereinbartes p95-Ziel |
| --- | ---: | ---: | ---: | ---: |
| Listen | 1.247 | 10 | 18,77 s | 2 s |
| Gefiltertes Kappa | 374 | 0 | 0,231 s | 5 s |
| Vollständiges Kappa | 125 | 0 | 1,272 s | 30 s |
| Überwiegend warme Filteroptionen | 744 | 0 | 0,059 s | Kalte Berechnung separat: 30 s |

Insgesamt wurden einschließlich Warmup und begonnener Lastspitze 2.678 Aufrufe
aufgezeichnet, davon zehn Timeouts. Bei Beginn der 20-Nutzer-Spitze unterschritt
der interne freie Speicher durch macOS-Swap die unveränderte 3-GiB-Reserve.
Die Sicherung beendete den Treiber; anschließend wurden eigene Prozesse und VM
normal gestoppt. Keine erzwungene Prozessbeendigung war erforderlich.
**Die fünfminütige Lastspitze, Erholungsphase und abschließende Exportprüfung sind
nicht bestanden oder abgeschlossen.**

Initialer Import, Wiederholungsimport und paralleler Import/Export während der
30-Minuten-Phase bestanden. Import und Export überlappten tatsächlich 44,83 Sekunden.
Die exportierten 131.150 ursprünglichen Units behielten dieselbe Inhaltsprüfsumme;
SQL-Scope, 1.016.158 ursprüngliche Antworten und die jeweiligen 64 neuen Fixture-Units
wurden unabhängig geprüft. Je Fixture blieben alle 128 Antworten, Chunks und
Zustandszeilen sowie der 220.665-Byte-Antwortwert erhalten. Nach dem Import enthielten
die HTTP-Filteroptionen die neue Gruppe. Das ersetzt die ausgefallene Schlussprüfung
nach der vollständigen Lastspitze nicht.

## Korrigierte Cache-Race

Nach einer Importinvalidierung konnte der fehlende Versionsschlüssel erneut den
Standardwert 1 ergeben. Ein neuer HTTP-Aufruf konnte dadurch die noch laufende
Berechnung vor dem Import übernehmen. Ein isolierter Test mit den tatsächlichen
`CacheService`- und `WorkspaceStatsCacheService`-Klassen und echtem Redis reproduzierte
das alte Ergebnis nach der Invalidierung: null frische Berechnungen.

Zufällige Generationsidentitäten verhindern die Wiederverwendung, auch nach Löschen
des Versionsschlüssels. Redis prüft Generation und Veröffentlichung atomar. Alte
Anfragen dürfen ihr ursprüngliches Ergebnis erhalten, können es aber nicht nach
einer Invalidierung wieder im Cache veröffentlichen. Der Nachtest berechnete
frische Optionen und lieferte das neue Ergebnis. API und Queueprozessor verwenden
denselben Pfad; Anwendung und Worker sind gemeinsam zu aktualisieren.

Die Redis-Regressionstests gehören zum verpflichtenden Backend-Integrationstest,
prüfen zwei Serviceinstanzen und ersetzen zwei bisherige Tests mit Redis-Nachbildung.
Das Ergebnis der automatisierten Prüfung und der genaue Folgecommit stehen in der
zugehörigen CI und im technischen Ergebnisarchiv. Ein neuer vollständiger 30-Minuten-
Nachweis des korrigierten Stands bleibt separat erforderlich.

## Lokale Validierung der Korrektur

Typprüfung einschließlich nativer ESM-Entity-Metadaten und Backend-Lint bestanden.
Der lokale Gesamtlauf ergab 4.257 bestandene und zwei fehlgeschlagene Fälle sowie
158 bewusst nicht aktivierte Integration-/Benchmarkfälle. Die beiden Fehler
betrafen alte Controller-Testmocks für den ersetzten Invalidierungsaufruf. Nach
Anpassung der Mocks bestanden beide Fälle im gezielten Nachlauf mit unveränderten
fachlichen Assertions. Die fünf neuen echten Redis-Regressionstests bestanden.
Der vollständige Unit-Lauf wurde nach dieser Mockkorrektur lokal nicht erneut
wiederholt; CI am endgültigen Head ist dafür ein gesonderter Nachweis.
Der verpflichtende PostgreSQL-/Redis-Lauf bestand anschließend mit **174 Tests
in 23 Suites**, null Fehlern und einem ausschließlich optionalen Kappa-Benchmark.
Der Abgleich nach Suite und Testname deckt **157 der 158 übersprungenen Unit-Fälle**
als tatsächlich ausgeführt und bestanden ab. Der verbleibende Fall ist genau
dieser optionale Benchmark; es gibt keine unzugeordneten Skips. Der
Produktionsbuild bestand ebenfalls.

Zwei vorherige lokale Versuche sind keine bestandenen Nachweise: der Einprozesslauf
überschritt sein 3-GiB-Testheaplimit; der bytegenaue Autocoder-Bundlevergleich
scheiterte an eingebetteten Pfaden aus einem verlinkten `node_modules`-Verzeichnis.
Nach Normalisierung waren die generierten Dateien identisch. Eine lokale Kopie
des unveränderten Responses-Pakets korrigierte den Pfad, ohne Anwendungscode,
Paketversionen oder Assertions zu verändern. Der folgende Gesamtlauf verwendete
einen einzelnen Worker mit dem bestehenden 1-GiB-Recyclingbudget.

## Browser und frühere Testlücken

Am Stand d2f20a1a5 bestand `manual-preparation.cy.ts` dreimal mit jeweils 28 Tests,
ohne Retries und ohne übersprungene Tests. Die drei Backend-Suites mit sechs früher
permanent übersprungenen Fällen liefen mit 136 bestandenen Tests und null Skips.
Die übrigen früheren Skips sind separat aktivierte Integrationstests und ein optionaler
Benchmark; ein übersprungener Unit-Test wird nicht als bestanden verbucht.

Reproduzierbare Backend-Prüfungen auf einer isolierten Testumgebung:

```sh
npx nx run backend:typecheck
npx nx lint backend
npx nx test backend --maxWorkers=1
# Startet einen eigenen lokalen Redis; benötigt redis-server:
npx nx run backend:verify-bullmq-live
# Benötigt ausdrücklich benannten, entbehrlichen PG-Testserver und Test-Redis:
npx nx run backend:test-integration
npx nx build backend --configuration=production
```

`backend:test-integration` verlangt `BACKEND_INTEGRATION_TEST_DATABASE_URL`,
`BULLMQ_TEST_REDIS_HOST` und `BULLMQ_TEST_REDIS_PORT`; es erstellt und entfernt eine
eigene Testdatenbank. Keine Anwendungsinstanz als entbehrlichen Testserver verwenden.
Das vollständige lokale technische Archiv enthält eingefrorene Bundle- und
Harness-Prüfsummen, JSON-Einzelergebnisse, Beobachterdaten und Prozessprotokolle.
Zugangsdaten und Rohdaten werden nicht in diesem Bericht veröffentlicht.

## Offen vor Freigabe

1. Listen- und kalte Facettenlaufzeiten anhand getrennter Daten-/Count-Pläne und
   I/O-Messwerte weiter eingrenzen und die vereinbarten Ziele nachweisen.
2. Den endgültigen Stand vollständig mit 10 Nutzern/30 Minuten, 20 Nutzern/5 Minuten,
   parallelem Schreiben/Exportieren und nachgewiesener Erholung qualifizieren.
   Dazu ist eine Umgebung mit dauerhaft ausreichender interner Speicherreserve nötig.
3. CI am endgültigen PR-Head abschließen und Ergebnisse diesem Head zuordnen.
4. Deployment, Wartungsfenster und fachliche Abnahme separat entscheiden.
   PostgreSQL-/TypeORM-Hauptversionswechsel und historische Nullbarkeitsabweichungen
   bleiben eigene Architekturarbeiten.

## Zusätzlicher Befund aus dem vollständigen Lauf r12

Der produktionskonform konfigurierte Lauf am Vorgänger `9d18415d0` wurde vollständig
ausgeführt: 30 Minuten mit zehn Nutzern, fünf Minuten mit 20 Nutzern und fünf
Minuten Erholung. 3.454 Aufrufe enthielten 39 Fehler, alle in der Lastspitze.
Listen-p95: 18,060 Sekunden bei zehn Nutzern, 30,005 Sekunden in der Spitze. Die
vereinbarten Ziele wurden damit verfehlt. Datenbank und alle zusätzlich erfassten
Queuezustände erholten sich; der vollständige Export und die ursprünglichen
Inhaltsprüfsummen blieben korrekt.

Nach dem Spitzenlast-Import fehlte dessen neue Gruppe in den Filteroptionen,
obwohl alle Fixture-Zeilen gespeichert waren. Der Lasttest protokollierte zuvor
einen Pool-Wartezeitfehler beim Lesen der optionalen Vorher-Statistik. Dadurch war
`overviewPending` bereits wahr; `overviewPending || await invalidate(...)`
übersprang anschließend die notwendige Invalidierung vollständig. Dieser Fehler
besteht bereits am PR-Basisstand und ist kein durch die Cache-Generationen
eingeführter Fehler.

Dieser Änderungsstand ruft die Invalidierung unabhängig vom Statistik-Warnstatus
auf und berücksichtigt auch deren expliziten Fehlerwert. Zwei Regressionen
belegen vor der Korrektur das Überspringen bzw. den übersehenen Fehlerwert.
Die Warnung bei unzuverlässiger Statistik und der Erhalt gespeicherter Daten
bleiben bestehen. Die Ergebnisse von r12 werden dem Vorgänger zugerechnet; der
Folgestand benötigt seinen eigenen Nachweis unter dem korrigierten Lastprofil.
