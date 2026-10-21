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

  it('F03 shows an authorization explanation after a protected view returns HTTP 403', () => {
    cy.intercept('GET', '**/api/admin/system-notifications', { statusCode: 403, body: { message: 'Forbidden' } }).as('deniedAction');
    cy.visit('/', { onBeforeLoad(win) {
      win.localStorage.setItem('auth_token', token(3600));
      win.localStorage.setItem('refresh_token', 'retained-refresh-token');
    } });
    cy.wait('@authData');
    cy.get('coding-box-user-workspaces-area').should('contain.text', 'Recovered Workspace');
    cy.window().then(win => { win.location.hash = '/admin/notifications'; });
    cy.wait('@deniedAction').its('response.statusCode').should('eq', 403);
    cy.get('coding-box-system-notifications-admin').should('be.visible');
    cy.get('mat-snack-bar-container').should('have.length', 1).and('be.visible');
    cy.get('.re-authentication, .reauthentication-hint, .login-button').should('not.exist');
    cy.window().then(win => { expect(win.localStorage.getItem('refresh_token')).to.equal('retained-refresh-token'); });
    cy.get('mat-snack-bar-container').should('contain.text', 'Berechtigung')
      .and('not.contain.text', 'Systemhinweise konnten nicht geladen werden');
    cy.get('mat-snack-bar-container .mdc-snackbar__label').should('be.visible');
    cy.screenshot('F03-protected-view-403', { capture: 'viewport', disableTimersAndAnimations: false });
  });

  it('F04 shows a failed auth-data load and restores the workspace list on retry', () => {
    let available = false;
    let requests = 0;
    cy.intercept('GET', '**/api/auth-data*', request => {
      requests += 1;
      request.reply(available ? { body: { userId: 7, userName: 'OIDC User', isAdmin: true, workspaces: [{ id: 12, name: 'Recovered Workspace' }] } } :
        { statusCode: 500, body: { message: 'Acceptance test unavailable' } });
    }).as('authDataOutage');
    cy.visit('/', { onBeforeLoad(win) {
      win.localStorage.setItem('auth_token', token(3600));
      win.localStorage.setItem('refresh_token', 'retained-refresh-token');
    } });
    cy.get('coding-box-user-workspaces-area', { timeout: 15000 }).should('contain.text', 'Die Sitzungsdaten konnten noch nicht geladen werden');
    cy.get('coding-box-user-workspaces-area').should('not.contain.text', 'Keine Arbeitsbereiche');
    cy.get('.re-authentication, .reauthentication-hint').should('not.exist');
    cy.window().then(win => { expect(win.localStorage.getItem('refresh_token')).to.equal('retained-refresh-token'); });
    cy.then(() => { expect(requests, 'initial request and bounded retries').to.equal(4); available = true; });
    cy.screenshot('F04-auth-data-error', { capture: 'viewport' });
    cy.contains('coding-box-user-workspaces-area button', 'Erneut laden').click();
    cy.get('coding-box-user-workspaces-area').should('contain.text', 'Recovered Workspace');
    cy.get('coding-box-user-workspaces-area').should('not.contain.text', 'Die Sitzungsdaten konnten noch nicht geladen werden');
    cy.get('coding-box-error-message-display .backend-unavailable').should('not.exist');
    cy.get('mat-snack-bar-container').should('not.exist');
    cy.window().then(win => { expect(win.localStorage.getItem('refresh_token')).to.equal('retained-refresh-token'); });
    cy.screenshot('F04-auth-data-recovered', { capture: 'viewport' });
  });

  it('F03 preserves the permission hint and pending input when saving returns HTTP 403', () => {
    cy.intercept('GET', '**/api/admin/system-notifications', { body: [] });
    cy.intercept('POST', '**/api/admin/system-notifications', {
      statusCode: 403, body: { message: 'Access level too low' }
    }).as('deniedSave');
    cy.visit('/', { onBeforeLoad(win) {
      win.localStorage.setItem('auth_token', token(3600));
      win.localStorage.setItem('refresh_token', 'retained-refresh-token');
    } });
    cy.wait('@authData');
    cy.get('coding-box-user-workspaces-area').should('contain.text', 'Recovered Workspace');
    cy.window().then(win => { win.location.hash = '/admin/notifications'; });
    cy.get('coding-box-system-notifications-admin input[formControlName="title"]').type('Pending notice');
    cy.get('coding-box-system-notifications-admin textarea[formControlName="message"]').type('Pending text');
    cy.get('coding-box-system-notifications-admin button[type="submit"]').click();
    cy.wait('@deniedSave').its('response.statusCode').should('eq', 403);
    cy.get('mat-snack-bar-container').should('contain.text', 'Zugriffsberechtigung')
      .and('not.contain.text', 'Systemhinweis konnte nicht gespeichert werden');
    cy.get('input[formControlName="title"]').should('have.value', 'Pending notice');
    cy.get('textarea[formControlName="message"]').should('have.value', 'Pending text');
    cy.get('.re-authentication, .reauthentication-hint, .login-button').should('not.exist');
    cy.window().then(win => { expect(win.localStorage.getItem('refresh_token')).to.equal('retained-refresh-token'); });
    cy.get('mat-snack-bar-container .mdc-snackbar__label').should('be.visible');
    cy.screenshot('F03-protected-save-403', { capture: 'viewport', disableTimersAndAnimations: false });
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

  it('shows a provider callback configuration failure without an automatic login loop', () => {
    let loginRequests = 0;
    cy.intercept('GET', '**/api/auth/login*', () => { loginRequests += 1; });
    cy.visit('/?error=authentication_failed&auth_error=configuration-error&request_id=callback-request');
    cy.get('.auth-login-failed').should('contain.text', 'Konfigurationsfehler').and('contain.text', 'callback-request');
    cy.get('.auth-login-failed button').should('be.visible');
    cy.location('search').should('eq', '');
    cy.then(() => expect(loginRequests).to.equal(0));
  });

  it('shows a failed code exchange without redirecting back to the unavailable provider', () => {
    cy.intercept('POST', '**/api/auth/exchange', {
      statusCode: 503, body: { code: 'provider-unavailable' }, headers: { 'X-Request-Id': 'exchange-request' }
    }).as('failedExchange');
    cy.visit('/?auth_code=login-code');
    cy.wait('@failedExchange');
    cy.get('.auth-login-failed').should('contain.text', 'Anmeldedienst ist derzeit nicht erreichbar').and('contain.text', 'exchange-request');
    cy.location('search').should('eq', '');
    cy.get('.reauthentication-hint').should('not.exist');
  });

  it('shows a JWKS configuration error and recovers the bootstrap through an explicit retry', () => {
    let configured = false;
    let bootstrapRequests = 0;
    cy.intercept('GET', '**/api/auth-data*', request => {
      bootstrapRequests += 1;
      request.reply(configured ? {
        body: { userId: 7, userName: 'OIDC User', isAdmin: false, workspaces: [{ id: 12, name: 'Configured Workspace' }] }
      } : { statusCode: 503, body: { code: 'configuration-error' } });
    }).as('jwksBootstrap');
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('auth_token', token(3600));
        win.localStorage.setItem('refresh_token', 'retained-refresh-token');
      }
    });
    cy.wait('@jwksBootstrap');
    cy.get('coding-box-user-workspaces-area').should('contain.text', 'Konfigurationsfehler');
    cy.get('.reauthentication-hint').should('not.exist');
    cy.then(() => {
      expect(bootstrapRequests).to.equal(1);
      configured = true;
    });
    cy.contains('button', 'Erneut laden').click();
    cy.wait('@jwksBootstrap');
    cy.get('coding-box-user-workspaces-area').should('contain.text', 'Configured Workspace');
    cy.window().then(win => expect(win.localStorage.getItem('refresh_token')).to.equal('retained-refresh-token'));
  });
});
