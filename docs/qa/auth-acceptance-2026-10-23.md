# Abnahmeprüfung für #566 und #1018

Prüfdatum: 22.–23.10.2026. Zielumgebung laut Auftrag: `https://kodierbox-test.iqb.hu-berlin.de`.

## Ergebnis

- **#566: Die sieben dokumentierten technischen Kriterien sind im geprüften Quellstand erfüllt.** Die OIDC-HTTP-Suite bestand im Merge-Stand mit 27 Tests und nach der unten dokumentierten WorkspaceGuard-Ergänzung mit 31 Tests; sie prüft reale signierte JWTs über HTTP, JWKS und die produktiven Strategien/Guards. Das ist die technische Abnahme des beschriebenen Testumfangs; die spätere Auslieferung und Live-Prüfung sind unten getrennt dokumentiert.
- **#1018: Fachliche Gesamtabnahme weiterhin offen.** F01 (echter Refresh-Ausfall mit Recovery), F02 (widerrufene Sitzung mit ungespeichertem Entwurf), F03 (Backend-401 mit Rückkehr sowie tatsächlicher 403 beim Schreiben und beim Aufruf einer geschützten Ansicht), F04 (Auth-Daten-Netzwerkfehler und Retry), F05 (echte JWKS-Fehlkonfiguration mit Recovery) und nun F07 (alte Refresh-Antwort nach Neuanmeldung, coder2 → coder3 sowie coder3 → coder3) sind auf der benannten Testinstanz geprüft. Für F06 sind die tatsächliche UI-/HTTP-/Log-Korrelation und die ergänzte deutsche/englische Betriebsdiagnose dokumentiert. Die Dokumentation und die im Verlauf entstandenen Korrekturen werden mit dem unten beschriebenen Integrationsstand zur Review vorgelegt; die bestätigte fachliche Freigabe fehlt. Die übrige Konsolidierung aus #571 ist ein eigener offener Umfang. Einzelheiten und Beweisgrenzen stehen am Ende dieses Protokolls.
- Beide Tickets bleiben offen. Die Prüfung selbst änderte keine Ticket-Checkliste und keinen Kommentar. Für die anschließende PR-Vorlage gilt der Workflowstatus Review; das ist keine fachliche Freigabe.

## Geprüfter Stand und Nachweise

