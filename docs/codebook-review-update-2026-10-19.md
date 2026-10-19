# Codebook-Paketupdate vom 19.10.2026

Folgeänderung zur integrierten [#1041](https://github.com/iqb-berlin/coding-box/pull/1041),
ursprünglich auf `develop` `abb620e7703dd1909c6914929877de1b41f6186e`.
Das Paket **4.1.0-dev.d79ca05** stammt aus Bibliothekscommit
`d79ca05365e6073bfd650e2dfa180c05d3ffc5b8`
([coding-components #251](https://github.com/iqb-berlin/coding-components/pull/251)).
SHA-256: `09694cd2b4d108882fca32434d7586b4de7bbf448a2d490c3f94e939020c81a7`.
[Studio #1728](https://github.com/iqb-berlin/studio-lite/pull/1728) verwendet denselben Tarball.

Das Paket enthält 15 Korrekturen für Regeltexte, aktuelle/Legacy-Formeln,
Bildformatierung, Formelspeicher sowie asynchron geladene Auswahl und
Exportsperre. Der ursprüngliche Befund 31 ist zurückgezogen: Die beanstandete
Standardbeschreibung entsteht im EXTENDED-Modus von Responses; der Generator
verwendet SIMPLE. Die bisherige Bibliotheksausgabe bleibt hier erhalten.

Root-Paket und Lock, Backend-Dockerfile sowie die lokalen Abnahmeskripte zeigen
auf den neuen Tarball. Alle anderen Lock-Einträge bleiben unverändert.
Die bestehende OIDC-, SOLVER-, Workspace- und Queue-Logik wird beibehalten.

## Neue Prüfungen

- **78 Backend-Tests / 7 Suites** zu Codebook-Service, Generator, DOCX und Controller.
- **71 Frontend-Tests / 4 Suites** zu Export, zonenloser Anbindung, Jobauswahl und Übersetzungen.
- Beide Produktionsbuilds und beide Lint-Aufrufe bestanden.
- **4.694 Exportpaare** der tatsächlich installierten Studio-/Kodierbox-Adapter
  identisch, einschließlich unveränderter unabhängiger alter Studio-Referenzen.
  Alle 20 Paketdateien entsprechen dem gebauten Paket. Persistenzgrenzen dieses
  Adaptervergleichs liegen im Speicher.
- **24 echte HTTP-/Queue-Downloads** mit PostgreSQL nach 163 Liquibase-Migrationen,
  Redis/Bull und echten OIDC-Tokens aus einem isolierten Keycloak: JSON und DOCX,
  alle/Job-/Bundle-/Schnittmengen-/umgekehrte Scopes, Score-/Instruktionsoptionen,
  Missingprofile, interne IDs vor Aliasen und Legacy-Metadatenwerte `0`/`false`.
  Alle Ausgaben stimmen mit dem installierten Studio-Adapter überein; dessen
  Persistenzgrenzen bleiben dabei im Speicher.
- **Sechs echte SOLVER-Fälle** mit abhängigen SUM_SCORE-Variablen stimmen mit
  unabhängigem Responses 5.2.0 überein; Ergebnisse sind in PostgreSQL geprüft.
  Leere Codebook-Schnittmengen und ein ungültiger Autocoder-Namensraum schlagen
  wie vorgesehen in der Queue fehl. Fehlgeschlagene Downloads werden abgewiesen;
  die Autocoder-Vorabprüfung verändert bei Fehlern keine Antworten.
- **Chrome am Produktionsfrontend:** echte OIDC-Tokens aus dem Passwortgrant werden
  in die temporäre Browser-Sitzung übernommen. Kein PKCE-Login-Nachweis.
  Aufgabenwahl bleibt beim Suchfilter erhalten; alle gemeinsamen Einstellungen
  sind während des Exports gesperrt. Der echte Queue-Download übernimmt die
  Score-Option; danach sind die Einstellungen wieder freigegeben. Keine
  JavaScript-Fehler. Die Jobanfrage wurde nur kurz angehalten und anschließend
  unverändert an API und Queue weitergeleitet.

[Prüfsummen und genaue Ergebnisse](codebook-review-update-2026-10-19.json).
Alle Daten sind synthetisch und liegen in isolierten lokalen Diensten.

## Erneute Abnahme auf synchronisiertem develop

Am Quellstand `0e4c62c2668ee6be8db87d2f833e8a45b87b5fbd` mit `develop`
`3ba72a90c095d6903cc87a609aedf08573615fc1` erneut lokal bestanden:
**3.392 Backend-Tests / 217 Suites** (67 Tests in 8 Suites übersprungen),
**3.039 Frontend-Tests / 279 Suites**, beide Lint-Aufrufe, beide Produktionsbuilds
zuletzt ohne Nx-Cache und beide Inventar-Regressionsfälle. Der Inventareintrag
für das aktualisierte Paket wurde korrigiert; die bestehende Risikoprüfung bleibt aktiv.

Der erneute Lauf mit gebauten Diensten, PostgreSQL, Redis/Bull und echtem
Keycloak bestätigt wieder **24 Downloads und sechs SOLVER-Fälle**.
Die **4.694 Exportpaare** der tatsächlich installierten Hosts stimmen überein.
Das Bibliothekspaket wurde dabei anhand aller 20 Dateien gegen den gepinnten
Tarball verifiziert, in diesem Lauf aber nicht erneut aus Bibliotheksquellen gebaut.
[Genauer aktueller Host-Nachweis](qa/codebook-word-current-2026-10-19/host-validation.json)
und [echter Dienstebericht](qa/codebook-word-current-2026-10-19/live-services-report.json).

**Neue Microsoft-Word-Web-Abnahme:** 14 frisch erzeugte DOCX-Dateien aus genau
diesem Paket wurden in Microsofts Word Web Viewer geöffnet. Alle 26 gerenderten
Seiten sind gesichert; Tabellen, Formeln, Bilder und Formatierungen wurden betrachtet.
11 von 13 Studio-/Kodierbox-Seitenpaaren sind pixelgleich, zwei unterscheiden
sich in jeweils 66 Pixeln ohne sichtbaren Inhalts- oder Layoutunterschied.
[Dokumente, gerenderte Seiten, Prüfsummen und Grenzen](qa/codebook-word-current-2026-10-19/README.md).
Dies ersetzt keinen neuen Desktop-Word-Nachweis. Der ursprüngliche reale Fehlerfall
und die ursprüngliche Schemer-HTML-Version bleiben unbekannt.

Die weiter oben beschriebene Codebook-Browserinteraktion behält ihren ursprünglichen
Quellstand; sie wurde für diese Folgeabnahme nicht erneut durchgeführt. Native
Installationsskripte und ein Docker-Anwendungsimage wurden ebenfalls nicht erneut
gebaut. Entfernte CI gilt nur für den jeweiligen PR-Head und wird vor dem Merge
separat geprüft. Kein Alpha-Kandidat, Tag, Registry-Release oder Deployment.
