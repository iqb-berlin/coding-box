# Codebook-Integration vom 17.10.2026

## Gemeinsames Paket

Studio und Kodierbox installieren denselben Entwicklungsbuild:

- Datei: `vendor/iqb-ngx-coding-components-4.1.0-dev.ff15d6d.tgz`
- Quellcommit: `ff15d6d882417db26bc81fc88a09074eab74d57d` aus coding-components PR #251
- SHA-256: `e67c04e07762350cb4ee3b1a70a36bcde0f2ba1c24df1f5a40000346d34fd112`
- Integrität: `sha512-RjXrwSua+T89/XvhyqjmeOYnc/wUXpFMVr5aYGWeluDnHSnP8pTIJDme+mqDFgAJ1MQAIUbuQu7+rlPGhjkrrQ==`

Der Build enthält die Checkbox-Korrektur, die DOCX-Korrektur für explizite
Null-Einzüge sowie die gemeinsamen deutschen Codebook-Texte und Übersetzungshilfen.
Die Quelle wurde mit `npm run build_cc` gebaut. Nur das erzeugte Paketmanifest
bekam die Entwicklungsversionsnummer und `gitHead`, anschließend wurde genau
einmal `npm pack` ausgeführt. Beide Hosts enthalten denselben Tarball.
Versionsnummern im Bibliotheksquellcode und vorhandene Releases bleiben erhalten.
Es wurde kein neuer Alpha-Kandidat, Git-Tag oder Registry-Release erstellt.

Nach `git pull` installiert `npm ci` das eingecheckte Paket. Eine gesonderte
manuelle Installation der Bibliothek ist nicht erforderlich. Das im Studio
gewählte Schemer-HTML bleibt eine separat konfigurierte Anwendung im iframe;
die Bibliotheksaktualisierung ersetzt dieses HTML nicht.

## Übersetzungen

Der Root-Loader führt die deutschen Bibliotheksvorgaben rekursiv mit der eigenen
Sprachdatei zusammen. Eigene Begriffe überschreiben bei Bedarf einzelne Schlüssel.
Die 42 kopierten `codebook.*`-Standardtexte sind aus der Anwendungsdatei entfernt;
anwendungsspezifische Kodier-/Jobtexte bleiben erhalten. Alle Komponenten nutzen
den bestehenden gemeinsamen TranslateService. Es wird kein zweiter Dienst erzeugt.
`mergeTranslations` und `selectTranslationsForLanguage` kommen aus dem
Bibliotheks-Einstieg `@iqb/ngx-coding-components/translations`.
Cache-Busting für die Anwendungsdatei bleibt erhalten.

## Paket- und Exportvergleich

Alle 20 installierten Paketdateien stimmen mit dem gebauten Paket und miteinander
überein. Die Tarball-Integrität stimmt mit beiden Root-Locks überein. Responses
bleibt der gemeinsame Host-Peer 5.3.1. 4.694 Exportpaare über die echten
Studio-/Kodierbox-Adapter ergeben identisches JSON und identische normalisierte
DOCX-Bestandteile. Unveränderte alte Studio-Referenzen werden weiter verglichen;
die Persistenzgrenzen dieses Vergleichs liegen im Speicher.
Der maschinenlesbare Nachweis steht in
[codebook-installation-comparison-2026-10-17.json](codebook-installation-comparison-2026-10-17.json).

Kodierboxs bisheriger HTTP-Loader wird um die Bibliotheksvorgaben ergänzt.
Das Backend-Dockerfile installiert denselben Tarball. Der bestehende
`image-size@2.0.3`-Override und der SOLVER-Adapter bleiben erhalten.

## Lokale Prüfung dieses Integrationsstands

- Frontend: 2.865 Tests in 274 Suites bestanden, einschließlich neuer Tests mit
  echter Anwendungs-Sprachdatei, Überschreibungen, Regionsfallback und Interpolation.
- Backend: 2.764 Tests in 178 Suites bestanden; 17 Tests in drei vorhandenen Suites
  bleiben übersprungen. Frontend und Backend wurden nacheinander validiert.
- Frontend-/Backend-Lint und beide Produktionsbuilds bestanden.
- Drei Chrome-Cypress-Tests am Produktionsfrontend bestanden, einschließlich
  Codebook-Beschriftungen, interpolierter Auswahlanzahl, Fortschritt, erfolgreichem
  Download und Fehleranzeige. Authentifizierung und HTTP-Antworten sind simuliert.
- Separate Produktionsinstallation aus dem generierten Backend-Manifest, demselben
  Tarball, allen generierten Overrides und dem gepinnten PostgreSQL-Treiber erfolgreich
  mit npm 11.18.0 und `--omit=dev --ignore-scripts` (657 Pakete).
