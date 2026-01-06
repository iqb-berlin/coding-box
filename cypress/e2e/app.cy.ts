describe('Kodierbox App E2E', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('should display the landing page structure', () => {
    cy.get('coding-box-home').should('exist');
    cy.get('coding-box-app-info').should('exist').and('be.visible');
    cy.get('coding-box-user-workspaces-area').should('exist').and('be.visible');
  });

  it('should display login button when not authenticated', () => {
    cy.get('.login-button').should('exist').and('be.visible');
    cy.contains('Bitte melden Sie sich an').should('be.visible');
  });

  it('should redirect to home or login when accessing protected route without auth', () => {
    // Attempt to visit protected route
    cy.visit('/coding');

    // Should likely redirect back to home or login URL
    // Since we are not logged in, we expect url not to be /coding
    cy.location('pathname').should('not.eq', '/coding');
  });
});