Merge-Commit: `474dd5125f9962e4b4d8b60b3f23c0f5637bda9d` aus [PR #1086](https://github.com/iqb-berlin/coding-box/pull/1086).

Der lokale Test-Head `ac6ad9499485cbf4444ad1b5da3b5c315f250739` und der Merge-Commit besitzen denselben vollständigen Git-Quellbaum: `da3d8be60121640cd7fd7221fc8457cf36ea38bb`. Bei der damaligen Live-Abfrage am Vormittag des 23.10.2026 verwies auch `develop` auf diesen Merge-Commit. Der spätere Integrationsstand steht unten gesondert.

[Merge-Pipeline 105032](https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/105032): am 23.10.2026 erneut geprüft, **19/19 Jobs erfolgreich**. CodeQL für den Merge-Commit ist ebenfalls erfolgreich. Die zuvor erfolgreiche [PR-Pipeline 105027](https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/105027) bleibt als zusätzlicher Nachweis verlinkt.

Gezielte lokale Nachprüfung am 22.10.2026, ohne Nx-Cache, jeweils seriell ausgeführt:

| Prüfung | Ergebnis | Lokales Protokoll |
| --- | --- | --- |
| Backend: OIDC-JWKS, Refresh-HTTP-Vertrag, OIDC-Service, JWT-/Workspace-Strategien, Guards, Fehlerfilter und Request-ID | 9 Suites / 130 Tests bestanden; darin 27 OIDC-JWKS-HTTP-Fälle | `/tmp/auth-acceptance-backend-2026-10-22.log` |
| Frontend: AuthService, SessionRecovery, Interceptor, Auth-Daten-Refresh, Guards, Home, globale Hinweise und Systemhinweise | 9 Suites / 157 Tests bestanden | `/tmp/auth-acceptance-frontend-2026-10-22.log` |
| Frontend: AppService, CodeSelector, ReplayCoding und Arbeitsbereichsansicht | 4 Suites / 148 Tests bestanden | `/tmp/auth-acceptance-recovery-2026-10-22.log` |
| Replay-Komponente: gezielt ausgewählte Recovery-Fälle | 5 Tests bestanden; 78 andere Tests durch den Namensfilter nicht ausgewählt | `/tmp/auth-acceptance-replay-context-2026-10-22.log` |
| Cypress `oidc-callback.cy.ts`, Produktions-Frontend lokal | 11/11 Browserfälle bestanden; API-/Provider-Antworten in dieser Suite simuliert | `/tmp/auth-acceptance-browser-2026-10-22.log` |

Ausgeführt über `NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx ... --skip-nx-cache`. Die Backend-Suite nutzt echte Nest-HTTP-Endpunkte und einen kontrollierten lokalen JWKS-HTTP-Server. Der Refresh-HTTP-Vertrag mockt den ausgehenden Provider-Transport. Die genannten lokalen Browserfälle sind kein Live-Nachweis für den entfernten Provider oder die Zielinstanz.

## #566: Soll/Ist je Kriterium

Quelle: [aktuelle Ticketkriterien](https://github.com/iqb-berlin/coding-box/issues/566). Suite: `apps/backend/src/app/auth/auth-jwks.integration.spec.ts` im genannten Merge-Quellbaum.

| Kriterium | Ist / Nachweis | Urteil |
| --- | --- | --- |
| Signierte Provider-JWTs, kontrolliertes JWKS und produktiver Auth-/Guard-Pfad | Eigenes RSA-Schlüsselpaar, lokaler JWKS-Server, `JwtStrategy`, `JwtAuthGuard`, kombinierter Guard; echte HTTP-Anfragen mit `fetch()` | Erfüllt |
| Gültiger Token und richtiger lokaler Benutzer | Drei Clientzuordnungen (`azp`, einzelne `aud`, Audience-Liste), beide Guards: HTTP 200, erwartete Serviceargumente und Principal mit lokaler Benutzer-ID 42 | Erfüllt im dokumentierten Integrationsumfang |
| Ablauf, Issuer, Client/Audience, fehlender Subject | Abgelaufene Tokens, falscher Issuer/Client, falsche Audiences, fehlende Client-Claims, fehlender/leerer Subject: HTTP 401 über beide Guards | Erfüllt |
| Signatur, unbekannter Schlüssel, unzulässiger Algorithmus | Falscher RSA-Schlüssel, unbekanntes `kid`, RS512, HS256 mit öffentlichem RSA-Schlüssel, `none`, fehlerhaftes JWT: HTTP 401 | Erfüllt |
| Kein Zugriff und keine Benutzeranlage/-änderung bei ungültigen Tokens | Jeder negative Tokenfall prüft HTTP 401 und keinen Aufruf von `createOidcProviderUser` | Erfüllt |
| Trennung von Workspace- und User-Session-Tokens | Moderne und Legacy-Replay-Tokens: normale JWT-Route 401, ausdrücklich freigegebene kombinierte Route 200, unmarkierte kombinierte Route 401; keine OIDC-Benutzeranlage | Erfüllt |
| HTTP-Status statt isoliertem `validate(payload)` | Tokenfälle durchlaufen HTTP und die echten Strategien/Guards; 200/401 werden geprüft. Provider-/Konfigurationsfälle mit 503 bleiben enthalten | Erfüllt |

Grenze: `UsersService` ist gemockt. Die Prüfung bestätigt die Übergabe verifizierter Identität und die Verwendung der vom Service gelieferten lokalen Benutzer-ID; sie integriert die Datenbankimplementierung des Services nicht zusätzlich. Die produktive Tokenstrategie wurde durch #1086 nicht geändert.

## #1018: Soll/Ist je Fall

Quelle: [aktuelle Ticketkriterien](https://github.com/iqb-berlin/coding-box/issues/1018). Die Bestätigung in der Zielumgebung erfolgt schrittweise; vollständig belegte Live-Fälle sind unten gesondert benannt. F01–F07 sind insgesamt noch nicht vollständig abgenommen.

| Fall | Bestätigte technische Nachweise | Noch erforderlicher Zielnachweis |
| --- | --- | --- |
| F01: Temporärer Provider-Ausfall | Auf der Zielinstanz: geprüfte erneuerbare Sitzung, tatsächlicher Transportausfall beim Refresh, korrelierter Provider-unavailable-Hinweis, Entwurf erhalten und ungespeichert; nach Rückstellung Retry ohne Neuanmeldung, automatische Speicherung und Neuladen | Bestanden; Refresh durch ausdrücklich genehmigtes Entfernen nur des lokalen Access-Tokens ausgelöst |
| F02: Widerrufene Sitzung | Eigene Provider-Sitzung tatsächlich abgemeldet; nachweislich ungespeicherter Entwurf bleibt bei abgelehntem Refresh erhalten. Erneute Anmeldung als coder2 stellt ihn automatisch wieder her und speichert ihn; anschließendes Neuladen bestätigt den Text | Bestanden; tatsächlicher Widerruf und Recovery auf der Zielinstanz, Details unten |
| F03: Backend-401 / fehlende Berechtigung | Tatsächlicher Backend-401 und direkte Rückkehr nach Anmeldung bestanden. Tatsächlicher 403-Schreibfall zeigt den Berechtigungshinweis, erhält den Entwurf und erlaubt nach Rückstellung Speichern ohne Anmeldung. Auch der geschützte Ansichtsaufruf ohne Workspace-Zugriff liefert jetzt tatsächlich 403 und den Berechtigungshinweis; Job 2777 ist danach mit derselben Sitzung per HTTP 200 erreichbar | Bestanden auf der Zielinstanz; drei Befunde korrigiert und live nachgeprüft, Details unten |
| F04: Auth-Daten-Abfrage | Auf der Zielinstanz: gezielt blockierter Auth-Daten-Request, eigener Fehlerzustand, erfolgreicher Retry, korrekte Arbeitsbereichsliste für coder2 und alter Hinweis entfernt | Bestanden für Netzwerkfehler; kein zusätzlicher 5xx-Fall erzeugt |
| F05: OIDC-/JWKS-Konfiguration | Tatsächliche Fehlkonfiguration auf der Zielinstanz, 503 `configuration-error`, korrelierte Request-ID, sichtbarer Hinweis und erhaltener Entwurf. Nach Rückstellung erfolgreicher Retry mit Speicherung und bestätigtem Neuladen | Bestanden auf der Zielinstanz, Details unten |
| F06: Betriebsdiagnose | Tatsächliche UI-/HTTP-/Log-Request-ID korreliert, Anwendungs- und Providerstatus getrennt, fünf sichere Diagnosefelder. Deutsche und englische Betriebsanleitung mit Klassifikation, Zuordnung, Erhaltung des Log-Nachweises und passenden Recovery-Schritten ergänzt und gegen Quelle/Live-Nachweise geprüft | Inhaltlich dokumentiert und zur Review vorgelegt; fachliche Bestätigung ausstehend. Übriger #571-Umfang bleibt offen |
| F07: Verspätete Antworten | In beiden Live-Durchläufen bleibt der alte Refresh nach bereits bestätigter Neuanmeldung noch pending und kommt erst danach mit 200 an. coder2 → coder3 übernimmt keinen alten Testentwurf; coder3 → coder3 bleibt nach alter Antwort und Neuladen als coder3 nutzbar. 78 ergänzende Regressionstests für Sitzung und Entwurfszuordnung grün | Durchgeführte Live-Fälle bestanden; einzelne Tokenwerte wurden nicht gelesen, ein zusätzlicher erzwungener frischer Refresh wurde nicht nachgewiesen. Genauere Grenzen und Zeitfolge unten |
| Fachliche Freigabe | Noch nicht erteilt | Verantwortliche Person, tatsächlich bereitgestellte Version, Datum, Soll/Ist und bereinigte Nachweise je Fall; Abweichungen ausdrücklich bewerten |

Die F06-Betriebsdiagnose für #571 ist in dieser PR-Vorlage ergänzt. Ihre fachliche Bestätigung sowie die übrigen Installations-/Migrationskriterien aus #571 sind dadurch nicht automatisch abgeschlossen.

## Aktualisierte Zielumgebung am 23.10.2026

Die Aktualisierung auf Commit `474dd5125f9962e4b4d8b60b3f23c0f5637bda9d` ist abgeschlossen. Neue Sicherung: rund 7,64 GiB; 853 bestehende Sicherungsdateien unverändert. Zwei Migrationen erfolgreich, gezählte Nutzdatenbestände unverändert. API-/Redis-Health, tatsächlicher Login-Redirect und Request-ID-Korrelation mit Backend-Log bestanden. Details und Beweisgrenzen stehen im [Deploymentprotokoll](auth-test-deployment-2026-10-23.md).

Der angemeldete Chrome lädt `main-Z2UXTY2E.js` aus dem neuen Build. Die angezeigte Version 1.17.4 ist im Home-Template fest eingetragen und kein Nachweis eines alten Images; die Paketversion des gebauten Quellstands ist 1.17.5.

F02/F05/F06 haben damit zusätzliche echte HTTP-/Provider-/Log-Teilnachweise; die vollständigen Browserabläufe bleiben erforderlich. F06: `deployment-auth-20261023`, HTTP 401 `session-invalid`, korreliert mit `oidc-refresh-failed` im Backend-Log.

## Angemeldete Browser-Vorprüfung am 23.10.2026

Chrome-Zugriff und echte Provider-Anmeldung funktionieren. Die Arbeitsbereichsliste wurde geladen; im Arbeitsbereich „VERA MaP Probierbereich“ (ID 3) wurden bestehende Jobs und eine tatsächliche Replay-/Review-Ansicht mit Player geöffnet. „Test“ (ID 1) und „Schulungsmodus_Testarbeitsbereich“ (ID 13) besitzen keine Kodierjobs. Das angemeldete Administrationskonto hat im Probierbereich keinen eigenen Kodierjob; die Review-Ansicht ist für Notizen schreibgeschützt. Die Jobdefinition zeigt dort `coder2` und `coder5` als Kodierer. Es wurde keine neue Jobdefinition erstellt, keine Notiz gespeichert und kein Kodierergebnis verändert.

Für die Kodier-/Recovery-Fälle ist die Anmeldung eines passenden Testkodierers angefordert; für F07 wird zusätzlich ein zweites Konto benötigt. Kein Fall F01–F07 wird durch diese Vorprüfung als vollständig bestanden gewertet.

## Separater Abnahmejob nach ausdrücklicher Freigabe

Am 23.10.2026 wurde der neue Job **„Auth-Abnahme 1018 · 2026-10-23“**, Datenbank-ID **2777**, im „VERA MaP Probierbereich“ (Arbeitsbereich 3) angelegt. Zugewiesenes Testkonto: **coder2** (lokale Benutzer-ID 7). Enthalten sind ausschließlich zwei neue synthetische Kodierfälle:

- Testgruppe `AUTH1018-20261023`, Testheft `AUTH1018-20261023-BOOKLET`.
- Neue Testpersonen `auth1018-20261023-a` / `auth1018-20261023-b`, IDs 103089 / 103090.
- Neue Antworten 44134102 / 44134103 für `DH_BF_05.Item_10`; eindeutig als synthetische Abnahmeantworten beschriftet. Sechs zusätzliche neue Strukturdatensätze dienen nur der Player-Sichtbarkeit.
- Kommentare erlaubt, Aggregation für diesen Testjob ausgeschaltet. Keine Ergebnisübernahme in Quelldaten. Bestehende Jobdefinition #30 wurde nicht verändert.

Die zwei Antwortfälle wurden im Browser mit Scope `person` und Modus `skip` importiert. Es wurde keine vorhandene Unit getroffen oder überschrieben. Da die vorhandene Definition die Variable bereits reserviert, entstand der separate Job als eng begrenzte Datenbank-Testfixture mit Transaktions- und ID-Guards; auch die manuelle Vorbereitung und Player-Metadaten betreffen ausschließlich die neuen Testdatensätze. Damit wird **nicht** die Jobplanungs-/Importlogik fachlich abgenommen, sondern eine isolierte Grundlage für die Auth- und Recovery-Prüfung geschaffen.

**Erkannte und zurückgenommene Nebenwirkung:** Der normale Import änderte automatisch Aktualitätsmetadaten der acht alten Jobs. Dies wurde beim unmittelbaren Fingerabdruckvergleich erkannt. Ausschließlich `freshness_status`, `freshness_reason`, `freshness_updated_at`, `freshness_affected_units`, `freshness_affected_responses` und `updated_at` wurden aus der heutigen Sicherung in einer geschützten Transaktion zurückgestellt. Vor dem Schreiben wurde berechnet und geprüft, dass diese Rücknahme exakt den direkt vor dem Import erfassten vollständigen Job-Fingerabdruck ergibt; danach wurde derselbe Fingerabdruck erneut bestätigt. Bestehende Antwortwerte, Notizen und Kodierungen waren davon nicht betroffen.

Der anschließende Vergleich bestätigte unveränderte Fingerabdrücke für 19 alte Testpersonen, 19 Testhefte, 307 Units, 1.784 Antworten, acht Jobs, 84 Jobfälle, acht Kodiererzuordnungen, eine Jobdefinition, 1.185 globale Testheft-Metadatensätze, 307 Chunks und 969 Player-Zustandszeilen. Der Prüfbereich umfasst die bestehenden Roh-/Kodierdaten dieses Arbeitsbereichs und globale Testheft-Metadaten, nicht jede Tabelle der gesamten Installation. Private Nachweise liegen unter `/home/user/kodierbox-deploy/auth-update-474dd512-20261023/acceptance/`.

Die Jobliste zeigt den neuen Job, `coder2`, die richtige Variable und 0/2 bearbeitete Fälle. Die Schreib-/Recovery-Abnahme benötigt nun den Kontowechsel zu `coder2`; bis dahin bleibt F01–F07 offen. Kein bestehender Job wird für Notizen oder Codevergabe verwendet.

### Kontowechsel: gemeldeter Anmeldefehler

Der Nutzer meldete beim Kontowechsel einen Fehler bzw. eine nicht bedienbare Anmeldung. Die unmittelbare Prüfung am 23.10.2026 um etwa 12:24 MESZ ergab: ein verarbeiteter Logout, bestätigter erfolgreicher Provider-Logout, kein Logout-Fehler und keine der selektiv gelesenen Auth-Fehlerklassen im engen Zehn-Minuten-Fenster. API-Health HTTP 200. Chrome zeigt das normale Provider-Anmeldeformular ohne sichtbare Fehlermeldung; das alte Konto war automatisch vorausgefüllt. Das Formular wurde auf `coder2` vorbereitet und das alte vorausgefüllte Passwortfeld geleert. Es wurde kein Passwort gelesen, eingegeben oder abgesendet. Die Anmeldung und die Schreib-/Recovery-Prüfung stehen noch aus. Die endgültige Player-Darstellung der neuen Fixture ist nach dem Kontowechsel erneut zu prüfen.

## Laufende Live-Abnahme als coder2

Am 23.10.2026 ist die Anmeldung als `coder2` im tatsächlichen Browser bestätigt: „Meine Kodierjobs“ zeigt den neuen Job 2777; nur dieser wurde gestartet. Die korrigierte synthetische Fixture zeigt jetzt die Frage und eindeutig markierte Testantwort im tatsächlichen Player, ohne den zuvor gemeldeten Seitenhinweis. Das normale Speichern der Testnotiz `AUTH1018-BASIS-20261023` und ihr Erhalt nach Browser-Neuladen sind bestätigt; der Datenbankabgleich zeigt zwei Fälle, beide Codes weiterhin ungesetzt. Bestehende Roh- und Kodierdaten bestanden den Fingerabdruckvergleich vor dem Schreibtest.

### F05 / F06: tatsächlicher Konfigurationsfehler

Nur das Test-Backend wurde vorübergehend auf den tatsächlich nicht vorhandenen JWKS-Pfad `…/protocol/openid-connect/certs-auth1018-not-found` gesetzt. Der externe Provider selbst, Datenbank, Worker, Frontend und übrige Infrastruktur wurden nicht geändert. Ein unabhängiger Rückstellprozess begrenzt jeden Fehler auf fünf Minuten; zusätzlich wurde die Rückstellung unmittelbar nach dem Nachweis gestartet.

Beim Speichern eines neuen Entwurfs im Job 2777 zeigte das UI „Anmeldung kann gerade nicht geprüft werden“ und einen Administrationshinweis zum Konfigurationsfehler. Die Sitzung und der neue Text blieben im Browser erhalten. Die Anwendung antwortete mit 503, während im Log der tatsächliche JWKS-Providerstatus 404 verzeichnet ist. Der Entwurf wurde bei diesem Fehler nicht in die Datenbank geschrieben; dort blieb die vorherige Basisnotiz erhalten.

Bereinigter tatsächlich korrelierter Eintrag:

```json
{
  "event": "oidc-jwks-failed",
  "errorClass": "configuration-error",
  "endpoint": "https://keycloak.kodierbox.iqb.hu-berlin.de/realms/coding-box/protocol/openid-connect/certs-auth1018-not-found",
  "requestId": "0e075764-a20d-40fe-8e9b-9cbb22c12136",
  "httpStatus": 404
}
```

Die Fehler-ID im UI entspricht der Log-Request-ID. Der Auszug enthält ausschließlich erlaubte Diagnosefelder, keine Tokens, Provider-Antwortkörper oder Personenkennungen. **F05 ist auf der Zielinstanz bestanden:** Die korrekte Konfiguration wurde um 12:35:25 MESZ vollständig wiederhergestellt und geprüft. „Anmeldung erneut prüfen“ entfernte den Fehlerhinweis und speicherte die zuvor blockierte Notiz. Die Notiz blieb nach erneutem Browser-Neuladen erhalten; dies wurde zusätzlich in der Datenbank ausschließlich für Job 2777 bestätigt. Beide Codes bleiben ungesetzt. Damit sind echte Fehlkonfiguration, Request-ID, Entwurfserhalt, Korrektur und Coding-Recovery für diesen Fall belegt. F06 hat damit einen vollständigen UI-/Log-Korrelationsnachweis; die verknüpfte Dokumentationskonsolidierung #571 bleibt eine eigene offene Bedingung. Der Benutzer hat anschließend ausdrücklich die kurzzeitige Entziehung ausschließlich der neuen coder2-Zuweisung genehmigt; der Ablauf ist unten dokumentiert. Die zuvor vorgeschlagene Umzuweisung an ein anderes Konto wurde von der automatischen Freigabeprüfung abgelehnt und nicht ausgeführt.


### F03: Zuweisung nur des neuen Jobs vorübergehend entzogen

Nach ausdrücklicher Benutzerfreigabe wurde ausschließlich `coding_job_coder` ID 2791 (Job 2777, coder2/User 7) kurz entfernt. Kein anderes Konto erhielt Zugriff. Ein unabhängiger Rückstellprozess war auf 180 Sekunden begrenzt; die manuelle Rückstellung erfolgte bereits um 12:44:13 MESZ. Die vollständige Zuweisungszeile einschließlich ID und ursprünglichem Zeitstempel stimmt danach exakt mit dem vorher gesicherten Datensatz überein.

Neue Testnotizen im bereits geöffneten regulären Kodierfenster wurden während der Entziehung nicht gespeichert; die zuvor bestätigte Notiz blieb in der Datenbank erhalten. Der Browser hielt den neuesten Entwurf sichtbar und leitete nicht zur Anmeldung weiter. **Befund:** Die Kodieransicht zeigte stattdessen „Die Notiz konnte nicht gespeichert werden. Bitte Verbindung prüfen und erneut versuchen.“ Der spezifische Berechtigungshinweis war nicht als nutzbare Fehlermeldung sichtbar. Die lokale Quellprüfung zeigt, dass `ReplayCodingService.saveNotes` nach dem zentralen Interceptor einen eigenen allgemeinen Snackbar öffnet. Daher ist der Berechtigungsteil von F03 noch nicht vollständig bestanden. Ein ergänzender Durchlauf mit erneut zeitlich begrenzter Entziehung ausschließlich derselben coder2-Zuweisung bestätigt den tatsächlichen Browserstatus: `POST /api/wsg-admin/workspace/3/coding-job/2777/notes 403 (Forbidden)`. Der Auszug aus der Chrome-Konsole enthält nur diesen Endpunkt und Status; Beleg `/tmp/auth1018-f03-http-status.txt`. Während der Entziehung blieb die neue HTTP-Testnotiz ungespeichert. Die Zuweisung wurde um 12:58:49 MESZ exakt wiederhergestellt; die danach eingegebene Recovery-Notiz ist gespeichert und die Codes bleiben leer. Der ursprüngliche Datensatzabgleich ist um 13:00:12 MESZ erneut vollständig grün. Serverseitiger zusätzlicher Beleg: `acceptance/f03-403-http-recovery-evidence.json`. Der erneute Aufruf im `coding-review`-Modus ist kein Nachweis für den Schutz der regulären Kodieransicht.

Nach Rückstellung wurde ohne erneute Anmeldung eine neue Testnotiz mit Marker `AUTH1018-F03-403-20261023-RECOVERY` erfolgreich gespeichert. Datenbankabgleich und Browser-Neuladen bestätigen den Text. Beide Codes bleiben ungesetzt. Nachprüfung um 12:44:50 MESZ: alle geschützten ursprünglichen Tabellenfingerprints stimmen überein. Belege: `/tmp/auth1018-f03-403.png`, `/tmp/auth1018-f03-recovery.png` und serverseitig `acceptance/f03-403-recovery-evidence.json`.

### F03: echter Backend-401 und leere Rückkehrseite

Nur das Testbackend wurde vorübergehend mit abweichendem erwarteten Issuer gestartet; JWKS und geteilter Provider blieben unverändert. Der tatsächlich signierte Access-Token wurde damit im produktiven Backend-Guard zurückgewiesen. Beim Eingeben des neuen Markers `AUTH1018-F03-401-20261023` bestätigt die Chrome-Konsole HTTP 401 am Notiz-Endpunkt. Das UI zeigte „Anmeldung erforderlich“, sperrte Kodieraktionen und hielt den neuen Entwurf sichtbar. In der Datenbank blieb die zuvor gespeicherte F01-Notiz erhalten.

Die normale Konfiguration wurde um 13:23:11 MESZ vollständig wiederhergestellt. Reguläres „Anmelden“ kehrte über SSO zur identischen Job-URL zurück. **Befund:** Die Seite blieb ohne Inhalt stehen; auch nach weiterem Beobachten war der sichtbare DOM leer (`coding-box-root` ohne Text). Ein zusätzlicher JavaScript-Laufzeitfehler wurde dabei nicht nachgewiesen; die Console enthielt die vorherigen 401-Requests. Nach normalem Neuladen erschien der Kodierjob wieder, der ursprüngliche 401-Entwurf wurde wiederhergestellt und gespeichert. Der Datenbanknachweis vom 23.10.2026, 13:26:09 MESZ bestätigt den exakten Marker und weiterhin ungesetzte Codes. Die Ursache der zunächst leeren Rückkehr ist noch offen; dieser 401-Recovery-Fall wird wegen des erforderlichen manuellen Neuladens nicht als vollständig bestanden gewertet.

Belege: `/tmp/auth1018-f03-401-http-status.txt`, `/tmp/auth1018-f03-401-error.png`, `/tmp/auth1018-f03-401-return-blank.png`; serverseitig `acceptance/f03-401-error-evidence.json` und `acceptance/f03-401-recovery-evidence.json`.

Der reguläre Leseaufruf wurde anschließend ebenfalls bei kurzzeitig entzogener, ausschließlich neuer coder2-Zuweisung geprüft. Die Ansicht blieb lesbar; ein 403 für diesen GET wurde nicht erzeugt. Das ist kein Beleg für einen fehlenden Zugriffsschutz: `getCodingJobReplaySession` verwendet `assertCodingJobAccess`, während das Speichern `assertCodingJobCodingAccess` verwendet. Der allgemeine Zugriff erlaubt unter anderem administrative bzw. hinreichende Arbeitsbereichsrechte ohne Job-Zuweisung. Der Entzug der Job-Zuweisung allein ist daher für diesen Benutzer kein geeigneter geschützter GET-403-Fall. Bestehende Arbeitsbereichsrechte wurden nicht geändert. Die Zuweisung wurde um 13:27:05 MESZ wieder exakt hergestellt.

### F01: echter Refresh-Ausfall nach ausdrücklicher Freigabe

Die ersten begrenzten Ausfallversuche erzwangen noch keinen Refresh und wurden deshalb nicht als bestanden gewertet. Der Benutzer hat danach ausdrücklich genehmigt: „Ja, nur lokalen Access-Token entfernen“. Über die Chrome-Oberfläche wurde ausschließlich `auth_token` der Testinstanz entfernt; Refresh-Token, Identität, Rechte und Kodierdaten wurden dabei nicht verändert und Tokenwerte nicht ausgegeben. Die zuvor ablehnende automatische Freigabeprüfung war damit durch eine konkrete Benutzerentscheidung geklärt.

Im anschließenden tatsächlichen Refresh-Ausfall zeigte die Anwendung „Anmeldung kann gerade nicht erneuert werden“ sowie Sitzungserhalt, erhaltene Eingaben und blockiertes Speichern/Laden. Die neue synthetische Notiz blieb im Browser und wurde nicht in die Datenbank geschrieben. Die Chrome-Konsole bestätigt `POST /api/auth/refresh` mit HTTP 503; die UI-Fehler-ID stimmt mit dem bereinigten Backend-Eintrag überein:

```json
{
  "event": "oidc-refresh-failed",
  "errorClass": "provider-unavailable",
  "endpoint": "http://127.0.0.1:9/auth1018-token",
  "requestId": "2a47e107-04f9-45ae-beb2-88b1d706bff0"
}
```

Der kontrollierte Transportfehler hat keinen Provider-HTTP-Status; die App antwortet mit 503. Der gemeinsame externe Provider selbst blieb erreichbar und unverändert. Die normale Backend-Konfiguration wurde um 13:14:51 MESZ wiederhergestellt.

Bei „Anmeldung erneut prüfen“ wies der echte Provider die alte Refresh-Sitzung allerdings als ungültig zurück (Provider HTTP 400, App-Klasse `session-invalid`, Request-ID `0f9d8390-ea3d-44e4-8955-cb744108f495`). Der Grund der Ungültigkeit wurde nicht durch Lesen sensibler Provider-Antwortkörper untersucht. Die Anwendung wechselte korrekt auf „Anmeldung erforderlich“ und hielt den Entwurf weiterhin sichtbar. Reguläres „Anmelden“ führte per bestehender SSO-Sitzung zur Rückkehr desselben Kontos und stellte den Entwurf automatisch wieder her; die Speicherung im neuen Job ist bestätigt. Dies belegt zusätzlich die Behandlung einer tatsächlich ungültigen Refresh-Sitzung, ersetzt aber keinen gezielten Widerruf für F02.

Danach wurde mit der frischen SSO-Sitzung und normalem Provider ein kontrollierter positiver Refresh geprüft: Nur der lokale Access-Token wurde entfernt; die neue Basisnotiz ließ sich ohne erneute Anmeldung speichern. Datenbanknachweis `acceptance/f01-fresh-refresh-baseline.json` vom 23.10.2026, 13:17:55 MESZ. **F01 ist im anschließenden Durchlauf bestanden:** Die vorab positiv geprüfte Sitzung wurde erneut einem begrenzten Token-Endpunkt-Ausfall ausgesetzt. Der neue Entwurf blieb sichtbar und ungespeichert; UI und bereinigtes Log korrelieren über Request-ID `8a3ff173-7f0d-452f-80cd-225a724a2fe6` mit `provider-unavailable`. Nach vollständiger Rückstellung um 13:19:41 MESZ speicherte „Anmeldung erneut prüfen“ den Entwurf automatisch, ohne erneute Anmeldung. Datenbank und Browser-Neuladen bestätigen exakt den Marker `AUTH1018-F01-FRISCH-20261023`. Codes bleiben ungesetzt. Zusätzliche Belege: `acceptance/f01-fresh-error-evidence.json`, `acceptance/f01-fresh-recovery-evidence.json` sowie `/tmp/auth1018-f01-fresh-refresh-error.png`. Der Ablauf prüft den tatsächlichen Transportausfall; ein natürlicher Access-Token-Ablauf wurde durch den ausdrücklich genehmigten lokalen Schritt ersetzt.

Belege: `/tmp/auth1018-f01-refresh-error.png`, `/tmp/auth1018-f01-http-status.txt`; serverseitig `acceptance/f01-refresh-error-evidence.json`, `acceptance/f01-retry-session-evidence.json`, `acceptance/f01-sso-recovery-evidence.json`.

### F04: Browser-Netzwerkfehler und erfolgreicher Retry

In Chrome DevTools wurde ausschließlich im Test-Tab die neue Request-Blocking-Regel `https://kodierbox-test.iqb.hu-berlin.de/api/auth-data*` aktiviert. Nach Neuladen der Startseite zeigte die App den eigenen Zustand „Die Sitzungsdaten konnten noch nicht geladen werden. Bitte versuchen Sie es erneut oder melden Sie sich neu an.“ mit „Erneut laden“ und „Neu anmelden“; die Arbeitsbereichsliste war nicht irreführend leer dargestellt.

Danach wurde die einzige neue Blockierregel gelöscht, Request-Blocking wieder deaktiviert und der vorherige Network-Filter wiederhergestellt. „Erneut laden“ führte ohne neue Anmeldung zur korrekten Arbeitsbereichsliste einschließlich VERA MaP Probierbereich; der Fehlerhinweis verschwand und Benutzer `coder2` wurde angezeigt. **F04 ist damit für den in den Kriterien vorgesehenen Netzwerkfehler mit anschließendem Retry bestanden.** Es wurde kein künstlicher HTTP-5xx als zusätzliches Szenario erzeugt. Screenshots: `/tmp/auth1018-f04-auth-data-error.png` und `/tmp/auth1018-f04-auth-data-recovery.png`. DevTools danach geschlossen; keine Blockierregel bleibt aktiv.

### Verbleibende Browserfälle und sichere Übergabe

F02 ist auf der Zielinstanz noch nicht vollständig nachgewiesen: Die eigene Keycloak-Accountkonsole unter dem konfigurierten Realm startet mit „failed to initialize keycloak“. Es wurde dort keine Sitzung widerrufen und keine Provider-Konfiguration geändert. Für einen echten externen Sitzungswiderruf ist ein funktionsfähiger Weg nötig.

F03: Der echte 403-Schreibfall inklusive Entwurfserhalt, fehlender Anmeldeschleife und erfolgreichem Speichern nach Rückstellung ist belegt; die spezifische Fehlermeldung ist mangelhaft. Der Backend-401 einschließlich Wiederanmeldung wurde inzwischen geprüft; die zunächst leere Rückkehrseite ist ein weiterer Befund. Der GET-Aufruf bei entzogener Job-Zuweisung bleibt über den allgemeineren Lesezugriff möglich und erfüllt daher nicht den gesuchten 403-Lesefall; dafür wäre ein anderer, geeigneter Berechtigungskontext erforderlich. F07 (ausstehende Antworten bei Ab-/Neuanmeldung derselben bzw. einer anderen Person) bleibt ebenfalls offen. Der Browser wurde weder auf ein anderes Konto umgestellt noch wurden bestehende Kodierungen verwendet.

Aktueller sicherer Stand (23.10.2026, 13:28 MESZ): normale Backend-Konfiguration, ursprüngliche Zuweisung ausschließlich an coder2, keine Browser-Blockierregel aktiv, keine vergebenen Codes und unveränderte Fingerprints des geschützten Bestands. Der letzte Fingerprintvergleich um 13:28:12 MESZ bestätigt unveränderte geschützte Bestandsdaten. Der reguläre Abnahmejob bleibt zur Fortsetzung im Browser offen. Nach den beiden bestätigten F03-Befunden wird keine vollständige Abnahme ausgesprochen; vor Abschluss von F02/F07 und der erneuten Prüfung von F03 sind die Befunde zu beheben bzw. zu klären. Die Tickets bleiben offen; es wurden keine Remote-Kommentare oder Ticketstatusänderungen vorgenommen.

## F06: Bereinigter Betriebsnachweis und Handlungshinweise

Am Testserver wurde der tatsächliche Log-Eintrag des synthetischen ungültigen Refreshs erneut selektiv gelesen. Nur die folgenden erlaubten Felder wurden übernommen:

```json
{
  "event": "oidc-refresh-failed",
  "errorClass": "session-invalid",
  "endpoint": "https://keycloak.kodierbox.iqb.hu-berlin.de/realms/coding-box/protocol/openid-connect/token",
  "httpStatus": 400,
  "requestId": "deployment-auth-20261023"
}
```

Der Providerstatus 400 ist vom Anwendungsstatus **401** zu unterscheiden. HTTP-Fehlerkörper und HTTP-Header der Anwendung tragen dieselbe Request-ID. Der Auszug enthält keine Tokens, Secrets, Queryparameter, Nutzerkennungen oder Provider-Antwortkörper. Der noch fehlende Nachweis ist die Korrelation eines im angemeldeten UI angezeigten Fehlerfalls einschließlich Recovery.

Handlungshinweise zum geprüften Quellstand:

| Diagnose | Vorgehen |
| --- | --- |
| 401 `session-invalid` | Erneute Anmeldung derselben Person anbieten; gespeicherten Entwurf im richtigen Coding-Kontext wiederherstellen und anschließend Speichern/Neuladen prüfen. Wiederholtes Retry ersetzt keine gültige Sitzung. |
| 503 `provider-unavailable` | Erreichbarkeit des konfigurierten Providers vom Backend prüfen; Sitzung und Eingaben erhalten, nach Wiederherstellung erneut versuchen. Den gemeinsam genutzten externen Provider nicht für die Testabnahme anhalten. |
| 503 `configuration-error` | Issuer, tatsächlichen Realm, Client-ID/-Typ, Callback und JWKS-/Token-Endpunkte mit der vorgesehenen Testkonfiguration abgleichen. Konfiguration korrigieren, gezielt Testanwendung neu laden und Recovery prüfen. |
| 403 bei geschützter Aktion | Berechtigung für Arbeitsbereich und Aktion prüfen. Eine vorhandene Refresh-Sitzung nicht als abgelaufen behandeln; keine wiederholte Anmeldung als Ersatz für fehlende Rechte. |

Für Supportfälle Zeitpunkt, Umgebung, sichere Request-ID und Fehlerklasse erfassen. Logs nur nach dieser ID und engem Zeitfenster lesen; vor Weitergabe auf die fünf obigen Felder begrenzen. Keine vollständigen Docker-Inspect-/Env-Ausgaben, Authorization-Header, Cookies, Token-Requests oder DB-Globals veröffentlichen. Diese lokalen Hinweise sind ein Teilbeitrag zur in #571 geforderten Konsolidierung; die vollständige EN-/DE-Dokumentationsabnahme von #571 ist weiterhin offen.

## Historischer Befund vor der Aktualisierung

Lesende HTTPS-Prüfung am 22.10.2026 nach VPN-Verbindung: Startseite und `/api/health` HTTP 200, TLS-Verifikation erfolgreich. OIDC-Discovery des konfigurierten Realms ebenfalls HTTP 200. Issuer: `https://keycloak.kodierbox.iqb.hu-berlin.de/realms/coding-box`.

Ein nicht angemeldeter Aufruf von `/api/auth-data` mit der synthetischen Anfrage-ID `acceptance-auth-20261022` ergab HTTP 401 und dieselbe ID in `X-Request-Id` sowie im JSON-Körper. Das ist ein HTTP-Korrelationsnachweis, keine Korrelation mit einem Betriebslog.

Am 23.10.2026 nach erneuter VPN-Verbindung im geöffneten Chrome-Tab: Loginseite erreichbar, angezeigte Version **1.17.4**. Die ohne Cache abgerufene deutsche Sprachdatei enthält die neuen Schlüssel für Konfigurations-, Provider-, Refresh- und Loginfehler nicht. Der Antwortheader nennt `Last-Modified: Tue, 29 Sep 2026 13:44:04 GMT`.

Serverprüfung per SSH ausschließlich auf der Testinstanz, mit unveränderter Hostschlüsselprüfung:

| Dienst | Laufendes Image |
| --- | --- |
| Frontend | `local/coding-box-frontend:zoneless-loading-20260929` |
| Backend/API | `iqbberlin/coding-box-backend:fix-marking-483f2dabcd08` |
| Export-Worker | `iqbberlin/coding-box-backend:fix-marking-483f2dabcd08` |
| Datenbank | `iqbberlin/coding-box-db:1.17.4`, PostgreSQL 14.23 |

In der Migrationstabelle sind 161 Changesets verzeichnet. Gegenüber dem geprüften Quellstand fehlen anhand der IDs die beiden Changesets `iqb:833-resource-ownership` und `iqb:testcenter-durable-import-runs`. Dies ist noch keine vollständige Liquibase-Checksum-/Upgrade-Abnahme.

Auf dem Server sind etwa **4 GB frei**, die Datenbank belegt etwa **18,66 GiB**. Bestehende Backups belegen etwa 13 GB; ihr Alter und ihre Wiederherstellbarkeit sind nicht neu bestätigt. Es gibt keinen zusätzlich gemounteten Sicherungsdatenträger. Der lokale Mac hat zum Prüfzeitpunkt ebenfalls nur etwa 1,1 GiB frei.

## Ursprünglich vorbereiteter Registry-Weg (historisch)

Ziel ist ausschließlich die Testinstanz mit dem exakt geprüften Commit `474dd5125f9962e4b4d8b60b3f23c0f5637bda9d`. Die grüne Pipeline veröffentlicht nach Commit adressierte Images unter `scm.cms.hu-berlin.de:4567/iqb/coding-box/iqbberlin/` für Backend, Frontend und Liquibase. Die Existenz der drei Commit-Tags sowie folgende Digests wurden am 23.10.2026 über die authentifizierte GitLab-Registry-API bestätigt. Ein Manifestzugriff vom Testserver scheitert derzeit an fehlender Registry-Anmeldung.

| Image | Digest | Registry-Größenangabe |
| --- | --- | --- |
| `coding-box-backend` | `sha256:da095d040bcd693ef94f3a60159919ed7e8c194267e2b52f8bcaba3f74faff64` | 268.253.166 Bytes |
| `coding-box-frontend` | `sha256:dcc7ea7369cf354443b6e70920b1b1785c89507ec71f1850fdbed9f5e159dfec` | 62.940.040 Bytes |
| `coding-box-liquibase` | `sha256:381a7f0aeabb5bcd8b925f95f155da858778c68cbf437296f4d17de7e2390434` | 205.007.689 Bytes |

Die Registry-Größenangaben sind keine Aussage über den zusätzlichen entpackten Speicherbedarf auf dem Server oder den Platz für Sicherung und Wiederherstellungsprüfung. Der Export-Worker verwendet dasselbe Backend-Image.

Vor einer Umschaltung erforderlich:

1. Registry-Zugang und ausreichenden Platz für Images sowie eine konsistente, prüfbare Sicherung bereitstellen. Vorhandene Backups und alte Images bleiben bis zur geklärten Rücknahme erhalten.
2. Die drei bestehenden Anwendungs-Images, Compose-Overrides, sicheren Konfigurationspfade und Datenstände für die Rücknahme erfassen. Aktive Jobs und Exporte vor dem Wartungsfenster prüfen.
3. Commit-Images und neue OIDC-Konfiguration für den vorhandenen `coding-box`-Realm vorbereiten; vorhandenes JWT-Secret beibehalten. Öffentlicher oder vertraulicher Client und Callback-Einstellungen müssen gegen den tatsächlichen Provider geprüft werden. Keine Secrets in dieses Protokoll übernehmen.
4. Sicherung und Wiederherstellbarkeit prüfen, Liquibase-Checksummen und die zwei ausstehenden Migrationen validieren; Anwendungsdienste koordiniert aktualisieren. Ein reines Zurückstellen der Images ist nach Schemaänderung nicht automatisch eine vollständige Datenrücknahme.
5. HTTP-/Health-/Versions-/Login-Prüfung; anschließend F01–F07 anhand eines passenden Test-Arbeitsbereichs und zweier Testkonten durchführen. Erst danach die Abnahmeentscheidung dokumentieren.

Dieser ursprüngliche Registry-Weg wurde wegen ungültiger Anmeldung durch einen Build aus dem exakten Git-Archiv ersetzt. Der abgeschlossene Ablauf ist oben verlinkt. Produktivsystem und externe Provider-Konfiguration wurden nicht verändert. Die vorhandene lokale Änderung an `AGENTS.md` bleibt unangetastet.

## F03-Korrektur und erneute lokale Prüfung

Die zu frühe Replay-Anfrage wurde im bisherigen Produktionsbuild durch einen neuen Cypress-Fall reproduziert: Bei verzögertem Login-Code-Austausch begann die geschützte Replay-Anfrage vor Abschluss des Callbacks. Der korrigierte Start deaktiviert die automatische erste Navigation und startet sie erst nach Callback und Auth-Daten-Bootstrap. Der bereits bereinigte Rücksprung im URL-Hash wird dabei direkt verwendet. Beim Speichern von Notizen und Kodierungen überlagert der Replay-Service die zentralen Sitzungs-/Berechtigungshinweise bei 401/403 und abgebrochenen Auth-Anfragen nicht mehr; Entwurf und Fehlerspeicher bleiben für eine Wiederholung erhalten.

Nach `ENOSPC` wurden auf ausdrücklichen Wunsch nur regenerierbare lokale Dateien bereinigt: drei unbenutzte Docker-Installationsmedien regulär ausgehängt, der verbleibende Installer-Download, Cypress 15.10.0 und zwei npm-Download-Caches entfernt. Geschützte npm-Dateien wurden übersprungen. Cypress 15.21.1, Projekte, Zugangsdaten, Docker-Volumes, Datenbanken und bestehende Sicherungen blieben erhalten. Danach waren rund 7,9 GiB frei. Der weitere lokale Build-Abbruch war laut Crash-Bericht ein nativer Fehler im Compiler-Cache (`SIGABRT`, `node.napi.node`, `EnvWrap::openEnv`). Der Produktionsbuild bestand im vorgesehenen CI-Modus ohne persistenten Angular-Cache; erforderlicher Netzwerkzugriff für die bestehende Google-Fonts-Einbettung wurde erlaubt. Produktkonfiguration und Optimierungen wurden dafür nicht verändert.

Lokale Nachweise:

- 187 gezielte Tests in sechs Auth-/App-/Replay-Suites bestanden.
- Frontend-Lint und Produktionsbuild bestanden.
- Die vollständige Frontend-Testsuite bestand mit 3.225 Tests in 291 Suites (238,7 Sekunden, beendet um 11:59:13 UTC). Währenddessen wurden keine Backend-Prüfungen ausgeführt.
- Elf bestehende Login-/Recovery-Browserfälle und der neue verzögerte Replay-Callback-Fall bestanden gegen genau dieses Produktionsartefakt. Der neue Fall war gegen den bisherigen Build rot und ist mit der Korrektur grün. Die Backend-Antworten dieser lokalen Browserfälle sind simuliert; die tatsächliche Zielabnahme bleibt separat erforderlich.
- Vor der vorbereiteten Frontend-Aktualisierung bestand der erneute Fingerabdruckvergleich der geschützten ursprünglichen Daten um 11:56:19 UTC vollständig.

Artefakt: Basis-Commit `ac6ad9499485cbf4444ad1b5da3b5c315f250739` plus sechs in `artifact-manifest.json` einzeln gehashte Quelldateien; Quelldigest `e975b13da2618cd264aa4375adcd1716f06af542d95f4d1ecddca7d3797aea46`. Neues Hauptbundle `main-BCB4BPYD.js`, SHA-256 `8d1111cb4ffc91723d0701364072275acbe9786c3eefd5ebba5acc4d64883087`. Separates Frontend-Image `local/coding-box-frontend:f03-e975b13da261-20261023`, ID `sha256:629878cb8e110049922babba9f3592e54fe50d997fec19a1d13d54af3dad852b`. Vorbereitung und Rücknahmekonfiguration liegen unter `/home/user/kodierbox-deploy/f03-recovery-20261023/frontend-e975b13da261/`; die Vorbereitung allein hat keinen laufenden Container geändert. F03 bleibt bis zur erneuten Live-Prüfung offen, ebenso die Tickets bis zur bestätigten Abnahme.

### Erneute F03-Live-Abnahme mit der Korrektur

Die Frontend-Aktualisierung wurde um 11:59:36 UTC abgeschlossen. Ausschließlich der Frontend-Container wurde ersetzt. Hauptbundle und SHA-256 wurden über die tatsächliche Test-URL geprüft; API-Health war erfolgreich und sämtliche übrigen laufenden Container behielten ihre Identität. Der vorhandene Compose-Aufruf enthält den neuen Frontend-Override auch für nachfolgende Backend-Fehlertests. Bisheriges Image und vollständige private Compose-Konfiguration bleiben für eine Rücknahme erhalten. Im Browser wurde `main-BCB4BPYD.js` bestätigt. Das zunächst von der automatischen Freigabeprüfung angehaltene Neuladen erfolgte erst nach exaktem Vergleich zwischen sichtbarer Testnotiz und gespeicherter Datenbanknotiz.

**403 bestanden:** Ausschließlich die genehmigte coder2-Zuweisung zum neuen Job wurde erneut kurz entzogen. Beim tatsächlichen Speicherversuch erschien „Sie haben keine Berechtigung für diese Aktion“, ohne überlagernden allgemeinen Verbindungshinweis und ohne Anmeldeumleitung. Der Browser behielt den neuen Entwurf, während die Datenbank um 12:01:18 UTC weiterhin die vorherige Notiz enthielt. Um 12:01:19 UTC wurde die Zuweisung einschließlich Original-ID und Zeitstempel exakt wiederhergestellt. Derselbe Entwurf wurde danach ohne erneute Anmeldung erfolgreich gespeichert und um 12:01:54 UTC in der Datenbank bestätigt. Beide Codes und Scores bleiben ungesetzt. Belege: `/tmp/auth1018-f03-403-retest.png` und serverseitig `acceptance/f03-retest-403-denied-evidence.json` sowie `acceptance/f03-retest-403-recovered-evidence.json`.

**401 und direkte Rückkehr bestanden:** Der zeitlich begrenzte Issuer-Fehler wurde ausschließlich im Test-Backend erneut erzeugt. Die Anwendung verlangte eine erneute Anmeldung, sperrte Kodieraktionen und behielt die neue Notiz `AUTH1018-F03-401-RETEST-20261023: Direkte SSO-Rückkehr mit erhaltenem Entwurf.`. Die Datenbank enthielt zunächst weiterhin die vorherige 403-Testnotiz. Um 12:02:48 UTC war die normale Auth-Konfiguration vollständig wiederhergestellt. Die Provider-Sitzung verlangte diesmal die tatsächliche Anmeldung durch den Benutzer. Nach dessen Bestätigung erschien der Abnahmejob mit Player und erhaltenem Entwurf direkt; durch die Prüfung wurde kein manuelles Neuladen als Reparatur ausgelöst. Die automatische Speicherung des wiederhergestellten Entwurfs ist um 12:05:37 UTC in der Datenbank bestätigt. Ein erst danach durchgeführtes, mit dem gespeicherten Text abgesichertes Neuladen erhielt die Notiz ebenfalls. Belege: `/tmp/auth1018-f03-401-retest-required.png`, `/tmp/auth1018-f03-401-retest-return.png`, serverseitig `acceptance/f03-retest-401-rejected-evidence.json` und `acceptance/f03-retest-401-recovered-evidence.json`.

Der vollständige geschützte Ausgangsdatenvergleich war nach den Fehlertests um 12:03:36 UTC erneut unverändert. Alle absichtlich erzeugten Backend-Fehler sind zurückgestellt; die coder2-Zuweisung ist wiederhergestellt. Damit sind die beiden F03-Befunde live behoben und die Teilfälle Backend-401 sowie Speichern mit 403 bestanden. Der tatsächliche geschützte Ansichtsaufruf mit 403 bleibt separat nachzuweisen: coder2 besitzt auch ohne Job-Zuweisung allgemeineren Lesezugriff. F03 wird deshalb insgesamt noch nicht als vollständig bestanden gewertet. Die Tickets bleiben bis zur separaten bestätigten Gesamtabnahme offen. Die nach Abschluss der lokalen Prüfung zusätzlich erschienenen Änderungen an Response-/User-Services gehören nicht zu diesem Frontend-Artefakt und wurden hier nicht bearbeitet.

### F02: Widerruf mit tatsächlich ungespeichertem Entwurf

Die eigene Sitzung wurde über den tatsächlichen Logout-Endpunkt des externen Keycloak-Realms widerrufen; die Provider-Seite bestätigte die Abmeldung. Eine erste Vorprüfung hatte ihre Notiz noch mit dem gültigen Access-Token gespeichert und wurde deshalb nicht als vollständiger F02-Nachweis gewertet.

Für den vollständigen Durchlauf wurde ausschließlich der alte Kodier-Tab über Chrome DevTools vorübergehend offline gesetzt. Die neue Notiz `AUTH1018-F02-UNSAVED-20261023: Dieser ungespeicherte Entwurf muss den Sitzungswiderruf überstehen.` blieb sichtbar; die Datenbank enthielt um 12:22:48 UTC nachweislich noch die vorherige Testnotiz. Die eigene Provider-Sitzung wurde in einem getrennten, normal erreichbaren Tab widerrufen. Anschließend wurde ausschließlich der bereits ausdrücklich freigegebene lokale Access-Token entfernt; Refresh-Token und Rechte blieben erhalten. Nach Rückstellung auf „No throttling“ und „Anmeldung erneut prüfen“ wies der echte Provider die Refresh-Sitzung zurück. Das UI verlangte eine Anmeldung und behielt den gesperrten Entwurf. Auch um 12:27:07 UTC war er noch nicht in der Datenbank gespeichert.

Nach der vom Benutzer vorgenommenen erneuten Anmeldung als coder2 erschien derselbe Entwurf wieder und wurde automatisch gespeichert. Die Datenbank bestätigt den exakten Text um 12:28:35 UTC; beide Codes und Scores bleiben NULL. Erst nach exaktem DOM-/Datenbankvergleich wurde neu geladen; die Notiz blieb erhalten. Der geschützte Ausgangsdatenvergleich war zuletzt vor diesem ausschließlich synthetischen Notiztest um 12:19:29 UTC vollständig unverändert.

Bereinigter Provider-Nachweis des kontrollierten Widerrufs: `oidc-refresh-failed`, Klasse `session-invalid`, Providerstatus 400, Endpunkt `https://keycloak.kodierbox.iqb.hu-berlin.de/realms/coding-box/protocol/openid-connect/token`, Request-ID `eb9f47bd-df4d-4295-ae94-f2a2865cacc1`. Der Providerstatus ist vom Anwendungsstatus 401 zu unterscheiden. Tokenwerte und Provider-Antwortkörper wurden nicht gelesen oder übernommen.

**F02 ist damit auf der Zielinstanz bestanden.** Belege: `/tmp/auth1018-f02-unsaved-session-rejected.png`, `/tmp/auth1018-f02-unsaved-recovered.png`; serverseitig `acceptance/f02-unsaved-before-revocation-evidence.json`, `acceptance/f02-unsaved-session-rejected-evidence.json`, `acceptance/f02-unsaved-recovered-evidence.json` und `acceptance/f02-refresh-rejection-diagnostics.json`. Die Netzwerkeinstellungen wurden vor dem anschließenden F07-Test normalisiert; die Backend-Konfiguration blieb während F02 unverändert.

### F07: begonnener Durchlauf, noch ohne Ergebnis

Nur im alten Kodier-Tab wurde ein DevTools-Profil mit 180.000 ms Latenz aktiviert. Die tatsächliche Anfrage an `/api/auth/refresh` war in der Netzwerkübersicht als `(pending)` sichtbar; bereinigter Nachweis `/tmp/auth1018-f07-pending-network.txt`. Ein vorbereiteter zweiter Tab wurde währenddessen regulär abgemeldet und auf die erneute Anmeldung als coder2 geführt. Um 12:41:21 UTC enthielt die Datenbank weiterhin die vorherige Testnotiz, nicht den neuen Browser-Entwurf `AUTH1018-F07-RACE-20261023`.

Die Anmeldung ist an den Benutzer übergeben. Damit ist F07 noch nicht bestanden: Der Eingang der alten Antwort muss zeitlich nach der bestätigten neuen Anmeldung liegen. Falls das Zeitfenster vorher abläuft, darf dieser Durchlauf nur die Abmeldung während eines ausstehenden Refreshs belegen und muss für die vollständige Reihenfolge wiederholt werden. Auch der Durchlauf mit einem anderen Konto und die anschließende Normalisierung der temporären Netzwerkdrossel stehen noch aus. Die rein lesende Rechteprüfung ergab für coder2 und coder5 jeweils Arbeitsbereichszugriff 3 in Arbeitsbereich 3; allein ein Wechsel zu coder5 erzeugt deshalb dort keinen 403-Lesefall. Für einen getrennten unverändernden 403-Ansichtstest ist ein bestehender Job in Arbeitsbereich 24 ohne coder2-Mitgliedschaft identifiziert; es wurden dafür keine Rechte geändert und keine bestehenden Antworten geöffnet oder verändert.

### Fortsetzung: Zeitfenster und neuer F03-Befund

Die verzögerte Refresh-Antwort kam mit HTTP 200 nach rund drei Minuten zurück. Die neue Anmeldung wurde erst später bestätigt; dieser Durchlauf erfüllt daher nicht die vollständige F07-Reihenfolge. Der alte Browser-Entwurf `AUTH1018-F07-RACE-20261023` wurde nicht gespeichert: Der Datenbanknachweis `acceptance/f07-first-response-after-login-evidence.json` von 12:50:11 UTC enthält weiterhin ausschließlich die vorherige synthetische Notiz. Die Netzwerkübersicht ist unter `/tmp/auth1018-f07-first-response-network.txt` festgehalten. Das Profil wurde auf „No throttling“ zurückgestellt und DevTools geschlossen. Nach der Browserunterbrechung waren die temporären Abnahme-Tabs nicht mehr vorhanden; der verbliebene Startseiten-Tab wurde für die Fortsetzung verwendet. F07 bleibt offen, insbesondere auch der Wechsel zu einem anderen Konto.

Der lesende Versuch, eine Ansicht in Arbeitsbereich 24 ohne Mitgliedschaft aufzurufen, erzeugte anschließend **401 statt des erwarteten 403**. Dies wurde nach einer frischen erfolgreichen SSO-Anmeldung reproduziert; das UI zeigte „Anmeldung erforderlich“ und „Authentisierungs-Token ist ungültig“. Quellprüfung: `WorkspaceGuard.canActivate()` in `apps/backend/src/app/admin/workspace/workspace.guard.ts` wirft bei `canAccessWorkSpace(...) === false` aktuell `UnauthorizedException`, auch für einen bereits authentifizierten Benutzer. Die fehlende Arbeitsbereichsberechtigung wird dadurch als Sitzungsfehler behandelt. Der genaue erste HTTP-Endpunkt wurde in diesem Durchlauf nicht zusätzlich im Netzwerkprotokoll erfasst; die Zuordnung zum Guard stützt sich auf die reproduzierte Ansicht, den fehlenden Workspace-Zugriff und den produktiven Quellpfad. Dies ist ein weiterer F03-Befund, kein bestandener 403-Ansichtstest. Die beiden zuvor korrigierten Befunde bleiben davon getrennt erfolgreich nachgeprüft.

Die normale Anmeldung als coder2 wurde anschließend auf der Startseite erneut bestätigt, ohne weiteren Zugriff auf den nicht freigegebenen Arbeitsbereich. Screenshot: `/tmp/auth1018-normal-session-20261023.png`. Der geschützte Bestandsvergleich bestätigte um 12:54:58 UTC sämtliche ursprünglichen Fingerabdrücke unverändert. Keine bestehenden Rohdaten oder Kodierungen wurden verändert; keine Tickets geschlossen oder Remote-Kommentare veröffentlicht.

Hinweis zur Diagnosedatei: Eine spätere Abfrage des rollierenden Zwölf-Minuten-Fensters lieferte keine Refresh-Fehler mehr und überschrieb die Ergebnisdatei `f02-refresh-rejection-diagnostics.json` mit einem leeren Trefferstand. Der zuvor tatsächlich erfasste F02-Eintrag mit Request-ID `eb9f47bd-df4d-4295-ae94-f2a2865cacc1` ist deshalb separat als `acceptance/f02-refresh-rejection-confirmed.json` aus dem bereinigten Werkzeugergebnis gesichert; Herkunft und Zeitpunkt sind dort ausdrücklich kenntlich gemacht.

### Weiterer F07-Versuch mit zweitem Konto

Ein neuer coder2-Tab für Job 2777 wurde mit 300.000 ms Antwortlatenz vorbereitet. Nach genehmigter Entfernung ausschließlich des lokalen Access-Tokens löste die neue synthetische Notiz `AUTH1018-F07-CODER2-ALT-20261023` einen tatsächlich ausstehenden Refresh aus; bereinigter Netzwerkbeleg `/tmp/auth1018-f07-coder5-pending.txt`. Der zweite Tab wurde regulär abgemeldet und für coder5 vorbereitet. Der Benutzer meldete anschließend, dessen Passwort gerade nicht zu kennen. Zu diesem Zeitpunkt war der Pending-Nachweis bereits rund 5,9 Minuten alt; auch dieser Versuch wird nicht als bestandener F07-Kontowechsel gewertet.

Die Anmeldung ist nun für ein anderes bekanntes Konto als coder2 offen. Es wurde kein Passwort zurückgesetzt oder ausgelesen und kein neues Konto angelegt. Die Rückstellung des alten Tabs auf „No throttling“ wurde beim Chrome-Tabwechsel unterbrochen und ist **noch nicht bestätigt**; sie muss vor weiteren Aktionen im alten Abnahme-Tab überprüft werden. Der alte Tab bleibt bis dahin unberührt. Die Tickets bleiben offen.

Nachfolgend bestätigt: Das Netzwerkprofil des alten Abnahme-Tabs steht wieder auf **„Disabled: No throttling“**, DevTools sind geschlossen. Der Kontowechsel-Versuch wurde beendet. Die gemeldete erneute coder2-Anmeldung lieferte im vorbereiteten Tab „Anmeldung nicht abgeschlossen“; eine tatsächlich neue gültige App-Sitzung ist dadurch nicht bestätigt. Es wurde keine weitere Anmeldung angefordert. F07 bleibt ohne verfügbares zweites Konto offen; die Wiederholung als coder2 allein erfüllt den noch fehlenden Kontowechsel nicht.

## WorkspaceGuard-Korrektur am 23.10.2026

Auf ausdrücklichen Auftrag wird fehlender Arbeitsbereichszugriff bei bereits bestätigter Identität jetzt als `ForbiddenException` (403) statt `UnauthorizedException` (401) behandelt. Dies gilt für normale Benutzer und für einen gültigen, zum Arbeitsbereich passenden Workspace-Token nach Entzug der Mitgliedschaft. Fehlende Identität, unbekannter Benutzer, ungültige Workspace-ID und ein Token für einen anderen Arbeitsbereich bleiben 401. Andere Guards, etwa die Prüfung einzelner Zugriffslevel, werden durch diesen eng begrenzten Patch nicht verändert.

Nachweise über Nx, Backend und Frontend getrennt geprüft:

- Regression zuerst rot: sechs gezielte Prüfungen erwarteten 403 und erhielten das bisherige 401.
- Nach Korrektur 45 gezielte Guard-/JWT-HTTP-Tests bestanden. Die HTTP-Suite verwendet echte signierte JWTs, den produktiven JWT-/kombinierten Guard, WorkspaceGuard und Fehlerfilter. Sie prüft 403 samt Request-ID, anschließend 200 mit demselben JWT und weiterhin 401 bei fehlender/abgelaufener Authentifizierung.
- Vollständige Backend-Suite: 220 Suites / 3.467 Tests bestanden, acht Suites / 67 bereits vorgesehene Tests übersprungen. Bestehende HTTP-Tests für Arbeitsbereichs-/Benutzerzugriff wurden ausschließlich an den neuen WorkspaceGuard-Status angepasst; ihre Prüfungen gegen unerlaubtes Lesen und Schreiben bleiben erhalten. Protokoll `/tmp/workspace-403-backend-tests-final.log`.
- Backend-Lint und Produktionsbuild bestanden. Protokolle `/tmp/workspace-403-backend-lint.log`, `/tmp/workspace-403-backend-build.log`.
- Frontend-Vertrag: 64 Tests in Auth-Interceptor und AppService bestanden, insbesondere 403 ohne Sitzungsende. Protokoll `/tmp/workspace-403-frontend-contract.log`.

Um **13:24:12 UTC / 15:24:12 MESZ** wurde ausschließlich die Test-API ersetzt. Image `local/coding-box-backend:workspace-403-0f78fccd1cdf-20261023`, ID `sha256:5a1d27adfcda1c47c5603848d7c9a718735d785c758b5c9e7bd1ca58187b7fdb`. Der tatsächliche Runtime-Hash von `main.js` wurde mit `d3414946b8a81475d7e5640d0d98062f03f3f0e3d48646d14c46e28f2347e348` bestätigt. Basis-Commit `ac6ad9499485cbf4444ad1b5da3b5c315f250739`; sechs einzeln gehashte Backend-Quell-/Testdateien, Quelldigest `0f78fccd1cdf579aa5615c682aefe2e4c5bf4a23eab9e89088f9348a3d880a7b`. Artefakt und gesicherte vollständige Rücknahmekonfiguration: `/home/user/kodierbox-deploy/workspace-403-20261023/backend-0f78fccd1cdf/`. Keine Migration, keine Änderung an Frontend oder Export-Worker; die Identitäten aller übrigen Container blieben erhalten. Bestehende Sicherungen bleiben erhalten.

**Erster Zwischenstand nach Auslieferung, noch kein Abnahmenachweis:** Der erste erneute Aufruf der geschützten Replay-Ansicht in Arbeitsbereich 24 lieferte weiterhin 401 auf `/api/wsg-admin/workspace/24/coding-job/2776/replay-session` und beim Replay-Statistik-Aufruf. Die Antwort des Sitzungsaufrufs enthielt `Unauthorized`, Request-ID `d67084fc-5a09-4141-b89e-35744935dc26`. Bereinigter Netzwerkbeleg `/tmp/workspace-403-live-network.txt`. Die Zuordnung dieses 401 zu einer konkreten Guard- oder Sitzungsursache wurde nicht abschließend nachgewiesen. Der lokale HTTP-Nachweis und die erfolgte Auslieferung ersetzen die Live-Prüfung nicht; deren erfolgreicher Abschluss ist im folgenden Abschnitt dokumentiert.

Der alte F07-Tab wurde nach Sicherung ausschließlich seines synthetischen Entwurfstextes unter `/tmp/auth1018-f07-synthetic-draft-retained.txt` geschlossen. Die normale Startseite wurde aufgerufen; Keycloak verlangt inzwischen eine neue Anmeldung. Coder2 ist dafür vorbereitet und die Eingabe an den Benutzer übergeben. Keine weitere Abnahme wird vor diesem Nachweis erklärt. Für einen späteren F07-Kontowechsel nennt der Benutzer jetzt coder3 oder coder1; coder5 ist laut Benutzer kein verfügbares Konto. Beide Tickets bleiben offen.

### Erfolgreiche Live-Nachprüfung nach der coder2-Anmeldung

Die vom Benutzer zunächst als möglicherweise fehlgeschlagen gemeldete Anmeldung war erfolgreich: Der tatsächliche Code-Austausch `/api/auth/exchange` lieferte HTTP 200, der Auth-Daten-Aufruf HTTP 304 mit vorhandener Cache-Antwort. Die Startseite zeigte anschließend ausdrücklich `Benutzer: coder2` und dessen Arbeitsbereiche. Danach wurde keine weitere Anmeldung ausgelöst.

Der reguläre Replay-Ansichtsaufruf für Arbeitsbereich 24 / Job 2776 wurde mit dem ausschließlich synthetischen Testpersonen-/Unit-Pfad ausgeführt. Der produktive WorkspaceGuard verweigert den Zugriff vor dem Laden der Antwortdaten. Die tatsächlichen Anfragen an `/api/wsg-admin/workspace/24/coding-job/2776/replay-session` lieferten jetzt **HTTP 403**. Im sichtbaren Accessibility-Baum der Anwendung stand **„Sie haben keine Berechtigung für diese Aktion“**. Es erschien kein Anmeldezwang. Der bereinigte Konsolennachweis enthält außerdem 403 für den zugehörigen Arbeitsbereichs-Settings- und Replay-Statistik-Aufruf. Bestehende Rechte und Zuweisungen wurden für diesen Durchlauf nicht verändert.

Als unmittelbare Gegenprobe wurde über die Startseite der eigene synthetische Job 2777 in Arbeitsbereich 3 geöffnet: `/api/wsg-admin/workspace/3/coding-job/2777/replay-session` antwortete mit **HTTP 200**, ohne erneute Anmeldung. Player, synthetische Antwort, bestehende Testnotiz `AUTH1018-F07-PENDING-20261023` und Fortschritt **0/2** waren sichtbar. Der Wechsel über die Startseite stellt sicher, dass eine neue Replay-Komponente samt Anfrage geladen wird; ein bloßer Querywechsel in der bereits geöffneten Komponente wurde nicht als Nachweis gezählt.

Bereinigte Netzwerkbelege mit URL und Status: `/tmp/workspace-403-confirmed-sessions-network.txt` (403, 403, anschließend 200). Ergänzend `/tmp/workspace-403-confirmed-console.txt`. Der Hinweis ist durch die beobachtete UI-/Accessibility-Ausgabe belegt; die Aufnahme `/tmp/workspace-403-view-feedback.png` zeigt wegen des Aufnahmezeitpunkts nur eine leere Fläche und wird ausdrücklich **nicht** als sichtbarer Hinweisbeleg gewertet. Für den initialen 401-Zwischenstand wird keine nachträglich unbewiesene Token-Ursache behauptet. Seit der erfolgreichen Anmeldung war keine weitere Code- oder Laufzeitänderung erforderlich.

**Ergebnis:** Der WorkspaceGuard-Befund „401 statt 403“ ist behoben und auf der Zielinstanz nachgeprüft. Damit ist auch der bislang fehlende F03-Teilfall des geschützten Ansichtsaufrufs bestanden; die bereits erfolgreich geprüften 401-Recovery- und 403-Schreibfälle gelten weiterhin.

Die neue Testfixture war laut rein lesendem Datenbankbeleg `acceptance/workspace-403-retest-evidence.json` um 13:42:07 UTC unverändert, einschließlich coder2-Zuweisung und weiterhin ungesetzter Codes/Scores. Der abschließende Vergleich um **13:44:40 UTC / 15:44:40 MESZ** bestätigt unveränderte vollständige Zeilenfingerprints der geschützten ursprünglichen Daten: 19 Personen, 19 Booklets, 307 Units, 1.784 Responses, acht Kodierjobs, 84 Job-Units, acht Job-Zuweisungen, eine Jobdefinition, 1.185 Bookletinfos, 307 Chunks und 969 Unit-Laststates. Der Nachweis bezieht sich auf die vor Beginn festgelegten ursprünglichen Vergleichsdaten; neue synthetische Abnahmedaten sind separat erfasst.

Der Browser steht wieder im separaten Job 2777. Die Netzwerkdrossel war zuletzt ausdrücklich **„Disabled: No throttling“**; die abschließende Rückstellung des reinen DevTools-Anzeigefilters und das Schließen von DevTools wurden durch einen Wechsel auf einen anderen Chrome-Tab unterbrochen und nicht bestätigt. Dies verändert keine Anwendungskonfiguration. Für F07 sind künftig coder3 oder coder1 vorgesehen; ein weiterer Kontowechsel wurde in diesem Durchlauf nicht begonnen. F06/#571, F07 und die bestätigte fachliche Gesamtabnahme bleiben offen, ebenso beide Tickets. Diese Korrektur ist lokal geprüft und auf der Testinstanz ausgeliefert, noch nicht committed oder gepusht.

## F07 mit coder3 und F06-Betriebsdokumentation am 23.10.2026

### F07: coder2 → coder3, alte Antwort nach neuer Anmeldung

Vor Beginn bestätigt der Vergleich um 13:49:10 UTC unveränderte geschützte ursprüngliche Daten. Ausschließlich im separaten Job 2777 wird ein neuer Browserentwurf mit Marker `AUTH1018-F07-CODER3-ALT-20261023` eingegeben. Der ausdrücklich freigegebene lokale Access-Token wird über die DevTools-Speicheroberfläche entfernt, ohne Tokenwerte auszulesen. Nur der alte Tab erhält das temporäre Profil `F07-Abnahme-10min` mit 600.000 ms Latenz; API und Provider liefern weiterhin reale Antworten.

Die Anfrage an `/api/auth/refresh` ist um **13:56:28 UTC** tatsächlich pending. Der zweite Tab wird regulär abgemeldet und der Benutzer meldet sich dort als coder3 an. Die Startseite mit Arbeitsbereichen und `Benutzer: coder3` ist um **13:58:28 UTC** bestätigt. Im alten Tab steht derselbe Refresh um **13:59:07 UTC** weiterhin auf pending. Erst danach wird auf **„Disabled: No throttling“** zurückgestellt; die alte Refresh-Antwort ist um **13:59:39 UTC** mit **HTTP 200** erfasst.

Der neue Tab zeigt auch nach anschließendem Neuladen coder3. Im selben synthetischen Job 2777 ist die zuvor gespeicherte Notiz `AUTH1018-F07-PENDING-20261023` sichtbar; der neue ungespeicherte coder2-Marker erscheint dort nicht. Die rein lesende Datenbankkontrolle um 13:59:55 UTC bestätigt die bisherige Testnotiz, beide Codes/Scores NULL und die unveränderte coder2-Zuweisung. Der alte eigene Browserentwurf ist vor dem Schließen seines Tabs unter `/tmp/auth1018-f07-coder2-discarded-draft.txt` gesichert. Es wurde keine Zuweisung an coder3 angelegt und kein bestehender Job bearbeitet.

### F07: coder3 → coder3, erneute Sitzung derselben Person

Ein zweiter Durchlauf beginnt mit zwei regulären coder3-Tabs. Nach Entfernung ausschließlich des lokalen Access-Tokens löst der lesende Aufruf des synthetischen Jobs einen Refresh aus; dieser ist um **14:03:46 UTC** pending. Der andere Tab wird regulär abgemeldet. Ein Chrome-Passwortmanager-Hinweis blockierte zwischenzeitlich die Menübedienung und wurde geschlossen; es wurde kein Passwort gelesen, geändert oder gespeichert. Die erneute Anmeldung übernimmt der Benutzer.

Die neue coder3-Sitzung mit Arbeitsbereichen ist um **14:06:10 UTC** bestätigt; der alte Refresh ist um **14:07:16 UTC** noch pending. Nach Rückstellung auf „No throttling“ ist dessen reale Antwort um **14:07:48 UTC** mit **HTTP 200** erfasst. Danach bleibt coder3 auch beim Neuladen nutzbar. Dieser zweite Durchlauf verwendet ausschließlich Leseaufrufe, keinen weiteren Notiz-/Kodierungsschreibtest.

**Beweisgrenze:** Die Zeitfolge neue Anmeldung → alter Refresh noch pending → alte Antwort 200 ist in beiden Durchläufen ausdrücklich beobachtet. Das unterschiedliche Konto und der nicht übernommene Entwurf sind im ersten Durchlauf sichtbar geprüft. Tokenwerte oder interne Sitzungsspeicher wurden nicht ausgelesen. Ein zusätzlich versuchter Kontrollaufruf nach Neuladen lieferte keinen nachgewiesenen neuen Refresh und wird nicht als Beleg für eine weitere Token-Erneuerung gezählt. Der ergänzende automatisierte Nachweis prüft das Verwerfen alter Token-/Fehlerantworten und die Benutzer-/Kontextzuordnung von Entwürfen.

Ausgeführt über Nx, ohne Cache und getrennt von Backend-Aufgaben: `nx test frontend --runInBand --testPathPatterns='auth.service.spec.ts|session-recovery.service.spec.ts|app.service.spec.ts' --skip-nx-cache`; **3 Suites / 78 Tests bestanden**. Log `/tmp/auth1018-f07-regression-20261023.log`. Strukturierte Zeitfolge und Ergebnis: [auth-f07-evidence-2026-10-23.json](auth-f07-evidence-2026-10-23.json). Weitere Belege: `/tmp/auth1018-f07-coder3-pending.json`, `...-login-confirmed.json`, `...-pending-after-login.json`, `...-late-response.txt`, `...-fixture-after-response.txt` sowie dieselben Zeitbelege mit Präfix `auth1018-f07-coder3-same-`. Finale Startseite: `/tmp/auth1018-f07-coder3-final-home.png` und `...-final-home.txt`.

Beide verzögerten Tabs sind geschlossen, die Drossel war davor jeweils ausdrücklich auf „No throttling“ zurückgestellt. Der verbleibende Abnahme-Tab steht mit coder3 auf der normalen Startseite; keine weitere Anmeldung ist nötig. Backend-/Providerkonfiguration, Berechtigungen und bestehende Sicherungen wurden in diesen F07-Durchläufen nicht geändert. Der vollständige ursprüngliche Vergleich ist um **14:11:18 UTC** erneut grün. Die abschließende Fixture-Kontrolle `acceptance/f07-coder3-final-evidence.json` um **14:16:19 UTC** bestätigt unveränderte gespeicherte Testnotiz, beide Codes/Scores NULL sowie exakt die bisherige coder2-Zuweisung.

### F06: Betriebsdiagnose in deutscher und englischer Anleitung ergänzt

Die bisherigen allgemeinen Debugging-Abschnitte in [OIDC-Authentifizierung](../oidc-authentication-de.md#55-authentifizierungsfehler-im-betrieb-unterscheiden-f06) und [OIDC Authentication](../oidc-authentication.md#55-operational-authentication-diagnosis-f06) enthalten nun:

- `session-invalid`/401, `provider-unavailable`/503, `configuration-error`/503, JWT-401 und fehlende Berechtigung/403 mit jeweils passenden Handlungsschritten; `invalid_grant` und noch ältere AccessLevel-401 werden ausdrücklich unterschieden.
- Zuordnung der sichtbaren Fehler-ID zu HTTP-Header/Fehlerkörper und Backend-Ereignis, sichere Request-ID-Zeichen/Größe sowie getrennte Bedeutung von Anwendungsstatus und Provider-`httpStatus`.
- Ausschließlich fünf zulässige Diagnosefelder, bereinigter Provider-Endpunkt ohne Zugangsdaten/Query/Fragment und ausdrücklicher Ausschluss von Tokens, Secrets und personenbezogenen Nutzdaten.
- Einmalige private Aufnahme eines begrenzten Logfensters mit der vollständigen aktiven Compose-Konfiguration; vorhandene Vorfallsnachweise werden nicht durch spätere leere rollierende Abfragen überschrieben.
- Erreichbarkeitsprüfung aus dem Backend-Netz, gezielte Konfigurationskorrektur und bestätigte Recovery anhand der bereits tatsächlich geprüften F01/F02/F05-Fälle. Ein Browser-Login allein gilt nicht als Nachweis der Backend-Provider-Verbindung.

Die Anleitung ist gegen `auth-provider-errors.ts`, `auth-failure.exception.ts`, `oidc-auth.service.ts`, `jwt.strategy.ts`, Request-ID-Middleware und HTTP-Fehlerfilter abgeglichen. Die gespeicherten bereinigten Ereignisse `f05-error-evidence.json` und `f02-refresh-rejection-confirmed.json` wurden erneut gelesen: JWKS-404 → Konfigurations-503 mit Request-ID `0e075764-a20d-40fe-8e9b-9cbb22c12136`, Refresh-Provider400 → Sitzungs-401 mit Request-ID `eb9f47bd-df4d-4295-ae94-f2a2865cacc1`. Der aktive Compose-Wrapper unterstützt die dokumentierten Log-Optionen `--since` und `--no-color`; JSON-Beispiele, Shell-Syntax und lokale Protokollverweise sind geprüft. Es wurde für die Dokumentation kein weiterer Fehler in die laufende Instanz eingebaut.

**Stand vor der anschließenden PR-Vorlage:** Die dokumentierten F07-Live-Fälle und die F06-Diagnoseergänzung liegen zur fachlichen Bestätigung vor. Die Dokumentationsänderungen sind lokal und noch nicht committed/gepusht; der übrige Umfang von #571 bleibt offen. #566 und #1018 bleiben ausdrücklich offen. Keine Checkliste, Workflowänderung, Veröffentlichung oder Ticketkommentierung wurde ausgeführt.


## Integration zur PR-Vorlage am 23.10.2026

Die Auth-Korrekturen und dieses Protokoll wurden zunächst isoliert auf `develop`-Basis
`f3e8a3b37feac818c3fe0fe65d22dfbbcff60c08` integriert. Während der Prüfung wurde
PR #1093 gemergt; die finale PR-Vorlage ist auf
`b80bf65ac5a19847ce510ad36eba857cef3c290f` abgeglichen. Parallele Änderungen im
ursprünglichen Arbeitsverzeichnis sind nicht Bestandteil der Vorlage.

Der Review ergänzt Regressionstests für fehlgeschlagene Code-Speicherungen bei
401, 403, Sitzungswechsel und temporär unmöglichem Refresh: Die ausstehende
Auswahl bleibt im Recovery-Snapshot erhalten, der spezifische Auth-Hinweis wird
nicht überschrieben und ein erfolgreicher Retry beendet den Speicherfehler.
Der Browsertest prüft die verzögerte Callback-/Auth-Daten-Reihenfolge beim direkten
Replay-Einstieg sowie den sichtbaren 403-Hinweis und den Erhalt der Refresh-Sitzung.

Beim zusätzlichen Browser-Review des direkten Replay-Einstiegs wurde außerdem
beobachtet, dass die Replay-Ladefehlerbehandlung den zentralen 403-Hinweis durch
„Unbekannter Fehler“ ersetzte. Die PR-Vorlage erhält jetzt den zentralen Hinweis
bei 401/403, räumt veraltete Replay-Daten weiterhin auf und finalisiert die
Fehlerstatistik genau einmal. Zwei neue Komponententests decken beide Statuswerte
ab; der Browserfall prüft den tatsächlichen sichtbaren 403-Hinweis. Diese zusätzliche
Replay-Korrektur ist lokal geprüft und noch kein neuer Live-Abnahmenachweis.

**Beweisgrenze:** Die oben protokollierten Live-Fälle betreffen die jeweils dort
benannten früheren Artefakte und lokalen Korrekturen. Die neue Integration enthält
inzwischen weitere Änderungen aus `develop`; sie ist kein erneut live abgenommenes
Binärartefakt. Die lokale Prüfung der PR-Vorlage, Remote-CI, Bereitstellung und
bestätigte fachliche Abnahme sind getrennte Schritte. Mit diesem PR werden weder
Deployment noch Ticketabschluss ausgelöst. #566, #1018 und #571 bleiben offen und
werden zur Review vorgelegt; der übrige Umfang von #571 bleibt separat offen.

### Lokale Prüfung vor dem abschließenden develop-Abgleich

Die folgenden Nx-Prüfungen betreffen die Integration auf `f3e8a3b37`; sie liefen
ohne Nx-Cloud und ohne Task-Cache. Frontend und Backend wurden getrennt und
seriell validiert; die vollständige Frontend-Suite lief nach der zusätzlichen
Replay-Korrektur erneut. Die Nachprüfung auf `b80bf65ac` steht darunter gesondert.

| Prüfung | Ergebnis | Protokoll |
| --- | --- | --- |
| Backend-Gesamtsuite | 227 Suites / 3.524 Tests bestanden; 75 Tests und 9 Suites übersprungen | `/tmp/auth-pr-20261023/backend-tests-final.log` |
| Backend-Typ-/Metadatencheck | 8 Gate-Tests, strikte Typprüfung ohne Diagnose und 43 Entity-Metadaten bestanden | `backend-typecheck.log` |
| Backend-Lint und Produktionsbuild | Bestanden | `backend-lint.log`, `backend-build.log` im selben Prüfverzeichnis |
| Frontend-Gesamtsuite nach Replay-Korrektur | 294 Suites / 3.269 Tests bestanden | `frontend-tests-final.log` |
| Replay-Komponentensuite / Code-Speicherfälle | 85 / 71 Tests bestanden | `frontend-replay-review.log`, `frontend-coding-review.log` |
| Frontend-Lint | Vollständig bestanden; danach die zwei zusätzlich geänderten Replay-Dateien erneut erfolgreich geprüft | `frontend-lint-final.log`, `frontend-replay-lint.log` |
| Finaler Frontend-Produktionsbuild | Bestanden | `frontend-build-final.log` |
| CI-Qualitätsprüfungen / Inventartests | 48 / 2 Tests bestanden | `frontend-quality-gates.log` |
| Finales Zoneless-Gate | Inventar aktuell; 6 Risikobereiche / 7 Mechanismen geprüft. Keine vollständige szenarienweise Zoneless-Abnahme behauptet | `zoneless-final.log` |
| Auth-Callback-Browserfälle | 12/12 bestanden am finalen Produktionsbuild; API-/Provider-Antworten in diesen Suites simuliert | `frontend-auth-browser-final.log` |
| Dokumentation | Evidenz-JSON, lokale Links, neue JSON-Beispiele und Shell-Syntax geprüft | Lokale Struktur- und Syntaxprüfung |

Der einzige Fehler im ersten Backend-Gesamtlauf betraf Dateipfade im
Reproduzierbarkeitstest des generierten Autocoder-Bundles: verlinkte Abhängigkeiten
enthielten den Namen eines anderen Worktrees. Eine lokale Kopie ausschließlich des
betroffenen installierten Responses-Pakets stellte normale `node_modules`-Pfade
her. Der gezielte Nachlauf und der anschließende Backend-Gesamtlauf bestanden;
Projektquellen, Manifest, Lockdatei und das generierte Bundle wurden dafür nicht
geändert.


### Abschließender Abgleich mit develop nach PR #1093

Die drei Auth-Commits wurden vor dem ersten Push auf
`b80bf65ac5a19847ce510ad36eba857cef3c290f` übertragen. Der einzige Konflikt betraf
das generierte Zoneless-Inventar: Die aktuelle develop-Matrix wurde beibehalten,
für die Auth-Quellen neu erzeugt und mit den fünf begrenzten Auth-Revieweinträgen
ergänzt. Der verbleibende Inventardiff betrifft ausschließlich AppComponent,
ReplayComponent, ReplayCodingService und den zusätzlichen HttpErrorResponse-Import.
Die übrigen Änderungen aus PR #1093 bleiben unverändert Bestandteil der Basis.

Zwischen beiden develop-Basen gibt es keine Änderung unter `apps/backend` oder
`api-dto`, an Manifest/Lockdatei, Nx-/Jest-/TypeScript-Grundkonfiguration. Die oben
bestandenen Backend-Prüfungen gelten deshalb für identische Backend-Quellen und
Abhängigkeiten. Auch die Auth-Frontenddateien und Lintregeln blieben beim Rebase
inhaltlich identisch; der vorherige vollständige und ergänzende Lintnachweis bleibt
gültig. Frontend-Gesamtsuite, Produktionsbuild, Auth-Browserfälle und Zoneless-Gate
wurden für die neue Integration erneut erfolgreich geprüft.


Ergebnis der Nachprüfung auf `b80bf65ac`:

- Frontend: **295 Suites / 3.307 Tests bestanden** (`/tmp/auth-pr-20261023/frontend-tests-develop-sync.log`).
- Produktionsbuild bestanden (`frontend-build-develop-sync.log`).
- Auth-Browserfälle **12/12 bestanden**, weiterhin mit simulierten API-/Provider-Antworten (`frontend-auth-browser-develop-sync.log`).
- Zoneless-Gate bestanden; 380 Quelldateien / 9.077 Inventareinträge und unveränderte Risikoreferenzen geprüft (`zoneless-develop-sync.log`).

Die fünf geänderten Auth-Laufzeitdateien sind vor und nach dem Rebase bytegleich.
Der PR enthält weiterhin ausschließlich die Auth-Korrekturen, die dazugehörigen
Tests, den notwendigen Inventarabgleich und die Betriebs-/Abnahmenachweise.
Remote-CI und bestätigte Abnahme sind davon getrennt und bleiben ausstehend.