- Alle 20 installierten Bibliotheksdateien stimmen auch in der Produktionsinstallation
  mit dem gebauten Paket überein. JSON-/DOCX-Einstieg, Null-Einzug mit 100 Twips,
  native Formel sowie ICNS-/PNG-Regression mit `image-size@2.0.3` bestanden.
- Vollständiger Root-Audit: 0 hoch, 0 kritisch, 57 moderat, 1 niedrig.

Der [Produktionspaket-Nachweis](codebook-production-check-2026-10-17.json)
bezieht sich auf diese separate Installation. Native Installationsskripte und
Docker-Start wurden dabei nicht ausgeführt. Ein Deployment und eine erneute
Microsoft-Word-Abnahme des Originalfalls sind nicht bestätigt. Die entfernte CI
ist am aktuellen PR-Head separat zu prüfen. Frühere Word-Abnahmen gelten für
ihre dort dokumentierten Artefakte.

## CI-Nachtrag: Dateien im Live-Testimage

Die GitLab-Pipeline [104222](https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/104222)
für `69200ad2` ist fehlgeschlagen. Die Jobs `test-replay-live` (475982),
`test-auth-live` (475983) und `test-workflows-live` (475984) brechen jeweils beim
Image-Bau mit ENOENT für den vendorten Bibliotheks-Tarball ab. Das gemeinsame
`scripts/e2e/replay/Dockerfile` kopierte vor `npm ci` bislang nur `vendor/braces`.
Es kopiert jetzt den vollständigen Vendor-Ordner, einschließlich aller lokalen
Dateiabhängigkeiten aus Paketmanifest und Lock.

Die Prüfung des rekonstruierten COPY-Eingangs bestätigt beide lokalen Abhängigkeiten.
`npm ci --omit=dev --ignore-scripts` installiert in diesem isolierten Verzeichnis
669 Pakete; Generator-Auflösung, DOCX-Null-Einzug, Formel und ICNS/PNG bestehen.
Drei Tests des bestehenden E2E-Harness bestehen ebenfalls. Das ist ein lokaler
Installationsnachweis; der Docker-Daemon antwortet nicht und ein vollständiger
Image-Bau bzw. Live-Lauf ist damit erst durch die neue entfernte CI zu bestätigen.

## CI-Nachtrag: Startfrist des Upload-Sicherheitstests

Zusätzlich überschreitet `test-backend` (475979) beim gültigen Multipart-Upload
die bisher gemeinsame Kindprozessgrenze von fünf Sekunden. Eine injizierte
Kaltstartverzögerung von sechs Sekunden reproduziert diesen Fehler mit dem alten
Test. Der Test trennt jetzt den Start des Kindprozesses vom eigentlichen Request:
Nach dem Laden von Nest und dem Start des HTTP-Servers meldet das Kind per IPC
seine Bereitschaft. Dafür gelten höchstens 30 Sekunden; ab Bereitschaft bleibt
die bisherige Fünf-Sekunden-Grenze für den Request erhalten. Zeitüberschreitungen
beenden das Kind und lassen den Test fehlschlagen. Payloads sowie Erwartungen an
Status, Daten und Ablehnung schädlicher Uploads bleiben erhalten.

Alle sechs Tests bestehen unverzögert und mit sechs Sekunden künstlicher
Startverzögerung je Kindprozess. Ein separat injizierter hängender Request wird
nach 5,254 Sekunden beendet und als Fehler gemeldet. Die vollständige reguläre
Backend-Suite besteht erneut mit 2.764 Tests in 178 Suites; 17 bestehende Tests in
drei Suites bleiben übersprungen. Backend-Lint besteht ebenfalls. Der zusätzliche
lokale Coverage-Lauf wurde aus Platzgründen abgebrochen und zählt nicht als
bestandene Prüfung. Damit ist die Trennung der Fristen lokal belegt; die genaue
Ladezeit auf dem entfernten Runner und der Erfolg der neuen Pipeline bleiben
separat zu bestätigen.

## Review-Korrekturen und erneuter develop-Abgleich

Der Branch ist auf `develop` `a8a48d0216f5bb48feae99b578f9e09153ffa785`
rebasiert. Der einzige Konflikt betraf die Upload-Testfristen: Die getrennten
30 Sekunden für den Start und fünf Sekunden für die Anfrage bleiben erhalten.
Alle übrigen Dateien des Rebase-Ergebnisses entsprechen der direkten Zusammenführung
des vorherigen PR-Stands mit diesem develop-Stand.

