describe('zoneless test-file upload', () => {
  it('follows the conflict overwrite through delayed publication of its result', () => {
    const filename = 'zoneless-upload.vomd';
    let uploaded = false;
    let uploadGateId = '';
    let overwriteGateId = '';
    let overwriteStarted = false;

    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/enable-regex-search', {
      body: { value: '{"enabled":false}' }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', {
      body: { enabled: false, baseUrl: '', hasApplicationToken: false }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', (request) => {
      request.reply({
        data: uploaded ? [{ id: 17, filename, file_type: 'vomd' }] : [],
        total: uploaded ? 1 : 0,
        page: 1,
        limit: 100,
        fileTypes: uploaded ? ['vomd'] : []
      });
    }).as('files');
    cy.task<{ id: string; url: string }>('deferred:create', {
      body: {
        total: 1,
        uploaded: 0,
        failed: 0,
        conflicts: [{ fileId: '17', filename, fileType: 'vomd' }]
      }
    }).then(gate => {
      uploadGateId = gate.id;
      cy.intercept('POST', '**/api/admin/workspace/5/upload?overwriteExisting=false', request => {
        expect(request.headers['content-type']).to.contain('multipart/form-data');
        request.url = gate.url;
        request.continue();
      }).as('upload');
    });
    cy.task<{ id: string; url: string }>('deferred:create', {
      body: { total: 1, uploaded: 1, failed: 0, uploadedFiles: [{ fileId: '17', filename, fileType: 'vomd' }] }
    }).then(gate => {
      overwriteGateId = gate.id;
      cy.intercept('POST', '**/upload?overwriteExisting=true&overwriteFileIds=17', request => {
        overwriteStarted = true;
        request.url = gate.url;
        request.continue();
      }).as('overwrite');
    });
    cy.intercept('GET', '**/api/admin/workspace/5/processes', request => {
      request.reply([{
        id: uploaded ? 'overwrite' : 'initial', queueName: 'test-files-upload',
        status: uploaded ? 'active' : 'completed', progress: uploaded ? 99 : 100, timestamp: Date.now()
      }]);
    }).as('processes');
    cy.intercept('GET', '**/api/admin/workspace/5/processes/test-files-upload', request => {
      request.reply({
        id: overwriteStarted ? 'overwrite' : 'initial', queueName: 'test-files-upload',
        status: uploaded ? 'completed' : 'active',
        progress: uploaded ? 100 : (overwriteStarted ? 25 : 50), timestamp: Date.now()
      });
    }).as('uploadProgress');

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then((window) => {
      window.location.hash = '/workspace-admin/5/test-files';
    });
    cy.wait('@files');
    cy.get('coding-box-test-files input[type="file"]').selectFile({
      contents: Cypress.Buffer.from('<VariableMetadata/>'),
      fileName: filename,
      mimeType: 'application/xml'
    }, { force: true });
    cy.get('coding-box-test-files .busy-overlay').contains('button', 'Prozesse anzeigen').click();
    cy.wait('@processes');
    cy.wait('@uploadProgress');
    cy.get('coding-box-process-overview-dialog').within(() => {
      cy.contains('tr', 'Testdatei-Upload').within(() => {
        cy.contains('50 %').should('be.visible');
        cy.get('button').should('be.disabled');
      });
    });
    cy.then(() => cy.task('deferred:release', uploadGateId));
    cy.wait('@upload');
    cy.wait('@processes');
    cy.get('coding-box-test-files-upload-conflicts-dialog').within(() => {
      cy.get('.row-checkbox input').check({ force: true });
      cy.contains('button', 'Auswahl überschreiben').click();
    });
    cy.get('coding-box-process-overview-dialog').contains('tr', 'Testdatei-Upload').should('contain.text', '25 %');
    cy.then(() => {
      uploaded = true;
      return cy.task('deferred:release', overwriteGateId);
    });
    cy.wait('@overwrite');
    cy.get('coding-box-test-files-upload-result-dialog')
      .should('contain.text', 'Erfolgreich: 1')
      .and('contain.text', filename);
    cy.get('coding-box-test-files-upload-result-dialog')
      .contains('button', 'Schließen').click();
    cy.get('coding-box-process-overview-dialog').within(() => {
      cy.contains('tr', 'Testdatei-Upload').should('contain.text', '100 %');
      cy.contains('button', 'Schließen').click();
    });
    cy.get('coding-box-test-files .files-table')
      .should('contain.text', filename);
    cy.window().should('not.have.property', 'Zone');
  });
});
