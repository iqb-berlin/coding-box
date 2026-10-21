# Codebook und Autocoder: npm-Update vom 20.10.2026

Kodierbox verwendet die veröffentlichte Bibliothek **4.1.0**, Responses **5.4.0**
und Coding-Scheme **3.5.0**. Bibliotheksquelle ist
`acbad15fe3e4a047398fc5505e4ca878bc38de42`. Öffentlicher npm-Download und Download
mit leerem Cache entsprechen dem geprüften Build.

SHA-256: `6226a01e8df5165ec6be0c7458bc4de3297bb6e1853442ea63245e4823298aa7`.

Root-Paket, Root-Lock und generiertes Backend-Runtime-Manifest verwenden das
Registry-Paket; im Dockerfile entfallen Tarball-Kopie und lokale
Pfadüberschreibung. Andere Paketversionen im Root-Lock ändern sich nicht.

Die erzeugte Autocoder-Kopie wurde aus Responses **5.4.0** neu gebaut und ist
reproduzierbar. Nur der mathjs-Import bleibt auf den bestehenden privaten
SOLVER-Adapter beschränkt. Der unabhängige Vergleich mit Responses **5.2.0**
sichert weiterhin Rundung, Null-Ergebnisse, schreibgeschützte Konfiguration,
Statuswerte und abhängige Ableitungen. Sechs zusätzliche Factory-Fälle prüfen
beide neuen Teilantwort-Optionen für SUM_SCORE, SUM_CODE und CONCAT_CODE,
jeweils einschließlich des Verhaltens ohne Aktivierung.

## Neue lokale Prüfung

- Backend vollständig: **3.408 Tests / 218 Suites** bestanden; **67 Tests / 8
  Suites** bleiben wie zuvor übersprungen.
- Exportdialog einschließlich zoneless-Verhalten und Jobauswahl: **68 Tests /
  3 Suites** bestanden.
- Backend- und Frontend-Produktionsbuild sowie beide Lint-Aufrufe bestanden,
  jeweils ohne Fehler und Warnungen.
- **4.694 Exportpaare** über die installierten Studio-/Kodierbox-Adapter sind in
  JSON und allen verglichenen DOCX-Bestandteilen identisch. Alle **20
  Paketdateien** entsprechen dem Build. Code/Missing 0, Scores, Bilder, Formeln,
  Leerzeichen und unveränderte alte Studio-Referenzen sind enthalten.
- Zoneless-CI-Prüfung: Inventar mit **8.860 Einträgen** konsistent,
  Risikoreferenzen und **2 Inventar-Regressionsfälle** bestanden. Nur der
  Fingerprint der aktualisierten Bibliothek ist angepasst; ihr Einzelreview
  bleibt offen. Das ist keine vollständige neue Zoneless-Abnahme.
- Bibliothek: **1.343 Tests**, frischer Consumer mit ESM/CommonJS, JSON/DOCX und
  striktem TypeScript mit Bundler/NodeNext bestanden.

Der bestehende Host-Vergleich wurde temporär für Registry-URL, heruntergeladenen
Tarball und Responses-Peer angepasst; Fälle und Referenzen bleiben unverändert.
Die Live-Prüfskripte vergleichen nun Paketversion und SHA-512-Integrität aus den
Lockfiles. Die Scriptsyntax wurde geprüft.

[Maschinenlesbarer Bericht mit Prüfsummen und Grenzen](codebook-npm-update-2026-10-20.json).

Vollständige Frontend-Suite, native Installationsskripte, Docker-Imagebuild,
neue HTTP-/Browser-/Redis- und Word-Abnahme wurden lokal nicht durchgeführt.
Die Word-Abnahme bleibt wie vereinbart separat. Frühere Nachweise gelten
für ihre jeweils genannten Paketstände. Entfernte CI am neuen PR-Head separat
prüfen. Dieser Branch wurde nicht gemergt oder deployt.
