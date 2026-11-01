# Grenzen für Ressourcenpakete

Ressourcenpaket-Uploads und der automatische GeoGebra-Download verwenden dieselben Grenzen:

| Grenze | Wert |
| --- | --- |
| ZIP-Datei | 128 MiB |
| Entpackte Einzeldatei | 64 MiB |
| Entpacktes Archiv insgesamt | 512 MiB |
| ZIP-Einträge einschließlich Verzeichnissen | 10.000 |
| Dateipfad im ZIP, UTF-8 | 1.024 Byte |
| Pfadbestandteile einschließlich Dateiname | 32 |

Die Werte stehen in `apps/backend/src/app/database/services/workspace/resource-package-limits.ts`.
Der Upload nimmt genau eine Datei im Feld `resourcePackage` an. Zusätzliche Formularfelder sind nicht vorgesehen.
Multer begrenzt den Upload bereits beim Empfang; Axios begrenzt auch GeoGebra-Antworten ohne `Content-Length`.
Der gemeinsame Service prüft zusätzlich die tatsächliche ZIP-Puffergröße und die Archivgrößen vor dem Entpacken.
Überschrittene Upload- oder Archivgrenzen führen zu HTTP 413. Ein fehlgeschlagener GeoGebra-Download wird wie bisher mit HTTP 400 beantwortet.

ZIP-Größenangaben müssen zu den tatsächlich gelesenen Inhalten passen. Alle Einträge zählen zu den Grenzen,
auch wenn die globale GeoGebra-Normalisierung sie anschließend nicht übernimmt.
Implizite Verzeichnisse zählen ebenfalls. Dateipfade und deren Gesamtzahl werden bereits beim
Dekodieren der Eintragsnamen begrenzt, bevor `adm-zip` die impliziten Verzeichnisse anlegt.
CRC- und Pfadprüfungen bleiben aktiv. Fehlerhafte Archive werden vor der Veröffentlichung des Pakets verworfen;
temporär entpackte Dateien werden entfernt.

Dateisystemzugriffe erfolgen asynchron. ZIP-Downloads werden mit `Content-Length` gestreamt, damit die
bestehende Fortschrittsanzeige die Gesamtgröße erhält. Bestehende ZIP-Namen und
Groß-/Kleinschreibungsvarianten bleiben lesbar. Die Dekompression verwendet den asynchronen Leser von
`adm-zip`; begrenzte Kopier-, Hash- und CRC-Arbeiten laufen weiterhin im API-Prozess.

Benutzerprofile werden bei OIDC-Anmeldung und Keycloak-Synchronisierung nicht mehr vollständig protokolliert.
Erstellungs- und Änderungsereignisse enthalten nur Ereignisnamen und interne Benutzer-ID.
