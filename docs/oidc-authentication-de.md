# OIDC-Authentifizierung

[English](oidc-authentication.md)

Betriebs- und Entwicklerhandbuch zum integrierten Auth-Ablauf. Bezug: [#571](https://github.com/iqb-berlin/coding-box/issues/571).
Geprüfte Basis: `develop` bei `edb09663f7b096128f4386bbd65c46888ad9ad70` (25.10.2026).
Die Konsolidierung aus #571 wurde im dokumentierten Umfang abgenommen. Die
Ergänzungen für #569 und #570 benötigen jeweils eine eigene Abnahme; die bestätigten
Prüfumfänge aus #564, #565 und #1018 bleiben bestehen.

## 1. Einführung

Kodierbox verwendet den Authorization-Code-Flow mit PKCE. Der Browser meldet sich
beim Provider an; das Backend tauscht dessen Authorization Code gegen Tokens und
ruft Userinfo ab. Im Redirect zur Anwendung steht ausschließlich ein kurzlebiger,
browsergebundener Einmalcode `auth_code`, kein Access-/Refresh-Token.
Der initiierende Browser löst ihn mit `POST /api/auth/exchange` ein.

Die derzeit belegte Provider-Integration ist Keycloak. Konfigurierbare OIDC-Endpunkte
bedeuten keine ungeprüfte Kompatibilitätszusage für alle OIDC-Provider; Voraussetzungen
und verbleibende Keycloak-Annahmen stehen in Abschnitt 6.

## 2. Für Systemadministratoren

### 2.1 Umgebungskonfiguration

Maßgeblich sind [Entwicklungsvorlage](../.env.dev.template),
[Produktionsvorlage](../.env.coding-box.template) und die dazugehörigen Compose-Dateien.
Die Beispiele ergänzen eine vollständige Vorlage; Datenbank-, Redis-, Registry- und
Infrastruktureinstellungen werden ebenfalls benötigt. `change_me` und `random_string`
sind ausgelieferte Platzhalter, keine für den Betrieb geeigneten Zugangsdaten.

| Variable | Verwendung |
| --- | --- |
| `OIDC_PROVIDER_URL` | Öffentliche Provider-Basisadresse; ersetzt nicht den exakten Issuer oder die einzelnen Endpunkte. |
| `OIDC_ISSUER` | Exakter `iss` des Provider-Access-Tokens, einschließlich Realm und gegebenenfalls tatsächlich eingesetztem Kontextpfad. |
| `OIDC_AUTHORIZATION_ENDPOINT` | Vom Browser erreichbare Anmeldeadresse. |
| `OIDC_TOKEN_ENDPOINT` | Vom Backend erreichbarer Code-/Refresh-Token-Endpunkt. |
| `OIDC_USERINFO_ENDPOINT` | Vom Backend erreichbarer Userinfo-Endpunkt. |
| `OIDC_JWKS_URI` | Vom Backend erreichbare JWKS-Adresse für die RS256-Prüfung. |
| `OIDC_END_SESSION_ENDPOINT` | Vom Backend erreichbarer Logout-Endpunkt. |
| `OIDC_ACCOUNT_ENDPOINT` | Gesondertes Account-/Profilmanagement; aktuell mit Keycloak-Parametern verwendet. |
| `OAUTH2_CLIENT_ID` | Client für Login, Token-Austausch und Client-/Audience-Prüfung. |
| `OAUTH2_CLIENT_SECRET` | Geheimnis eines vertraulichen Clients; bei einem entsprechend eingerichteten öffentlichen Client ausdrücklich leer möglich. Niemals ein reales Geheimnis veröffentlichen. |
| `OAUTH2_REDIRECT_URL` | Schema-relative Backend-Callback-Adresse, standardmäßig `//HOST/api/auth/callback`; siehe unten. |
| `JWT_SECRET` | Unabhängiger starker Schlüssel für HS256-Workspace-Tokens, kein OIDC-Provider-Schlüssel. |

**Produktionsbeispiel** mit externem Keycloak und Realm `coding-box`:

```dotenv
SERVER_NAME=coding-box.example.org
OIDC_PROVIDER_URL=https://keycloak.${SERVER_NAME}
OIDC_ISSUER=https://keycloak.${SERVER_NAME}/realms/coding-box
OIDC_ACCOUNT_ENDPOINT=https://keycloak.${SERVER_NAME}/realms/coding-box/account
OIDC_AUTHORIZATION_ENDPOINT=https://keycloak.${SERVER_NAME}/realms/coding-box/protocol/openid-connect/auth
OIDC_TOKEN_ENDPOINT=https://keycloak.${SERVER_NAME}/realms/coding-box/protocol/openid-connect/token
OIDC_USERINFO_ENDPOINT=https://keycloak.${SERVER_NAME}/realms/coding-box/protocol/openid-connect/userinfo
OIDC_END_SESSION_ENDPOINT=https://keycloak.${SERVER_NAME}/realms/coding-box/protocol/openid-connect/logout
OIDC_JWKS_URI=https://keycloak.${SERVER_NAME}/realms/coding-box/protocol/openid-connect/certs
OAUTH2_CLIENT_ID=coding-box
OAUTH2_CLIENT_SECRET=
OAUTH2_REDIRECT_URL=//${SERVER_NAME}/api/auth/callback
```

Das leere Geheimnis gilt hier ausschließlich für den passend konfigurierten
öffentlichen Beispielclient. Bei einem vertraulichen Client das tatsächliche
Geheimnis geschützt setzen. `AuthController` setzt der Callback-Variablen bei
`NODE_ENV=production` `https:` voran, ansonsten `http:`. Keine vollständige
`https://...`-URL in diese schema-relative Variable einsetzen.
Die erlaubte Provider-Redirect-URI ist in diesem Beispiel exakt
`https://coding-box.example.org/api/auth/callback`.
`redirect_uri` am Login ist davon verschieden: Es bezeichnet das erlaubte
Rückkehrziel in der Anwendung, beispielsweise die Home-Seite oder den Kodierjob.

**Entwicklungsbeispiel** für das Compose-Netz:

```dotenv
SERVER_NAME=localhost
API_PORT=3333
OIDC_PROVIDER_URL=http://${SERVER_NAME}:8080
OIDC_ISSUER=http://${SERVER_NAME}:8080/realms/coding-box
OIDC_ACCOUNT_ENDPOINT=http://${SERVER_NAME}:8080/realms/coding-box/account
OIDC_AUTHORIZATION_ENDPOINT=http://${SERVER_NAME}:8080/realms/coding-box/protocol/openid-connect/auth
OIDC_TOKEN_ENDPOINT=http://keycloak:8080/realms/coding-box/protocol/openid-connect/token
OIDC_USERINFO_ENDPOINT=http://keycloak:8080/realms/coding-box/protocol/openid-connect/userinfo
OIDC_END_SESSION_ENDPOINT=http://keycloak:8080/realms/coding-box/protocol/openid-connect/logout
OIDC_JWKS_URI=http://keycloak:8080/realms/coding-box/protocol/openid-connect/certs
OAUTH2_CLIENT_ID=coding-box
OAUTH2_CLIENT_SECRET=
OAUTH2_REDIRECT_URL=//${SERVER_NAME}:${API_PORT}/api/auth/callback
```

Öffentlicher Issuer/Authorization-/Account-Endpunkt müssen im Browser funktionieren.
`keycloak:8080` ist dagegen der interne Docker-Service für Backend-Aufrufe. Deshalb
kann die interne JWKS-/Token-Adresse von der öffentlichen Adresse abweichen,
während der erwartete Issuer weiterhin exakt zum Token passen muss.
Bei einem Backend direkt auf dem Host sind diese internen Adressen explizit auf
vom Host erreichbare Endpunkte anzupassen. Das Backend liest `.env.dev`; bereits
exportierte passende Prozessvariablen können die Host-Konfiguration vorgeben.

Die Anwendung verwendet explizite Endpunkte und führt keine automatische
Discovery-Konfiguration aus. Werte mit den Discovery-Metadaten des konkreten
Providers vergleichen. `/auth/realms/...` ist nur bei einem tatsächlich so
konfigurierten Provider-Kontextpfad korrekt. Die ausgelieferten Keycloak-22-
Beispiele verwenden `/realms/coding-box` ohne zusätzliches `/auth` davor.
`KEYCLOAK_*` betrifft verbleibende Hilfs-/Installationspfade und die ausdrücklich
unterstützte Legacy-Migration; es ersetzt nicht die aktive `OIDC_*`-Konfiguration.

### 2.2 Keycloak Setup

Die vollständige [Realm-Datei](../config/keycloak/realm/coding-box-realm.json)
verwendet Variablen aus der [Realm-Konfiguration](../config/keycloak/realm/coding-box-realm.config).
Der eigenständige [Client-Export](../config/keycloak/clients/coding-box.json)
ist kein notwendiger erneuter Import in einen bestehenden Realm.

- Realm `coding-box`; `CODING_BOX_CLIENT_ID` und `OAUTH2_CLIENT_ID` müssen zum
  tatsächlich eingerichteten Client passen.
- Standard-Authorization-Code-Flow aktiviert, Implicit Flow und Direct Access
  Grants deaktiviert. PKCE S256 wird vom Backend verwendet.
- Der ausgelieferte Client ist öffentlich (`publicClient: true`), Service Accounts
  sind deaktiviert. Ein vertraulicher Client benötigt passende Client-Authentifizierung
  und `OAUTH2_CLIENT_SECRET`; ein Client-Credentials-Dienst erweitert keine API-Rechte.
- Der Export enthält Wildcards für Redirects/Origins. Für den Betrieb die konkrete
  Callback-Adresse und die erlaubten Browser-Origins begrenzen. Das Backend erlaubt
  die Callback-Origin sowie eine ausdrücklich konfigurierte
  `FRONTEND_URL`-Origin. In Entwicklung kommen die abgeleitete `HTTP_PORT`-Origin
  und localhost/127.0.0.1 auf diesem Port hinzu. Diese Laufzeitwerte und die
  Provider-Allowlist müssen zum tatsächlichen Frontend passen.
- `admin` in `realm_access.roles` steuert Administratorrechte. Workspace-Mitgliedschaft,
  Zugriffslevel und Jobzuweisung bleiben eigenständige Anwendungsberechtigungen.
- Die Realm-Vorgabe für Access-Tokens ist 300 Sekunden. Der ausgelieferte Client
  überschreibt sie mit `access.token.lifespan=4579200` (53 Tage). Die tatsächliche
  Client-Konfiguration und `exp` prüfen; 5 Minuten sind keine garantierte Laufzeit.
- Der Export erlaubt Registrierung; Reset-Password ist deaktiviert. Betreiber
  legen diese Regeln und die Sitzungs-/Tokenlaufzeiten bewusst fest.
- Vor dem ersten Start eigene starke Admin-/Datenbankzugänge in `.env.dev` bzw.
  der privaten Installation und `CODING_BOX_ADMIN_*` in der Realm-Konfiguration
  setzen. Keine festen Beispielpasswörter als Betriebsvorgabe übernehmen.
- Das IQB-Theme liegt unter [themes/iqb](../config/keycloak/themes/iqb) und wird
  über das Client-Attribut `login_theme` ausgewählt.

### 2.3 Deployment

#### Lokale Entwicklung mit Docker

In einem eigenen frischen Checkout mit unbenutztem Compose-Projektnamen arbeiten.
Den Beispielnamen vor Verwendung auf eine freie Kennung ändern. Bestehende
Konfigurationen nicht mit den folgenden Kopierbefehlen überschreiben.

```bash
umask 077
export COMPOSE_PROJECT_NAME=auth-dev-example
cp -n .env.dev.template .env.dev
```

Vor dem Start Platzhalter einschließlich `JWT_SECRET` und beider Admin-Zugänge
ersetzen, Realm-Konfiguration abstimmen und Registry-Zugriff klären. Der folgende
Aufruf prüft ausschließlich die Compose-Konfiguration; er startet keine Dienste:

```bash
docker compose --env-file .env.dev -f docker-compose.yaml -f docker-compose.override.yaml config --quiet
```

Die ausgelieferten Dateien verwenden das externe Netzwerk mit festem Namen
`app-net` und feste bzw. vorgegebene Hostports. Ein anderer Projektname trennt
Compose-Ressourcen, aber nicht dieses Netzwerk und die Hostports. Auf dem Zielhost
darf kein bestehender Stack dadurch beeinträchtigt werden. Für parallele Stacks
zuerst eigene Netzwerke und konfliktfreie Ports in einer vollständig geprüften
Override-Kombination festlegen oder einen separaten Entwicklungsrechner verwenden.
Die folgenden Make-Befehle verwenden ohne weitere Konfiguration den Standardstack.

Für einen entsprechend vorbereiteten lokalen Entwicklungsstack anschließend `make dev-build` und
`make dev-up` verwenden. Diese Befehle bauen/laden Images und starten Dienste.
Das Dev-Override stellt Keycloak auf Port 8080 bereit; Backend auf `API_PORT`,
Frontend auf `HTTP_PORT`. `make dev-up` ist kein Produktionsdeployment.
Bei Host-Entwicklung zusätzlich DB/Redis starten und die internen Provider-Adressen
wie in Abschnitt 2.1 anpassen. Frontend und Backend getrennt starten; die
[Projektanleitung](../AGENTS.md) enthält die jeweiligen Nx-/npm-Befehle.

#### Produktive Neuinstallation

1. Einen überprüften Release-Tag, neue Zielverzeichnisse, Registry-Zugriff, DNS/TLS,
   Traefik und die externe Provider-Installation festlegen. Die Produktions-
   Compose-Datei stellt selbst keinen Keycloak bereit.
   Vor dem Installer-Aufruf entscheiden, ob ein neuer Realm eingerichtet oder
   ein vorhandener Provider unverändert verwendet werden soll. Bei vorhandenem
   Provider die Installer-Frage `Do you want to use the Keycloak identity provider
   included in the infrastructure? [Y/n]` ausdrücklich mit `n` beantworten und
   dessen bestehende Endpunkte/Client-Werte eingeben. Der Standardzweig kann
   Realm-Dateien ersetzen, Keycloak stoppen und einen Import ausführen; er ist
   kein sicherer Anschlussweg an einen unverändert zu erhaltenden Provider.
2. Das zu diesem Release gehörende [Installationsskript](../scripts/install.sh)
   lesen und mit dem gewählten Tag aufrufen: `bash scripts/install.sh "$AUTH_RELEASE_TAG"`.
   `AUTH_RELEASE_TAG` vorher ausdrücklich auf den geprüften Tag setzen.
   Das interaktive Skript kann Dateien herunterladen, Infrastruktur einrichten,
   Realm-Daten importieren und Dienste starten; ausschließlich für die geplante
   Neuinstallation verwenden. Linux/Bash-Werkzeuge einschließlich `readarray`
   werden vorausgesetzt, nicht die mit macOS ausgelieferte Bash 3.2.
3. Der Installer lädt die Compose-Basis als `docker-compose.coding-box.yaml` und
   legt `.env.coding-box` an. Konfiguration privat mit den freigegebenen Werten
   vergleichen. Die abschließende Frage `Do you want to start coding-box now?
   [Y/n]` zunächst mit `n` beantworten. Danach im installierten Verzeichnis rendern:

   ```bash
   docker compose --env-file .env.coding-box -f docker-compose.coding-box.yaml -f docker-compose.coding-box.prod.yaml config --quiet
   ```

   Im Quellcheckout heißt dieselbe Basis `docker-compose.yaml`. Eine gegebenenfalls
   erzeugte `compose.sh` und zusätzliche Betreiber-Overrides müssen in der
   tatsächlich eingesetzten vollständigen Kombination berücksichtigt werden.
   Dies ist keine Vorschaltprüfung des gesamten Installers: Frühere Schritte
   können bereits Dateien, Infrastruktur und bei gewähltem Importzweig den
   Provider verändert haben. Diese Entscheidungen vor Schritt 2 prüfen.
4. Restriktive Callback-/Origin-Liste, Client und Zugangsdaten prüfen. Erst danach
   die neue Anwendung gezielt starten. `make coding-box-up` lädt Images und
   startet die installierte Konfiguration. Bestehende Installationen gehören
   zum Upgrade-Pfad und dürfen nicht durch den Neuinstaller überschrieben werden.
5. Vor Freigabe Gesundheit, Login, Callback, Exchange, geschütztes
   `GET /api/auth-data`, Rolle, Arbeitsbereich, Refresh und Logout prüfen.

**Beweisgrenze:** [#564 wurde im dokumentierten Umfang angenommen](https://github.com/iqb-berlin/coding-box/issues/564#issuecomment-6389951706):
Live-Login mit ausgelieferten Vorlagen/Realm/Theme in isolierter Entwicklungs-
Authkonfiguration; Produktionsvorlage auf Compose-/Konfigurationsebene geprüft.
Kein vollständiger interaktiver Produktionsinstaller und kein separates TLS-
Produktionsdeployment wurden damit abgenommen. Diese Anleitung erweitert diese
Nachweise nicht zu einer solchen Live-Abnahme.

## 3. Für Entwickler

### 3.1 Backend-Implementierung

Aktiv sind [AuthController](../apps/backend/src/app/auth/auth.controller.ts),
[OidcAuthService](../apps/backend/src/app/auth/service/oidc-auth.service.ts),
[JwtStrategy](../apps/backend/src/app/auth/jwt.strategy.ts) und die getrennte
[WorkspaceTokenStrategy](../apps/backend/src/app/auth/workspace-token.strategy.ts).
[AuthModule](../apps/backend/src/app/auth/auth.module.ts) registriert den generischen
OIDC-Service; ein Austausch des `KeycloakAuthService` ist kein Betreiber-Upgrade-Schritt.

Alle folgenden Routen enthalten den globalen Backend-Präfix `/api`:

| Route | Vertrag |
| --- | --- |
| `GET /api/auth/login` | Erfordert `browser_challenge` (43 Zeichen Base64url-SHA256), optionales erlaubtes Anwendungsziel `redirect_uri`; erzeugt serverseitiges PKCE und Redirect. |
| `GET /api/auth/callback` | Provider-`code`/`state`; konsumiert PKCE, tauscht Code, ruft Userinfo, speichert Identität; Redirect mit `auth_code`. |
| `POST /api/auth/exchange` | JSON `{ "code": "<one-time-code>", "browser_verifier": "<browser-verifier>" }`; liefert Tokens nur an den passenden initiierenden Browser, einmalig. |
| `POST /api/auth/refresh` | JSON `{ "refresh_token": "<refresh-token>" }`; erneuert Provider-Tokens, liefert 401 bei ungültiger Sitzung bzw. 503 bei Provider-/Konfigurationsfehler. |
| `POST /api/auth/logout` | Refresh-Token im Body; versucht Provider-Logout. Lokales Logout bleibt auch bei Providerfehler möglich. |
| `GET /api/auth/profile` | Leitet an das gesondert konfigurierte Accountmanagement weiter. |
| `POST /api/auth/token` | Client-Credentials-Weiterleitung zum Provider; daraus folgt keine zusätzliche Maschinen-API-Berechtigung. |
| `POST /api/auth/validate` | Userinfo-Abfrage mit Access-Token; ersetzt keine Route-/Workspace-Autorisierung. |

Die Body-Werte in dieser Tabelle sind Platzhalter, keine ausführbaren Testzugänge.
API-Verträge stehen in [request-contracts](../api-dto/request-contracts.ts).

### 3.2 Frontend-Implementierung

Der aktuelle [AuthService](../apps/frontend/src/app/core/services/auth.service.ts)
verwaltet den OIDC-Login. `AuthenticationService` ist dagegen eine gesonderte
Testcenter-Anbindung und verwaltet diese OIDC-Sitzung nicht.

- Browser-Verifier im `sessionStorage` unter `oidc_login_verifier`; nach erfolgreichem
  Exchange entfernen. Die Bindung ist deshalb an den initiierenden Browser-Tab gebunden.
- Access-, ID- und Refresh-Token im `localStorage` unter `auth_token`, `id_token`,
  `refresh_token`. Das ist die Implementierung, keine HttpOnly-Cookie-Speicherung.
  Bei Logout werden diese Werte entfernt. Tokenwerte nicht in Tickets/HARs ausgeben.
- `getValidToken()` erneuert fehlende oder bald ablaufende Access-Tokens; parallele
  Refreshes werden für dieselbe Sitzung zusammengeführt. Alte Antworten dürfen keine
  neue Sitzung oder eine andere Person überschreiben.
- Echte Sitzungsfehler fordern eine erneute Anmeldung an. Vorübergehende Provider-
  oder Konfigurationsfehler erhalten Sitzung und Wiederherstellungsentwurf.

### 3.3 Authentifizierungsablauf

1. Frontend erzeugt zufälligen Browser-Verifier und SHA256-Challenge.
2. Backend speichert serverseitigen PKCE-Verifier plus Browser-Challenge in Redis
   für 300 Sekunden und leitet zum Provider weiter (S256, `openid profile email`).
3. Provider authentifiziert den Benutzer und ruft den Backend-Callback auf.
4. Backend konsumiert den PKCE-Zustand einmalig. Den PKCE-Verifier sendet es im
   geschützten Token-Request an den Provider; er steht nicht im Frontend-Redirect.
5. Backend speichert den erhaltenen Tokensatz samt Browser-Challenge für 60 Sekunden
   im Redis-Exchange-Cache. Zur Anwendung geht nur der zufällige `auth_code`.
6. Frontend sendet Code und Browser-Verifier an `/api/auth/exchange`. Der Cacheeintrag
   wird nur bei passender Challenge atomar konsumiert. Falscher Browser, abgelaufener
   oder erneut verwendeter Code ergibt 401.
7. Frontend speichert Tokens und verwendet den Access-Token als Bearer. Das Backend
   prüft RS256/JWKS, Ablauf, exakten Issuer, Client (`azp` oder `aud`) und `sub`.
   Es ordnet die lokale Identität über Provider-Issuer und Subject zu.

Es gibt keine dauerhafte Refresh-Token-Tabelle im Anwendungsbackend. Redis enthält
hier kurzlebige PKCE-/Exchange-Zustände einschließlich des temporären Tokensatzes;
Provider-Sitzung und Browser-Token-Speicherung sind davon getrennt.

### 3.4 Integration mit anderen Services

Rollen und authentifizierte Identität ersetzen keine Workspace-/Jobberechtigung.
Der [Scope-Guard](../apps/backend/src/app/auth/jwt-or-workspace-token-auth.guard.ts)
und die [Workspace-Regeln](../apps/backend/src/app/admin/workspace/workspace.guard.ts)
prüfen den Zugriff für die konkrete Route. Die Rollen-/Tokenübersicht steht in
Abschnitt 6; eine erfolgreiche Token-Ausgabe ist kein pauschaler API-Zugriff.

## 4. Für Endbenutzer

### 4.1 Login-Prozess

„Anmelden“ in der Anwendung startet den gebundenen Login-Flow. Benutzername und
Passwort ausschließlich beim vorgesehenen Provider eingeben. Nach Rückkehr müssen
Identität und die vorgesehenen Arbeitsbereiche sichtbar sein. Fehlt eine Zuordnung,
erteilt eine erneute Anmeldung allein keine zusätzlichen Rechte.

### 4.2 Profil-Management

Das Profilmanagement verwendet den gesonderten Account-Endpunkt des Providers.
Seine konkrete Funktion ist für Keycloak belegt; ein beliebiger anderer Provider
benötigt einen passenden Account-/Claim-Vertrag.

### 4.3 Logout

Das explizite Logout entfernt lokale Tokens und versucht die Provider-Sitzung über
das Refresh-Token zu beenden. Ein fehlgeschlagener Provider-Aufruf ist kein Nachweis
für einen serverseitigen globalen Sitzungswiderruf. Andere Tabs/Sitzungen und bereits
signierte Access-Tokens sind entsprechend ihrem eigenen Zustand zu behandeln.

### 4.4 Fehlerbehebung für Benutzer

Bei erneuter Anmeldung dieselbe Person verwenden, um einen eigenen Entwurf im
ursprünglichen Kodierkontext wieder aufzunehmen. Bei Provider-/Netzwerkfehlern
Wiederholen nutzen und den Entwurf erhalten. Fehler-ID, Zeitpunkt und Aktion an
den Betrieb geben; keine Tokens, Passwörter oder Antwortdaten weitergeben.

## 5. Fehlerbehebung (Häufige Probleme)

### 5.1 Konfigurationsprobleme

Startvalidierung, effektive `OIDC_*`-/`OAUTH2_*`-Werte und die konkrete Fehlerklasse
prüfen. Den exakten Issuer und Callback mit dem Provider vergleichen. Ein öffentlich
konfigurierter Client benötigt kein erfundenes Geheimnis; ein vertraulicher Client
benötigt das passende geschützte Geheimnis. Konfiguration gezielt nach dem
[Upgrade-/Rücknahmeverfahren](auth-upgrade-and-restore.md) korrigieren.

### 5.2 Authentifizierungsfehler

Bei fehlendem/verbrauchten Browser-Verifier oder abgelaufenem Einmalcode den Login
von der Anwendung aus neu beginnen. Codes nicht manuell zwischen Tabs kopieren.
`invalid_grant`, 401, 403 und 503 haben unterschiedliche Ursachen; siehe Abschnitt 5.5.

### 5.3 Keycloak-Probleme

Realm, Client, erlaubte Callback-Adresse, Rollen und tatsächlich effektive
Tokenlaufzeiten prüfen. Gegen einen bestehenden Realm keinen pauschalen JSON-
Neuimport als Fehlerbehebung durchführen. Den gesicherten Betreiberstand vergleichen.

### 5.4 Netzwerkprobleme

DNS, VPN/Routing, TLS-Vertrauenskette, Proxy und Erreichbarkeit aus Browser **und**
Backend getrennt prüfen. CORS/Origin-Allowlist am vorgesehenen Dienst korrigieren;
Browser-Schutz nicht mit CORS-Plugins umgehen. Ein Browser-Login belegt keine
Backend-Verbindung zu internen Token-/JWKS-Adressen.

### 5.5 Authentifizierungsfehler im Betrieb unterscheiden (F06)

Bezug: [#1018](https://github.com/iqb-berlin/coding-box/issues/1018) und [#571](https://github.com/iqb-berlin/coding-box/issues/571). Dieses Verfahren beschreibt die implementierte Fehlerklassifikation und die im [Abnahmeprotokoll](qa/auth-acceptance-2026-10-23.md) belegten Live-Prüfungen. Die getrennte Konsolidierung von Installation und Upgrade in #571 wird dadurch nicht vollständig abgeschlossen.

**Zuerst die Fehlerklasse bestimmen**

| Ergebnis der Anwendung | Bedeutung | Wiederherstellung |
| --- | --- | --- |
| 503, `provider-unavailable` | Transportfehler, Timeout oder Serverausfall bei Provider/JWKS; daraus folgt kein nachgewiesenes Sitzungsende | Sitzung und Entwurf erhalten. Verbindung aus dem Backend-Netz prüfen, Erreichbarkeit wiederherstellen, Anmeldung erneut prüfen und erfolgreiches Speichern bestätigen |
| 503, `configuration-error` | Fehlende/ungültige Endpunkt- oder Clientkonfiguration oder als Konfigurationsfehler eingeordnete Provider-/JWKS-Antwort 400/401/403/404 | Request-ID an den Betrieb geben. Ausgelieferten Issuer, Client-ID und betroffenen Endpunkt prüfen, vorgesehene Konfiguration wiederherstellen und im bestehenden Tab erneut versuchen |
| 401, `session-invalid` | Zum Beispiel Refresh-Antwort 400 mit `invalid_grant` oder Userinfo-Antwort 401 | Dieselbe Person erneut anmelden und den wiederhergestellten Entwurf im selben Kodierkontext vor dem Fortsetzen prüfen |
| 401 ohne diesen Code | Fehlender, abgelaufener oder zurückgewiesener JWT; auch Signatur, Subject, Issuer und Client/Audience können die Ursache sein | Tatsächlich fehlschlagende Route und erwarteten Issuer/Client prüfen. Aus 401 allein weder Provider-Ausfall noch Sitzungsablauf ableiten |
| 403 beim Arbeitsbereichs-/Jobzugriff | Authentifizierte Anfrage ohne erforderliche Berechtigung | Sitzung erhalten. Mitgliedschaft sowie Lese-/Schreib-/Jobzuweisungsregeln der Route prüfen; wiederholte Anmeldung erteilt keine Rechte |
| Auth-Daten-Abfrage mit Netzwerkfehler/5xx | Die Arbeitsbereichsliste wurde nicht erfolgreich geladen | Sichtbare Wiederholen-Aktion nutzen; richtige Liste und Verschwinden des bisherigen Fehlers prüfen |

`invalid_grant` ist eine Ausnahme von der allgemeinen Provider-400-Regel oben. Unbekanntes `kid`, falsche Signatur, falscher Issuer/Client und abgelaufene JWTs bleiben Authentifizierungsfehler; ein nicht erreichbarer oder falsch konfigurierter JWKS-Endpunkt wird davon unterschieden. Einzelne Zugriffslevel-Guards verwenden weiterhin ältere 401-Antworten: Meldung und Route prüfen, statt für sämtliche Berechtigungsfehler bereits 403 vorauszusetzen.

**Browser, HTTP und Betriebslog zuordnen**

1. Zielumgebung, ausgeliefertes Artefakt/Version, UTC-Zeit, Aktion, HTTP-Status der Anwendung und sichtbare Fehler-ID erfassen. In DevTools Network ausschließlich Antwortheader `X-Request-Id`, Fehlerfelder `requestId`/`code` und den Pfad ohne Querywerte prüfen. UI-ID, Header und Fehlerkörper müssen für dieselbe Anfrage übereinstimmen.
2. Die Request-ID-Middleware akzeptiert getrimmte IDs mit 1–128 Zeichen aus `[A-Za-z0-9._:-]+`; andernfalls erzeugt sie eine neue ID. Maßgeblich ist die zurückgegebene ID, nicht ein unbestätigter vom Client gesetzter Wert. Das Provider-Diagnoseereignis übernimmt diese ID, soweit sie verfügbar ist.
3. Zugehöriges Backend-Ereignis suchen: `oidc-refresh-failed`, `oidc-code-exchange-failed`, `oidc-userinfo-failed`, `oidc-jwks-failed` oder `oidc-logout-failed`. Aus diesem strukturierten Ereignis ausschließlich `event`, `errorClass`, `endpoint`, `httpStatus` und `requestId` weitergeben.
4. `httpStatus` ist der Status des **Providers**, nicht der Anwendungsantwort. Ohne Provider-Antwort kann er `null` sein. Beim Endpunkt werden nur Origin und Pfad protokolliert; URL-Zugangsdaten, Query und Fragment werden entfernt. Eine Konfigurationsprüfung vor dem Provider-Aufruf muss kein Provider-Antwortereignis erzeugen; dann auch den korrelierten Backend-Fehlereintrag prüfen.

Für die interne Diagnose ein begrenztes Log-Zeitfenster einmalig sichern. Compose-Projekt, Umgebungsdateien und vollständige Override-Liste der aktiven Installation verwenden; bei vorhandenem `compose.sh`-Wrapper diesen anstelle von `docker compose` einsetzen.

```bash
umask 077
auth_diag_dir="$(mktemp -d)"
docker compose logs --no-color --since 15m backend > "$auth_diag_dir/backend.log" 2>&1
auth_request_id='example-request-123'
grep -nF -- "$auth_request_id" "$auth_diag_dir/backend.log"
```

Rohdatei und benachbarte Logzeilen dienen der internen Prüfung. Für Ticket oder Supportnachricht nur die fünf erlaubten Felder aus dem strukturierten Auth-Ereignis übertragen; eine allgemeine HTTP-Logzeile oder ein Stacktrace ist kein bereinigter Auszug. Ursprüngliche Aufnahme und Zeitfenster erhalten. Einen vorhandenen Vorfallsnachweis nicht durch eine spätere leere Abfrage eines rollierenden Fensters überschreiben.

Dieses Dokumentationsbeispiel hat Anwendungsstatus **503** und Providerstatus **404**:

```json
{
  "event": "oidc-jwks-failed",
  "errorClass": "configuration-error",
  "endpoint": "https://keycloak.example.com/realms/coding-box/protocol/openid-connect/certs",
  "httpStatus": 404,
  "requestId": "example-request-123"
}
```

Keine Authorization-/Cookie-Header, Access-/Refresh-/ID-Tokens, Client-Secrets, Callback-/Exchange-Codes, PKCE-Werte, vollständigen HAR-Dateien, Provider-Antwortkörper oder Personen-/Antwortdaten übernehmen. Dieses Verfahren benötigt weder das Auslesen von Tokenwerten noch einen Dump von Umgebungs- oder Konfigurationsdateien.

**Betriebsmaßnahme auswählen und Erfolg prüfen**

- Bei `provider-unavailable` DNS, Routing/VPN, TLS und Erreichbarkeit des betroffenen Endpunkts **aus dem Backend** prüfen. Ein erfolgreicher Browser-Login beweist keine Backend-Verbindung zum Provider oder JWKS. Verbindung wiederherstellen und erneut versuchen; der Entwurf muss erhalten bleiben und danach gespeichert werden können.
- Bei `configuration-error` `OIDC_ISSUER`, `OAUTH2_CLIENT_ID` und betroffenen Endpunkt mit dem vorgesehenen Provider/Realm vergleichen. Der Issuer muss exakt dem Token-Issuer des Providers entsprechen. Absichtlich interne `OIDC_JWKS_URI`-/Token-Adressen dürfen abweichen, müssen aber aus dem Backend erreichbar sein. Ein syntaktisch gültiger, inhaltlich falscher Issuer kann JWT-401 statt `configuration-error` erzeugen. Betroffene ausgelieferte Einstellung nach dem Änderungs-/Rücknahmeverfahren des Deployments korrigieren, erneut versuchen und das Verschwinden des alten Hinweises bestätigen.
- Bei `session-invalid` dieselbe Person neu anmelden und Kodierkontext sowie Entwurf prüfen. Bei 403 die vorgesehene Berechtigung prüfen; Zugriffe nicht als Diagnoseabkürzung erweitern.
- Anwendungsstatus vorher/nachher, übereinstimmende Request-ID, bereinigtes Ereignis und Recovery-Ergebnis festhalten. Der Live-F05/F06-Nachweis im Abnahmeprotokoll ordnet Anwendungs-503 dem JWKS-Providerstatus 404 zu, stellt die Konfiguration zurück und bestätigt den erhaltenen Entwurf nach Speichern/Neuladen. F02 belegt getrennt Refresh-`invalid_grant` mit Anwendungs-401 und Providerstatus 400. Dafür gelten unterschiedliche Wiederherstellungswege.

## 6. Sicherheitsüberlegungen

### Token-Typen und Rechte

Die folgende Übersicht beschreibt den integrierten Stand. Die
[verbindliche Rechte-Matrix mit allen 25 Routen](workspace-api-token-rights-de.md)
legt Freigaben, Ausschlüsse, Zusatzprüfungen, Ausstellung und Legacy-Übergang fest.
Die separate Abnahme von [#569](https://github.com/iqb-berlin/coding-box/issues/569)
steht noch aus.

| Typ/Scope | Geltung und Grenze |
| --- | --- |
| OIDC-Benutzer-Access-Token | Provider-signiertes RS256-JWT für den konfigurierten Client; Anwendungsrollen, Workspace-Mitgliedschaft und Route entscheiden über Aktionen. Laufzeit nach Provider/Client und `exp`. |
| Workspace `replay:read` | Ausdrücklich freigegebene Replay-/Player-/Metadatenrouten sowie kompatibles Statistik-POST im gebundenen Workspace. Standardmaximum 90 Tage, über `WORKSPACE_TOKEN_REPLAY_READ_MAX_DURATION_DAYS` konfigurierbar. |
| Workspace `replay-statistics:write` | Ausdrücklich freigegebene Statistikaktion; kein allgemeines Schreibrecht. Maximum 1 Tag. |
| Workspace `coding-job:operate` | Freigegebene Kodierjob-Lese- und Schreibaktionen, unter anderem Fortschritt/Notizen, Status, Pause/Fortsetzen und Abgabe; zusätzliche Workspace-/Rollen-/Jobprüfungen bleiben erforderlich. Maximum 1 Tag. |
| Client-Credentials-Provider-Token | Die Ausgabe über `/api/auth/token` definiert keinen eigenständigen Maschinenzugang. Akzeptanz und Rechte müssen für einen konkreten Verbraucher gesondert festgelegt werden. |

Der Statistik-POST akzeptiert bewusst **auch `replay:read`**, damit der vorhandene
Replay seine Statistik erfassen kann. Deshalb ist dieser historische Scope nicht
pauschal schreibfrei. `replay-statistics:write` ist die zusätzliche explizite
Alternative; diese Kompatibilitätsausnahme bleibt beim Legacy-Übergang erhalten.
[Implementierung](../apps/backend/src/app/admin/replay-statistics/replay-statistics.controller.ts).

Workspace-Tokens sind HS256-Tokens mit `token_use=workspace`, `iss=coding-box`,
`aud=coding-box-workspace-token`, eigener Workspace-ID und Scopes. Bei kombinierten
Scopes gilt die kürzeste zulässige Höchstdauer. Ausgestellt werden sie über die
Benutzer-/Workspace-geschützten Tokenrouten, nicht aus einem bereits vorhandenen
Workspace-Token heraus. Der Server begrenzt die Dauer und protokolliert die Ausgabe.
Tokens ausschließlich in der dafür vorgesehenen geschützten Anwendung/Integration
verwenden; Ausgabe und Authorization-Header nicht in Supportnachrichten kopieren.

`ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS` ist derzeit standardmäßig `true`. Die Option
erlaubt das geprüfte alte Format ohne moderne Typ-/Issuer-/Audience-Claims;
vorhandene Scope-Arrays bleiben erhalten, auch für `coding-job:operate`; nur
fehlende Scopes erhalten `replay:read`. Signatur, Ablauf und Workspace-Bindung
bleiben erforderlich. Vor Deaktivierung betroffene Verbraucher inventarisieren,
moderne Tokens mit minimalen Scopes ausstellen und Replay/Frontend gegen die
Guard-Tests prüfen. Neue Integrationen sollen nicht auf dem Legacy-Format aufbauen.
Ein Workspace-Token ersetzt keine OIDC-Benutzersitzung und erhält ohne explizite
Routenfreigabe keinen Zugriff; auch die Scope-Prüfung kann dabei 401 liefern.

Quellen: [Tokenregeln](../apps/backend/src/app/auth/workspace-token.ts),
[Strategie](../apps/backend/src/app/auth/workspace-token.strategy.ts),
[Ausgabe](../apps/backend/src/app/admin/workspace/workspace-users.controller.ts),
[Guard-Tests](../apps/backend/src/app/auth/jwt-or-workspace-token-auth.guard.spec.ts)
und [Strategietests](../apps/backend/src/app/auth/workspace-token.strategy.spec.ts).

### Provider-Voraussetzungen und Grenzen

[#570](https://github.com/iqb-berlin/coding-box/issues/570) verfolgt die vollständige
Provider-Abgrenzung separat. Für den aktuellen Backend-Bearer-Pfad gelten:

- JWT-Access-Token, RS256 und erreichbare JWKS mit passendem Schlüssel; opaque Tokens
  oder andere Signaturalgorithmen sind durch diesen Pfad nicht unterstützt.
- Exakter `iss`, nichtleeres `sub` sowie passendes `azp` **oder** ein `aud`, das
  `OAUTH2_CLIENT_ID` enthält. `preferred_username` wird genutzt, sonst `sub`.
- Callback/Userinfo verwendet `sub`, `preferred_username` sowie optional
  `given_name`, `family_name`, `email`; diese Claims für einen anderen Provider
  gezielt abgleichen. Admin-Rolle/Frontend-Rollen erwarten `realm_access.roles`.
- Der Account-Aufruf verwendet `referrer`/`referrer_uri`; das ist eine verbleibende
  Keycloak-Annahme. Profilverwaltung und Claim-Mapping anderer Provider benötigen
  eine konkrete Anpassung bzw. passende Konfiguration.
- Aktiver OIDC-Service, Keycloak-Deployment/Theme und verbleibende
  `KeycloakAuthService`-Hilfsdateien unterscheiden. Letztere sind im aktiven
  Auth-Modul nicht als alternative Login-Implementierung registriert.

Belegt ist Keycloak; ein weiterer Provider wurde nicht live abgenommen. Ein neuer
Provider erfordert einen eigenen Anwendungsfall und passende Prüfungen, nicht
bloß den Austausch einer Basis-URL.

#### Konkreter Claim- und Providervertrag (#570)

Die drei aktiven Verbraucher lesen Claims aus unterschiedlichen Antworten:

| Verbraucher | Quelle und benötigte Zuordnung |
| --- | --- |
| Backend-Callback | Userinfo mit nichtleerem `sub`; `preferred_username` wird an die lokale Benutzeranlage weitergegeben, optionale Namen/E-Mail ebenfalls. `realm_access.roles` mit `admin` setzt die Admininformation dieses Aufrufs. Der konfigurierte Issuer wird als Herkunft gespeichert. |
| Backend-Bearer | RS256-Access-JWT über konfigurierte JWKS; exakter Issuer und passendes `azp` oder `aud`. `sub` ist erforderlich, ein fehlender/leerer `preferred_username` fällt hier auf `sub` zurück. Namen/E-Mail und `realm_access.roles` werden aus dem Access-Token gelesen. |
| Frontend | Profilfelder und `realm_access.roles` werden aus dem gespeicherten Access-Token dekodiert. Claims ausschließlich im ID-Token oder in Userinfo füllen diesen Pfad nicht. Das Frontend ersetzt keine serverseitige Berechtigungsprüfung. |

Für einen anderen Provider deshalb Rollen und Profilfelder gezielt in **Userinfo
und Access-Token** konfigurieren beziehungsweise die jeweiligen Verbraucher
anpassen. Für den vorgesehenen Callback einen stabilen, nichtleeren
`preferred_username` bereitstellen; dort gibt es den oben genannten
Bearer-Fallback auf `sub` nicht. `realm_access.roles` muss ein Array von
Rollenbezeichnungen sein, die Adminrolle heißt exakt `admin`.
Es gibt keinen allgemeinen konfigurierbaren Claim-Mapper; Claims wie
`groups`, ein oberstes `roles` oder `resource_access` werden nicht automatisch in
`realm_access.roles` übersetzt. Eine neue Provideranbindung muss die lokale
Identität und die erwarteten Rollen über alle drei Pfade konsistent halten.

Die [lokale Benutzerzuordnung](../apps/backend/src/app/database/services/users/users.service.ts)
sucht sowohl nach Issuer/Subject als auch nach dem Benutzernamen. Ein Treffer
über denselben Benutzernamen kann die gespeicherte Issuer-/Subject-Zuordnung
aktualisieren. Ein Providerwechsel schafft daher keine getrennten Benutzer allein
durch eine andere Issuer-URL. Bestehendes lokales `isAdmin` bleibt bei der
Benutzersynchronisierung erhalten (`bisheriges isAdmin` oder neuer Admin-Claim);
ein fehlender Admin-Claim entzieht dieses lokale Recht nicht automatisch.
Benutzerzuordnung, lokale Adminrechte, Workspace-Mitgliedschaft und Jobzuweisungen
bei einer geplanten Umstellung gesondert prüfen; keine bestehenden Konten oder
Rechte als Testabkürzung ändern.

Weitere konkrete Protokollgrenzen des aktiven
[OIDC-Dienstes](../apps/backend/src/app/auth/service/oidc-auth.service.ts):

- Authorization Code mit PKCE S256 und fest angefordertem Scope
  `openid profile email`; keine automatische Provider-Discovery oder Auswahl
  weiterer Authorization-Parameter durch eine allgemeine Adapterkonfiguration.
  Für erneuerbare Sitzungen muss der Provider einen verwendbaren Refresh-Token
  liefern. Falls er dafür etwa `offline_access` verlangt, ist eine gezielte
  Anpassung nötig; dieser Scope wird derzeit nicht angefordert.
- Code-Austausch und Refresh senden Formular-POSTs mit `client_id` und bei
  gesetztem Geheimnis `client_secret` im Body. Ein öffentlicher Client lässt das
  Geheimnis weg. Eine Auswahl von `client_secret_basic`, `private_key_jwt` oder
  anderen Token-Endpunkt-Authentifizierungen ist nicht implementiert.
- Userinfo wird per GET mit Bearer-Access-Token angefordert. Der API-Bearer-Pfad
  benötigt weiterhin ein signiertes RS256-JWT; ein ausschließlich über
  Introspection verwendbares Token ersetzt diesen Vertrag nicht.
- Der aktive Logout verwendet einen Formular-POST an `OIDC_END_SESSION_ENDPOINT`
  mit `client_id`, `refresh_token` und optionalem `client_secret`. Das ist für
  Keycloak belegt. Ein bloßer RP-Initiated-Logout-Endpunkt mit `id_token_hint`
  genügt nicht als Nachweis derselben Funktion. Die vorhandene Hilfsmethode
  `getLogoutUrl()` wird vom aktiven Logout-Controller nicht verwendet.
- Accountmanagement ist ein gesonderter Browser-Redirect an
  `OIDC_ACCOUNT_ENDPOINT`, mit Keycloak-Parametern `referrer`/`referrer_uri` beim
  erlaubten Rückkehrziel. Eine Discovery- oder Userinfo-Adresse ersetzt diesen
  Profilverwaltungsvertrag nicht.

[AuthModule](../apps/backend/src/app/auth/auth.module.ts) registriert
`OidcAuthService` und `JwtStrategy`. Die verbleibenden Dateien
[KeycloakAuthService](../apps/backend/src/app/auth/service/keycloak-auth.service.ts)
und [KeycloakJwksService](../apps/backend/src/app/auth/keycloak-jwks.service.ts)
sind dort nicht registriert und werden vom aktiven Login-/Bearer-Pfad nicht
aufgerufen. Dagegen sind Realm-/Client-Exporte, Theme, Installer und die begrenzte
Legacy-Konfigurationsmigration bewusst Keycloak-spezifische Deploymentdetails.
Diese Dateien als Betreiber nicht auf Verdacht entfernen oder austauschen.

Vor einer weiteren Provideranbindung einen eigenen Prüfumfang festlegen:
Endpunkte und Client-Authentifizierung abgleichen; ein synthetisches Profil mit
passenden Claims und bewusst unterschiedlichen Issuer-/Client-Werten prüfen;
dann Login, Callback, Exchange, geschützte API, Profil, Refresh und Provider-Logout
in isolierter Umgebung nachweisen. Ein erfolgreicher synthetischer JWKS-Test
belegt keinen zweiten realen Provider. Die vorhandenen Keycloak-Nachweise bleiben
auf ihre dokumentierten Entwicklungs-/Testumgebungen begrenzt.

### Secret Management und HTTPS-Anforderungen

Provider-Zugangsdaten, `JWT_SECRET`, Admin- und Datenbankpasswörter getrennt schützen.
Nur private Betreiberdateien verwenden; Migrationen lesen diese als Bash. Reale
Secrets und Tokens niemals in Dokumentation, Tickets, Screenshots oder Logs
übernehmen. Öffentliche Browser-Endpunkte/Callback im Betrieb mit gültigem HTTPS
betreiben; interne Backend-Adressen und deren Vertrauens-/Netzgrenzen ausdrücklich
festlegen. HTTP-Beispiele gelten für das isolierte lokale Entwicklungsnetz.

## 7. Migrationsleitfaden

Für bestehende Installationen gilt ausschließlich der
[geprüfte Upgrade- und Restore-Pfad](auth-upgrade-and-restore.md).
Er beschreibt zusammengehörige Anwendungs-/Provider-/Asset-Sicherungen, private
Dateisicherungen, Legacy-Ergänzung, Abbruch bei Duplikaten/Teilkonfiguration und
wiederholte Ausführung ohne Realm-Neuimport. Bei Queue-/Anwendungsversionswechseln
zusätzlich [Backend-Betriebsgrenzen](backend-hardening.md) beachten.

Die Migration erhält eine vollständige Betreiberkonfiguration. Änderungen nur
bei ausdrücklich unterstützter Legacy-Konfiguration bzw. fehlendem/unsicherem
Workspace-Schlüssel; Auswirkungen auf bestehende Tokens vorher einplanen.
Bei Fehlschlag bricht der Updater standardmäßig ab. Ein vollständiger Restore
kann Provider-Sitzungen verlieren und ist kein globaler Tokenwiderruf.

[#565 ist im dokumentierten Umfang angenommen](https://github.com/iqb-berlin/coding-box/issues/565#issuecomment-6395469691):
[Live-Protokoll](qa/auth-upgrade-565-2026-10-25.md) und
[bereinigte Nachweise](qa/auth-upgrade-565-evidence-2026-10-25.json).
Ein vollständiger interaktiver Updater-Lauf, Keycloak-Hauptversionswechsel,
produktiver TLS-Betrieb und produktiver Queue-Restore gehören nicht zu diesem
Nachweis. Die letzten Skriptergänzungen wurden durch Dateiregressionen geprüft;
kein erneuter vollständiger Live-Restore wird behauptet.

Für neue Deployments gilt Abschnitt 2.3. Eine Neuinstallation, ein Providerwechsel,
eine Auth-Konfigurationsmigration und ein DB-Schema-Rollback sind verschiedene
Vorgänge; nicht durch erneute Realm-/Nutzerimporte vermischen.

## Prüfnachweise und Abnahme

- [#564: bestätigter Neuinstallationsumfang](https://github.com/iqb-berlin/coding-box/issues/564#issuecomment-6389951706).
- [#565: bestätigter Upgrade-/Restore-Umfang](https://github.com/iqb-berlin/coding-box/issues/565#issuecomment-6395469691).
- [#1018: Sitzungs- und Fehlerbehandlung](https://github.com/iqb-berlin/coding-box/issues/1018),
  [Diagnose-/Browserprotokoll](qa/auth-acceptance-2026-10-23.md).
- [#569: externe Token-Rechte](https://github.com/iqb-berlin/coding-box/issues/569),
  [#570: Providergrenzen](https://github.com/iqb-berlin/coding-box/issues/570).
- [Bestätigte Dokumentationsabnahme zu #571](https://github.com/iqb-berlin/coding-box/issues/571#issuecomment-6396878100)
  und [Prüfnachweis](qa/auth-documentation-571-2026-10-25.md).

Die bestätigten Teilabnahmen bleiben auf ihren jeweiligen Prüfumfang begrenzt.
#569 und #570 bleiben bis zur jeweils ausdrücklich bestätigten Abnahme offen.
