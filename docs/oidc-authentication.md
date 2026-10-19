# OIDC Authentication

This document describes the OpenID Connect (OIDC) authentication in Kodierbox, including the generic OIDC implementation and Keycloak-specific integration.

## 1. Introduction

### What is OIDC/OpenID Connect?

OpenID Connect (OIDC) is an authentication layer built on top of OAuth 2.0. It allows clients to verify the identity of a user based on the authentication performed by an authorization server.

### Why does Kodierbox use OIDC?

Kodierbox uses OIDC for:
- Centralized user management
- Single Sign-On (SSO) across multiple applications
- Secure authentication with PKCE (Proof Key for Code Exchange)
- Support for standard identity providers like Keycloak
- Flexibility for different OIDC providers

### Authentication Flow Overview

The authentication flow in Kodierbox uses the Authorization Code Flow with PKCE:

1. User initiates login
2. Backend generates PKCE code verifier and challenge
3. Redirect to OIDC provider (e.g., Keycloak)
4. User authenticates with provider
5. Provider redirects with authorization code
6. Backend exchanges code for access token
7. Backend retrieves user information
8. User is stored in Kodierbox database
9. Access token is returned to frontend

## 2. For System Administrators

### 2.1 Environment Configuration

#### Required Environment Variables (Generic OIDC)

The following variables must be configured for the generic OIDC implementation:

```bash
# OIDC Provider Endpoints
OIDC_PROVIDER_URL=https://keycloak.example.com
OIDC_ISSUER=https://keycloak.example.com/auth/realms/coding-box
OIDC_ACCOUNT_ENDPOINT=https://keycloak.example.com/auth/realms/iqb/account
OIDC_AUTHORIZATION_ENDPOINT=https://keycloak.example.com/auth/realms/iqb/protocol/openid-connect/auth
OIDC_TOKEN_ENDPOINT=https://keycloak.example.com/auth/realms/iqb/protocol/openid-connect/token
OIDC_USERINFO_ENDPOINT=https://keycloak.example.com/auth/realms/iqb/protocol/openid-connect/userinfo
OIDC_END_SESSION_ENDPOINT=https://keycloak.example.com/auth/realms/iqb/protocol/openid-connect/logout
OIDC_JWKS_URI=https://keycloak.example.com/auth/realms/iqb/protocol/openid-connect/certs

# OAuth2 Client Configuration
OAUTH2_CLIENT_ID=coding-box
OAUTH2_CLIENT_SECRET=your_secret_here
OAUTH2_REDIRECT_URL=//example.com/auth/callback
```

#### Keycloak-Specific Variables

For the Keycloak-specific implementation, these variables can be used:

```bash
KEYCLOAK_URL=https://keycloak.example.com/auth/
KEYCLOAK_REALM=coding-box
KEYCLOAK_CLIENT_ID=coding-box
KEYCLOAK_CLIENT_SECRET=your_secret_here
```

#### Configuration Templates

The main configuration template is in `.env.coding-box.template`. Copy this file and adjust values for your environment:

```bash
cp .env.coding-box.template .env.coding-box
# Edit .env.coding-box with your values
```

#### Docker Compose Setup

The OIDC environment variables are defined in `docker-compose.yaml` and passed to backend and frontend via the `x-env-oidc` anchor:

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

#### Realm Configuration

The Keycloak realm configuration is in `config/keycloak/realm/coding-box-realm.json`. Important settings:

- **Realm Name**: `coding-box`
- **Access Token Lifespan**: 300 seconds (5 minutes)
- **SSO Session Idle Timeout**: 1800 seconds (30 minutes)
- **SSO Session Max Lifespan**: 36000 seconds (10 hours)
- **Registration Allowed**: `true` (can be disabled)
- **Reset Password Allowed**: `false`

#### Client Setup

The client configuration is in `config/keycloak/clients/coding-box.json`:

- **Client ID**: `coding-box`
- **Name**: IQB Kodierbox
- **Standard Flow Enabled**: `true` (Authorization Code Flow)
- **Implicit Flow Enabled**: `false`
- **Public Client**: `true`
- **Redirect URIs**: `*` (restrict in production)
- **Web Origins**: `*` (restrict in production)
- **Access Token Lifespan**: 4579200 seconds (53 days)

