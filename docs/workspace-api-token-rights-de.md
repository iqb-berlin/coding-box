# Rechte der Workspace API Tokens

[English](workspace-api-token-rights.md)

Verbindliche Rechteübersicht zu [#569](https://github.com/iqb-berlin/coding-box/issues/569),
auf Grundlage von `develop` bei `0f08d70d2cc1f9bebc852d9996ac01657368ca4a`.
Das Ticket bleibt bis zur separaten fachlichen Abnahme offen.

## Token Typen und unterstützte Zugriffe

OIDC-Benutzersitzungen verwenden Provider-signierte RS256-Tokens mit exaktem
Issuer und passendem `azp` oder `aud`. Die lokalen Rollen, Workspace-Mitgliedschaft
und Jobrechte entscheiden über Benutzeraktionen.

Workspace-API-Tokens verwenden HS256 und den separaten `JWT_SECRET`, mit
`token_use=workspace`, `tokenType=workspace-api`, `iss=coding-box`,
`aud=coding-box-workspace-token`, Benutzer-ID, Workspace-ID und expliziten Scopes.
Unterstützt werden die nachfolgend freigegebenen Replay-, Metadaten-, Statistik-
und Kodierjob-Aktionen, jeweils im gebundenen Workspace und mit den aktuellen
lokalen Rechten der im Token bezeichneten Person. Ein Token ist weder an eine
einzelne Antwort noch an einen einzelnen Job gebunden. Es ersetzt keine
OIDC-Benutzersitzung und gewährt keine zusätzlichen Rollen.

Der Client-Credentials-Austausch unter `/api/auth/token` vermittelt einen
Provider-Token. Er definiert keinen separaten Maschinenzugang oder Workspace-Scope.
Ein eigener Maschinenzugang mit festgelegtem Verbraucher und Rechtemodell ist
außerhalb dieses Tickets; Provider-Tokens werden nach den vorhandenen OIDC-Regeln
behandelt. Opaque Tokens und beliebige andere Provider-Clients sind dadurch nicht
zugelassen.

## Laufzeiten und Scope Kombinationen

| Kürzel | Scope | Höchstdauer bei Neuausstellung |
| --- | --- | --- |
| R | `replay:read` | Standard 90 Tage; durch `WORKSPACE_TOKEN_REPLAY_READ_MAX_DURATION_DAYS` konfigurierbar. |
| S | `replay-statistics:write` | 1 Tag. |
| C | `coding-job:operate` | 1 Tag. |

Es sind ganze Tage ab 1 zulässig. Mindestens ein bekannter Scope ist erforderlich;
fehlende oder unbekannte Ausgabe-Scopes werden abgelehnt. Kombinationen erhalten
die **kleinste** zulässige Höchstdauer: R+S, R+C und R+S+C höchstens einen Tag.
Die Begrenzung gilt für die Neuausstellung; vorhandene korrekt signierte Tokens
werden dadurch nicht rückwirkend verkürzt. Ihre Ablaufzeit bleibt maßgeblich.

Für die aktuelle Oberfläche gelten diese Profile:

- Externer Replay/Export: R, mit der konfigurierten Replay-Laufzeit.
- Interner Replay: R+S, höchstens einen Tag.
- Kodierjob-Replay: R+S+C, höchstens einen Tag.

C allein erlaubt keine Replay-Assets und keinen Statistik-POST. S allein erlaubt
keine Replay-Daten. Scopes werden ausdrücklich kombiniert, wenn ein Verbraucher
mehrere dieser Aktionen benötigt.

## Verbindliche Allow und Deny Matrix

Jede Zeile gilt für **Workspace-Tokens**. `ja` bedeutet eine Scope-Freigabe,
nicht den Wegfall der Zusatzprüfungen. Bei mehreren Scopes genügt in diesen
Routen eine der mit `ja` markierten Alternativen. OIDC-Benutzer durchlaufen ihre
normalen Rollen-/Workspace-/Jobprüfungen unabhängig von dieser Scope-Tabelle.
Alle Routen enthalten das globale `/api`-Präfix.

- `workspace`: Token-Workspace muss exakt dem Routen-Workspace entsprechen;
  der bezeichnete Benutzer muss aktuell lokalen Workspace-Zugriff haben.
- `job-access`: zusätzlich existierender Job in diesem Workspace und Prüfung
  `assertUserCanAccessCodingJob`: Systemadmin, Workspace-Level ab 2 oder
  als Kodierer zugelassene und dem Job zugewiesene Person.
- `job-code`: zusätzlich existierender Job und Prüfung `assertUserCanCodeCodingJob`;
  die Person muss als Kodierer zugelassen und dem Job zugewiesen sein.
- `manager-job`: zusätzlich `job-access` sowie Workspace-Level ab 2 oder Systemadmin.
- `job-code/review`: normal `job-code`; mit `issueReview=true` stattdessen
  existierender Job plus Systemadmin oder Workspace-Level ab 2. Der Review-Zweig
  ist kein allgemeiner Weg um eine fehlende Kodierzuweisung.

| ID | HTTP | Route | R | S | C | Zusatzprüfung |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | GET | `/api/admin/workspace/:workspace_id/player/:playerName` | ja | nein | nein | `workspace` |
| R02 | GET | `/api/admin/workspace/:workspace_id/:unit/unitDef` | ja | nein | nein | `workspace` |
| R03 | GET | `/api/admin/workspace/:workspace_id/unit/:unitId` | ja | nein | nein | `workspace` |
| R04 | GET | `/api/admin/workspace/:workspace_id/booklet/:bookletId/units` | ja | nein | nein | `workspace` |
| R05 | GET | `/api/admin/workspace/:workspace_id/responses/:testPerson/:unitId` | ja | nein | nein | `workspace` |
| R06 | GET | `/api/admin/workspace/:workspace_id/coding/responses/:responseId/replay-url` | ja | nein | nein | `workspace` |
| R07 | GET | `/api/admin/workspace/:workspace_id/replay-payload/:testPerson/:unitId` | ja | nein | nein | `workspace` |
| R08 | GET | `/api/admin/workspace/:workspace_id/replay-assets/:unitId` | ja | nein | nein | `workspace` |
| R09 | GET | `/api/admin/workspace/:workspace_id/replay-response/:testPerson/:unitId` | ja | nein | nein | `workspace` |
| R10 | GET | `/api/admin/workspace/:workspaceId/unit/:unitId/info` | ja | nein | nein | `workspace` |
| R11 | GET | `/api/admin/workspace/:workspaceId/booklet/:bookletId/info` | ja | nein | nein | `workspace` |
| S01 | POST | `/api/admin/workspace/:workspace_id/replay-statistics` | ja | ja | nein | `workspace` |
| J01 | GET | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id` | nein | nein | ja | `job-access` |
| J02 | PUT | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id` | nein | nein | ja | `manager-job` |
| J03 | PUT | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/status` | nein | nein | ja | `job-code` |
| J04 | PUT | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/comment` | nein | nein | ja | `job-access` |
| J05 | POST | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/pause` | nein | nein | ja | `job-code` |
| J06 | POST | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/resume` | nein | nein | ja | `job-code` |
| J07 | POST | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/submit` | nein | nein | ja | `job-code` |
| J08 | POST | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/progress` | nein | nein | ja | `job-code/review` |
| J09 | POST | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/notes` | nein | nein | ja | `job-code/review` |
| J10 | GET | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/progress` | nein | nein | ja | `job-access` |
| J11 | GET | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/replay-session` | nein | nein | ja | `job-access` |
| J12 | GET | `/api/wsg-admin/workspace/:workspace_id/coding-job/:id/units` | nein | nein | ja | `job-access` |
| J13 | GET | `/api/admin/workspace/:workspace_id/coding-job/:codingJobId/notes` | nein | nein | ja | `job-access` |

### Bewusste Ausnahmen und Ausschlüsse

R erlaubt bewusst auch S01, damit externe und ältere Replays ihre Statistik
melden können. `replay:read` ist deshalb **nicht pauschal schreibfrei**. R allein
wird als externer Replay-Ursprung erfasst; mit S oder C als interner Ursprung.
Der Ursprung erweitert keine Freigabe: C allein erfüllt S01 weiterhin nicht.

C erlaubt die oben aufgeführten Lese- und Schreibaktionen einschließlich des
allgemeinen Job-Updates J02. J02 behält die zusätzliche Managerprüfung; C umgeht
weder Job-Zuweisung noch Workspace-Rechte. Diese Freigaben sind umfangreicher
als bloßes Lesen von Job-Notizen.

**Standard ist verweigern:** Geschützte Routen ohne explizite Workspace-Freigabe
akzeptieren diese Tokens nicht, auch nicht mit R+S+C. Dazu gehören insbesondere:

- Token-Policy lesen, eigene oder fremde Workspace-Tokens ausstellen;
- Workspace-/Benutzer-/Rollenverwaltung und allgemeine Adminaktionen;
- neue Jobs erstellen oder Jobs löschen sowie Neustart offener Einheiten;
- Job-Start, Review-Abgabe (`submit-review`) und andere nicht gelistete Jobaktionen;
- Statistikberichte lesen, Exporte und andere nicht gelistete Verwaltungsaktionen.

Die Tabelle erteilt keine Rechte auf öffentlich erreichbare Routen. Ein
Workspace-Bearer ist auch kein OIDC-Refresh-Token und kann nicht als solcher an
`/api/auth/refresh` eingesetzt werden.

Fehlender/falscher Scope, Token-Typ, Signatur oder Ablauf sowie ein anderer
Token-Workspace führen typischerweise zu 401. Entzogener Workspace-Zugriff oder
fehlende Jobberechtigung liefern 403; ein fehlender Job kann 404 ergeben.
Der bestehende AccessLevelGuard liefert bei unzureichendem Level weiterhin 401.
Diese Unterschiede dürfen nicht durch pauschales erneutes Anmelden verschleiert werden.

## Ausstellung und Verwendung

Die folgenden HTTP-Beispiele enthalten ausschließlich Platzhalter. Zuerst muss
eine gültige OIDC-Benutzersitzung mit lokalen Workspace-Rechten vorliegen.

```http
GET /api/admin/workspace/token-policy
Authorization: Bearer <OIDC-access-token>

GET /api/admin/workspace/7/token/90?scopes=replay:read
Authorization: Bearer <OIDC-access-token>

GET /api/admin/workspace/7/token/1?scopes=replay:read&scopes=coding-job:operate
Authorization: Bearer <OIDC-access-token>
```

Für eine andere Identität gilt
`GET /api/admin/workspace/7/<encoded-identity>/token/1?scopes=replay:read`.
Der Anforderer braucht zusätzlich Workspace-Level ab 3 oder Systemadminrechte.
Die Zielperson muss spätestens bei der Verwendung des Tokens Workspace-Zugriff
haben. Die Ausgabe selbst ersetzt diese spätere Prüfung nicht.

Die Antwort ist ein JSON-String mit dem Token. Für folgende Requests den
**dekodierten String ohne JSON-Anführungszeichen** als Bearer verwenden:

```http
GET /api/admin/workspace/7/unit/UNIT-1/info
Authorization: Bearer <workspace-token>
```

Die Ausgabe wird als `ACCESS_TOKEN_CREATED` mit Akteur, Zielperson, Workspace,
Dauer und Scopes journalisiert; der Tokenwert gehört nicht ins Journal. Scheitert
die Journalisierung, wird kein Token zurückgegeben. Bestehende Workspace-Tokens
können keine neuen Tokens ausstellen. Nach Ablauf ist eine Neuausstellung über
eine berechtigte Benutzersitzung nötig; es gibt keinen Workspace-Refresh-Token.

Tokens sind Zugangsdaten. Neue Integrationen verwenden Bearer-Header und HTTPS.
Bestehende Replay-Links mit Auth im URL-Fragment bleiben ein unterstützter
Oberflächenpfad und sind wie Zugangsdaten zu schützen; nicht in Tickets oder
allgemeine Logs kopieren. Der Replay entfernt ersetzte Auth-Werte aus der URL.
Einzelne Workspace-Tokens haben keine eigene Widerrufsroute. Ablauf, lokale
Rechteentziehung und eine geplante Rotation von `JWT_SECRET` haben unterschiedliche
Wirkung; eine Schlüsselrotation betrifft alle damit signierten Workspace-Tokens.

## Legacy Übergang

`ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS` steht in beiden Env-Vorlagen standardmäßig
auf `true` und wird durch die ausgelieferten Compose-Dateien an API und Export-
Worker weitergegeben. Die Strategie liest den Wert beim Start; eine Dateiänderung
allein schaltet laufende Instanzen nicht um. `false`, `0`, `no` und `off` deaktivieren
den alten Pfad. Moderne Tokens funktionieren danach weiterhin.

Der alte Pfad akzeptiert nur das geprüfte frühere Format ohne `token_use`, `iss`
und `aud`, mit Benutzer, Workspace, Benutzername und Ablauf. Gemischte oder falsche
moderne Claims werden nicht zu Legacy umgedeutet. Signatur, HS256, Ablauf und die
oben genannten Workspace-/Scope-/Jobprüfungen gelten weiterhin.

**Vorhandene Scope-Arrays bleiben erhalten**, auch wenn sie C enthalten.
Nur bei vollständig fehlendem `scopes` wird R ergänzt. Ein leerer oder fehlerhaft
geformter Scope-Wert wird nicht zu einer allgemeinen Berechtigung. Legacy heißt
weder automatisch unbegrenzt noch automatisch auf R reduziert.

Sicherer Betreiberablauf:

1. Betroffene Replay-Links, Exporte und Integrationen inventarisieren. Alte Tokens
   nur privat klassifizieren; keine Werte oder vollständigen Links protokollieren.
2. Über berechtigte Benutzersitzungen moderne Tokens mit minimalen Scopes und
   passender Höchstdauer ausstellen. Verbraucher kontrolliert umstellen.
3. In einer isolierten Umgebung einen modernen R-Token, dessen Statistik-POST,
   den kombinierten Kodierjob-Replay und die erwarteten Verweigerungen prüfen.
   Alte Tokens mit und ohne Scope-Array vor dem Umschalten gesondert prüfen.
4. In der privaten Betreiberkonfiguration
   `ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS=false` setzen. Mit den tatsächlich
   verwendeten Compose-Dateien und Overrides `config --quiet` prüfen; keine
   effektiven Secrets exportieren. Die Installationsbasis kann
   `docker-compose.coding-box.yaml` statt `docker-compose.yaml` heißen.
5. Die betreffenden Backend-Instanzen über den regulären Deploymentablauf
   konsistent neu erstellen. Moderne Tokens müssen weiter funktionieren; alte
   Tokens werden dann abgelehnt. Replay-Daten und Kodierungen bleiben erhalten.
6. Ablehnungen ohne Tokenwerte beobachten. Falls ein Verbraucher übersehen wurde,
   nicht pauschal Schlüssel drehen oder Rechte erweitern. Eine zeitlich begrenzte
   Rückkehr zu `true` nach Betreiberentscheidung reaktiviert noch gültige alte
   Tokens mit ihrem bisherigen Rechteumfang; die Verbraucher anschließend gezielt
   umstellen und den Abschaltversuch wiederholen.

## Nachweise und Abnahme

Die [Matrix-Regressionen](../apps/backend/src/app/auth/workspace-token-permissions.spec.ts)
prüfen alle dokumentierten Route-/Scope-Zuordnungen, beide Sprachfassungen und
die vollständige Freigaben-Inventur. Die
[HTTP-Regressionen](../apps/backend/src/app/auth/workspace-token-permissions.integration.spec.ts)
prüfen repräsentative echte Controller mit signierten Tokens, tatsächlichen Guards
und dem echten `CodingJobAccessService`. Datenzugriffe und fachliche Schreibdienste
sind isolierte Testdoubles. Bestehende Strategie-, Ausstellungs-,
Workspace-/AccessLevel- und Frontend-/Replay-Tests ergänzen diese Abdeckung.

Die Prüfung ist kein Produktionsbetrieb mit realen Tokens und kein neuer
Client-Credentials-Zugang. Die separate fachliche Abnahme von #569 steht aus.
