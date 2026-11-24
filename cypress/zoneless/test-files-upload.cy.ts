describe('zoneless test-file upload', () => {
  it('shows active upload progress, the upload result and the refreshed file list', () => {
    const filename = 'zoneless-upload.vomd';
    let uploaded = false;
    let uploadGateId = '';

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
        uploaded: 1,
        failed: 0,
        uploadedFiles: [{ fileId: '17', filename, fileType: 'vomd' }],
        failedFiles: [],
        conflicts: []
      }
    }).then(gate => {
      uploadGateId = gate.id;
      cy.intercept('POST', '**/api/admin/workspace/5/upload?overwriteExisting=false', request => {
        expect(request.headers['content-type']).to.contain('multipart/form-data');
        request.url = gate.url;
        request.continue();
      }).as('upload');
    });
    cy.intercept('GET', '**/api/admin/workspace/5/processes', request => {
      request.reply([{
        id: uploaded ? 'active-upload' : 'previous-upload', queueName: 'test-files-upload',
        status: 'completed', progress: 100, timestamp: Date.now(), data: { fileCount: 1 }
      }]);
    }).as('processes');
    cy.intercept('GET', '**/api/admin/workspace/5/processes/test-files-upload', {
      body: {
        id: 'active-upload', queueName: 'test-files-upload', status: 'active',
        progress: 50, timestamp: Date.now(), data: { fileCount: 1 }
      }
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
    cy.then(() => {
      uploaded = true;
      return cy.task('deferred:release', uploadGateId);
    });
    cy.wait('@upload');
    cy.get('coding-box-test-files-upload-result-dialog')
      .should('contain.text', 'Erfolgreich: 1')
      .and('contain.text', filename);
    cy.get('coding-box-test-files-upload-result-dialog')
      .contains('button', 'Schließen').click();
    cy.wait('@processes');
    cy.get('coding-box-process-overview-dialog').within(() => {
      cy.contains('tr', 'Testdatei-Upload').should('contain.text', '100 %');
      cy.contains('button', 'Schließen').click();
    });
    cy.get('coding-box-test-files .files-table')
      .should('contain.text', filename);
    cy.window().should('not.have.property', 'Zone');
  });
});
