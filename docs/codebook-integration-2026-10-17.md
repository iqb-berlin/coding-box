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

Zusätzlich überschreitet `test-backend` (475979) beim gültigen Multipart-Upload
einmal die Kindprozessgrenze von fünf Sekunden. Alle sechs Tests der Suite
`upload-dependencies.spec.ts` bestehen beim gezielten lokalen Nachtest. Die
Ursache der CI-Zeitüberschreitung ist damit nicht abschließend geklärt und wird
nicht als behoben ausgewiesen.
