describe('Background export startup failures without ZoneJS', () => {
  let releaseFailure: () => void;
  afterEach(() => { releaseFailure?.(); });

  for (const leaveView of [false, true]) {
    it(leaveView ? 'reports a rejected start after navigation' :
      'reports a rejected start once and releases the export button', () => {
      let startRequests = 0;
      const failureGate = new Cypress.Promise<void>(resolve => { releaseFailure = resolve; });
      cy.mockKeycloakAuthentication();
      cy.stubWorkspace({ workspaceId: 5 });
      cy.intercept('GET', '**/api/admin/workspace/5/coding/export-missings-profiles', {
        body: [{ id: 4, label: 'IQB-Standard' }]
      }).as('missingsProfiles');
      cy.intercept('POST', '**/api/admin/workspace/5/coding/export/start', request => {
        startRequests += 1;
        return failureGate.then(() => {
          request.reply({ statusCode: 503, body: { message: 'Temporarily unavailable' } });
        });
      }).as('startExport');
      cy.visit('/');
      cy.wait('@authData');
      cy.window().then(win => { win.location.hash = '/workspace-admin/5/export'; });
      cy.wait('@missingsProfiles');
      cy.get('[data-cy="start-export"]').should('not.be.disabled').click();
      cy.get('[data-cy="start-export"]').should('be.disabled')
        .should(() => { expect(startRequests).to.equal(1); });
      if (leaveView) {
        cy.window().then(win => { win.location.hash = '/'; });
        cy.get('coding-box-export').should('not.exist');
        cy.get('coding-box-home').should('be.visible');
      }
      cy.then(() => { releaseFailure(); });
      cy.wait('@startExport');
      cy.get('mat-snack-bar-container').should('have.length', 1)
        .and('contain.text', 'Datenexport konnte nicht gestartet werden');
      cy.get('coding-box-export-toast .export-toast-container').should('not.exist');
      if (!leaveView) cy.get('[data-cy="start-export"]').should('not.be.disabled');
      cy.window().should('not.have.property', 'Zone');
    });
  }
});
