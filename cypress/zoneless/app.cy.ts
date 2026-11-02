describe('zoneless migration build', () => {
  it('boots without loading ZoneJS', () => {
    cy.intercept('GET', '**/api//admin/logo/settings', { statusCode: 404, body: {} });
    cy.visit('/');
    cy.get('coding-box-home').should('be.visible');
    cy.get('.app-header img').should('have.attr', 'alt', 'Startseite');
    cy.window().should('not.have.property', 'Zone');
  });
});
