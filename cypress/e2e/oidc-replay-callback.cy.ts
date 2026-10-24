describe('OIDC replay callback startup', () => {
  it('defers direct replay requests until the delayed callback and auth-data bootstrap complete', () => {
    const encode = (value: object) => Cypress.Buffer.from(JSON.stringify(value)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const accessToken = `${encode({ alg: 'RS256' })}.${encode({
      sub: 'oidc-user', exp: Math.floor(Date.now() / 1000) + 3600
    })}.signature`;
    let exchanged = false;
    let bootstrapped = false;
    cy.intercept('GET', '**/api//admin/logo/settings', { statusCode: 404, body: {} });
    cy.intercept('GET', '**/api/system-notifications/active', { body: [] });
    cy.intercept('POST', '**/api/admin/workspace/12/replay-statistics', { body: {} });
    cy.intercept('POST', '**/api/auth/exchange', req => {
      req.on('after:response', () => { exchanged = true; });
      req.reply({ delay: 250, body: { access_token: accessToken, refresh_token: 'new-refresh' } });
    }).as('delayedExchange');
    cy.intercept('GET', '**/api/auth-data*', req => {
      req.on('after:response', () => { bootstrapped = true; });
      req.reply({ delay: 250, body: { userId: 7, isAdmin: false, workspaces: [{ id: 12, name: 'Test' }] } });
    }).as('delayedAuthData');
    cy.intercept('GET', '**/api/wsg-admin/workspace/12/coding-job/100/replay-session*', req => {
      expect(exchanged, 'callback completed before protected view loads').to.equal(true);
      expect(bootstrapped, 'auth data completed before protected view loads').to.equal(true);
      expect(req.headers.authorization).to.equal(`Bearer ${accessToken}`);
      req.reply({ statusCode: 403, body: { message: 'Forbidden' } });
    }).as('replayRequest');
    cy.visit('/?auth_code=delayed#/replay/person/UNIT?workspaceId=12&codingJobId=100&mode=coding', {
      onBeforeLoad(win) { win.sessionStorage.setItem('oidc_login_verifier', 'verifier'); }
    });
    cy.wait('@delayedExchange');
    cy.wait('@delayedAuthData');
    cy.wait('@replayRequest');
    cy.get('coding-box-replay').should('exist');
    cy.get('mat-snack-bar-container').should('contain.text', 'Berechtigung');
    cy.window().then(win => expect(win.localStorage.getItem('refresh_token')).to.equal('new-refresh'));
    cy.location('search').should('eq', '');
    cy.location('hash').should('include', '/replay/person/UNIT');
    cy.get('.reauthentication-hint, .re-authentication').should('not.exist');
  });
});
