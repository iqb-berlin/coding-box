describe('Backend OIDC callback', () => {
  it('exchanges the browser-bound login code and renders the authenticated workspace without zones', () => {
    const encode = (value: object) => Cypress.Buffer.from(JSON.stringify(value)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      sub: 'oidc-user', preferred_username: 'OIDC User', exp: Math.floor(Date.now() / 1000) + 3600
    })}.signature`;
    cy.intercept('GET', '**/api//admin/logo/settings', { statusCode: 404, body: {} });
    cy.intercept('GET', '**/api/system-notifications/active', { body: [] });
    cy.intercept('POST', '**/api/auth/exchange', request => {
      expect(request.body).to.deep.equal({ code: 'login-code', browser_verifier: 'browser-verifier' });
      request.reply({ access_token: token, refresh_token: 'refresh-token', token_type: 'Bearer', expires_in: 3600 });
    }).as('exchange');
    cy.intercept('GET', '**/api/auth-data?identity=oidc-user', request => {
      expect(request.headers.authorization).to.equal(`Bearer ${token}`);
      request.reply({
        userId: 7, userName: 'OIDC User', firstName: 'OIDC', lastName: 'User',
        email: 'oidc@example.org', isAdmin: false, workspaces: [{ id: 12, name: 'OIDC Workspace' }]
      });
    }).as('authData');

    cy.visit('/?auth_code=login-code', {
      onBeforeLoad(win) {
        win.sessionStorage.setItem('oidc_login_verifier', 'browser-verifier');
      }
    });
    cy.wait('@exchange');
    cy.wait('@authData');
    cy.location('search').should('eq', '');
    cy.get('coding-box-user-workspaces-area').should('contain.text', 'OIDC Workspace');
    cy.get('.login-button').should('not.exist');
    cy.window().then(win => {
      expect('Zone' in win).to.equal(false);
      expect(win.localStorage.getItem('auth_token')).to.equal(token);
      expect(win.sessionStorage.getItem('oidc_login_verifier')).to.equal(null);
    });
  });
});

describe('OIDC renewal and bootstrap diagnostics', () => {
  const token = (expiresIn: number) => {
    const encode = (value: object) => Cypress.Buffer.from(JSON.stringify(value)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      sub: 'oidc-user', preferred_username: 'OIDC User', exp: Math.floor(Date.now() / 1000) + expiresIn
    })}.signature`;
  };

  const visitWithRefreshSession = () => cy.visit('/', {
    onBeforeLoad(win) {
      win.localStorage.setItem('auth_token', token(-60));
      win.localStorage.setItem('refresh_token', 'retained-refresh-token');
    }
  });

  beforeEach(() => {
    cy.intercept('GET', '**/api//admin/logo/settings', { statusCode: 404, body: {} });
    cy.intercept('GET', '**/api/system-notifications/active', { body: [] });
    cy.intercept('GET', '**/api/auth-data*', {
      body: { userId: 7, userName: 'OIDC User', isAdmin: true, workspaces: [{ id: 12, name: 'Recovered Workspace' }] }
    }).as('authData');
  });

  it('retains a refresh session during a provider outage and recovers through the retry button', () => {
    let available = false;
    cy.intercept('POST', '**/api/auth/refresh', request => {
      expect(request.body.refresh_token).to.equal('retained-refresh-token');
      request.reply(available ? {
        body: { access_token: token(3600), refresh_token: 'rotated-refresh-token', token_type: 'Bearer', expires_in: 3600 }
      } : {
        statusCode: 503, body: { code: 'provider-unavailable', requestId: 'outage-request-123' }
      });
    }).as('refresh');
    visitWithRefreshSession();
    cy.wait('@refresh');
    cy.get('.auth-refresh-unavailable').should('contain.text', 'outage-request-123');
    cy.get('.reauthentication-hint').should('not.exist');
    cy.window().then(win => {
      expect(win.localStorage.getItem('refresh_token')).to.equal('retained-refresh-token');
    });
    cy.then(() => { available = true; });
    cy.get('.auth-refresh-unavailable button').click();
    cy.wait('@refresh').its('response.statusCode').should('eq', 200);
    cy.wait('@authData');
    cy.get('.auth-refresh-unavailable').should('not.exist');
    cy.get('coding-box-user-workspaces-area').should('contain.text', 'Recovered Workspace');
    cy.window().then(win => {
      expect(win.localStorage.getItem('refresh_token')).to.equal('rotated-refresh-token');
    });
  });

  it('shows a configuration failure without discarding the refresh session', () => {
    cy.intercept('POST', '**/api/auth/refresh', {
      statusCode: 503, body: { code: 'configuration-error', requestId: 'configuration-request-123' }
    });
    visitWithRefreshSession();
    cy.get('.auth-refresh-unavailable').should('contain.text', 'Konfigurationsfehler');
    cy.window().then(win => {
      expect(win.localStorage.getItem('refresh_token')).to.equal('retained-refresh-token');
    });
    cy.get('.reauthentication-hint').should('not.exist');
  });

  it('requires a new login for an invalid refresh session', () => {
    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'session-invalid' } });
    visitWithRefreshSession();
    cy.get('.reauthentication-hint').should('be.visible');
    cy.get('.auth-refresh-unavailable').should('not.exist');
    cy.window().then(win => {
      expect(win.localStorage.getItem('refresh_token')).to.equal(null);
    });
  });

  it('distinguishes a rejected backend bootstrap from an expired provider session', () => {
    cy.intercept('GET', '**/api/auth-data*', { statusCode: 401, body: { message: 'Unauthorized', requestId: 'bootstrap-request-123' } });
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('auth_token', token(3600));
        win.localStorage.setItem('refresh_token', 'retained-refresh-token');
      }
    });
    cy.get('coding-box-user-workspaces-area').should('contain.text', 'Backend hat den Zugriff abgelehnt');
    cy.get('.reauthentication-hint').should('not.exist');
    cy.get('.auth-refresh-unavailable').should('not.exist');
  });
});
