describe('zoneless test-file upload', () => {
  it('shows the upload result and refreshes the file list', () => {
    const filename = 'zoneless-upload.vomd';
    let uploaded = false;

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
    cy.intercept('POST', '**/api/admin/workspace/5/upload?overwriteExisting=false',
      (request) => {
        expect(request.headers['content-type']).to.contain('multipart/form-data');
        uploaded = true;
        request.reply({
          total: 1,
          uploaded: 1,
          failed: 0,
          uploadedFiles: [{ fileId: '17', filename, fileType: 'vomd' }],
          failedFiles: [],
          conflicts: []
        });
      }).as('upload');

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
    cy.wait('@upload');
    cy.get('coding-box-test-files-upload-result-dialog')
      .should('contain.text', 'Erfolgreich: 1')
      .and('contain.text', filename);
    cy.get('coding-box-test-files-upload-result-dialog')
      .contains('button', 'Schließen').click();
    cy.get('coding-box-test-files .files-table')
      .should('contain.text', filename);
    cy.window().should('not.have.property', 'Zone');
  });
});
