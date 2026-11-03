describe('zoneless migration build', () => {
  it('boots without loading ZoneJS', () => {
    cy.intercept('GET', '**/api//admin/logo/settings', { statusCode: 404, body: {} });
    cy.visit('/');
    cy.get('coding-box-home').should('be.visible');
    cy.get('.app-header img').should('have.attr', 'alt', 'Startseite');
    cy.window().should('not.have.property', 'Zone');
  });

  ['error', 'home.home-page'].forEach(alt => {
    it(`preserves the configured logo description ${alt}`, () => {
      cy.mockKeycloakAuthentication();
      cy.stubWorkspace({ workspaceId: 5 });
      cy.intercept('GET', '**/api/legal-notice', { body: { html: '<p>Legal notice</p>', isDefault: false } });
      cy.intercept('GET', '**/api/admin/content-pool/settings', {
        body: { enabled: false, baseUrl: '', hasApplicationToken: false }
      });
      cy.intercept('PUT', '**/api//admin/logo/settings', { body: { success: true } }).as('saveLogo');
      cy.visit('/');
      cy.wait('@authData');
      cy.window().then(win => { win.location.hash = '/admin/settings'; });
      cy.get('.logo-alt-text-container input').clear().type(alt);
      cy.get('.alt-text-actions button').click();
      cy.wait('@saveLogo').its('request.body.alt').should('equal', alt);
      cy.get('.app-header img').should('have.attr', 'alt', alt).trigger('mouseenter');
      cy.get('mat-tooltip-component').should('have.text', alt);
      cy.window().then(win => { win.location.hash = '/home'; });
      cy.get('coding-box-sys-admin-settings').should('not.exist');
      cy.window().then(win => { win.location.hash = '/admin/settings'; });
      cy.get('.logo-alt-text-container input').should('have.value', alt);
    });
  });
});
