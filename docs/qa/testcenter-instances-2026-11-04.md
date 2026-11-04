# Technischer Prüfbericht: Testcenter-Freigaben und Anmeldung

Stand: 4. November 2026. Grundlage ist PR #1154, Ausgangsstand
`3c77f8b94f7d0fd94c9a3b00be7cf8716bb3e8db`.

## Verfügbarkeit und Umfang

Die Erweiterung ergänzt die laufende PR. Eine Veröffentlichung, ein Deployment
auf einer benannten Instanz und eine fachliche Abnahme sind damit nicht belegt.
Die [Bedienungsanleitung](../testcenter-instances-de.md) beschreibt den neuen
Ablauf anhand der sichtbaren Beschriftungen und der Anwendungsquellen.

- Systemadministratoren speichern zusätzliche benannte HTTPS-Instanzen in der
  bestehenden Einstellungstabelle. Keine neue Datenbankmigration ist nötig.
- Angemeldete Importnutzer können die freigegebenen Instanzen abrufen. Nur
  Systemadministratoren können Freigaben hinzufügen, umbenennen, aufheben und
  den Verbindungstest ausführen.
- Anmeldungen und nachfolgende Import-/Downloadanfragen lesen die aktuelle
  Freigabe. Es gibt keinen nur pro API-Replik gültigen Freigabecache. Dynamische Freigaben werden pro externem
  Abruf über einen exakten Primärschlüssel gelesen; große Einstellungstabellen
  werden nicht für jede Datei vollständig abgefragt.
- Ein Verbindungstest fordert ausschließlich `/api/version` an. Er begrenzt
  Laufzeit und Antwortgröße, folgt keiner Weiterleitung und meldet eine
  Erreichbarkeit nur bei einer gültigen Versionsantwort. Ein SPA-HTML-Dokument
  mit HTTP 200 gilt nicht als Erfolg.
- Bei einer ausdrücklich geforderten Admin-Challenge wird der offizielle
  Testcenter-Ablauf aus `POST /api/session/challenge` und `PUT /api/session` verwendet.
  Die bisherige direkte Anmeldung bleibt erhalten. Fehlerhafte Zugangsdaten,
  Weiterleitungen und gewöhnliche Netzwerk-/Serverfehler werden nicht erneut
  mit einem anderen Anmeldeverfahren versucht.
- Hashalgorithmus, Eingabegrößen, maximale Versuche, Rechenzeit und gleichzeitige
  Challenge-Lösungen sind begrenzt. Zertifikatsprüfung und Umleitungssperre gelten
  auch für die zusätzlichen Anmeldeschritte.

## Ausgeführte Prüfungen

Offene Fälle wurden nicht als bestanden gewertet. Die lokalen Testläufe sind
von einer fachlichen Abnahme und einem Deployment getrennt zu betrachten.
Die folgende Tabelle dokumentiert die ursprüngliche Erweiterung bis
`d1eec77aa`; die anschließenden Reviewkorrekturen und ihre Nachprüfungen sind
darunter gesondert aufgeführt.

| Prüfung | Stand |
| --- | --- |
| Gezielte Backend-Regressionssuite einschließlich HTTP-Rechtegrenze, TLS, Prüfclient, Controllerimporten und Bundle-Abgleich | 147 Tests bestanden; sechs optionale Datenbanktests nicht ausgeführt. |
| Vollständige Backend-Suite | 268 Suites / 4.331 Tests bestanden; 19 optionale Suites beziehungsweise 162 Umgebungstests übersprungen. |
| Backend-Lint | Bestanden. |
| Strikte Backend-Typprüfung und Entity-Metadaten | Bestanden, null Typdiagnosen; 43 Entities in CommonJS und ESM geprüft. |
| Backend-Produktionsbuild | Bestanden. |
| Frontend-Lint und vollständige Frontend-Suite | Lint bestanden; 351 Suites / 3.809 Tests bestanden. Nach der visuellen Korrektur des Formularzustands zusätzlich alle drei Einstellungen-Komponententests bestanden. |
| Frontend-Qualitäts- und Übersetzungsgates | 81 Prüfungen bestanden. |
| Frontend-Produktionsbuild und Browserfälle | Produktionsbuild bestanden; alle 16 Cypress-Fälle in Electron bestanden, ohne übersprungene Fälle oder Wiederholungen. Visuelle Prüfung der neuen Einstellungen erfolgt. |
| Reale angemeldete Gegenstellen 17/18/19 | Alle drei offiziellen Backends bestanden: Anmeldung, Gruppen, Unit-Datei, Antwort-/Logabruf und echte Kodierbox-Parser. Falsche Zugangsdaten wurden jeweils auf HTTP 422 abgebildet. |

