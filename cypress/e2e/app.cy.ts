describe('Kodierbox App E2E', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/realms/coding-box/protocol/openid-connect/auth*', request => {
      const url = new URL(request.url);
      const redirectUri = url.searchParams.get('redirect_uri') || '';
      const state = url.searchParams.get('state') || '';
      request.redirect(`${redirectUri}#error=login_required&state=${state}`, 302);
    });
    cy.intercept('GET', '**/api//admin/logo/settings', { statusCode: 404, body: {} });
    cy.intercept('GET', '**/api/system-notifications/active', { body: [] });
    cy.visit('/');
    cy.get('coding-box-home').should('be.visible');
  });

  it('should display the landing page structure', () => {
    cy.window().should('not.have.property', 'Zone');
    cy.get('coding-box-home').should('exist');
    cy.get('coding-box-app-info').should('exist').and('be.visible');
    cy.get('coding-box-user-workspaces-area').should('exist').and('be.visible');
  });

  it('should display login button when not authenticated', () => {
    cy.get('.login-button').should('exist').and('be.visible');
    cy.contains('Bitte melden Sie sich an').should('be.visible');
  });

  it('should redirect to home or login when accessing protected route without auth', () => {
    cy.window().then(win => { win.location.hash = '/coding'; });
    cy.location('hash').should('include', '/home');
    cy.location('hash').should('include', 'auth=session-expired');
    cy.location('hash').should('include', 'returnUrl=%2Fcoding');
    cy.get('coding-box-my-coding-jobs').should('not.exist');
    cy.get('.login-button').should('be.visible');
  });
});