#### User Roles and Permissions

Kodierbox uses the following role structure in Keycloak:

- **admin**: System administrator with full permissions
- **default-roles-coding-box**: Default role for all users

Admin status is read from the user's `realm_access.roles` array. Users with the `admin` role receive administrator privileges in Kodierbox.

#### Admin Account Setup

The admin account is configured via environment variables:

```bash
CODING_BOX_ADMIN_NAME=coding-box-admin
CODING_BOX_ADMIN_EMAIL=coding-box-admin@localhost
CODING_BOX_ADMIN_PASSWORD=change_me
CODING_BOX_ADMIN_CREATED_TIMESTAMP=1234567890
```

These variables are used in the realm configuration to create the initial admin user.

**Default Credentials for Local Development:**

- **Keycloak Admin Console** (http://localhost:8080/admin):
  - Username: `admin`
  - Password: `change_me`

- **Kodierbox Realm User** (http://localhost:8080/realms/coding-box):
  - Username: `coding-box-admin`
  - Password: `change_me`

**Important:** Change these passwords after the first login for security.

#### Theme Customization

Kodierbox uses a custom IQB theme for Keycloak. The theme is located in `config/keycloak/themes/iqb/`. The theme is activated via the client attribute `login_theme: iqb`.

### 2.3 Deployment

#### Docker Compose Deployment

Start the complete environment with:

```bash
make dev-up
```

This starts:
- PostgreSQL database
- Redis for PKCE verifier storage
- Backend with OIDC configuration
- Frontend
- Keycloak (if configured in compose file)

#### Traefik Integration

Traefik is used as a reverse proxy and configures SSL/TLS. Ensure that:
- `SERVER_NAME` is set correctly
- `TLS_CERTIFICATE_RESOLVER` is configured (or empty for custom certificates)
- OIDC endpoints are accessible via HTTPS

#### SSL/TLS Configuration

For production environments:
- Use HTTPS for all OIDC endpoints
- Configure valid SSL certificates
- Set `sslRequired: external` in Keycloak realm configuration
- Update all redirect URIs to HTTPS

#### Network Configuration

Kodierbox uses a Docker network `app-net` for communication between services. Ensure that:
- Backend can reach OIDC provider
- Frontend can reach backend
- OIDC provider can reach callback URL

## 3. For Developers

### 3.1 Backend Implementation

#### OidcAuthService - Generic OIDC Service

The `OidcAuthService` (`apps/backend/src/app/auth/service/oidc-auth.service.ts`) implements a generic OIDC solution that works with any OIDC-compliant provider.

**Main Methods:**

- `getAuthorizationUrl(state, redirectUri, codeChallenge)`: Generates authorization URL for OIDC provider
- `exchangeCodeForToken(code, redirectUri, codeVerifier)`: Exchanges authorization code for access token
- `getUserInfo(accessToken)`: Retrieves user information from provider
- `getLogoutUrl(idToken, redirectUri)`: Generates logout URL
- `logoutWithRefreshToken(refreshToken)`: Performs POST logout
- `getProfileUrl(redirectUri)`: Generates profile management URL
- `generatePkcePair()`: Generates PKCE code verifier and challenge
- `storePkceVerifier(state, codeVerifier)`: Stores PKCE verifier (5 minute TTL)
- `consumePkceVerifier(state)`: Consumes and deletes PKCE verifier

**Interfaces:**

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

#### KeycloakAuthService - Keycloak-Specific Service

The `KeycloakAuthService` (`apps/backend/src/app/auth/service/keycloak-auth.service.ts`) provides a Keycloak-specific implementation with simplified configuration.

**Differences from generic service:**
- Only requires `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`
- Constructs endpoints automatically from base URL
- Identical method signatures to `OidcAuthService`

#### AuthController - REST API Endpoints

The `AuthController` (`apps/backend/src/app/auth/auth.controller.ts`) provides the following endpoints:

**GET /auth/login**
- Initiates OIDC login
- Generates PKCE pair
- Stores code verifier
- Redirects to OIDC provider
- Query parameter: `redirect_uri` (optional)

**GET /auth/callback**
- Processes OIDC callback
- Validates state parameter
- Consumes PKCE verifier
- Exchanges code for token
- Retrieves user info
- Stores user in database
- Redirects with token or JSON response
- Query parameters: `code`, `state`

**POST /auth/logout**
- Performs SSO logout
- Invalidates refresh token
- Body: `{ refresh_token: string }`

**GET /auth/profile**
- Redirects to OIDC provider profile management
- Query parameter: `redirect_uri` (optional)

**POST /auth/token**
- OAuth2 Client Credentials Flow
- Body: `{ client_id, client_secret, scope? }`
- Returns access token

**POST /auth/validate**
- Validates access token against OIDC provider
- Body: `{ access_token: string }`
- Returns user info

#### AuthService - User Management

The `AuthService` (`apps/backend/src/app/auth/service/auth.service.ts`) manages users in the Kodierbox database:

**Main Methods:**

- `storeOidcProviderUser(user)`: Stores OIDC user in database
- `loginOidcProviderUser(user)`: Logs in OIDC user and creates JWT
- `createToken(identity, workspaceId, duration)`: Creates workspace-specific token
- `isAdminUser(userId)`: Checks admin status
- `canAccessWorkSpace(userId, workspaceId)`: Checks workspace access

### 3.2 Frontend Implementation

#### Authentication Service

The `AuthenticationService` (`apps/frontend/src/app/core/services/authentication.service.ts`) manages authentication in the frontend.

**Main functions:**
- Token storage (localStorage/sessionStorage)
- Token refresh
- User session management

#### Route Guards

Kodierbox uses multiple guards for route protection:

- **AuthGuard** (`apps/frontend/src/app/core/guards/auth.guard.ts`): Protects authenticated routes
- **AdminGuard** (`apps/frontend/src/app/core/guards/admin.guard.ts`): Protects admin routes
- **TokenGuard** (`apps/frontend/src/app/core/guards/token.guard.ts`): Validates tokens
- **AccessLevelGuard** (`apps/frontend/src/app/core/guards/access-level.guard.ts`): Checks access level

#### Token Storage and Refresh

Tokens are stored in the frontend and automatically refreshed:
- Access token is used for API calls
- Refresh token is used for token refresh
- Token storage follows security best practices

#### Interceptors for API Calls

The `AuthInterceptor` (`apps/frontend/src/app/core/interceptors/auth.interceptor.ts`) automatically adds authorization headers to API calls.

#### User Session Management

Session management includes:
- Login status tracking
- User information caching
- Automatic logout on token expiration
- Session timeout handling

### 3.3 Authentication Flow

#### PKCE (Proof Key for Code Exchange) Flow

The PKCE flow is used for public clients and increases security:

**Step 1: Generate Code Verifier and Challenge**
```typescript
const { codeVerifier, codeChallenge } = this.oidcAuthService.generatePkcePair();
```
- Code verifier: 32 bytes random data, base64url-encoded
- Code challenge: SHA256 hash of verifier, base64url-encoded

**Step 2: Store Verifier**
```typescript
await this.oidcAuthService.storePkceVerifier(state, codeVerifier);
```
- Storage with state as key
- TTL: 5 minutes
- Storage location: In-memory map (development), Redis (production)

**Step 3: Redirect to OIDC Provider**
```typescript
const authUrl = this.oidcAuthService.getAuthorizationUrl(state, redirectUri, codeChallenge);
res.redirect(authUrl);
```
- Parameters: `response_type=code`, `client_id`, `redirect_uri`, `state`, `scope`, `code_challenge`, `code_challenge_method=S256`

**Step 4: Exchange Code for Token**
```typescript
const tokenResponse = await this.oidcAuthService.exchangeCodeForToken(code, redirectUri, codeVerifier);
```
- POST request to token endpoint
- Parameters: `grant_type=authorization_code`, `client_id`, `code`, `redirect_uri`, `code_verifier`, optional `client_secret`

**Step 5: Retrieve User Info**
```typescript
const userInfo = await this.oidcAuthService.getUserInfo(tokenResponse.access_token);
```
- GET request to userinfo endpoint
- Header: `Authorization: Bearer {access_token}`

**Step 6: Store User**
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

#### Token Lifecycle

1. **Access Token**: Short-lived (default 5 minutes), used for API calls
2. **Refresh Token**: Long-lived (default 53 days), used for token refresh
3. **ID Token**: Contains user claims, used for identity verification
4. **Token Refresh**: Automatic by frontend on expiration
5. **Token Invalidation**: On logout or SSO logout

#### Refresh Token Handling

- Refresh tokens are stored securely
- Automatic refresh on expired access token
- Refresh token is invalidated on logout
- SSO logout invalidates refresh token at provider

#### Session Management

- Session timeout based on SSO session (30 minutes idle, 10 hours max)
- Activity tracking for idle timeout
- Automatic redirect on session expiration
- Manual logout option

### 3.4 Integration with Other Services

#### Database Integration

Users are stored in the PostgreSQL database:

- Table: `users`
- Fields: `id`, `identity`, `username`, `email`, `first_name`, `last_name`, `issuer`, `is_admin`
- Index on `identity` and `issuer` for fast lookup
- Upsert logic: User is updated if already exists

#### Redis Integration

Redis is used for PKCE verifier storage:

- Key format: `oidc:pkce:{sha256(state)}`
- TTL: 5 minutes
- Storage location: In-memory map in development, Redis in production
- Automatic cleanup of expired entries

#### Workspace Access Control

Access to workspaces is checked via `AuthService.canAccessWorkSpace()`:

- User must have workspace access
- Admin users have access to all workspaces
- Workspace admins have access to their workspace

#### Role-Based Authorization

Roles are read from Keycloak `realm_access.roles`:

- `admin`: Full access to all features
- Other roles can be added as needed
- Roles are synchronized in Kodierbox database

## 4. For End Users

### 4.1 Login Process

**How to log in:**

1. Click "Login" on the login page
2. You will be redirected to Keycloak login
3. Enter your username and password
4. After successful authentication, you will be redirected back to Kodierbox
5. You are now logged in

**Password Management:**
- Passwords are managed in Keycloak
- Password reset depends on Keycloak configuration
- In default configuration, password reset is disabled

**Account Creation:**
- If registration is enabled in Keycloak, new users can register
- Click "Register" on the login page
- Fill out the registration form
- After confirmation, you can log in

### 4.2 Profile Management

**Accessing Profile Settings:**

1. Click on your username in the header
2. Select "Profile" from the menu
3. You will be redirected to Keycloak profile management

**Changing Password:**
- Go to profile management
- Navigate to "Password"
- Enter your current and new password
- Confirm the new password
- Save changes

**Managing Personal Information:**
- Profile management allows changes to:
  - First name
  - Last name
  - Email address
  - Other attributes (depending on configuration)

**Email Verification:**
- Depends on Keycloak configuration
- In default configuration, email verification is disabled
- If enabled, you must verify your email after registration

### 4.3 Logout

**Single Logout (application only):**
- Click "Logout" in the user menu
- You will be logged out of Kodierbox
- Other applications remain logged in

**SSO Logout (all sessions):**
- Kodierbox automatically performs SSO logout
- Refresh token is invalidated at provider
- You will be logged out of all applications using SSO
- Session is terminated at Keycloak

**Session Timeout:**
- Idle timeout: 30 minutes of inactivity
- Max session: 10 hours
- After timeout, you are automatically logged out
- You must log in again

### 4.4 Troubleshooting for Users

**Login Errors:**

**Incorrect credentials:**
- Verify username and password
- Check for case sensitivity
- Try resetting your password (if enabled)

**Account locked:**
- Contact your administrator
- Administrator can unlock account in Keycloak

**Browser issues:**
- Clear browser cookies and cache
- Disable browser extensions
- Try a different browser
- Ensure JavaScript is enabled

**Connection issues:**
- Check your internet connection
- Verify server is reachable
- Try again later

## 5. Troubleshooting (Common Issues)

### 5.1 Configuration Issues

**Missing Environment Variables**

Symptom: Backend fails to start with error "OpenID Connect configuration is missing"

Solution:
- Check `.env.coding-box` file
- Ensure all OIDC_* variables are set
- Check Docker Compose environment variables
- Restart backend

**Incorrect Endpoint URLs**

Symptom: "Failed to exchange authorization code for token" or "Failed to get user information"

Solution:
- Verify OIDC_ENDPOINT_* variables
- Ensure URLs are correct and reachable
- Test endpoints with curl or Postman
- Check TLS/SSL configuration

**Client Secret Mismatch**

Symptom: "Invalid client credentials" on token exchange

Solution:
- Verify OAUTH2_CLIENT_SECRET in environment variables
- Ensure secret matches Keycloak client configuration
- Regenerate secret in Keycloak if needed
- Restart backend

**Redirect URI Problems**

Symptom: "Invalid redirect_uri" or redirect not working

Solution:
- Verify OAUTH2_REDIRECT_URL
- Ensure redirect URI is included in Keycloak client configuration
- Use HTTPS in production
- Check CORS configuration

### 5.2 Authentication Failures

**PKCE Verifier Expired**

Symptom: "PKCE verifier missing or expired"

Solution:
- PKCE verifier has 5 minute TTL
- Restart login process
- Check system time on server and client
- Ensure Redis is running (in production)

**Invalid State Parameter**

Symptom: "State parameter is required for PKCE flow"

Solution:
- State is automatically generated
- Verify state is returned correctly in callback
- Ensure no state manipulation by middleware
- Check browser console for errors

**Token Exchange Failure**

Symptom: "Failed to exchange authorization code for token"

Solution:
- Verify authorization code hasn't expired (60 seconds)
- Ensure PKCE verifier is correct
- Check client ID and secret
- Check Keycloak logs for errors

**User Info Retrieval Error**

Symptom: "Failed to get user information"

Solution:
- Verify access token is valid
- Ensure userinfo endpoint is reachable
- Check token scopes include `profile` and `email`
- Check Keycloak user configuration

### 5.3 Keycloak Issues

**Realm Not Found**

Symptom: "Realm not found" in Keycloak logs

Solution:
- Verify KEYCLOAK_REALM variable
- Ensure realm exists in Keycloak
- Import realm configuration if needed
- Check Keycloak Admin Console

**Client Not Found**

Symptom: "Client not found" or "Invalid client"

Solution:
- Verify OAUTH2_CLIENT_ID variable
- Ensure client exists in realm
- Check client is enabled
- Import client configuration if needed

**Invalid Credentials**

Symptom: "Invalid credentials" on login

Solution:
- Check user login in Keycloak Admin Console
- Ensure user is enabled
- Reset password if needed
- Check user roles

**Role Assignment Problems**

Symptom: User doesn't have admin rights despite role

Solution:
- Verify user has `admin` role in Keycloak
- Ensure role is in `realm_access.roles`
- Sync user in Kodierbox database
- Check backend logs for role mapping

### 5.4 Network Issues

**CORS Errors**

Symptom: CORS errors in browser

Solution:
- Check CORS configuration in backend
- Ensure origin is allowed
- Configure CORS in Keycloak if needed
- Use CORS plugin for browser testing

**Proxy Configuration**

Symptom: Connection errors through proxy

Solution:
- Check Traefik configuration
- Ensure OIDC endpoints are routed correctly
- Configure proxy headers (X-Forwarded-*, etc.)
- Test endpoints without proxy

**SSL Certificate Problems**

Symptom: SSL errors or certificate warnings

Solution:
- Use valid SSL certificates in production
- Ensure certificate is valid for all endpoints
- Check certificate chain
- Configure `sslRequired: external` in Keycloak

**Timeout Issues**

Symptom: Request timeouts

Solution:
- Check network connection
- Increase timeout values in HTTP client
- Check firewall configuration
- Check load balancer settings

### 5.5 Debugging

**Backend Logs**

```bash
# Docker logs
docker-compose logs backend | grep oidc

# Filter for authentication
docker-compose logs backend | grep -i "auth\|oidc\|keycloak"
```

Important log messages:
- "Initiating OpenID Connect Provider login"
- "Processing OpenID Connect Provider callback"
- "Successfully obtained access token"
- "OIDC Provider User with id 'X' stored in database"

**Frontend Console**

Open browser Developer Tools (F12) and check:
- Console for JavaScript errors
- Network tab for failed requests
- Application tab for token storage
- LocalStorage/SessionStorage for session data

**Keycloak Logs**

```bash
# Keycloak container logs
docker-compose logs keycloak

# Admin console for detailed logs
# Navigate to: Keycloak Admin > Realm > Events
```

**Network Inspection**

Use browser DevTools or tools like:
- curl for API testing
- Postman for more complex requests
- Wireshark for network analysis

Example curl:
```bash
curl -X GET "https://keycloak.example.com/auth/realms/coding-box/.well-known/openid-configuration"
```

## 6. Security Considerations

### PKCE for Public Clients

PKCE (Proof Key for Code Exchange) is used to prevent authorization code interception attacks:

- Code verifier is randomly generated (32 bytes)
- Code challenge is SHA256 hash of verifier
- Verifier is not transmitted over the network
- Server can validate challenge
- Protects against code interception and replay attacks

### State Parameter Validation

State parameter is used for CSRF protection:

- Random string is generated
- State is validated in authorization request and callback
- Redirect URI can optionally be encoded in state
- Prevents CSRF attacks on callback endpoint

### Redirect URI Validation

Redirect URIs are validated to prevent open redirect attacks:

- Only allowed URIs are accepted
- Relative URIs are allowed
- Same-origin URIs are allowed
- OIDC provider origin is explicitly blocked
- Validation in `isAllowedRedirect()` method

### Token Storage Best Practices

**Backend:**
- Access tokens are not persistently stored
- Refresh tokens are stored securely in database
- PKCE verifiers have short TTL (5 minutes)
- Tokens are transmitted over HTTPS

**Frontend:**
- Tokens are stored in sessionStorage or localStorage
- Use HttpOnly cookies when possible
- Implement token refresh mechanism
- Clear tokens on logout

### Secret Management

**Environment Variables:**
- Never store secrets in code
- Use `.env` files for development
- Use secret management in production (Vault, Kubernetes Secrets)
- Rotate secrets regularly

**Keycloak:**
- Use strong client secrets
- Rotate secrets regularly
- Use separate secrets for development/production
- Enable client secret rotation if available

### HTTPS Requirements

**Production:**
- All OIDC endpoints must use HTTPS
- SSL/TLS must be properly configured
- Use current TLS versions (TLS 1.2+)
- Disable deprecated cipher suites

**Development:**
- HTTP is acceptable for local development
- Use HTTPS for testing with production configuration
- Note browser security warnings

## 7. Migration Guide

### From Legacy Authentication

If migrating from legacy authentication:

1. **Create backup:**
   - Backup user database
   - Backup configuration files
   - Document existing authentication flows

2. **Configure OIDC:**
   - Set up Keycloak or other OIDC provider
   - Configure environment variables
   - Import realm and client configuration

3. **Migrate users:**
   - Export existing users
   - Import users to Keycloak
   - Set initial passwords
   - Assign roles

4. **Testing:**
   - Test login flow
   - Test token refresh
   - Test logout
   - Test roles and permissions

5. **Deployment:**
   - Deploy new version
   - Monitor logs
   - Be ready for rollback

### From Keycloak-Only to Generic OIDC

If switching from Keycloak-specific to generic OIDC implementation:

1. **Change environment variables:**
   - Remove KEYCLOAK_* variables
   - Add OIDC_* variables
   - Configure all endpoints explicitly

2. **Adapt code:**
   - Replace `KeycloakAuthService` with `OidcAuthService`
   - Update imports
   - Test all authentication flows

3. **Test configuration:**
   - Verify all endpoints
   - Test with different OIDC providers
   - Check compatibility

### Environment Variable Changes

When changing environment variables:

1. **Document changes:**
   - Note old and new values
   - Document reason for change

2. **Test changes:**
   - Test in development environment
   - Verify all flows
   - Check compatibility

3. **Deploy changes:**
   - Update `.env` files
   - Restart services
   - Monitor logs

### Database Migration

When changing user schema:

1. **Create migration script:**
   - Use Liquibase for schema changes
   - Create rollback script
   - Test migration in test environment

2. **Migrate data:**
   - Backup existing data
   - Run migration
   - Verify data integrity

3. **Deployment:**
   - Run migration during deployment
   - Monitor for errors
   - Be ready for rollback

## Additional Resources

- [OpenID Connect Specification](https://openid.net/connect/)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
