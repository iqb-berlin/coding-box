# Testcenter freigeben und Daten importieren

Diese Anleitung beschreibt die Erweiterung von PR #1154. Sie ist erst nach einer
Veröffentlichung und dem Update der jeweiligen Kodierbox-Installation verfügbar.

## Freigabe durch die Systemadministration

1. Die **Administration** öffnen und **Einstellungen** auswählen.
2. Zur Karte **Freigegebene Testcenter** gehen.
3. In **Name des Testcenters** eine verständliche Bezeichnung eingeben.
4. In **Basisadresse (HTTP oder HTTPS)** die genaue Adresse eingeben, beispielsweise
   `https://testcenter.example.org/tci`. Einen Installationspfad einschließen;
   keinen zusätzlichen `/api`-Pfad anhängen. Auch eine HTTP-Adresse wie
   `http://testcenter.intern:8080/tci` ist möglich. Bei HTTP erscheint bereits vor
   dem Speichern der Hinweis **Unverschlüsselte Übertragung (HTTP)**.
5. **Speichern und freigeben** anklicken. Der Eintrag erscheint in der Liste und
   steht beim nächsten Öffnen des Testcenter-Imports zur Auswahl. Ein Neustart
   der Kodierbox ist dafür nicht erforderlich.
6. Am Eintrag **Verbindung prüfen** anklicken. Bei Erfolg erscheint die gemeldete
   Testcenter-Version. Diese Prüfung bestätigt Erreichbarkeit und bei HTTPS die
   Zertifikatsprüfung; sie bestätigt weder die Anmeldung noch Datenrechte oder
   einen vollständigen Import.

Die Freigabe gilt für die gesamte Kodierbox-Installation. Zugangsdaten werden
dabei nicht gespeichert. **Name bearbeiten** lädt einen Eintrag in die Eingabe.
Die Basisadresse ist dann schreibgeschützt; **Name speichern** ändert nur den Namen.
**Abbrechen** verwirft die Bearbeitung und öffnet wieder die Eingabe für eine neue
Freigabe. Für eine andere Basisadresse eine neue Freigabe anlegen und die alte
bei Bedarf ausdrücklich aufheben.
**Freigabe aufheben** öffnet eine Bestätigung mit Name, Adresse und den Folgen für alle
Arbeitsbereiche. Erst die Bestätigung hebt die Freigabe auf. **Abbrechen** lässt sie bestehen. Anschließende
Anmeldungen und Importanfragen an diese Adresse werden abgewiesen, auch wenn ein
Dialog noch eine ältere Auswahl oder Sitzung anzeigt. Bereits laufende externe
HTTP-Anfragen werden dadurch nicht abgebrochen.

Es sind höchstens 100 zusätzliche, in der Systemadministration angelegte Freigaben
zulässig. Diese Grenze gilt auch bei gleichzeitigen Änderungen durch mehrere
Administratoren oder Backend-Prozesse. Bestehende Einträge können bei voller Liste
weiterhin umbenannt oder aufgehoben werden.

Standardmäßig erlaubt sind `https://iqb-testcenter.de` sowie
`https://iqb-testcenter1.de` bis `https://iqb-testcenter10.de`. Eine Freigabe gilt
für die normalisierte, genaue Basisadresse; zusätzliche Installationspfade oder
andere Subdomains benötigen eine eigene Freigabe.

Die elf IQB-Adressen sind anfangs freigegeben. Sie können wie eigene Instanzen
umbenannt oder aufgehoben werden. Eine aufgehobene IQB-Freigabe bleibt auch nach
einem Neustart und auf anderen Backend-Prozessen gesperrt. Sie verschwindet aus
der Auswahl; auch die individuelle URL und die nummerierte Auswahl umgehen die
Sperre nicht. Zum erneuten Freigeben dieselbe Adresse mit einem Namen speichern.
Die elf IQB-Adressen belegen keinen der 100 zusätzlichen Plätze.

Nur ausdrücklich über `TESTCENTER_ALLOWED_URLS` konfigurierte Adressen sind
schreibgeschützt. Diese Betreiberkonfiguration hat auch bei einer IQB-Adresse
Vorrang vor einer Freigabe oder Sperre in der Oberfläche. Auch HTTP-Installationen
können direkt in der Oberfläche freigegeben, umbenannt und aufgehoben werden.
`TESTCENTER_ALLOWED_URLS` ist dafür nicht erforderlich.
Private Zertifizierungsstellen benötigen weiterhin die Einrichtung durch den
Betreiber: [HTTPS und Zertifikate](testcenter-tls-de.md). Auch eine hier
freigegebene HTTPS-Adresse benötigt ein gültiges, vertrauenswürdiges Zertifikat.

HTTP-Einträge bleiben in der Liste als **Unverschlüsselte Übertragung (HTTP)**
gekennzeichnet. Kennwort, Sitzungstoken und Testdaten werden auf dem Weg zwischen
Kodierbox-Backend und Testcenter unverschlüsselt übertragen und können mitgelesen
oder verändert werden. Die HTTPS-Verbindung zur Kodierbox schützt diese zweite
Verbindung nicht. HTTP nur in einer entsprechend abgesicherten Umgebung verwenden.
Ein erfolgreicher Verbindungstest verschlüsselt HTTP nicht. Die Freigabe bleibt
auf das genaue Protokoll, den Host, Port und Installationspfad beschränkt.

## Auswahl beim Import

1. Im gewünschten Arbeitsbereich die Testdateien oder Testergebnisse öffnen und
   den bestehenden Testcenter-Import starten.
2. Unter **Test Center auswählen** die benannte Instanz auswählen. Die genaue
   Adresse wird automatisch übernommen. Die Auswahl enthält nur aktuell freigegebene Instanzen.
   **individuelle Testcenter URL** bleibt verfügbar; auch eine individuell
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
abgewiesen. Vor dem Abruf der Challenge und vor dem Absenden ihrer Lösung wird
die Freigabe erneut geprüft; ein zwischenzeitlicher Widerruf stoppt den Ablauf.
Ein beliebiger Anmeldefehler löst keinen zusätzlichen Versuch aus.

Eine angezeigte Versionsnummer ist keine automatische Kompatibilitätsfreigabe.
Den Stand der technischen Prüfung und noch fehlende Nachweise beschreibt der
[Prüfbericht](qa/testcenter-instances-2026-11-04.md).

## Fehlerhinweise und Prozessübersicht

Die Verwaltung unterscheidet ungültige HTTP-/HTTPS-Adressen, die Grenze von
100 zusätzlichen Freigaben und Betreiberkonfiguration. Beim Verbindungstest
werden Zertifikatsfehler, eine Zeitüberschreitung nach zehn Sekunden und eine
ungültige Versionsantwort getrennt erklärt. Zugangsdaten und interne Antworten
der Gegenstelle werden dabei nicht angezeigt.

Content-Pool-Imports und -Uploads erscheinen in der zentralen Prozessübersicht
als **Content-Pool-Übertragung** mit Prozentfortschritt, Vorgang und Paket-ID.
Bei Uploads wird zusätzlich die Anzahl der ausgewählten Dateien angezeigt.
Diese Queue-Änderung betrifft die Content-Pool-Anbindung.