- `7422057ea`: Der gemeinsame Dialog bekommt stabile Initialwerte. Änderungen am
  Jobfilter und verspätete Missing-Profile überschreiben die vom Benutzer gewählten
  Ausgabeoptionen nicht mehr. Zwei Angular-Regressionstests prüfen die tatsächlichen
  Formulareingaben und den gesendeten Exportauftrag. Beide Browser-Abläufe prüfen
  zusätzlich Jobauswahl, spätes Laden der Profile, JSON und abgewählte Bewertungen.
- `b8bcfe381`: Explizite Item-Referenzen werden zuerst über die interne Variablen-ID
  aufgelöst, anschließend über den Alias. Ältere Metadatenspalten bleiben als Fallback
  erhalten. Fünf DOCX-Regressionstests decken Alias-Kollisionen, die Priorität einer
  expliziten ID sowie ältere Alias-/Spaltenformate einschließlich `0` und `false` ab.
  Die neuen Tests reproduzierten vor der Korrektur zwei UI- und zwei DOCX-Fehler.

Nach diesen Korrekturen erneut geprüft:

- Frontend: **2.958 Tests in 277 Suites bestanden**.
- Backend: **3.050 Tests in 195 Suites bestanden**; **63 Tests in sieben Suites
  bleiben übersprungen**. Nach einem lokalen ENOSPC-Fehler und einem unterbrochenen
  Lauf wurde die vollständige Suite abschließend erfolgreich wiederholt.
- Beide Lints, beide Builds und die Zoneless-Risikoprüfung bestanden. Das Inventar
  enthält zwei geänderte Fingerprints; keine Prüfvermerke wurden pauschal freigegeben.
- **3/3 Chrome-Cypress-Tests am Produktionsfrontend bestanden**. Authentifizierung
  und HTTP-Antworten sind simuliert.
- **4.694 Exportpaare** über die echten installierten Studio-/Kodierbox-Adapter
  bestehen erneut in JSON und allen normalisierten DOCX-Bestandteilen. Zusätzlich
  besteht der gültige Kollisionsfall `idA/alias=idB`, `idB/alias=B`: Ein Item mit
  `variableId=idB` erscheint in beiden DOCX-Ausgaben genau einmal unter `B`.
  Die Persistenzgrenzen des Vergleichs liegen weiterhin im Speicher.

Die Korrekturen liegen im Kodierbox-Host und verwenden den vorhandenen gemeinsamen
Bibliotheksbuild `4.1.0-dev.ff15d6d`. DOCX-Dateien können sich wegen erzeugter
Zeitstempel technisch unterscheiden. Eine erneute Datenbank-/Redis-/Word-Abnahme
und die entfernte CI sind von diesen lokalen Ergebnissen getrennt zu beurteilen.

## Item-Zuordnung über Job- und Bündelfilter hinweg

`587e0f0a0` erhält die ursprünglichen Variablen-IDs und Aliase in einem internen
`itemVariableReferences`-Kontext. Der erste Variablenfilter erzeugt diesen Kontext
aus dem vollständigen Schema; weitere Filter übernehmen ihn. Der Adapter löst
Item-Referenzen gegen diese ursprünglichen Identitäten auf und übernimmt danach
nur Zuordnungen zu tatsächlich exportierten Variablen. Die Reihenfolge der
Variablenfilter verändert damit nicht mehr die Bedeutung einer Item-Referenz.

Acht neue Integrationstests führen den echten `CodebookGenerationService` mit dem
echten Generator aus. Nur Repository- und Profilgrenzen sind simuliert. Sie decken
Jobfilter, Bündelfilter, deren Schnittmenge, umgekehrte Alias-Kollisionen,
ältere Metadatenspalten mit `0`/`false`, ungefilterte Ausgabe sowie aufeinanderfolgende
Exporte desselben Quelldatensatzes ab. Die Schemata werden dabei als gültig geprüft.
Vor der Korrektur schlugen sieben der acht Tests wegen falscher Item-Zuordnungen fehl.

Erneut bestanden:

- **3.058 Backendtests in 196 Suites**; **63 Tests in sieben Suites übersprungen**.
- Backend-Lint und Backend-Build.
- **4.694 Exportpaare** des bestehenden Studio-/Kodierbox-Vergleichs.
- Der zusätzliche gültige Scope-Fall ergibt jetzt identisches JSON und identische
  normalisierte DOCX-Bestandteile: Studio und Kodierbox enthalten ausschließlich
  `ITEM-A`; das Item der ausgeschlossenen Variable erscheint nicht mehr.

Die Frontendquellen, Paket-Pins und der Bibliotheksbuild sind unverändert. Die zuvor
dokumentierten Frontend-/Browser-Prüfungen wurden für diese Backendkorrektur nicht
wiederholt. Die entfernte CI ist am neuen PR-Head separat zu prüfen.
