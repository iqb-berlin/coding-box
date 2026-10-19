describe('saved item matrix diagnoses', () => {
  it('opens a saved diagnosis and downloads all cells after the job is gone', () => {
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    const archiveId = '11111111-1111-4111-8111-111111111111';
    const base = '**/api/admin/workspace/5/coding/export/item-matrix-diagnostics';
    cy.intercept('GET', base, { body: [{ archiveId, jobId: 'deleted-job',
      createdAt: 1000, total: 5480, version: 'v2', matrixValue: 'score', missingsProfileId: 4 }] }).as('archives');
    cy.intercept('GET', `${base}/${archiveId}`, { body: { total: 5480, sampleLimit: 20, groups: [] } }).as('diagnosis');
    cy.intercept('GET', `${base}/${archiveId}/download`, {
      headers: { 'content-type': 'text/csv' }, body: 'zeile;spalte;person_login\r\n2;5;login-1\r\n'
    }).as('cells');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(window => { window.location.hash = '/workspace-admin/5/export'; });
    cy.get('[data-cy="load-saved-diagnostics"]').click();
    cy.wait('@archives');
    cy.get('[data-cy="open-saved-diagnostics"]').click();
    cy.wait('@diagnosis');
    cy.get('[data-cy="item-matrix-full-diagnostics-download"]').click();
    cy.wait('@cells');
    cy.readFile(`cypress/downloads/Itemdatensatz-Diagnose-${archiveId}.csv`).should('contain', '2;5;login-1');
  });
});
