describe('zoneless test-results view', () => {
  it('uploads responses and refreshes the overview after processing', () => {
    let uploaded = false;
    const before = {
      testPersons: 3,
      testGroups: 2,
      uniqueBooklets: 1,
      uniqueUnits: 4,
      uniqueResponses: 6
    };
    const after = { ...before, testPersons: 4, uniqueResponses: 7 };
    const delta = {
      testPersons: 1,
      testGroups: 0,
      uniqueBooklets: 0,
      uniqueUnits: 0,
      uniqueResponses: 1
    };

    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', {
      body: { value: '{"enabled":false}' }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', {
      body: { data: [], total: 0 }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview',
      (request) => request.reply({
        body: {
          ...(uploaded ? after : before),
          responseStatusCounts: {},
          sessionBrowserCounts: {},
          sessionOsCounts: {},
          sessionScreenCounts: {}
        }
      })).as('overview');
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', {
      body: []
    });
    cy.intercept('POST', '**/api/admin/workspace/5/upload/results/responses/init',
      (request) => {
        expect(request.body).to.include({ fileName: 'responses.json' });
        request.reply({ uploadId: 'upload-1', chunkSize: 1024, totalChunks: 1 });
      }).as('uploadInit');
    cy.intercept('PUT', '**/api/admin/workspace/5/upload/results/upload-1/chunk/0', {
      body: { chunkIndex: 0 }
    }).as('uploadChunk');
    cy.intercept('POST', '**/api/admin/workspace/5/upload/results/upload-1/complete',
      (request) => {
        expect(request.body).to.include({
          overwriteMode: 'skip',
          scope: 'person'
        });
        uploaded = true;
        request.reply({ body: [{ jobId: 'job-1' }] });
      }).as('uploadComplete');
    cy.intercept('GET', '**/api/admin/workspace/5/upload/status/job-1', {
      body: {
        id: 'job-1',
        status: 'completed',
        progress: 100,
        result: {
          expected: delta,
          before,
          after,
          delta,
          responseStatusCounts: {},
          issues: [],
          importedResponses: true
        }
      }
    }).as('uploadStatus');

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then((window) => {
      window.location.hash = '/workspace-admin/5/test-results';
    });
    cy.wait('@overview');
    cy.contains('coding-box-test-results .overview-metric', 'Testpersonen')
      .find('.value').should('have.text', '3');
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
    cy.get('coding-box-test-results-upload-options-dialog')
      .contains('button', 'Upload starten').click();
    cy.wait(['@uploadInit', '@uploadChunk', '@uploadComplete', '@uploadStatus']);
    cy.get('coding-box-test-results-upload-result-dialog', { timeout: 10000 })
      .should('contain.text', 'Upload-Ergebnis');
    cy.contains('coding-box-test-results .overview-metric', 'Testpersonen')
      .find('.value').should('have.text', '4');
    cy.window().should('not.have.property', 'Zone');
  });
});
