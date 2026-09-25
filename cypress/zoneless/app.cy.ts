import '../e2e/app.cy';

describe('zoneless migration build', () => {
  it('boots without loading ZoneJS', () => {
    cy.visit('/');
    cy.get('coding-box-home').should('be.visible');
    cy.window().should('not.have.property', 'Zone');
  });
});
