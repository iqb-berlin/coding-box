# Integration des gemeinsamen Codebooks

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

Die Kodierengine verbleibt bei @iqb/responses 5.2.0; die gemeinsame Bibliothek hat
für Codebook-Regeltexte eine eigene, feste Abhängigkeit auf 5.2.2.
Rollback erfolgt durch die vorherige Anwendungsversion, ohne Datenmigration.