Die Prüfungen verwenden Node 24.22.1 laut `.nvmrc`. Die Abhängigkeiten wurden
für den abschließenden Backend-Lauf als eigene Kopie im isolierten Arbeitsbaum
eingebunden: Eine Symlink-Einbindung verändert die eingebetteten Modulpfade des
unveränderten Autocoder-Bundles und führt deshalb zu einem falschen Ergebnis beim
Reproduzierbarkeitsvergleich. Der Bundle-Abgleich ist mit der eigenen Kopie
bestanden. Frühere abgebrochene Läufe werden nicht als Gesamtnachweis gewertet.
Die Tabelle dokumentiert lokale Ergebnisse; ein erfolgreicher Remote-CI-Lauf für
den ergänzten PR-Stand ist damit noch nicht belegt.

## Nachprüfung der Reviewkorrekturen

Die folgende Nachprüfung gehört zum Korrekturstand `555524635`. Der anschließende
Abgleich mit dem weitergelaufenen `develop` wird gesondert dokumentiert.

- **Umbenennen:** Die Oberfläche hält die ausgewählte Basisadresse fest, zeigt
  sie schreibgeschützt an und bietet **Name speichern** sowie **Abbrechen** an.
  Ein veränderter Formularwert kann beim Umbenennen keine zweite Adresse
  freigeben. Wird der gerade bearbeitete Eintrag aufgehoben, wird die Eingabe
  zurückgesetzt.
- **Freigabegrenze:** Prüfung und Speicherung laufen in einer PostgreSQL-
  Transaktion unter einer gemeinsamen, transaktionsgebundenen Advisory-Sperre.
  Auch Widerrufe verwenden dieselbe Sperre. Die Abfragen innerhalb der Sperre
  verwenden den Transaktionsmanager. Es wird keine nur pro Backend-Prozess
  wirksame Sperre eingesetzt; eine Datenbankmigration ist nicht erforderlich.
  Zum Sperrverhalten siehe die [PostgreSQL-Dokumentation](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS).
- **Fehlermeldungen:** Die Testcenter-Anmeldung meldet erwartete Fehler lokal im
  Dialog. Die zusätzliche globale Anzeige entfällt auch bei HTTP 403. HTTP 401
  führt weiterhin zur erneuten Anmeldung an der Kodierbox. Die Prüfungen verwenden
  den echten HTTP-Service zusammen mit dem Auth-Interceptor.

| Nachprüfung | Stand |
| --- | --- |
| Backend-Service, HTTP-Rechtegrenze und PostgreSQL-Konkurrenzfälle | 17 Tests bestanden; davon vier mit PostgreSQL 18.4 und zwei getrennten Verbindungspools. |
| Vollständige Frontend-Suite | 351 Suites / 3.821 Tests bestanden. |
| Frontend-Regressionssuite nach Extraktion der Auth-Prädikate | Alle 118 Tests in fünf betroffenen Suites bestanden; einschließlich HTTP 401 und unveränderter globaler Fehlerbehandlung für andere Anfragen. |
| Backend-Lint, strikte Typprüfung und Produktionsbuild | Bestanden; null Typdiagnosen und übereinstimmende CommonJS-/ESM-Metadaten für 43 Entities. |
| Frontend-Lint und Übersetzungsgates | Bestanden; 81 Qualitäts- und Übersetzungsprüfungen. Die bisherigen Struktur-Ausnahmen des Auth-Interceptors konnten entfernt werden. |
| Aktueller Frontend-Produktionsbuild und erweiterte Browserfälle | Bestanden; alle 16 Cypress-Fälle ohne Wiederholungen oder übersprungene Fälle. Zusätzlich geprüft: URL-Sperre beim Umbenennen, Abbrechen, Widerruf während einer Bearbeitung und keine globale Doppelmeldung bei HTTP 403/422. Neue Umbenennungsansicht visuell geprüft. |

