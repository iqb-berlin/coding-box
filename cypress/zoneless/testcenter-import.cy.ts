describe('zoneless Testcenter import with delayed responses', () => {
  it('renders login, progress, upload failure and retry through the reachable file dialog', () => {
    cy.viewport(1280, 900);
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/enable-regex-search', {
      body: { value: '{"enabled":false}' }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', {
      body: { enabled: false, baseUrl: '', hasApplicationToken: false }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', {
      body: { data: [], total: 0, page: 1, limit: 100, fileTypes: [] }
    }).as('files');
    cy.intercept('POST', '**/api/tc_authentication', {
      delay: 600,
      body: {
        token: 'testcenter-token',
        claims: { workspaceAdmin: [{ id: 'tc-study', label: 'Delayed study', type: 'tc', flags: { mode: 'full' } }] }
      }
    }).as('testcenterLogin');
    cy.intercept('GET', '**/api/admin/workspace/5/importWorkspaceFiles/progress?*', {
      delay: 150,
      body: {
        importRunId: 'run', status: 'running', totalPlanned: 4, totalProcessed: 2,
        totalUploaded: 2, totalFailed: 0, options: [], updatedAt: 1, currentFile: 'delayed.xml'
      }
    }).as('progress');
    let attempts = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/importWorkspaceFiles?*', request => {
      attempts += 1;
      expect(request.query.definitions).to.equal('true');
      request.reply(attempts === 1 ? {
        delay: 1500, statusCode: 400, body: { message: 'delayed upload failure' }
      } : {
        delay: 600,
        body: {
          success: true,
          testFilesUploadResult: {
            total: 1, uploaded: 1, failed: 0, conflicts: [], failedFiles: [],
            uploadedFiles: [{ fileId: '17', filename: 'delayed.xml', fileType: 'unit' }]
          }
        }
      });
    }).as('upload');

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(window => { window.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.get('coding-box-test-files').contains('a', 'Testcenter Import').click();
    cy.get('coding-box-test-center-import input[formControlName="name"]').type('user');
    cy.get('coding-box-test-center-import input[formControlName="pw"]').type('password');
    cy.get('coding-box-test-center-import mat-select[formControlName="testCenter"]').click();
    cy.get('mat-option').contains('Testcenter 1').click();
    cy.get('coding-box-test-center-import .auth-form button[type="submit"]').click();
    cy.wait('@testcenterLogin');
    cy.get('coding-box-test-center-import .auth-section').should('not.exist');
    cy.get('coding-box-test-center-import mat-select[formControlName="workspace"] .mat-mdc-select-arrow-wrapper')
      .scrollIntoView().should('be.visible').click({ scrollBehavior: false });
    cy.get('mat-option').contains('Delayed study').click();
    cy.get('coding-box-test-center-import mat-checkbox[formControlName="definitions"]').click();
    cy.get('coding-box-test-center-import .import-form button[type="submit"]').click();
    cy.wait('@progress');
    cy.get('coding-box-test-center-import').should('contain.text', 'delayed.xml');
    cy.get('coding-box-test-center-import mat-progress-bar').should('have.attr', 'aria-valuenow', '50');
    cy.wait('@upload');
    cy.get('coding-box-test-center-import mat-spinner').should('not.exist');
    cy.get('coding-box-test-center-import .error-message').should('contain.text', 'delayed upload failure');
    cy.get('coding-box-test-center-import .import-form button[type="submit"]').should('be.enabled').click();
    cy.wait('@upload');
    cy.get('coding-box-test-center-import').should('not.exist');
    cy.get('coding-box-test-files-upload-result-dialog').should('contain.text', 'delayed.xml');
    cy.window().should('not.have.property', 'Zone');
  });
});
