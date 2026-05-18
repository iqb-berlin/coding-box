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

CSV- und API-Ausgaben sollen die Audit-Felder unveraendert ausgeben, aber keine
zusaetzliche PII rekonstruieren oder aus Fremdtabellen anreichern.

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