Die vier Datenbankfälle prüfen den letzten freien Platz bei zwei gleichzeitigen
Freigaben (99 → genau 100), gleichzeitige Änderungen derselben Adresse ohne
Duplikate, Umbenennen bei voller Liste und Wiederverwendung eines aufgehobenen
Platzes sowie Rollback und Freigabe der Sperre nach einem Schreibfehler.

Zur Wiederholung einen eigenen, entbehrlichen PostgreSQL-Testserver verwenden.
Beispiel mit ausschließlich synthetischen Zugangsdaten und freiem lokalen Port:

```sh
docker run -d --name tc-approval-tests --memory=512m \
  --tmpfs /var/lib/postgresql \
  -e POSTGRES_DB=testcenter_approvals -e POSTGRES_USER=fixture \
  -e POSTGRES_PASSWORD=fixture-only-password \
  -p 127.0.0.1:55435:5432 postgres:18.4
docker exec tc-approval-tests pg_isready -U fixture -d testcenter_approvals
```

Erst wenn `pg_isready` die Verbindung annimmt, mit Node laut `.nvmrc` ausführen:

```sh
POSTGRES_INTEGRATION_TESTS=true POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55435 \
POSTGRES_USER=fixture POSTGRES_PASSWORD=fixture-only-password \
POSTGRES_DB=testcenter_approvals NX_DAEMON=false \
npx nx run backend:test --runInBand \
  '--testMatch=**/testcenter-instances.postgres.spec.ts'
docker stop tc-approval-tests
```

Erwartet: vier ausgeführte, bestandene Tests und keine übersprungenen Fälle.
Die Suite legt ein eigenes Schema an und entfernt nur dieses Schema. Die
Testdatenbank liegt im Arbeitsspeicher des separat angelegten Containers.

## Abgleich mit dem aktuellen develop

Nach dem Push der Korrekturen wurde `develop` bis `7a4197c5b` übernommen. Die
Importkonflikte betrafen die dort bereits gemergte Backend-ESM-Umstellung:
`FormData` verwendet den Default-Import; der Interface-Import für den
Workspace-Dateileser ist nun im ausgelagerten Autocoder-Schema-Service als
Typimport markiert. Die Integrationsgrenzen und Reviewkorrekturen bleiben
Bestandteil des zusammengeführten Stands.

| Nachprüfung nach dem Abgleich | Stand |
| --- | --- |
| Testcenter, Content-Pool, Autocoder-Schema und -Prozess sowie Modul-/Controller-Regressionen | 162 Tests bestanden; zwölf umgebungsabhängige Fälle in diesem Lauf übersprungen. |
| PostgreSQL-Freigaben mit getrennten Verbindungspools | Alle vier Fälle anschließend mit PostgreSQL 18.4 ausgeführt und bestanden; keine übersprungenen Fälle. |
| Produktionsbuild als `main.mjs` | Bestanden. |
| Native ESM-Importe | ZIP-, XLSX-, Multipart-, Archiv- und SQLite-Roundtrips mit den vorhandenen lokalen Abhängigkeiten bestanden. Zusätzlich Autocoder-Namespace, leere Kodierung und Schema-Konstruktor nativ geprüft. |
| Backend-Lint und strikte Typ-/Metadatenprüfung | Bestanden; null Typdiagnosen und weiterhin 43 Entities in beiden Importreihenfolgen geprüft. |
| Betroffene Frontend-Suites und Qualitätsgates | 118 Tests in fünf Suites, alle 81 Qualitäts-/Übersetzungsprüfungen und Frontend-Lint bestanden. |
| Neuer Frontend-Build und Testcenter-Browserfälle | Produktionsbuild und erneut alle 16 Browserfälle bestanden, ohne übersprungene Fälle oder Wiederholungen. |

