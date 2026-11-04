# Testcenter freigeben und Daten importieren

Diese Anleitung beschreibt die Erweiterung von PR #1154. Sie ist erst nach einer
Veröffentlichung und dem Update der jeweiligen Kodierbox-Installation verfügbar.

## Freigabe durch die Systemadministration

1. Die **Administration** öffnen und **Einstellungen** auswählen.
2. Zur Karte **Freigegebene Testcenter** gehen.
3. In **Name des Testcenters** eine verständliche Bezeichnung eingeben.
4. In **HTTPS-Basisadresse** die genaue Adresse eingeben, beispielsweise
   `https://testcenter.example.org/tci`. Einen Installationspfad einschließen;
   keinen zusätzlichen `/api`-Pfad anhängen.
5. **Speichern und freigeben** anklicken. Der Eintrag erscheint in der Liste und
   steht beim nächsten Öffnen des Testcenter-Imports zur Auswahl. Ein Neustart
   der Kodierbox ist dafür nicht erforderlich.
6. Am Eintrag **Verbindung prüfen** anklicken. Bei Erfolg erscheint die gemeldete
   Testcenter-Version. Diese Prüfung bestätigt Erreichbarkeit und die geprüfte
   HTTPS-Verbindung; sie bestätigt weder die Anmeldung noch Datenrechte oder
   einen vollständigen Import.

Die Freigabe gilt für die gesamte Kodierbox-Installation. Zugangsdaten werden
dabei nicht gespeichert. **Name bearbeiten** lädt einen Eintrag in die Eingabe;
mit unveränderter Adresse und **Speichern und freigeben** wird sein Name geändert.
**Freigabe aufheben** entfernt eine hier eingerichtete Freigabe. Anschließende
Anmeldungen und Importanfragen an diese Adresse werden abgewiesen, auch wenn ein
Dialog noch eine ältere Auswahl oder Sitzung anzeigt. Bereits laufende externe
HTTP-Anfragen werden dadurch nicht abgebrochen.

Standardmäßig erlaubt sind `https://iqb-testcenter.de` sowie
`https://iqb-testcenter1.de` bis `https://iqb-testcenter10.de`. Eine Freigabe gilt
für die normalisierte, genaue Basisadresse; zusätzliche Installationspfade oder
andere Subdomains benötigen eine eigene Freigabe.

Diese elf IQB-Standardadressen und über `TESTCENTER_ALLOWED_URLS` ergänzte Adressen
werden angezeigt und sind in der Oberfläche schreibgeschützt. HTTP-Installationen
können nur durch den Betreiber über diese Umgebungsvariable zugelassen werden.
Private Zertifizierungsstellen benötigen weiterhin die Einrichtung durch den
Betreiber: [HTTPS und Zertifikate](testcenter-tls-de.md). Auch eine hier
freigegebene HTTPS-Adresse benötigt ein gültiges, vertrauenswürdiges Zertifikat.

## Auswahl beim Import

1. Im gewünschten Arbeitsbereich die Testdateien oder Testergebnisse öffnen und
   den bestehenden Testcenter-Import starten.
2. Unter **Test Center auswählen** die benannte Instanz auswählen. Die genaue
   Adresse wird automatisch übernommen. Die bisherigen Standardauswahlen und
   **individuelle Testcenter URL** bleiben verfügbar; auch eine individuell
   eingegebene Adresse muss zuvor freigegeben sein.
3. Mit dem Testcenter-Konto anmelden. Dieses Konto braucht mindestens Leserechte
   für den dort gewünschten Arbeitsbereich. Die Freigabe einer Adresse erteilt
   selbst keine Datenberechtigungen.
4. Den vorgesehenen Testcenter-Arbeitsbereich auswählen und den vorhandenen
   Importablauf verwenden.

Eine fehlende Freigabe, abgelehnte Zugangsdaten, fehlende Berechtigungen und
Zeitüberschreitungen werden bei der Anmeldung getrennt erklärt. Während der
Anmeldung ist eine weitere Anmeldung gesperrt. Fehler im Testcenter-Kennwort
beenden nicht die Kodierbox-Sitzung.

## Testcenter-Versionen

Die direkte Admin-Anmeldung älterer Testcenter bleibt erhalten. Verlangt ein
Testcenter ab 18.2 ausdrücklich den Challenge-Schutz für Admin-Anmeldungen, löst
die Kodierbox die vom Testcenter gestellte Rechenaufgabe und schließt dessen
offiziellen Anmeldeablauf ab. Der Schutz im Testcenter bleibt aktiviert.

Die Rechenaufgabe ist auf unterstützte Algorithmen, einen Suchbereich von null
bis höchstens 1.000.000, fünf Sekunden Rechenzeit und zwei gleichzeitig laufende Lösungen pro
Backend-Prozess begrenzt. Weiterleitungen werden in allen Anmeldeschritten
abgewiesen. Ein beliebiger Anmeldefehler löst keinen zusätzlichen Versuch aus.

Eine angezeigte Versionsnummer ist keine automatische Kompatibilitätsfreigabe.
Den Stand der technischen Prüfung und noch fehlende Nachweise beschreibt der
[Prüfbericht](qa/testcenter-instances-2026-11-04.md).
