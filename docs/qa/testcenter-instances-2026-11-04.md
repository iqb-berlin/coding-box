# Technischer Prüfbericht: Testcenter-Freigaben und Anmeldung

Stand: 4. November 2026. Grundlage ist PR #1154, Ausgangsstand
`3c77f8b94f7d0fd94c9a3b00be7cf8716bb3e8db`.

## Verfügbarkeit und Umfang

Die Erweiterung ergänzt die laufende PR. Eine Veröffentlichung, ein Deployment
auf einer benannten Instanz und eine fachliche Abnahme sind damit nicht belegt.
Die [Bedienungsanleitung](../testcenter-instances-de.md) beschreibt den neuen
Ablauf anhand der sichtbaren Beschriftungen und der Anwendungsquellen.

- Systemadministratoren speichern zusätzliche benannte HTTP-/HTTPS-Instanzen in der
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

## Nachprüfung des fehlgeschlagenen CI-Browsertests

Im Job [test-browser #499761](https://scm.cms.hu-berlin.de/iqb/coding-box/-/jobs/499761)
der Pipeline #107269 am Stand `d1eec77aa` scheiterten alle fünf Fälle in
`cypress/component/test-center-import.component.cy.ts` beim Initialisieren:
`this.backend.getTestcenterInstances is not a function`. Der vorhandene
Backend-Mock war noch leer, obwohl der Importdialog inzwischen die freigegebenen
Instanzen lädt. Die übrigen 32 Komponententests dieses Jobs waren erfolgreich.
Die bisherigen 16 Testcenter-Browserfälle gehören zu einer anderen Suite und
hatten diesen veralteten Komponenten-Mock nicht ausgeführt.

Der Mock liefert jetzt eine leere Instanzliste über ein Observable. Sein
Rückgabevertrag wird mit `Pick<UserBackendService, 'getTestcenterInstances'>`
typisiert. Anwendung und Fehlerbehandlung werden unverändert ausgeführt;
keiner der fünf Fälle wird übersprungen oder abgeschwächt.

Mit Node 24.22.1 und Cypress 15.21.1 erneut lokal ausgeführt:

```sh
NX_DAEMON=false npx nx run frontend:component-test --browser=electron
```

Ergebnis: alle elf Specs mit insgesamt 37 Tests bestanden, einschließlich der
fünf zuvor fehlgeschlagenen Importfälle; keine Wiederholungen, übersprungenen
oder ausstehenden Fälle. Der lokale Erfolg ersetzt den noch ausstehenden
Remote-CI-Nachweis für den korrigierten Stand nicht.

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
Netzwerkabsicherung ist nicht als implementiert ausgewiesen. HTTP-Freigaben
können auch in der Systemadministration angelegt werden; Formular und gespeicherte
Einträge weisen ausdrücklich auf die unverschlüsselte Übertragung hin.

## Nachprüfung der Freigaben und Prozessübersicht (2026-11-09)

Die IQB-Adressen sind jetzt anfängliche Freigaben: Sie können umbenannt, nach
Bestätigung installationsweit aufgehoben und erneut freigegeben werden. Die
Sperrmarkierung liegt in der vorhandenen Einstellungstabelle. Sie bleibt nach
Neustarts und zwischen API-Replikaten wirksam. Nur ausdrücklich vom Betreiber
konfigurierte Einträge bleiben schreibgeschützt und haben Vorrang. Die
Importauswahl stellt aufgehobene IQB-Adressen nicht mehr fest eingebaut bereit.

Der Challenge-Login prüft die Freigabe vor beiden Folgeanfragen erneut. Die
Prozessübersicht zeigt Content-Pool-Aufträge mit numerischem Fortschritt,
übersetztem Vorgang, Paket-ID und gegebenenfalls Dateianzahl. Bei
Administrationsfehlern werden sichere Diagnosecodes in deutsche Handlungsanweisungen
übersetzt. Die globale Fehlerbehandlung gibt ausschließlich die festgelegten
Testcenter-Diagnosen frei; Antworten, URLs und Zugangsdaten der Gegenstelle
werden nicht als Fehlerdetails offengelegt.

Prüfumgebung: Node 24.22.1 gemäß `.nvmrc`. Die Datenbankprüfung lief mit einem
separat initialisierten, temporären PostgreSQL 14 auf Loopback-Port 55454 und
zwei unabhängigen Verbindungspools. Dieser Server wurde anschließend gestoppt.
Es wurden keine Anwendungsdatenbanken verändert.

Reproduzierbare Prüfungen im Repository, jeweils einzeln auszuführen:

```sh
NX_DAEMON=false npx nx run backend:test --runInBand \
  '--testMatch=**/{testcenter*,content-pool*,job-queue.service,global-http-exception.filter}.spec.ts'

# Voraussetzung: ausschließlich eine leere, separate PostgreSQL-Testdatenbank.
POSTGRES_INTEGRATION_TESTS=true POSTGRES_HOST=127.0.0.1 \
POSTGRES_PORT=55454 POSTGRES_USER=fixture POSTGRES_DB=postgres \
NX_DAEMON=false npx nx run backend:test --runInBand \
  '--testMatch=**/testcenter-instances.postgres.spec.ts'

NX_DAEMON=false npx nx run frontend:test --runInBand \
  '--testMatch=**/{testcenter-settings.component,test-center-import.component*,test-center-instance-selection,process-overview.component,user-backend.service,auth.interceptor}.spec.ts'
NX_DAEMON=false npx nx lint frontend
NX_DAEMON=false npx nx run frontend:test-quality-gates
NX_DAEMON=false npx nx build frontend --configuration=production
NX_DAEMON=false npx nx e2e frontend --configuration=ci \
  --spec=cypress/zoneless/testcenter-import.cy.ts --browser=electron
NX_DAEMON=false npx nx run frontend:component-test \
  --spec=cypress/component/test-center-import.component.cy.ts --browser=electron
NX_DAEMON=false npx nx lint backend
NX_DAEMON=false npx nx run backend:typecheck
NX_DAEMON=false npx nx build backend --configuration=production
```

Die Browserfälle verwenden synthetische Daten und simulierte API-Antworten.
Sie ersetzen keinen vollständigen Testcenter-Import mit Speicherung und keine
fachliche Abnahme. Der Änderung ist kein Release oder Deployment zugeordnet.

Ergebnisse der Nachprüfung:

| Prüfung | Ergebnis |
| --- | --- |
| Gezielte Backend-Regressionssuite einschließlich globalem Fehlerfilter und Prozessübersicht | 17 Suites / 226 Tests bestanden; 13 optionale Umgebungstests übersprungen. |
| Separate PostgreSQL-Prüfung der Freigaben | Alle fünf Tests bestanden; darunter Widerruf/Wiederfreigabe einer IQB-Adresse über getrennte Verbindungspools und bestehende Konkurrenz-/Kapazitätstests. Diese fünf Fälle waren im vorgenannten Lauf übersprungen. |
| Gezielte Frontend-Regressionssuite | Sieben Suites / 136 Tests bestanden. |
| Frontend-Qualitäts- und Übersetzungsgates | Alle 90 Prüfungen bestanden. |
| Frontend- und Backend-Lint, jeweils separat | Bestanden. |
| Strikte Backend-Typprüfung und Entity-Metadaten | Bestanden; CommonJS/ESM stimmen für 43 Entities und beide Importreihenfolgen überein. |
| Frontend- und Backend-Produktionsbuild, jeweils separat | Bestanden. |
| Testcenter-/Content-Pool-Browserfälle in Electron | Alle 18 Fälle bestanden, ohne Wiederholungen, übersprungene Fälle oder Fehler. Die Prozessübersicht und der Bestätigungsdialog wurden anhand der erzeugten Screenshots visuell geprüft. |
| Betroffene Cypress-Komponentensuite | Alle fünf Importfälle bestanden, ohne Wiederholungen oder übersprungene Fälle. |

Der erste Browserlauf wurde wegen eines falsch gewählten Screenshot-Elements
und eines fehlenden Fokus auf dem Eingabefeld korrigiert. Der abschließende
vollständige Lauf bestand alle Fälle. Die lokalen Cypress-Berichte entstanden
im Arbeitsstand vor dem Commit; sie sind kein Nachweis einer Remote-CI für den
anschließend gepushten Commit. Frühere Prüfstände in diesem Bericht bleiben
historische Nachweise für die jeweils genannten Stände.

## Kritische Nachprüfung der Verwaltungsaktionen (2026-11-09)

Die Nachprüfung von `7997c64e5` fand einen weiteren P2-Fehler: Während die
Freigabeliste erneut geladen oder eine Verbindung geprüft wurde, konnten
Freigaben weiter verändert werden. Eine ältere Antwort konnte dadurch eine
inzwischen aufgehobene Freigabe erneut in der Oberfläche anzeigen oder einen
überholten Verbindungsstatus hinterlassen. Die Backend-Freigabeprüfung wurde
dadurch nicht umgangen.

Die Verwaltung führt Laden, Prüfen, Speichern, Umbenennen und Widerrufen jetzt
gegenseitig ausschließend aus. Eingabefelder und Aktionen spiegeln denselben
Zustand wider; auch die Methoden selbst weisen konkurrierende Aufrufe ab. Zwei
neue Regressionstests schlugen vor der Korrektur fehl. Der Browserfall hält die
HTTP-Antworten über die vorhandenen lokalen Test-Gates bis nach den
Sperrprüfungen zurück, ohne eine feste Antwortverzögerung vorauszusetzen.

Der vollständige Frontendlauf umfasste 354 Suites und 3.883 Tests: 353 Suites
beziehungsweise 3.882 Tests bestanden. Eine neue Testassertion musste korrigiert
werden, weil der Neuladen-Knopf bei Beginn des Ladens korrekt aus dem DOM
entfernt wird. Anschließend bestanden alle sieben betroffenen Suites mit
138 Tests, einschließlich aller 15 Verwaltungsfälle. Es gab im vollständigen
Lauf keine weiteren Fehler. Die Ergebnisse werden hier getrennt ausgewiesen.

Die Pipeline für `7997c64e5` ist
[GitLab #107867](https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/107867).
GitHub-CodeQL und die GitHub-Analyse waren bei der Nachprüfung erfolgreich.
GitLab-Anwendungsbuild, Datenbankprüfung, Lint und Backend-Integration waren
erfolgreich; weitere Jobs liefen noch. Dies ist kein Abschlussnachweis für
diese Pipeline oder für einen nachfolgenden Commit.

Abschließend bestanden Frontend-Lint, Produktionsbuild und alle 18 Browserfälle
erneut, ohne Wiederholungen oder übersprungene Fälle. Die beiden neuen
Nebenläufigkeitsprüfungen verwenden kontrolliert freigegebene HTTP-Antworten.
Backend-Code und API-Verträge wurden bei dieser Korrektur nicht geändert.
Im laufenden GitLab-Job waren außerdem strikte Backend-Typprüfung,
Entity-Metadaten, Laufzeitpaketprüfung sowie die Tests für CodingProcessService
bereits erfolgreich; der gesamte Backend-Testlauf war noch nicht beendet.

## Abschlussprüfung der Pipeline und Inventarkorrektur (2026-11-09)

Die [GitLab-Pipeline #107919](https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/107919)
für `c44b7f98b` endete mit 19 erfolgreichen und einem fehlgeschlagenen Job.
CodeQL und die GitHub-Analyse waren erfolgreich. Der fehlgeschlagene
[Frontendjob #502425](https://scm.cms.hu-berlin.de/iqb/coding-box/-/jobs/502425)
bestand zuerst alle 354 Suites und 3.883 Tests sowie die 90 Qualitätsprüfungen.
Er scheiterte danach an `frontend:zoneless-inventory-test`: Das generierte
Inventar enthielt für die letzten UI-Korrekturen noch 18 veraltete oder fehlende
Fingerprints und einen entfallenen Eintrag. Der Fehler war lokal mit
`NX_DAEMON=false npx nx run frontend:zoneless-approval` reproduzierbar.

Das Inventar wurde mit
`NX_DAEMON=false npx nx run frontend:zoneless-inventory --update` neu erzeugt
und gegen die Quelländerungen geprüft. Die Änderungen betreffen die
Testcenter-Verwaltung, den Testcenter-Import, den Instanzdienst und die
Prozessübersicht; weitere Änderungen aktualisieren Zeilennummern und die
Referenzen auf den bestehenden Bestätigungsdialog. Die Inventareinträge bleiben
offen; die Aktualisierung stellt keine vollständige Einzelabnahme dar.
Prüfregeln und Anwendungscode bleiben unverändert.

Danach bestanden separat `frontend:zoneless-inventory-test` (beide Tests),
`frontend:zoneless-approval` und `frontend:e2e-coverage`. Der zuvor gestartete
lokale vollständige Frontendlauf für `c44b7f98b` bestand ebenfalls alle
354 Suites und 3.883 Tests. Für den Commit mit der Inventarkorrektur ist eine
neue Remote-Pipeline erforderlich; ihr Ergebnis wird getrennt nachgeführt.

## Entfernung des abgeschlossenen Migrationsinventars (2026-11-09)

Nach der Nachfrage zum dauerhaften Nutzen entfällt das generierte
Zoneless-Inventar vollständig: Die Migration ist im normalen Bootstrap, in Jest
und in den Cypress-Komponententests aktiv. Das Inventar verglich ausschließlich
Quell-Fingerprints; alle 10.826 Einzelprüfungen standen weiterhin auf `open`.
Es lieferte keinen zusätzlichen Verhaltensnachweis, verlangte aber bei jeder
UI-Änderung eine Neuerzeugung.

Entfernt wurden `zoneless-coverage.json`, Generator und Inventartests sowie die
vier zugehörigen Nx-Targets und die beiden Aufrufe im GitLab-Frontendjob.
Historischer Audit und Risikomatrix bleiben als Dokumentation erhalten;
aktuelle Arbeitsanweisungen kennzeichnen die entfernten Befehle als historisch.
Die Anwendungs- und Regressionstests, Zone.js-Schutzprüfungen, Coverage-Grenzen,
Browser-, Login-, Replay- und Workflowprüfungen bleiben aktiv. Die bestehende
CI-Konfigurationsprüfung kontrolliert zusätzlich, dass keine Inventar-Targets
mehr erforderlich sind und die E2E-Planprüfung weiterhin aufgerufen wird.

Für diese Bereinigung bestanden alle 90 Qualitätsprüfungen, Frontend-Lint und
der Produktionsbuild. Anwendungscode und Jest-/Cypress-Testauswahl wurden nicht
geändert. Der neue Remote-Lauf ist separat bis zum Abschluss zu prüfen; die
vorherige Inventarkorrektur `999a0d928` ist dadurch überholt.

## Abschluss von Pipeline #107947 und Parser-Testkorrektur (2026-11-09)

[Pipeline #107947](https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/107947)
für `d99810cb9` endete nach rund 39 Minuten mit 17 erfolgreichen Jobs, einem
fehlgeschlagenen Backendjob und einem deshalb übersprungenen Frontendjob.
CodeQL und die GitHub-Analyse waren erfolgreich. Browser-, Live-Login-, Replay-,
Workflow-, Datenbank-, Integrations-, Build-, Lint- und Auditprüfungen bestanden.

[Backendjob #502460](https://scm.cms.hu-berlin.de/iqb/coding-box/-/jobs/502460)
scheiterte ausschließlich an `codebook-image-security.spec.ts`: Der mit
`spawnSync` gestartete Node-Prozess erreichte das gemeinsame Fünf-Sekunden-Limit
für Prozessstart, Modulauflösung und Parserprüfung (`ETIMEDOUT`). Die bestehende
Prüfung bestand lokal unverändert; das alte Protokoll unterscheidet die Phasen
nicht und belegt daher keinen tatsächlichen Parser-Hänger.

Die Korrektur verwendet einen isolierten Kindprozess mit Bereitschaftsmeldung.
Prozess-/Modulinitialisierung bleiben auf 30 Sekunden begrenzt. Erst danach
startet die eigentliche Parserprüfung mit unverändertem Fünf-Sekunden-Watchdog;
eine Endlosschleife wird per `SIGKILL` beendet. Fehler und unerwartete
Prozessabbrüche lassen die Prüfung weiterhin fehlschlagen. Die reguläre
ICNS-/PNG-Prüfung verwendet weiterhin genau den Parser, den der installierte
Codebook-Generator auflöst.

Vier gezielte Backendtests bestanden: ICNS-/PNG-Verhalten, sechs Sekunden
verzögerte Initialisierung, Abbruch eines nicht terminierenden Kindprozesses
und Weitergabe einer fehlgeschlagenen Parserprüfung. Backend-Lint bestand
ebenfalls. Anwendungscode und Abhängigkeiten bleiben unverändert. Der folgende
Remote-Lauf prüft den Gesamtstand; sein Abschluss wird in der PR-Beschreibung
mit Pipeline und Commit festgehalten.


## HTTP-Freigaben in der Oberfläche (2026-11-09)

Systemadministratoren können HTTP- und HTTPS-Adressen jetzt im selben Formular
freigeben. Das Feld heißt **Basisadresse (HTTP oder HTTPS)**. Bei einer
HTTP-Adresse erscheint vor dem Speichern der hervorgehobene Hinweis
**Unverschlüsselte Übertragung (HTTP)**. Derselbe Hinweis bleibt am gespeicherten
Eintrag sichtbar, auch nach einem erfolgreichen Verbindungstest. Er nennt
Kennwort, Sitzungstoken und Testdaten sowie das Risiko des Mitlesens oder
Veränderns auf dem Weg zwischen Kodierbox-Backend und Testcenter. Die
HTTPS-Verbindung zur Kodierbox schützt diesen zweiten Übertragungsweg nicht.

`TESTCENTER_ALLOWED_URLS` ist für HTTP-Freigaben nicht mehr erforderlich.
Ausdrückliche Betreiberkonfiguration bleibt schreibgeschützt. Die übrigen
Regeln bleiben bestehen: nur HTTP(S), keine eingebetteten Zugangsdaten,
Suchparameter oder Fragmente, Freigabe der genauen Basisadresse,
Systemadministrator-Rechte, keine Weiterleitungen und höchstens 100 zusätzliche
Freigaben. Für HTTPS bleibt die Zertifikatsprüfung aktiv.

Geprüfter Anwendungscode: `4cf8e3be1aad755841a101d976b9660fb98b3f15`.
Die Browserergebnisse weisen diesen Commit und `sourceDirty: false` aus.
Der nachfolgende Nachweis ergänzt nur die Dokumentation.

| Prüfung | Ergebnis |
| --- | --- |
| Gezielte Testcenter-Backend-Suite unter Node 24.22.1 | 142 Tests bestanden; zwölf optionale Datenbankfälle zunächst übersprungen. |
| Freigaben mit isoliertem PostgreSQL 14 und zwei getrennten Verbindungspools | Alle sechs Fälle bestanden, einschließlich HTTP-Freigabe, Umbenennen und Widerruf. Die separate Datenbank wurde anschließend entfernt. Die übrigen sechs Import-Recovery-Datenbankfälle wurden nicht erneut ausgeführt. |
| Gezielte Frontend-Suite | Alle 148 Tests in neun Suites bestanden. HTTP ist im Formular gültig, andere Protokolle bleiben ungültig; der Hinweis erscheint bei HTTP und verschwindet bei HTTPS. |
| Backend- und Frontend-Lint | Beide separat bestanden. |
| Frontend-Qualitäts- und Übersetzungsprüfungen | Alle 90 Prüfungen bestanden. |
| Frontend-Produktionsbuild | Bestanden. |
| Cypress gegen den Produktionsbuild in Electron 138 | Alle 19 Browserfälle bestanden; null Fehler, übersprungene Tests oder nach Wiederholung bestandene Fälle. Beide Protokolle durchlaufen Freigabe, Verbindungstest, Umbenennen, Abbrechen und Widerruf. |
| Visuelle Kontrolle | HTTP-Hinweis im Eingabeformular und am gespeicherten Eintrag anhand der Browser-Screenshots geprüft; Text und Hervorhebung sind lesbar. |

Reproduzierbare Befehle aus der Projektwurzel, mit Node 24.22.1 und installierten
Abhängigkeiten. Die Befehle nacheinander ausführen:

```sh
NX_DAEMON=false npx nx run backend:test --runInBand --testPathPatterns=testcenter
NX_DAEMON=false npx nx lint backend

# Ausschließlich eine eigene leere PostgreSQL-Testdatenbank verwenden.
# POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD und POSTGRES_DB
# müssen auf diese Testdatenbank zeigen, niemals auf Anwendungsdaten.
POSTGRES_INTEGRATION_TESTS=true NX_DAEMON=false npx nx run backend:test \
  --runInBand --skipNxCache --testPathPatterns=testcenter-instances.postgres.spec

NX_DAEMON=false npx nx test frontend --runInBand \
  '--testPathPatterns=testcenter-settings|test-center-import|test-center-instance-selection|auth.interceptor|user-backend.service|process-overview'
NX_DAEMON=false npx nx lint frontend
NX_DAEMON=false npx nx run frontend:test-quality-gates
NX_DAEMON=false npx nx build frontend --configuration=production
NX_DAEMON=false npx nx e2e frontend --configuration=ci \
  --spec=cypress/zoneless/testcenter-import.cy.ts --browser=electron --skipNxCache
```

Der Backend-Lauf muss unzulässige Protokolle, URL-Zusätze und fehlende
Administrator-Rechte weiterhin abweisen. Freigegebene HTTP-Adressen müssen
über getrennte Service- und Datenbankverbindungen lesbar sein und nach Widerruf
HTTP 403 erhalten. Die Browserfälle müssen den Warnhinweis vor dem Speichern
und am gespeicherten HTTP-Eintrag sichtbar anzeigen; HTTPS erhält keinen
HTTP-Warnhinweis.

Browserartefakte: `coverage/cypress/browser/results.json` und `junit.xml`.
Die Bilder `testcenter-http-approval-warning.png`,
`testcenter-http-instance-settings.png` und `testcenter-http-instance-rename.png`
entstehen unter `cypress/screenshots/testcenter-import.cy.ts/`.

Die Browser-API-Antworten sind synthetisch. Dieser Nachweis belegt keinen neuen
vollständigen Import mit einem externen Testcenter, kein Deployment und keine
fachliche Abnahme. Die Remote-CI des aktualisierten PR-Stands ist separat zu
bewerten.
