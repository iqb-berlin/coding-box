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