## Versionsaussage und Grenzen

Die Quellprüfung wurde an den Testcenter-Tags 17.6.1, 18.3.1 und 19.0.1
durchgeführt. Admin-Anmeldung, Arbeitsbereichsgruppen, Dateiliste, Dateiabruf
sowie Antwort- und Logberichte besitzen die von der Kodierbox verwendeten
Endpunkte. Seit 18.2 kann der Admin-Challenge-Schutz die direkte Anmeldung
abweisen. Das wird durch die Erweiterung berücksichtigt.

| Version | Quellvergleich | Echter angemeldeter Abruf und Parser |
| --- | --- | --- |
| 17.6.1 | Direkte Anmeldung und benötigte Endpunkte vorhanden | Bestanden, direkte Anmeldung |
| 18.3.1 | Benötigte Endpunkte und Challenge-Anmeldung geprüft | Bestanden, Challenge-Schutz aktiviert |
| 19.0.1 | Benötigte Endpunkte und Challenge-Anmeldung geprüft | Bestanden, Challenge-Schutz aktiviert |

Nach dem Neustart von Docker Desktop wurden die offiziellen Backend-Images mit
eigenen lokalen Datenbanken und vorbereiteten synthetischen Daten geprüft. Für
17/18 lief MySQL 8.4, für 19 PostgreSQL 18.4. Die Backend-Images liefen als
Linux/amd64 unter Docker-Desktop-Emulation, der Prüfclient mit Node 24.22.1 auf
macOS/arm64. Die Protokollierung am lokalen Gateway bestätigte für 18/19 die
Abfolge `PUT /session/admin` → HTTP 400, `POST /session/challenge` → HTTP 200,
`PUT /session` → HTTP 200. Version 17 meldete sich direkt erfolgreich an.

Jede Version lieferte eine Antwortzeile und zwei Logzeilen. Die Kodierbox-Parser
behielten eine Antwort und drei Log-/Sitzungseinträge; es gab keine Parserfehler
oder -warnungen. Ein gesonderter negativer Anmeldeversuch pro Version ergab
HTTP 422 für das falsche Testkennwort.

Die [maschinenlesbaren Zähler und Image-Digests](testcenter-compatibility-2026-11-04.json)
halten den geprüften Stand fest. Die [isolierten Fixtures und Befehle](../../scripts/qa/testcenter-fixtures/README.md)
ermöglichen die Wiederholung. Die Gegenstellen wurden nur über einen lokalen
HTTP-Gateway angesprochen; Zertifikatsvertrauen wurde in den separaten
HTTPS-Regressionen geprüft. Das ist keine Prüfung produktiver Konten oder ein
Nachweis der Speicherung in der Kodierbox-Datenbank.

