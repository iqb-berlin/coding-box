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
