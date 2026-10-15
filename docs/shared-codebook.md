# Integration des gemeinsamen Codebooks

## Aktueller Responses-Stand

Die [Prüfung vom 15.10.2026](codebook-responses-2026-10-15.md) verwendet überall
`@iqb/responses` 5.3.1, die beim Abgleich aktuelle Patchversion der 5.3-Reihe.
Die Bibliothek bezieht Responses als Peer (`^5.3.0`); Schemer, Validierung und
Generator verwenden dieselbe Installation wie der Host. Es gibt keine private
5.2.2-Installation mehr. 1.285 Generator-Tests und 4.694 installierte Exportpaare
bestehen einschließlich der unveränderten Studio-Referenzen. Aktueller Tarball-
SHA256: `9a0e75158dcc70e821c6a481d431ec6a0429e248afb85bd27991b1ae1af22d7a`.
Frühere Berichte unten beziehen sich auf ihre damaligen Paketstände.

## Vorherige Inlinebild-Korrektur

Die [Prüfung vom 15.10.2026](codebook-inline-images-2026-10-15.md) behebt Textverlust bei defekten Inlinebildern. 1.285 Generator-Tests und 4.694 installierte Exportpaare bestehen. Dabei verwendeten beide Anwendungen den Tarball mit SHA256 `1340db41e6493cca3d4395426c14f156319c3bbbf0b81d01f84c233a56a5091a`. Eine neue Word-Abnahme wurde für diesen Paketstand nicht ausgeführt.

## Format- und Aspect-Abnahme vom 13.10.2026

Die [Browser- und Word-Abnahme vom 13.10.2026](codebook-aspect-acceptance-2026-10-13.md) ergänzt die frühere Leerzeichen-Abnahme um bestätigte Formatierungsfixes und den bidirektionalen Formel-Austausch. Damals geprüftes Paket-SHA256: `0e355c3896799ae765cb6e90b00147da0359c56f5fdc90d36b7caf40fbe59ab8`. 1.245 Generator-Tests, 4.654 installierte Exportpaare und 262 tatsächliche Microsoft-Word-Web-Seiten sind geprüft. Die explizite 18pt-Schriftgröße des alten `Farbe`-Referenzfalls wird bewusst korrigiert; alle übrigen alten Dokumentbestandteile bleiben streng verglichen. Angaben zu früheren Paketständen weiter unten sind historische Nachweise.

Die Codebook-UI und der JSON-/DOCX-Generator kommen aus
`@iqb/ngx-coding-components` 4.1.0. Studio bildet die Bedien- und Ausgabereferenz.
Die vollständigen Regeln und Referenztests stehen in
`coding-components/docs/shared-codebook.md`.

Schulungsbedarf wird in beiden Anwendungen im gemeinsamen Formular ausgewählt
und im gemeinsamen Generator anhand von CODER_TRAINING_REQUIRED gefiltert.
Der Kodierbox-Wrapper ergänzt den Jobdefinitionsfilter. Die Gruppenspalte und
der zusätzliche Variablenbündel-Filter werden hier nicht angezeigt (Issue #176).
Der bestehende serverseitige Variablenbündel-Vertrag bleibt erhalten; Bündeldaten
werden weiterhin zur korrekten Auflösung von Jobdefinitionen geladen.
Workspace-Prüfung und serverseitige Schnittmengenbildung bleiben bestehen.
Sowohl synchroner Export als auch Queue-Prozessor verwenden über den vorhandenen
Generation-Service denselben gemeinsamen Generator. Jobstart, Statusabfrage,
Fortschritt und Download bleiben ausschließlich in der Kodierbox. Schließen
beendet die Statusabfrage, nicht den Serverjob.
Der Wrapper meldet asynchrone Daten- und Statusänderungen an Angular und ist mit
OnPush und zoneless Change Detection getestet.

## Release-Kandidat

Die Abhängigkeit zeigt vor Veröffentlichung auf
`vendor/iqb-ngx-coding-components-4.1.0.tgz`. Das Backend-Dockerfile übernimmt
dasselbe Artefakt ausdrücklich in die Runtime-Installation. Ohne diese Zuordnung
würde Nx die Versionsnummer 4.1.0 im generierten Runtime-Manifest ausgeben und npm
zu früh die noch unveröffentlichte Registry-Version installieren wollen.

Nach gemeinsamer Abnahme: Bibliothek veröffentlichen, die Root-Abhängigkeit auf
4.1.0 umstellen und Lock aktualisieren. Anschließend die Tarball-COPY- und
`npm pkg set`-Schritte im Backend-Dockerfile sowie den Tarball entfernen und die
Runtime-Installation erneut prüfen. Nicht nur die Frontend-Abhängigkeit ändern.

Die Kodierengine verwendet wie Schemer, Validierung und Codebook-Regeltexte
`@iqb/responses` 5.3.1. Die Bibliothek verwendet den Host-Peer. Der Anwendungs-
und Persistenzvertrag bleibt bei response-Spezifikation 1.5.1; ein echter
Engine-Regressionstest erhält auch den alten Status CODE_SELECTION_PENDING.
Rollback erfolgt durch die vorherige Anwendungsversion, ohne Datenmigration.