Der eigenständige Prüfclient wurde außerdem mit echten lokalen HTTP-Anfragen
gegen drei synthetische API-Generationen geprüft: direkte Anmeldung,
Challenge-Anmeldung, Gruppen, Dateien und Antwort-/Logparser. Die Rückgaben werden
auf nicht leere Daten geprüft, ohne Zugangsdaten oder Antwortzeilen auszugeben.
Diese automatisierten Regressionen verwenden synthetische Gegenstellen. Sie sind
kein Nachweis, dass konkrete produktive Konten, Arbeitsbereiche und Testdaten
erreichbar sind. Ältere Hauptversionen wurden nicht allgemein freigegeben.
Die im Testcenter verwendete ALTCHA-Version 1.3.3 setzt die maximale Zahl auf
1.000.000 und prüft den Hash aus Salt und Zahl. Das wurde gegen deren
[gebundenen Quellstand](https://github.com/altcha-org/altcha-lib-php/blob/9a9b98c48dea0b2e8c353ea991d5f5627cbdab36/src/BaseChallengeOptions.php)
und die Implementierung von `createChallenge`/`verifySolution` verglichen.
Der öffentliche Abruf von `/api/version` auf Testcenter 2 meldete während dieser
Arbeit 19.0.1; er belegt keinen Datenzugriff.

Quellen: [Testcenter 18.2](https://github.com/iqb-berlin/testcenter/releases/tag/18.2.0),
[Anmeldung 19.0.1](https://github.com/iqb-berlin/testcenter/blob/19.0.1/backend/src/controller/SessionController.class.php),
[Admin-API 17.6.1](https://github.com/iqb-berlin/testcenter/blob/17.6.1/docs/api/workspace.spec.yml),
[Admin-API 18.3.1](https://github.com/iqb-berlin/testcenter/blob/18.3.1/docs/api/workspace.spec.yml),
[Admin-API 19.0.1](https://github.com/iqb-berlin/testcenter/blob/19.0.1/docs/api/workspace.spec.yml).

## Wiederholbarer Abruf- und Parsernachweis gegen echte Instanzen

Voraussetzungen: Node laut `.nvmrc`, installierte Abhängigkeiten und ein
abgesprochener Test-Arbeitsbereich mit Lesekonto, mindestens einer gestarteten
Testgruppe, gespeicherten Antworten und Logs sowie einer Unit-Datei. Pro
Testcenter-Version einen eigenen Lauf ausführen. Ein leeres Konto oder eine leere
Testgruppe darf nicht als erfolgreiche Kompatibilitätsprüfung gewertet werden.

Das Kennwort lokal in der Shell eingeben; es gehört nicht in Git oder einen
gemeinsam genutzten Bericht. Beispiel für zsh, mit tatsächlich vorbereiteten
Werten ersetzen:

```sh
read -rs 'TESTCENTER_LIVE_PASSWORD?Testcenter-Kennwort: '
export TESTCENTER_LIVE_PASSWORD
TESTCENTER_LIVE_URL=https://testcenter.example.org/tci \
TESTCENTER_LIVE_USERNAME=testkonto \
TESTCENTER_LIVE_WORKSPACE=12 \
TESTCENTER_LIVE_GROUP=vorbereitete-testgruppe \
npx nx run backend:verify-testcenter-live
unset TESTCENTER_LIVE_PASSWORD
```

Bei einer privaten CA `NODE_EXTRA_CA_CERTS` vor dem Start auf die geprüfte
PEM-Datei setzen. Zertifikatsfehler werden nicht umgangen.

Erwartet: Exit-Code 0 und eine JSON-Zusammenfassung mit der gemeldeten Version,
`authenticated`, `groupFound` und `fileDownloaded` jeweils `true`, positiven
Antwort-/Logzahlen sowie `parsedResponses > 0` und `parsedLogs > 0`. Der Client verwendet die echte
Kodierbox-Anmeldung und den echten Antwort-/Logparser. Er gibt nur Zähler aus;
keine Zugangsdaten, Challenge-Salts, Tokens oder Antwortzeilen werden gespeichert.
Parserwarnungen müssen anhand der vorbereiteten Testdaten bewertet werden.

Dieser Client schreibt keine Ergebnisse in die Kodierbox-Datenbank
(`persistedToCodingBox: false`). Den vollständigen Import einschließlich
Persistenz anschließend in einem vereinbarten Testbereich prüfen und das
tatsächliche Ergebnis separat dokumentieren. Dieser Nachweis der Speicherung und
die fachliche Abnahme bleiben offen.

## Betriebsgrenzen

Die Freigabeliste vertraut der Systemadministration beziehungsweise der
Betreiberkonfiguration. Sie ersetzt keine ausgehenden Netzwerkregeln und prüft
oder bindet DNS-Ziel-IP-Adressen nicht gesondert. Eine solche zusätzliche
Netzwerkabsicherung ist nicht als implementiert ausgewiesen. HTTP-Ausnahmen
bleiben der ausdrücklich gesetzten Betreiberkonfiguration vorbehalten.
