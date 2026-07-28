const keycloakUrl = 'https://keycloak.kodierbox.iqb.hu-berlin.de';

interface WorkspaceStubOptions {
  workspaceId: number;
  userId?: number;
  identity?: string;
  workspaceName?: string;
}

const createToken = (nonce: string, identity: string): string => {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) =>
    Cypress.Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      sub: identity,
      nonce,
      iat: now,
      exp: now + 3600,
      session_state: 'e2e-session',
      realm_access: { roles: ['admin'] }
    }),
    'e2e'
  ].join('.');
};

Cypress.Commands.add(
  'mockKeycloakAuthentication',
  (identity = 'e2e-user') => {
    let nonce = '';
    cy.intercept(
      'GET',
      `${keycloakUrl}/realms/coding-box/protocol/openid-connect/auth*`,
      request => {
        const url = new URL(request.url);
        nonce = url.searchParams.get('nonce') || '';
        const redirectUri = url.searchParams.get('redirect_uri') || '';
        const state = url.searchParams.get('state') || '';
        request.redirect(
          `${redirectUri}#code=e2e-code&state=${state}` +
            '&session_state=e2e-session',
          302
        );
      }
    );
    cy.intercept(
      'POST',
      `${keycloakUrl}/realms/coding-box/protocol/openid-connect/token`,
      request => {
        const token = createToken(nonce, identity);
        request.reply({
          access_token: token,
          refresh_token: token,
          id_token: token,
          expires_in: 3600,
          refresh_expires_in: 3600,
          token_type: 'Bearer',
          session_state: 'e2e-session'
        });
      }
    );
    cy.intercept('GET', `${keycloakUrl}/realms/coding-box/account`, {
      body: {
        id: identity,
        username: identity,
        firstName: 'E2E',
        lastName: 'User'
      }
    });
  }
);

Cypress.Commands.add(
  'stubWorkspace',
  ({
    workspaceId,
    userId = 2,
    identity = 'e2e-user',
    workspaceName = 'E2E Workspace'
  }: WorkspaceStubOptions) => {
    cy.intercept('GET', '**/api//admin/logo/settings', {
      statusCode: 404,
      body: {}
    });
    cy.intercept('GET', '**/api/system-notifications/active', { body: [] });
    cy.intercept('GET', `**/api/auth-data?identity=${identity}`, {
      body: {
        userId,
        userName: identity,
        email: `${identity}@example.org`,
        firstName: 'E2E',
        lastName: 'User',
        isAdmin: true,
        workspaces: [{ id: workspaceId, name: workspaceName }]
      }
    }).as('authData');
    cy.intercept('GET', `**/api/admin/users/access/${workspaceId}`, {
      body: []
    });
    cy.intercept(
      'GET',
      `**/api/wsg-admin/workspace/${workspaceId}/coding-job*`,
      {
        body: {
          data: [],
          total: 0,
          page: 1,
          limit: 1
        }
      }
    );
    cy.intercept(
      'GET',
      `**/api/workspace/${workspaceId}/settings/auth-session-idle-timeout-minutes`,
      { body: 30 }
    );
    cy.intercept(
      'GET',
      `**/api/admin/workspace/${workspaceId}/responses/geogebra-existence`,
      { body: false }
    );
  }
);

declare global {
  namespace Cypress {
    interface Chainable {
      mockKeycloakAuthentication(identity?: string): Chainable<void>;
      stubWorkspace(options: WorkspaceStubOptions): Chainable<void>;
    }
  }
}

export {};
