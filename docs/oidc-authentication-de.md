# OIDC-Authentifizierung

Dieses Dokument beschreibt die OpenID Connect (OIDC) Authentifizierung in Kodierbox, einschließlich der generischen OIDC-Implementierung und der Keycloak-spezifischen Integration.

## 1. Einführung

### Was ist OIDC/OpenID Connect?

OpenID Connect (OIDC) ist eine Authentifizierungsschicht, die auf OAuth 2.0 aufbaut. Es ermöglicht Clients, die Identität eines Benutzers basierend auf der Authentifizierung durch einen Autorisierungsserver zu verifizieren.

### Warum verwendet Kodierbox OIDC?

Kodierbox verwendet OIDC für:
- Zentralisierte Benutzerverwaltung
- Single Sign-On (SSO) über mehrere Anwendungen
- Sichere Authentifizierung mit PKCE (Proof Key for Code Exchange)
- Unterstützung von Standard-Identity-Providern wie Keycloak
- Flexibilität für verschiedene OIDC-Provider

### Überblick über den Authentifizierungsablauf

Der Authentifizierungsablauf in Kodierbox verwendet den Authorization Code Flow mit PKCE:

1. Benutzer initiiert Login
2. Backend generiert PKCE Code Verifier und Challenge
3. Redirect zum OIDC-Provider (z.B. Keycloak)
4. Benutzer authentifiziert sich beim Provider
5. Provider leitet mit Authorization Code zurück
6. Backend tauscht Code gegen Access Token
7. Backend ruft Benutzerinformationen ab
8. Benutzer wird in Kodierbox-Datenbank gespeichert
9. Access Token wird an Frontend zurückgegeben

## 2. Für Systemadministratoren

### 2.1 Umgebungskonfiguration

#### Erforderliche Umgebungsvariablen (generischer OIDC)

Die folgenden Variablen müssen für die generische OIDC-Implementierung konfiguriert werden:

```bash
# OIDC Provider-Endpunkte
OIDC_PROVIDER_URL=https://keycloak.example.com
OIDC_ISSUER=https://keycloak.example.com/auth/realms/coding-box
OIDC_ACCOUNT_ENDPOINT=https://keycloak.example.com/auth/realms/iqb/account
OIDC_AUTHORIZATION_ENDPOINT=https://keycloak.example.com/auth/realms/iqb/protocol/openid-connect/auth
OIDC_TOKEN_ENDPOINT=https://keycloak.example.com/auth/realms/iqb/protocol/openid-connect/token
OIDC_USERINFO_ENDPOINT=https://keycloak.example.com/auth/realms/iqb/protocol/openid-connect/userinfo
OIDC_END_SESSION_ENDPOINT=https://keycloak.example.com/auth/realms/iqb/protocol/openid-connect/logout
OIDC_JWKS_URI=https://keycloak.example.com/auth/realms/iqb/protocol/openid-connect/certs

# OAuth2 Client-Konfiguration
OAUTH2_CLIENT_ID=coding-box
OAUTH2_CLIENT_SECRET=your_secret_here
OAUTH2_REDIRECT_URL=//example.com/auth/callback
```

#### Keycloak-spezifische Variablen

Für die Keycloak-spezifische Implementierung können diese Variablen verwendet werden:

```bash
KEYCLOAK_URL=https://keycloak.example.com/auth/
KEYCLOAK_REALM=coding-box
KEYCLOAK_CLIENT_ID=coding-box
KEYCLOAK_CLIENT_SECRET=your_secret_here
```

#### Konfigurationsvorlagen

Die Hauptkonfigurationsvorlage befindet sich in `.env.coding-box.template`. Kopieren Sie diese Datei und passen Sie die Werte an Ihre Umgebung an:

```bash
cp .env.coding-box.template .env.coding-box
# Bearbeiten Sie .env.coding-box mit Ihren Werten
```

#### Docker Compose Setup

Die OIDC-Umgebungsvariablen sind in `docker-compose.yaml` definiert und werden über den `x-env-oidc` Anchor an Backend und Frontend weitergegeben:

