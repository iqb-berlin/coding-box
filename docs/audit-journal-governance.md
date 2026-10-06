# Audit Journal Governance

## Zielbild

Das Journal ist beides: Audit-Log fuer fachlich relevante, nachvollziehbare
Aktionen und System-Log fuer sicherheits- und betriebsrelevante Hintergrundjobs.
Es ist nicht als Debug-Log gedacht. Debug-Details gehoeren in die Applikationslogs,
nicht in persistente Journal-Eintraege.

## Ereignistypen

Kanonische Ereignistypen werden in `api-dto/audit-journal/audit-journal.dto.ts`
gepflegt. Neue Eintraege muessen einen fachlichen `eventType` verwenden, zum
Beispiel `TEST_RESULTS_IMPORTED`, `RESPONSE_DELETED`,
`CODING_VERSION_RESET`, `CODING_RESULTS_APPLIED`,
`ACCESS_LEVEL_CHANGED` oder `DATABASE_EXPORT_STARTED`.

Legacy-Felder wie `actionType` und `userId` bleiben fuer Rueckwaertskompatibilitaet
befuellt, sind aber nicht das Zielmodell fuer neue Auswertungen.

## Herkunft Und Schreibpfade

Vertrauenswuerdige Ereignisse werden im Backend beim jeweiligen fachlichen
Vorgang erzeugt. Benutzer-IDs stammen aus der authentifizierten Anfrage und
werden bei Uploads und Validierungsjobs in die Queue uebernommen. Eine
Benutzer-ID im Request-Body oder in Query-Parametern ist kein Herkunftsnachweis.

`POST /admin/workspace/:workspace_id/journal` erzeugt ausschliesslich
`MANUAL_NOTE_CREATED` mit `actorType=user`. Legacy-Angaben zu einer angeblichen
Aktion oder deren Ergebnis stehen nur als `reportedActionType` und
`reportedResult` in den Details. System-/Job-Akteure, andere Ereignistypen,
Job-/Korrelationskennungen und unbekannte Body-Felder werden abgelehnt.
Manuelle Notizen belegen nicht, dass die beschriebene Aktion ausgefuehrt wurde.

Loeschungen von Testpersonen, Heften, Aufgaben, Antworten und Logs schreiben
ihr Ereignis in derselben Datenbanktransaktion wie die Loeschung. Schlaegt das
Journal fehl, wird diese Transaktion zurueckgerollt. Cache-Invalidierung erfolgt
danach; ihr Ausfall entfernt kein bereits gespeichertes Ereignis. Bulk-Loeschungen
im Ergebnisbrowser protokollieren jeden bestaetigten Stapel mit Nummer, Gesamtzahl und
Loeschmenge. Ein spaeterer Fehler hebt fruehere Stapel nicht auf.

Rechte-, Einstellungs-, Kodierjob- und Jobdefinitionsaenderungen sowie das
Anwenden von Kodierergebnissen schreiben ihre Ereignisse ebenfalls innerhalb
der jeweiligen Transaktion. Tokens werden erst nach erfolgreichem
`ACCESS_TOKEN_CREATED`-Eintrag zurueckgegeben. Workspace-Datenbankexports
protokollieren Abschluss, Fehler und Abbruch im Worker.

Upload- und Testcenter-Importe speichern jeden Persistenzstapel zusammen mit
einem Ereignis mit Mengen, Phase und Herkunft. Ein Audit-Fehler rollt den
betroffenen Stapel einschliesslich ersetzter Daten zurueck. Der Gesamtimport ist
nicht atomar: Fruehere bestaetigte Stapel und ihre Ereignisse bleiben bei spaeteren
Fehlern erhalten. Zusaetzliche Abschlussereignisse fassen den Lauf zusammen;
ihr Ausfall wird als Warnung gemeldet und darf keinen erneuten Import ausloesen.
Das Abschlussereignis beschreibt das Gesamtergebnis; es ersetzt keine
dauerhafte Wiederaufnahme- oder Idempotenzverwaltung des Importlaufs.
Ein erfolgreiches Journal allein beweist keinen erfolgreichen End-to-End-Ablauf.

Kodierungs-Resets und die aelteren Validierungs-Loeschpfade schreiben ebenfalls
je Stapel ein transaktionales Ereignis. Beim Reset werden Antworten,
Aktualitaetsdaten und betroffene Jobstatus gemeinsam mit diesem Ereignis
gespeichert. Scheitert ein spaeterer Stapel, bleiben Daten und Status der bereits
bestaetigten Stapel konsistent. Rechte-Ereignisse vergleichen den unter Sperre
gelesenen Vorherzustand. Pause, Fortsetzen und Aktualisieren von
Kodierjobs beziehungsweise Jobdefinitionen werden als Aenderung protokolliert.

## Pflichtfelder

Neue Audit-Ereignisse muessen mindestens diese Felder liefern:

- `workspaceId`: betroffener Arbeitsbereich
- `actorType`: `user`, `system` oder `job`
- `eventType`: kanonischer Ereignistyp
- `result`: `started`, `success` oder `failure`
- `summary`: kurze, datensparsame Beschreibung

Wenn verfuegbar, sollen zusaetzlich gesetzt werden:

- `actorUserId`: numerische Benutzer-ID bei Benutzeraktionen
- `actorId`: opake Actor-Kennung, wenn keine numerische Benutzer-ID existiert
- `entityType` und `entityId`: betroffene Entitaet
- `correlationId` oder `jobId`: technische Zuordnung fuer Requests und Jobs
- `details`: strukturierte Zusatzdaten ohne personenbezogene Rohdaten

## PII-Regeln

Journal-Eintraege duerfen keine Testpersonen-Codes, Logins, Gruppen,
Passwoerter, Tokens, Rohantworten, kompletten Request-Bodies oder vergleichbare
personenbezogene Rohdaten persistieren. `JournalService` maskiert bekannte
sensitive Detail-Schluessel. Neue Aufrufer sollen trotzdem nur minimierte
Details uebergeben, zum Beispiel Zaehler, technische IDs, Statuswerte und
fachliche Kategorien.

API-Ausgaben sollen keine zusaetzliche PII rekonstruieren oder aus Fremdtabellen
anreichern. CSV-Ausgaben neutralisieren Formel-Praefixe einschliesslich
vorangestellter Leer- und Steuerzeichen und verwenden regulaeres CSV-Quoting.
Der apostrophierte CSV-Text ist daher nicht in jeder Zelle byte-identisch zur API.

## Retention

Status: Retention ist im Code noch nicht technisch durchgesetzt.

Vorschlag fuer die naechste Umsetzungsstufe:

- Standard-Retention pro Workspace konfigurierbar machen, zunaechst 24 Monate.
- `failure`- und sicherheitsrelevante Events nicht kuerzer halten als normale
  Erfolgsereignisse.
- Periodischen Purge-Job einfuehren, der alte Journal-Eintraege loescht und die
  Anzahl geloeschter Eintraege selbst als Systemereignis protokolliert.
- Vor Aktivierung pruefen, ob bestehende rechtliche oder projektspezifische
  Aufbewahrungspflichten laengere Fristen verlangen.
