describe('zoneless test-results view', () => {
  it('renders the loaded overview and opens the import dialog', () => {
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', {
      body: { value: '{"enabled":false}' }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', {
      body: { data: [], total: 0 }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', {
      body: {
        testPersons: 3,
        testGroups: 2,
        uniqueBooklets: 1,
        uniqueUnits: 4,
        uniqueResponses: 6,
        responseStatusCounts: {},
        sessionBrowserCounts: {},
        sessionOsCounts: {},
        sessionScreenCounts: {}
      }
    }).as('overview');
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', {
      body: []
    });

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then((window) => {
      window.location.hash = '/workspace-admin/5/test-results';
    });
    cy.wait('@overview');
    cy.get('coding-box-test-results .overview-card')
      .should('contain.text', 'Testpersonen')
      .and('contain.text', '3');
    cy.get('coding-box-test-results .action-bar')
      .contains('button', 'Import').click();
    cy.get('coding-box-test-results-import-dialog')
      .should('contain.text', 'Antworten hochladen')
      .and('contain.text', 'Logs hochladen');
    cy.get('coding-box-test-results-import-dialog')
      .contains('mat-list-item', 'Antworten hochladen').click();
    cy.get('coding-box-test-results input[accept=".json,.zip,.csv"]')
      .first()
      .selectFile({
        contents: Cypress.Buffer.from('[]'),
        fileName: 'responses.json',
        mimeType: 'application/json'
      }, { force: true });
    cy.get('coding-box-test-results-upload-options-dialog')
      .should('contain.text', 'Upload Optionen (Responses)');
    cy.window().should('not.have.property', 'Zone');
  });
});