```yaml
x-env-oidc: &env-oidc
  OIDC_PROVIDER_URL: ${OIDC_PROVIDER_URL}
  OIDC_ISSUER: ${OIDC_ISSUER}
  OIDC_ACCOUNT_ENDPOINT: ${OIDC_ACCOUNT_ENDPOINT}
  OIDC_AUTHORIZATION_ENDPOINT: ${OIDC_AUTHORIZATION_ENDPOINT}
  OIDC_TOKEN_ENDPOINT: ${OIDC_TOKEN_ENDPOINT}
  OIDC_USERINFO_ENDPOINT: ${OIDC_USERINFO_ENDPOINT}
  OIDC_END_SESSION_ENDPOINT: ${OIDC_END_SESSION_ENDPOINT}
  OIDC_JWKS_URI: ${OIDC_JWKS_URI}
  OAUTH2_CLIENT_ID: ${OAUTH2_CLIENT_ID}
  OAUTH2_CLIENT_SECRET: ${OAUTH2_CLIENT_SECRET}
  OAUTH2_REDIRECT_URL: ${OAUTH2_REDIRECT_URL}
```

### 2.2 Keycloak Setup

#### Realm-Konfiguration

Die Keycloak Realm-Konfiguration befindet sich in `config/keycloak/realm/coding-box-realm.json`. Wichtige Einstellungen:

- **Realm Name**: `coding-box`
- **Access Token Lifespan**: 300 Sekunden (5 Minuten)
- **SSO Session Idle Timeout**: 1800 Sekunden (30 Minuten)
- **SSO Session Max Lifespan**: 36000 Sekunden (10 Stunden)
- **Registration Allowed**: `true` (kann deaktiviert werden)
- **Reset Password Allowed**: `false`

#### Client-Setup

Die Client-Konfiguration befindet sich in `config/keycloak/clients/coding-box.json`:

- **Client ID**: `coding-box`
- **Name**: IQB Kodierbox
- **Standard Flow Enabled**: `true` (Authorization Code Flow)
- **Implicit Flow Enabled**: `false`
- **Public Client**: `true`
- **Redirect URIs**: `*` (in Produktion einschränken)
- **Web Origins**: `*` (in Produktion einschränken)
- **Access Token Lifespan**: 4579200 Sekunden (53 Tage)

#### Benutzerrollen und Berechtigungen

Kodierbox verwendet die folgende Rollenstruktur in Keycloak:

- **admin**: Systemadministrator mit vollen Rechten
- **default-roles-coding-box**: Standardrolle für alle Benutzer

Der Admin-Status wird aus dem `realm_access.roles` Array des Benutzers gelesen. Benutzer mit der Rolle `admin` erhalten Administrator-Rechte in Kodierbox.

#### Admin-Account Setup

Der Admin-Account wird über Umgebungsvariablen konfiguriert:

```bash
CODING_BOX_ADMIN_NAME=coding-box-admin
CODING_BOX_ADMIN_EMAIL=coding-box-admin@localhost
CODING_BOX_ADMIN_PASSWORD=change_me
CODING_BOX_ADMIN_CREATED_TIMESTAMP=1234567890
```

Diese Variablen werden in der Realm-Konfiguration verwendet, um den initialen Admin-Benutzer zu erstellen.

**Standard-Anmeldedaten für die lokale Entwicklung:**

