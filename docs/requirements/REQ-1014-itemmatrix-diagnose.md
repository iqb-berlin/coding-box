# Itemmatrix: vollständige, dauerhafte Fehlerdiagnose

Ergänzt den Itemmatrix-Export aus [#190](https://github.com/iqb-berlin/coding-box/issues/190)
um die Diagnoseanforderungen aus [#1014](https://github.com/iqb-berlin/coding-box/issues/1014).

Der reguläre Export bleibt bei nicht auflösbaren Zellen fehlgeschlagen. Die
gruppierte Übersicht bleibt begrenzt auf 20 Beispielpositionen; die vollständige
CSV enthält **jede** betroffene Zelle mit Matrixzeile und Spaltennummer (jeweils
einsbasiert, einschließlich Kopfzeile und vier Schlüsselspalten), Personenlogin,
Personencode, Gruppe, Booklet-ID/-Name, Spaltenname, Unit, Variable und Fehlergrund.
CSV-Werte werden maskiert und gegen die Interpretation als Tabellenformeln geschützt.
Die Erfassung schreibt gebufferte Blöcke; sie sammelt keine vollständige Zellliste
im Arbeitsspeicher oder in Redis. Die Diagnose ändert keine Datenbankdaten.

Nach Abschluss der Fehlererfassung werden CSV und gruppierte Diagnose unter
`temp/item-matrix-diagnostics/<workspace-id>/<uuid>/` atomar veröffentlicht.
Dieser Pfad liegt bereits im gemeinsamen `export_temp_vol` von Backend und
Export-Worker. Für lokale Installationen muss das `temp`-Verzeichnis dauerhaft
erhalten und gesichert werden. Archive haben keine automatische Ablaufzeit;
Queue-Löschung und Bereinigung gewöhnlicher Exportdateien entfernen sie nicht.
Das Löschen eines Workspaces entfernt seine Diagnosearchive.
Die Veröffentlichung prüft vor und nach dem Dateikopieren lesend, ob der Workspace
noch existiert. Ein gleichzeitiges Löschen oder ein Abbruch des Exportauftrags
entfernt bereits veröffentlichte Diagnosen wieder. Der Archivindex liest nur die
kleinen Metadaten; vollständige Diagnosegruppen werden erst beim Öffnen geladen.

Im Exportbereich lassen sich gespeicherte Diagnosen laden, deren Übersicht öffnen
und die vollständige CSV herunterladen. Die entsprechenden workspacegebundenen
API-Endpunkte verwenden dieselben Authentifizierungs- und Zugriffsprüfungen wie
andere Kodierexporte. Personenkennungen sind nur in der vollständigen CSV enthalten.
Jeder Export erhält eine neue Archiv-ID, auch bei wiederverwendeten Bull-Job-IDs.

Das optional herunterladbare ZIP enthält weiterhin die ausdrücklich als
unvollständig markierte Matrix und README sowie jetzt `diagnose.csv` mit allen
Zellen und `diagnose-gruppiert.csv` mit der Übersicht. Das ZIP bleibt ein
gewöhnliches Exportartefakt mit einer Stunde Aufbewahrungszeit. Die separate
Diagnose bleibt auch bei einem nachfolgenden ZIP-/Redis-Fehler erhalten.

Bereits abgelaufene Diagnosen aus älteren Versionen lassen sich nicht nachträglich
rekonstruieren. Für sie muss einmal ein neuer Export gestartet werden.

Regressionstests decken beide abgeleiteten Fehlergründe, CSV/Excel-Koordinaten,
5.480 Zellen, deterministische Wiederholung, Archivzugriff ohne Queue/Redis,
Neustart, Workspace-Trennung, Abbruch und fehlgeschlagene Veröffentlichung ab.

## Durchgängige lokale Abnahme vom 19.10.2026

Der wiederholbare Nx-Aufruf `backend:verify-item-matrix-live` verwendet eine
isolierte PostgreSQL-Datenbank nach 163 Migrationen, Redis/Bull, echte OIDC-Tokens
und getrennte API-/Export-Worker-Prozesse aus dem Produktionsbuild.
2.740 synthetische Personen erzeugen 5.480 Fehlerzellen, je 2.740 mit
`derived-result-missing` und `derived-source-unresolved`. CSV/Score und Excel/Code
liefern identische vollständige Diagnose-CSVs mit geprüften Koordinaten.
ZIP-Inhalt, Workspace-Trennung und unveränderte Antwortdaten sind geprüft.
Nach Entfernen der Queue-Aufträge und ihrer Cache-Einträge sowie nach Neustart
beider Prozesse stimmen die archivierten Downloads weiterhin per SHA-256 überein.

Im Produktionsfrontend wurden die Archive nach echter Anmeldung über OIDC
Authorization Code mit S256-PKCE geöffnet und die zwei Diagnosegruppen angezeigt.
Der Browserdownload stimmt mit den 5.480 archivierten Zellen überein. Die API
wurde dabei nicht simuliert; die Browserkonsole enthält keine JavaScript-Fehler.

Anleitung: `scripts/e2e/item-matrix/README.md`. Die synthetische Abnahme bestätigt
keinen erneuten Lauf mit dem ursprünglichen Problemdatensatz und kein Deployment.
