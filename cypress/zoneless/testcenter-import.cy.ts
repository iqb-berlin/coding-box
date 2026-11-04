describe('zoneless Testcenter import with delayed responses', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/testcenter/instances', {
      body: [{ label: 'Study Testcenter', baseUrl: 'https://study-testcenter.example.org/tci', source: 'administrator' }]
    });
  });
  for (const testcenter of [
    { label: 'Testcenter 1', id: '1', server: '1', url: '', approved: false },
    { label: 'individuelle Testcenter URL', id: '6', server: '', url: 'https://custom-testcenter.example.org/tci', approved: false },
    { label: 'Study Testcenter', id: '7', server: '', url: 'https://study-testcenter.example.org/tci', approved: true },
    ...Array.from({ length: 10 }, (_, index) => ({
      label: 'individuelle Testcenter URL', id: '6', server: '', url: `https://iqb-testcenter${index + 1}.de`, approved: false
    }))
  ]) {
    it(`renders login, progress, upload failure and retry for ${testcenter.url || testcenter.label}`, () => {
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
      cy.intercept('POST', '**/api/tc_authentication', request => {
        expect(request.body).to.deep.equal({ username: 'user', password: 'password', server: testcenter.server, url: testcenter.url });
        request.reply({
          delay: 600,
          body: {
            token: 'testcenter-token',
            claims: { workspaceAdmin: [{ id: 'tc-study', label: 'Delayed study', type: 'tc', flags: { mode: 'full' } }] }
          }
        });
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
        expect(request.query.responses).to.equal('false');
        expect(request.query.server).to.equal(testcenter.id);
        expect(request.query.url).to.equal(encodeURIComponent(testcenter.url));
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
      // A cold bootstrap on the shared runner can exceed Cypress's 5s request budget.
      cy.wait('@authData', { requestTimeout: 30_000 });
      cy.window().then(window => { window.location.hash = '/workspace-admin/5/test-files'; });
      cy.wait('@files');
      cy.get('coding-box-test-files').contains('button', 'Testcenter Import').click();
      cy.get('coding-box-test-center-import input[formControlName="name"]').type('user');
      cy.get('coding-box-test-center-import input[formControlName="pw"]').type('password');
      cy.get('coding-box-test-center-import mat-select[formControlName="testCenter"]').click();
      cy.get('mat-option').contains(testcenter.label).click();
      if (testcenter.url && !testcenter.approved) {
        cy.get('coding-box-test-center-import .auth-form button[type="submit"]').should('be.disabled');
        cy.get('coding-box-test-center-import input[formControlName="testCenterIndividual"]').should('be.enabled').type(testcenter.url);
      }
      cy.get('coding-box-test-center-import .auth-form button[type="submit"]').click();
      cy.wait('@testcenterLogin');
      cy.get('coding-box-test-center-import .auth-section').should('not.exist');
      cy.get<HTMLElement>('coding-box-test-center-import .import-form').then(forms => {
        const form = forms[0];
        if (testcenter.label === 'Testcenter 1') {
          // Reproduce Electron holding the entrance at its invisible first frame.
          const entrance = form.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
          entrance.pause();
          entrance.currentTime = 0;
          expect(form.ownerDocument.defaultView!.getComputedStyle(form).opacity).to.equal('0');
        }
        // Match the manual-preparation harness: finish finite entrance motion only.
        // Keep the progress spinner and delayed network responses running normally.
        for (let ancestor: HTMLElement | null = form; ancestor; ancestor = ancestor.parentElement) {
          ancestor.getAnimations().forEach(animation => {
            const endTime = animation.effect?.getComputedTiming().endTime;
            if (typeof endTime === 'number' && Number.isFinite(endTime)) animation.finish();
          });
        }
      });
      cy.get('coding-box-test-center-import .import-form').should('be.visible');
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
  }

  for (const failure of [
    { status: 403, message: 'Testcenter target is not allowed', expected: 'noch nicht freigegeben' },
    { status: 422, message: 'Invalid Testcenter credentials', expected: 'Zugangsdaten abgelehnt' }
  ]) {
    it(`explains login HTTP ${failure.status} while retaining the Coding-Box session`, () => {
      cy.mockKeycloakAuthentication();
      cy.stubWorkspace({ workspaceId: 5 });
      cy.intercept('GET', '**/api/workspace/5/settings/enable-regex-search', { body: { value: '{"enabled":false}' } });
      cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', { body: { enabled: false, baseUrl: '', hasApplicationToken: false } });
      cy.intercept('GET', '**/api/admin/workspace/5/files?*', { body: { data: [], total: 0, page: 1, limit: 100, fileTypes: [] } }).as('files');
      cy.intercept('POST', '**/api/tc_authentication', { statusCode: failure.status, body: { message: failure.message } }).as('login');
      cy.visit('/');
      cy.wait('@authData', { requestTimeout: 30_000 });
      cy.window().then(window => { window.location.hash = '/workspace-admin/5/test-files'; });
      cy.wait('@files');
      cy.get('coding-box-test-files').contains('button', 'Testcenter Import').click();
      cy.get('input[formControlName="name"]').type('user');
      cy.get('input[formControlName="pw"]').type('password');
      cy.get('mat-select[formControlName="testCenter"]').click();
      cy.get('mat-option').contains('individuelle Testcenter URL').click();
      cy.get('input[formControlName="testCenterIndividual"]').type('https://study.example/tci');
      cy.get('.auth-form button[type="submit"]').click();
      cy.wait('@login');
      cy.get('.auth-section [role="alert"]').should('contain.text', failure.expected);
      cy.get('.auth-form button[type="submit"]').should('be.enabled');
      cy.window().then(window => { expect(window.localStorage.getItem('auth_token')).to.be.a('string'); });
    });
  }


  it('lets a system administrator approve, probe and revoke an instance in settings', () => {
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    const instance = { label: 'Study Testcenter', baseUrl: 'https://study.example/tci', source: 'administrator' };
    cy.intercept('GET', '**/api/admin/testcenter/instances', { body: [] });
    cy.intercept('POST', '**/api/admin/testcenter/instances', request => {
      expect(request.body).to.deep.equal({ label: instance.label, baseUrl: instance.baseUrl });
      request.reply({ body: [instance] });
    }).as('approveInstance');
    cy.intercept('POST', '**/api/admin/testcenter/instances/test', {
      body: { version: '19.0.1', checkedAt: '2026-11-04T12:00:00Z' }
    }).as('probeInstance');
    cy.intercept('DELETE', '**/api/admin/testcenter/instances', request => {
      expect(request.body).to.deep.equal({ baseUrl: instance.baseUrl });
      request.reply({ body: [] });
    }).as('revokeInstance');
    cy.intercept('GET', '**/api/admin/content-pool/settings', { body: { enabled: false, baseUrl: '', hasApplicationToken: false } });
    cy.intercept('GET', '**/api/legal-notice', { body: { html: '', isDefault: true } });
    cy.visit('/');
    cy.wait('@authData', { requestTimeout: 30_000 });
    cy.window().then(window => { window.location.hash = '/admin/settings'; });
    cy.get('coding-box-testcenter-settings').contains('mat-label', 'Name des Testcenters').click();
    cy.get('coding-box-testcenter-settings input[name="name"]').should('be.focused').type(instance.label);
    cy.get('coding-box-testcenter-settings').contains('mat-label', 'HTTPS-Basisadresse').click();
    cy.get('coding-box-testcenter-settings input[name="baseUrl"]').should('be.focused').type(instance.baseUrl);
    cy.get('coding-box-testcenter-settings button[type="submit"]').click();
    cy.wait('@approveInstance');
    cy.get('coding-box-testcenter-settings li').should('contain.text', instance.label);
    cy.get('coding-box-testcenter-settings').contains('button', 'Verbindung prüfen').click();
    cy.wait('@probeInstance');
    cy.get('coding-box-testcenter-settings [role="status"]').should('contain.text', '19.0.1');
    cy.get('coding-box-testcenter-settings').screenshot('testcenter-instance-settings');
    cy.get('coding-box-testcenter-settings').contains('button', 'Freigabe aufheben').click();
    cy.wait('@revokeInstance');
    cy.get('coding-box-testcenter-settings li').should('not.exist');
  });

});
