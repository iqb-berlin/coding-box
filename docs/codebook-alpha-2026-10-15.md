# Codebook-Alpha nach dem aktuellen develop-Abgleich

Dieser Stand verwendet den veröffentlichten Tarball
`vendor/iqb-ngx-coding-components-4.1.0-alpha.1.tgz` aus dem
[Alpha-Release](https://github.com/iqb-berlin/coding-components/releases/tag/Schemer_v2.9.0-alpha.1).
SHA-256: `cb85078662e8fe4490aa90001e369db059571da73ec73a1457a7ffb89d49f296`.
Studio und Kodierbox verwenden dieselbe Paketdatei; alle 20 installierten
Paketdateien stimmen mit dem Release-Build überein. Responses bleibt 5.3.1.
Die bestehende lokale SOLVER-Kompatibilität und der Antwortvertrag bleiben erhalten.

## develop und Zoneless

`develop` auf `31ad79f3d` wird übernommen, einschließlich Zoneless-Umstellung
und verbindlicher Quality Gates. Die gemeinsame Codebook-Oberfläche bleibt
bestehen; der Wrapper verwendet Signals und `inject()` wie die aktuelle Anwendung.
Die manuellen Angular-Zone-Timer der ergänzten Tests sind durch Jest-Timer ersetzt.
Die verzögerten Antwortfälle aus develop und die Prüfungen der gemeinsamen
Oberfläche werden gemeinsam ausgeführt.

Die Aufgaben-/Missingprofil-Auswahl und der Schulungsfilter bleiben gemeinsam.
Jobdefinitionen und Jobstatus bleiben im Kodierbox-Wrapper; keine Gruppenspalte
oder Variablenbündel-Auswahl im Dialog. Der serverseitige Scope-Vertrag bleibt
bestehen. `exhaustMap` verhindert überlappende Statusabfragen; Schließen beendet
laufende Abfragen und Downloads. Der Export bleibt bis zum Ende des Downloads
gesperrt und wird bei Fehlern wieder freigegeben.

Die von der gemeinsamen Bibliothek deklarierte Angular-Animations-Peerabhängigkeit
wird ausdrücklich auf denselben Patchstand 21.2.24 wie Angular Core gesetzt.
Das verhindert eine unpassende automatische Peerauflösung auf 21.2.25; es werden
keine Zone- oder Animationsprovider in die Anwendung zurückgebracht.

## Behobener CI-Audit-Befund

Pipeline [104049](https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/104049)
scheiterte im Job [audit-app / 474890](https://scm.cms.hu-berlin.de/iqb/coding-box/-/jobs/474890).
Die 19 Paketkorrekturtests waren dort grün. Die beiden hohen npm-Befunde
betrafen die verschachtelte `image-size@1.2.1`-Installation und die davon
betroffene gemeinsame Bibliothek. Der Host erzwingt nun `image-size@2.0.3`.

Der neue Backend-Test verwendet den tatsächlich vom installierten Generator
aufgelösten Parser und einen begrenzten Kindprozess. Ein ICNS-Eintrag mit
Eintragslänge 0 muss abgelehnt werden; ein gültiges PNG liefert weiter 1×1 Pixel.
Der vollständige lokale npm-Audit meldet danach 0 hohe und 0 kritische Befunde;
57 moderate und ein niedriger Befund bleiben sichtbar. Die Auditgrenze wird nicht
abgeschwächt.

Das Backend-Dockerfile kopiert denselben Alpha-Tarball und setzt die
`image-size@2.0.3`-Override auch für seine separate Produktionsinstallation.

## Installations- und Exportvergleich

[Maschinenlesbarer Vergleich](codebook-alpha-installation-comparison-2026-10-15.json):
4.694 Exportpaare durch die echten Studio-/Kodierbox-Adapter sind identisch,
einschließlich JSON und aller verglichenen DOCX-Bestandteile. Unveränderte alte
Studio-Referenzen, Leerzeichenfälle, Inlinebilder, Code/Missing 0 und gespeicherte
Chemieformate sind enthalten. Beide Hosts verwenden dasselbe Alpha-Paket und
dieselbe Responses-Auflösung im Host und in der Bibliothek.

Persistenzgrenzen dieses Vergleichs liegen im Speicher. Der Vergleich ersetzt
keinen aktuellen HTTP-/Browser-/Redis-/Word-Lauf. Historische Word-Abnahmen
behalten ihre ursprünglichen Artefaktbezüge. Exakte lokale Tests und entfernte CI
stehen im PR; ein Deployment ist damit nicht bestätigt.