- **Keycloak Admin Console** (http://localhost:8080/admin):
  - Benutzername: `admin`
  - Passwort: `change_me`

- **Kodierbox Realm** (http://localhost:8080/realms/coding-box):
  - Benutzername: `coding-box-admin`
  - Passwort: `change_me`

**Wichtig:** Ändern Sie diese Passwörter nach dem ersten Login aus Sicherheitsgründen.

#### Theme-Anpassung

Kodierbox verwendet ein benutzerdefiniertes IQB-Theme für Keycloak. Das Theme befindet sich in `config/keycloak/themes/iqb/`. Das Theme wird über den Client-Attribut `login_theme: iqb` aktiviert.

### 2.3 Deployment

#### Docker Compose Deployment

Starten Sie die komplette Umgebung mit:

```bash
make dev-up
```

Dies startet:
- PostgreSQL Datenbank
- Redis für PKCE Verifier Storage
- Backend mit OIDC-Konfiguration
- Frontend
- Keycloak (falls im Compose-File konfiguriert)

#### Traefik Integration

Traefik wird als Reverse Proxy verwendet und konfiguriert SSL/TLS. Stellen Sie sicher, dass:

- `SERVER_NAME` korrekt gesetzt ist
- `TLS_CERTIFICATE_RESOLVER` konfiguriert ist (oder leer für benutzerdefinierte Zertifikate)
- Die OIDC-Endpunkte über HTTPS erreichbar sind

#### SSL/TLS-Konfiguration

Für Produktionsumgebungen:
- Verwenden Sie HTTPS für alle OIDC-Endpunkte
- Konfigurieren Sie gültige SSL-Zertifikate
- Setzen Sie `sslRequired: external` in der Keycloak Realm-Konfiguration
- Aktualisieren Sie alle Redirect URIs auf HTTPS

#### Netzwerkkonfiguration

Kodierbox verwendet ein Docker-Netzwerk `app-net` für die Kommunikation zwischen Services. Stellen Sie sicher, dass:

- Backend kann OIDC-Provider erreichen
- Frontend kann Backend erreichen
- OIDC-Provider kann Callback-URL erreichen

## 3. Für Entwickler

### 3.1 Backend-Implementierung

#### OidcAuthService - Generischer OIDC-Service

Der `OidcAuthService` (`apps/backend/src/app/auth/service/oidc-auth.service.ts`) implementiert eine generische OIDC-Lösung, die mit jedem OIDC-konformen Provider funktioniert.

**Hauptmethoden:**

- `getAuthorizationUrl(state, redirectUri, codeChallenge)`: Generiert die Authorization URL für den OIDC-Provider
- `exchangeCodeForToken(code, redirectUri, codeVerifier)`: Tauscht Authorization Code gegen Access Token
- `getUserInfo(accessToken)`: Ruft Benutzerinformationen vom Provider ab
- `getLogoutUrl(idToken, redirectUri)`: Generiert Logout-URL
- `logoutWithRefreshToken(refreshToken)`: Führt POST Logout durch
- `getProfileUrl(redirectUri)`: Generiert Profilmanagement-URL
- `generatePkcePair()`: Generiert PKCE Code Verifier und Challenge
- `storePkceVerifier(state, codeVerifier)`: Speichert PKCE Verifier (5 Minuten TTL)
- `consumePkceVerifier(state)`: Konsumiert und löscht PKCE Verifier

**Schnittstellen:**

```typescript
export interface OidcConfiguration {
  issuer: string;
  account_endpoint: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint: string;
  jwks_uri: string;
}

export interface OidcTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
  id_token?: string;
}

export interface OidcUserInfo {
  sub: string;
  preferred_username: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  realm_access?: {
    roles: string[];
  };
}
```

#### KeycloakAuthService - Keycloak-spezifischer Service

Der `KeycloakAuthService` (`apps/backend/src/app/auth/service/keycloak-auth.service.ts`) bietet eine Keycloak-spezifische Implementierung mit vereinfachter Konfiguration.

**Unterschiede zum generischen Service:**
- Benötigt nur `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`
- Konstruiert Endpunkte automatisch aus Basis-URL
- Identische Methodensignaturen wie `OidcAuthService`

#### AuthController - REST API Endpunkte

Der `AuthController` (`apps/backend/src/app/auth/auth.controller.ts`) stellt folgende Endpunkte bereit:

**GET /auth/login**
- Initiiert OIDC Login
- Generiert PKCE Pair
- Speichert Code Verifier
- Redirect zum OIDC-Provider
- Query Parameter: `redirect_uri` (optional)

**GET /auth/callback**
- Verarbeitet OIDC Callback
- Validiert State Parameter
- Konsumiert PKCE Verifier
- Tauscht Code gegen Token
- Ruft User Info ab
- Speichert Benutzer in Datenbank
- Redirect mit Token oder JSON Response
- Query Parameter: `code`, `state`

**POST /auth/logout**
- Führt SSO Logout durch
- Invalidiert Refresh Token
- Body: `{ refresh_token: string }`

**GET /auth/profile**
- Redirect zum Profilmanagement des OIDC-Providers
- Query Parameter: `redirect_uri` (optional)

**POST /auth/token**
- OAuth2 Client Credentials Flow
- Body: `{ client_id, client_secret, scope? }`
- Gibt Access Token zurück

**POST /auth/validate**
- Validiert Access Token gegen OIDC-Provider
- Body: `{ access_token: string }`
- Gibt User Info zurück

#### AuthService - Benutzermanagement

Der `AuthService` (`apps/backend/src/app/auth/service/auth.service.ts`) verwaltet Benutzer in der Kodierbox-Datenbank:

**Hauptmethoden:**

- `storeOidcProviderUser(user)`: Speichert OIDC-Benutzer in Datenbank
- `loginOidcProviderUser(user)`: Loggt OIDC-Benutzer ein und erstellt JWT
- `createToken(identity, workspaceId, duration)`: Erstellt Workspace-spezifisches Token
- `isAdminUser(userId)`: Prüft Admin-Status
- `canAccessWorkSpace(userId, workspaceId)`: Prüft Workspace-Zugriff

### 3.2 Frontend-Implementierung

#### Authentication Service

Der `AuthenticationService` (`apps/frontend/src/app/core/services/authentication.service.ts`) verwaltet die Authentifizierung im Frontend.

**Hauptfunktionen:**
- Token-Speicherung (localStorage/sessionStorage)
- Token-Refresh
- Benutzer-Session-Management

#### Route Guards

Kodierbox verwendet mehrere Guards für Routenschutz:

- **AuthGuard** (`apps/frontend/src/app/core/guards/auth.guard.ts`): Schützt authentifizierte Routen
- **AdminGuard** (`apps/frontend/src/app/core/guards/admin.guard.ts`): Schützt Admin-Routen
- **TokenGuard** (`apps/frontend/src/app/core/guards/token.guard.ts`): Validiert Token
- **AccessLevelGuard** (`apps/frontend/src/app/core/guards/access-level.guard.ts`): Prüft Zugriffsebene

#### Token-Speicherung und Refresh

Tokens werden im Frontend gespeichert und automatisch refreshet:
- Access Token wird für API-Calls verwendet
- Refresh Token wird für Token-Refresh verwendet
- Token-Storage folgt Sicherheitsbest Practices

#### Interceptors für API-Calls

Der `AuthInterceptor` (`apps/frontend/src/app/core/interceptors/auth.interceptor.ts`) fügt automatisch Authorization Headers zu API-Calls hinzu.

#### User Session Management

Die Session-Verwaltung umfasst:
- Login-Status-Tracking
- Benutzer-Informationen-Caching
- Automatisches Logout bei Token-Ablauf
- Session-Timeout-Handling

### 3.3 Authentifizierungsablauf

#### PKCE (Proof Key for Code Exchange) Flow

Der PKCE Flow wird für Public Clients verwendet und erhöht die Sicherheit:

**Schritt 1: Code Verifier und Challenge generieren**
```typescript
const { codeVerifier, codeChallenge } = this.oidcAuthService.generatePkcePair();
```
- Code Verifier: 32 Bytes Random Data, Base64URL-encoded
- Code Challenge: SHA256 Hash des Verifiers, Base64URL-encoded

**Schritt 2: Verifier speichern**
```typescript
await this.oidcAuthService.storePkceVerifier(state, codeVerifier);
```
- Speicherung mit State als Key
- TTL: 5 Minuten
- Speicherort: In-Memory Map (produktiv: Redis)

**Schritt 3: Redirect zum OIDC-Provider**
```typescript
const authUrl = this.oidcAuthService.getAuthorizationUrl(state, redirectUri, codeChallenge);
res.redirect(authUrl);
```
- Parameter: `response_type=code`, `client_id`, `redirect_uri`, `state`, `scope`, `code_challenge`, `code_challenge_method=S256`

**Schritt 4: Code gegen Token tauschen**
```typescript
const tokenResponse = await this.oidcAuthService.exchangeCodeForToken(code, redirectUri, codeVerifier);
```
- POST Request zum Token Endpoint
- Parameter: `grant_type=authorization_code`, `client_id`, `code`, `redirect_uri`, `code_verifier`, optional `client_secret`

**Schritt 5: User Info abrufen**
```typescript
const userInfo = await this.oidcAuthService.getUserInfo(tokenResponse.access_token);
```
- GET Request zum Userinfo Endpoint
- Header: `Authorization: Bearer {access_token}`

**Schritt 6: Benutzer speichern**
```typescript
const userData: CreateUserDto = {
  identity: userInfo.sub,
  username: userInfo.preferred_username,
  firstName: userInfo.given_name || '',
  lastName: userInfo.family_name || '',
  email: userInfo.email || '',
  issuer: 'coding-box',
  isAdmin: userInfo.realm_access?.roles?.includes('admin') || false
};
await this.authService.storeOidcProviderUser(userData);
```

#### Token-Lebenszyklus

1. **Access Token**: Kurzlebig (Standard 5 Minuten), für API-Calls
2. **Refresh Token**: Langlebig (Standard 53 Tage), für Token-Refresh
3. **ID Token**: Enthält Benutzer-Claims, für Identitätsprüfung
4. **Token Refresh**: Automatisch durch Frontend bei Ablauf
5. **Token Invalidierung**: Bei Logout oder SSO-Logout

#### Refresh Token Handling

- Refresh Tokens werden sicher gespeichert
- Automatischer Refresh bei abgelaufenem Access Token
- Refresh Token wird bei Logout invalidiert
- SSO-Logout invalidiert Refresh Token beim Provider

#### Session-Management

- Session-Timeout basierend auf SSO Session (30 Minuten Idle, 10 Stunden Max)
- Aktivitäts-Tracking für Idle-Timeout
- Automatischer Redirect bei Session-Ablauf
- Manuelle Logout-Möglichkeit

### 3.4 Integration mit anderen Services

#### Datenbank-Integration

Benutzer werden in der PostgreSQL-Datenbank gespeichert:

- Tabelle: `users`
- Felder: `id`, `identity`, `username`, `email`, `first_name`, `last_name`, `issuer`, `is_admin`
- Index auf `identity` und `issuer` für schnellen Lookup
- Upsert-Logik: Benutzer wird aktualisiert, wenn bereits vorhanden

#### Redis-Integration

Redis wird für PKCE Verifier Storage verwendet:

- Key-Format: `oidc:pkce:{sha256(state)}`
- TTL: 5 Minuten
- Speicherort: In-Memory Map in Entwicklung, Redis in Produktion
- Automatische Bereinigung abgelaufener Einträge

#### Workspace-Zugriffskontrolle

Zugriff auf Workspaces wird über `AuthService.canAccessWorkSpace()` geprüft:

- Benutzer muss Workspace-Zugriff haben
- Admin-Benutzer haben Zugriff auf alle Workspaces
- Workspace-Admins haben Zugriff auf ihren Workspace

#### Rollenbasierte Autorisierung

Rollen werden aus Keycloak `realm_access.roles` gelesen:

- `admin`: Vollzugriff auf alle Funktionen
- Andere Rollen können nach Bedarf hinzugefügt werden
- Rollen werden in Kodierbox-Datenbank synchronisiert

## 4. Für Endbenutzer

### 4.1 Login-Prozess

**So loggen Sie sich ein:**

1. Klicken Sie auf der Login-Seite auf "Anmelden"
2. Sie werden zum Keycloak Login-Redirect weitergeleitet
3. Geben Sie Ihren Benutzernamen und Passwort ein
4. Nach erfolgreicher Authentifizierung werden Sie zurück zu Kodierbox geleitet
5. Sie sind jetzt angemeldet

**Passwort-Management:**
- Passwörter werden in Keycloak verwaltet
- Passwort-Reset ist abhängig von Keycloak-Konfiguration
- In der Standardkonfiguration ist Passwort-Reset deaktiviert

**Account-Erstellung:**
- Wenn Registration in Keycloak aktiviert ist, können neue Benutzer sich registrieren
- Klicken Sie auf "Registrieren" auf der Login-Seite
- Füllen Sie das Registrierungsformular aus
- Nach Bestätigung können Sie sich einloggen

### 4.2 Profil-Management

**Zugriff auf Profileinstellungen:**

1. Klicken Sie auf Ihren Benutzernamen im Header
2. Wählen Sie "Profil" aus dem Menü
3. Sie werden zum Keycloak Profilmanagement weitergeleitet

**Passwort ändern:**
- Gehen Sie zu Profilmanagement
- Navigieren Sie zu "Passwort"
- Geben Sie Ihr aktuelles und neues Passwort ein
- Bestätigen Sie das neue Passwort
- Speichern Sie die Änderungen

**Persönliche Informationen verwalten:**
- Profilmanagement ermöglicht Änderung von:
  - Vorname
  - Nachname
  - E-Mail-Adresse
  - Weitere Attribute (je nach Konfiguration)

**E-Mail-Verifizierung:**
- Abhängig von Keycloak-Konfiguration
- In der Standardkonfiguration ist E-Mail-Verifizierung deaktiviert
- Wenn aktiviert, müssen Sie Ihre E-Mail nach Registration verifizieren

### 4.3 Logout

**Single Logout (nur Anwendung):**
- Klicken Sie auf "Abmelden" im Benutzermenü
- Sie werden aus Kodierbox ausgeloggt
- Andere Anwendungen bleiben angemeldet

**SSO Logout (alle Sessions):**
- Kodierbox führt automatisch SSO Logout durch
- Refresh Token wird beim Provider invalidiert
- Sie werden aus allen Anwendungen ausgeloggt, die SSO verwenden
- Session wird bei Keycloak beendet

**Session-Timeout:**
- Idle-Timeout: 30 Minuten Inaktivität
- Max Session: 10 Stunden
- Nach Timeout werden Sie automatisch ausgeloggt
- Sie müssen sich erneut anmelden

### 4.4 Fehlerbehebung für Benutzer

**Login-Fehler:**

**Falsche Anmeldedaten:**
- Überprüfen Sie Benutzernamen und Passwort
- Achten Sie auf Groß-/Kleinschreibung
- Versuchen Sie, Ihr Passwort zurückzusetzen (falls aktiviert)

**Account gesperrt:**
- Wenden Sie sich an Ihren Administrator
- Administrator kann Account in Keycloak entsperren

**Browser-Probleme:**
- Löschen Sie Browser-Cookies und Cache
- Deaktivieren Sie Browser-Extensions
- Versuchen Sie einen anderen Browser
- Überprüfen Sie, ob JavaScript aktiviert ist

**Verbindungsprobleme:**
- Überprüfen Sie Ihre Internetverbindung
- Überprüfen Sie, ob der Server erreichbar ist
- Versuchen Sie es später erneut

## 5. Fehlerbehebung (Häufige Probleme)

### 5.1 Konfigurationsprobleme

**Fehlende Umgebungsvariablen**

Symptom: Backend startet nicht mit Fehler "OpenID Connect configuration is missing"

Lösung:
- Überprüfen Sie `.env.coding-box` Datei
- Stellen Sie sicher, alle OIDC_* Variablen gesetzt sind
- Überprüfen Sie Docker Compose Umgebungsvariablen
- Starten Sie Backend neu

**Falsche Endpoint-URLs**

Symptom: "Failed to exchange authorization code for token" oder "Failed to get user information"

Lösung:
- Überprüfen Sie OIDC_ENDPOINT_* Variablen
- Stellen Sie sicher, URLs korrekt und erreichbar sind
- Testen Sie Endpunkte mit curl oder Postman
- Überprüfen Sie TLS/SSL-Konfiguration

**Client Secret Mismatch**

Symptom: "Invalid client credentials" beim Token-Exchange

Lösung:
- Überprüfen Sie OAUTH2_CLIENT_SECRET in Umgebungsvariablen
- Stellen Sie sicher, Secret mit Keycloak Client-Konfiguration übereinstimmt
- Regenerieren Sie Secret in Keycloak wenn nötig
- Starten Sie Backend neu

**Redirect URI Probleme**

Symptom: "Invalid redirect_uri" oder Redirect funktioniert nicht

Lösung:
- Überprüfen Sie OAUTH2_REDIRECT_URL
- Stellen Sie sicher, Redirect URI in Keycloak Client-Konfiguration enthalten ist
- Verwenden Sie in Produktion HTTPS
- Überprüfen Sie CORS-Konfiguration

### 5.2 Authentifizierungsfehler

**PKCE Verifier abgelaufen**

Symptom: "PKCE verifier missing or expired"

Lösung:
- PKCE Verifier hat 5 Minuten TTL
- Starten Sie Login-Prozess neu
- Überprüfen Sie Systemzeit auf Server und Client
- Stellen Sie sicher, Redis läuft (in Produktion)

**Ungültiger State Parameter**

Symptom: "State parameter is required for PKCE flow"

Lösung:
- State wird automatisch generiert
- Überprüfen Sie, ob State im Callback korrekt zurückgegeben wird
- Stellen Sie sicher, keine State-Manipulation durch Middleware
- Prüfen Sie Browser-Console auf Fehler

**Token-Exchange-Fehler**

Symptom: "Failed to exchange authorization code for token"

Lösung:
- Überprüfen Sie Authorization Code ist nicht abgelaufen (60 Sekunden)
- Stellen Sie sicher, PKCE Verifier korrekt ist
- Überprüfen Sie Client ID und Secret
- Prüfen Sie Keycloak Logs auf Fehler

**User Info Retrieval Fehler**

Symptom: "Failed to get user information"

Lösung:
- Überprüfen Sie Access Token ist gültig
- Stellen Sie sicher, Userinfo Endpoint erreichbar ist
- Überprüfen Sie Token-Scopes enthalten `profile` und `email`
- Prüfen Sie Keycloak Benutzer-Konfiguration

### 5.3 Keycloak-Probleme

**Realm nicht gefunden**

Symptom: "Realm not found" in Keycloak Logs

Lösung:
- Überprüfen Sie KEYCLOAK_REALM Variable
- Stellen Sie sicher, Realm in Keycloak existiert
- Importieren Sie Realm-Konfiguration falls nötig
- Überprüfen Sie Keycloak Admin Console

**Client nicht gefunden**

Symptom: "Client not found" oder "Invalid client"

Lösung:
- Überprüfen Sie OAUTH2_CLIENT_ID Variable
- Stellen Sie sicher, Client in Realm existiert
- Überprüfen Sie Client ist enabled
- Importieren Sie Client-Konfiguration falls nötig

**Ungültige Anmeldedaten**

Symptom: "Invalid credentials" beim Login

Lösung:
- Überprüfen Sie Benutzer-Login in Keycloak Admin Console
- Stellen Sie sicher, Benutzer enabled ist
- Setzen Sie Passwort zurück falls nötig
- Überprüfen Sie Benutzer-Rollen

**Rollen-Zuweisungsprobleme**

Symptom: Benutzer hat keine Admin-Rechte trotz Rolle

Lösung:
- Überprüfen Sie Benutzer hat `admin` Rolle in Keycloak
- Stellen Sie sicher, Rolle in `realm_access.roles` enthalten ist
- Synchronisieren Sie Benutzer in Kodierbox-Datenbank
- Überprüfen Sie Backend Logs für Role-Mapping

### 5.4 Netzwerkprobleme

**CORS-Fehler**

Symptom: CORS-Fehler im Browser

Lösung:
- Überprüfen Sie CORS-Konfiguration im Backend
- Stellen Sie sicher, Origin erlaubt ist
- Konfigurieren Sie CORS in Keycloak wenn nötig
- Verwenden Sie CORS-Plugin für Browser-Tests

**Proxy-Konfiguration**

Symptom: Verbindungsfehler durch Proxy

Lösung:
- Überprüfen Sie Traefik-Konfiguration
- Stellen Sie sicher, OIDC-Endpunkte korrekt geroutet werden
- Konfigurieren Sie Proxy-Header (X-Forwarded-*, etc.)
- Testen Sie Endpunkte ohne Proxy

**SSL-Zertifikatprobleme**

Symptom: SSL-Fehler oder Zertifikat-Warnungen

Lösung:
- Verwenden Sie gültige SSL-Zertifikate in Produktion
- Stellen Sie sicher, Zertifikat für alle Endpunkte gültig ist
- Überprüfen Sie Zertifikatskette
- Konfigurieren Sie `sslRequired: external` in Keycloak

**Timeout-Probleme**

Symptom: Request-Timeouts

Lösung:
- Überprüfen Sie Netzwerkverbindung
- Erhöhen Sie Timeout-Werte in HTTP-Client
- Überprüfen Sie Firewall-Konfiguration
- Prüfen Sie Load Balancer-Settings

### 5.5 Debugging

**Backend Logs**

```bash
# Docker Logs
docker-compose logs backend | grep oidc

# Filter für Authentifizierung
docker-compose logs backend | grep -i "auth\|oidc\|keycloak"
```

Wichtige Log-Meldungen:
- "Initiating OpenID Connect Provider login"
- "Processing OpenID Connect Provider callback"
- "Successfully obtained access token"
- "OIDC Provider User with id 'X' stored in database"

**Frontend Console**

Öffnen Sie Browser Developer Tools (F12) und prüfen Sie:
- Console für JavaScript-Fehler
- Network Tab für Failed Requests
- Application Tab für Token-Storage
- LocalStorage/SessionStorage für Session-Daten

**Keycloak Logs**

```bash
# Keycloak Container Logs
docker-compose logs keycloak

# Admin Console für detaillierte Logs
# Navigieren Sie zu: Keycloak Admin > Realm > Events
```

**Network Inspection**

Verwenden Sie Browser DevTools oder Tools wie:
- curl für API-Testing
- Postman für komplexere Requests
- Wireshark für Network-Analysis

Beispiel curl:
```bash
curl -X GET "https://keycloak.example.com/auth/realms/coding-box/.well-known/openid-configuration"
```

## 6. Sicherheitsüberlegungen

### PKCE für Public Clients

PKCE (Proof Key for Code Exchange) wird verwendet, um Authorization Code Interception Angriffe zu verhindern:

- Code Verifier wird zufällig generiert (32 Bytes)
- Code Challenge ist SHA256 Hash des Verifiers
- Verifier wird nicht über das Netzwerk übertragen
- Server kann Challenge validieren
- Schützt vor Code Interception und Replay Angriffe

### State Parameter Validierung

State Parameter wird für CSRF-Schutz verwendet:

- Zufälliger String wird generiert
- State wird im Authorization Request und Callback validiert
- Optional kann Redirect URI im State encodiert werden
- Verhindert CSRF-Angriffe auf Callback-Endpoint

### Redirect URI Validierung

Redirect URIs werden validiert, um Open Redirect Angriffe zu verhindern:

- Nur erlaubte URIs werden akzeptiert
- Relative URIs sind erlaubt
- Same-Origin URIs sind erlaubt
- OIDC Provider Origin ist explizit blockiert
- Validierung in `isAllowedRedirect()` Methode

### Token Storage Best Practices

**Backend:**
- Access Tokens werden nicht persistent gespeichert
- Refresh Tokens werden sicher in Datenbank gespeichert
- PKCE Verifier haben kurze TTL (5 Minuten)
- Tokens werden über HTTPS übertragen

**Frontend:**
- Tokens werden in sessionStorage oder localStorage gespeichert
- Verwenden Sie HttpOnly Cookies wenn möglich
- Implementieren Sie Token-Refresh-Mechanismus
- Löschen Sie Tokens bei Logout

### Secret Management

**Umgebungsvariablen:**
- Speichern Sie Secrets niemals im Code
- Verwenden Sie `.env` Dateien für Entwicklung
- Verwenden Sie Secret Management in Produktion (Vault, Kubernetes Secrets)
- Rotieren Sie Secrets regelmäßig

**Keycloak:**
- Verwenden Sie starke Client Secrets
- Rotieren Sie Secrets regelmäßig
- Verwenden Sie separate Secrets für Development/Production
- Aktivieren Sie Client Secret Rotation wenn verfügbar

### HTTPS-Anforderungen

**Produktion:**
- Alle OIDC-Endpunkte müssen HTTPS verwenden
- SSL/TLS muss korrekt konfiguriert sein
- Verwenden Sie aktuelle TLS-Versionen (TLS 1.2+)
- Deaktivieren Sie veraltete Cipher Suites

**Entwicklung:**
- HTTP ist für lokale Entwicklung akzeptabel
- Verwenden Sie HTTPS für Tests mit Produktion-Konfiguration
- Beachten Sie Browser-Sicherheitswarnungen

## 7. Migrationsleitfaden

### Von Legacy-Authentifizierung

Wenn Sie von einer Legacy-Authentifizierung migrieren:

1. **Backup erstellen:**
   - Sichern Sie Benutzerdatenbank
   - Sichern Sie Konfigurationsdateien
   - Dokumentieren Sie bestehende Authentifizierungsabläufe

2. **OIDC konfigurieren:**
   - Richten Sie Keycloak oder anderen OIDC-Provider ein
   - Konfigurieren Sie Umgebungsvariablen
   - Importieren Sie Realm und Client-Konfiguration

3. **Benutzer migrieren:**
   - Exportieren Sie bestehende Benutzer
   - Importieren Sie Benutzer in Keycloak
   - Setzen Sie initiale Passwörter
   - Weisen Sie Rollen zu

4. **Testing:**
   - Testen Sie Login-Flow
   - Testen Sie Token-Refresh
   - Testen Sie Logout
   - Testen Sie Rollen und Berechtigungen

5. **Deployment:**
   - Deployen Sie neue Version
   - Überwachen Sie Logs
   - Seien Sie bereit für Rollback

### Von Keycloak-only zu generischem OIDC

Wenn Sie von Keycloak-spezifischer zu generischer OIDC-Implementierung wechseln:

1. **Umgebungsvariablen ändern:**
   - Entfernen Sie KEYCLOAK_* Variablen
   - Fügen Sie OIDC_* Variablen hinzu
   - Konfigurieren Sie alle Endpunkte explizit

2. **Code anpassen:**
   - Ersetzen Sie `KeycloakAuthService` durch `OidcAuthService`
   - Aktualisieren Sie Imports
   - Testen Sie alle Authentifizierungsabläufe

3. **Konfiguration testen:**
   - Verifizieren Sie alle Endpunkte
   - Testen Sie mit verschiedenen OIDC-Providern
   - Überprüfen Sie Kompatibilität

### Umgebungsvariablen-Änderungen

Bei Änderungen an Umgebungsvariablen:

1. **Dokumentieren Sie Änderungen:**
   - Notieren Sie alte und neue Werte
   - Dokumentieren Sie Grund für Änderung

2. **Testen Sie Changes:**
   - Testen Sie in Entwicklungsumgebung
   - Verifizieren Sie alle Flows
   - Überprüfen Sie Kompatibilität

3. **Deployen Sie Changes:**
   - Aktualisieren Sie `.env` Dateien
   - Starten Sie Services neu
   - Überwachen Sie Logs

### Datenbank-Migration

Bei Änderungen am Benutzer-Schema:

1. **Migration-Skript erstellen:**
   - Verwenden Sie Liquibase für Schema-Änderungen
   - Erstellen Sie Rollback-Skript
   - Testen Sie Migration in Testumgebung

2. **Daten migrieren:**
   - Sichern Sie bestehende Daten
   - Führen Sie Migration durch
   - Verifizieren Sie Datenintegrität

3. **Deployment:**
   - Führen Sie Migration während Deployment
   - Überwachen Sie auf Fehler
   - Seien Sie bereit für Rollback

## Zusätzliche Ressourcen

- [OpenID Connect Specification](https://openid.net/connect/)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
