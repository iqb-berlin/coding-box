describe('Kodierbox App E2E', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/realms/coding-box/protocol/openid-connect/auth*', request => {
      const url = new URL(request.url);
      const redirectUri = url.searchParams.get('redirect_uri') || '';
      const state = url.searchParams.get('state') || '';
      request.redirect(`${redirectUri}#error=login_required&state=${state}`, 302);
    });
    cy.intercept('GET', '**/api/admin/logo/settings', { statusCode: 404, body: {} });
    cy.intercept('GET', '**/api/system-notifications/active', { body: [] });
    cy.intercept('GET', '**/api/legal-notice', {
      body: { html: '<p>Datenschutz dieser Instanz</p>', isDefault: false, imprintUrl: 'https://example.org/impressum' }
    });
    cy.visit('/');
    cy.get('coding-box-home').should('be.visible');
  });

  it('should display the landing page structure', () => {
    cy.window().should('not.have.property', 'Zone');
    cy.get('coding-box-home').should('exist');
    cy.get('.app').should('have.class', 'app--home');
    cy.get('coding-box-app-info').should('exist').and('be.visible');
    cy.get('coding-box-user-workspaces-area').should('exist').and('be.visible');
  });

  it('offers the operator imprint and instance privacy text before login', () => {
    cy.get('footer nav a').should('have.text', 'Impressum').and('have.attr', 'href', 'https://example.org/impressum');
    cy.contains('footer button', 'Datenschutz').click();
    cy.contains('mat-dialog-content', 'Datenschutz dieser Instanz').should('be.visible');
    cy.contains('mat-dialog-actions button', 'Schließen').click();
    cy.get('mat-dialog-content').should('not.exist');
  });

  it('should display login button when not authenticated', () => {
    cy.get('.login-button').should('exist').and('be.visible');
    cy.contains('Mit der IQB-Kodierbox kodieren Sie').should('be.visible');
    cy.get('.reauthentication-hint').should('not.exist');
  });

  it('should redirect to home or login when accessing protected route without auth', () => {
    cy.window().then(win => { win.location.hash = '/coding'; });
    cy.location('hash').should('include', '/home');
    cy.location('hash').should('include', 'auth=login-required');
    cy.location('hash').should('include', 'returnUrl=%2Fcoding');
    cy.get('coding-box-my-coding-jobs').should('not.exist');
    cy.get('.login-button').should('be.visible').and('contain.text', 'Anmelden');
    cy.get('.reauthentication-hint').should('not.exist');
    cy.intercept('GET', '**/api/auth/login?*', {
      headers: { 'content-type': 'text/html' }, body: '<p>OIDC test login</p>'
    }).as('login');
    cy.get('.login-button').click();
    cy.wait('@login').then(({ request }) => {
      const redirect = new URL(request.url).searchParams.get('redirect_uri');
      expect(new URL(redirect || '').hash).to.equal('#/coding');
    });
  });
});
