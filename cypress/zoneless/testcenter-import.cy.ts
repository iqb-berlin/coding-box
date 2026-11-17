describe('zoneless Testcenter import with delayed responses', () => {
  afterEach(() => { cy.task('deferred:reset'); });
  beforeEach(() => {
    cy.intercept('GET', '**/api/testcenter/instances', {
      body: [{ label: 'Testcenter 1', baseUrl: 'https://iqb-testcenter1.de', source: 'standard' }, { label: 'Study Testcenter', baseUrl: 'https://study-testcenter.example.org/tci', source: 'administrator' }]
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
      cy.get('coding-box-error-message-display .other-error').should('not.exist');
      cy.get('mat-snack-bar-container').should('not.exist');
      cy.window().then(window => { expect(window.localStorage.getItem('auth_token')).to.be.a('string'); });
    });
  }


  it('shows Content-Pool transfer progress and package details in the process overview', () => {
    cy.viewport(1440, 1000);
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/token-policy', { body: { scopes: {} } });
    cy.intercept('GET', '**/api/admin/workspace/5/journal*', { body: { data: [], total: 0, page: 1, limit: 20 } });
    cy.intercept('GET', '**/api/admin/workspace/5/processes', { body: [{
      id: 'synthetic-transfer', queueName: 'content-pool', status: 'active', progress: 45, timestamp: Date.now(),
      data: { operation: 'upload-files', acpId: 'synthetic-package', fileCount: 2, progressMessage: 'Kodierschemata werden übertragen' }
    }] }).as('processes');
    cy.visit('/');
    cy.wait('@authData', { requestTimeout: 30_000 });
    cy.window().then(window => { window.location.hash = '/workspace-admin/5/settings'; });
    cy.get('coding-box-ws-settings').contains('button', 'Prozesse anzeigen').scrollIntoView().click();
    cy.wait('@processes');
    cy.get('coding-box-process-overview-dialog').should('contain.text', 'Content-Pool-Übertragung')
      .and('contain.text', '45 %').and('contain.text', 'synthetic-package')
      .and('contain.text', 'Kodierschemata im Content Pool ersetzen');
    cy.get('coding-box-process-overview-dialog mat-progress-bar').should('have.attr', 'aria-valuenow', '45');
    cy.get('coding-box-process-overview-dialog').closest('mat-dialog-container').screenshot('content-pool-process-overview');
  });

  it('lets administrators manage an initial IQB approval and explains failures and cancellation', () => {
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    const instance = { label: 'Testcenter 1', baseUrl: 'https://iqb-testcenter1.de', source: 'standard' };
    cy.intercept('GET', '**/api/admin/testcenter/instances', { body: [instance] });
    cy.intercept('GET', '**/api/admin/content-pool/settings', { body: { enabled: false, baseUrl: '', hasApplicationToken: false } });
    cy.intercept('GET', '**/api/legal-notice', { body: { html: '', isDefault: true } });
    let probeId = '';
    cy.task<{ id: string; url: string }>('deferred:create', {
      statusCode: 503, body: { code: 'TESTCENTER_CERTIFICATE_ERROR', message: 'Testcenter connection failed' }
    }).then(gate => {
      probeId = gate.id;
      cy.intercept('POST', '**/api/admin/testcenter/instances/test', request => {
        request.url = gate.url;
        request.continue();
      }).as('probe');
    });
    cy.intercept('POST', '**/api/admin/testcenter/instances', {
      statusCode: 400, body: { code: 'TESTCENTER_INSTANCE_LIMIT', message: 'limit' }
    }).as('limit');
    cy.intercept('DELETE', '**/api/admin/testcenter/instances', { body: [] }).as('revoke');
    cy.visit('/');
    cy.wait('@authData', { requestTimeout: 30_000 });
    cy.window().then(window => { window.location.hash = '/admin/settings'; });
    cy.get('coding-box-testcenter-settings').contains('button', 'Verbindung prüfen').click();
    cy.get('coding-box-testcenter-settings').contains('button', 'Name bearbeiten').should('be.disabled');
    cy.get('coding-box-testcenter-settings').contains('button', 'Freigabe aufheben').should('be.disabled');
    cy.then(() => cy.task('deferred:release', probeId));
    cy.wait('@probe');
    cy.get('coding-box-testcenter-settings [role="status"]').should('contain.text', 'HTTPS-Zertifikat');
    cy.get('coding-box-testcenter-settings').contains('mat-label', 'Name des Testcenters').click();
    cy.get('coding-box-testcenter-settings input[name="name"]').should('be.focused').type('New study');
    cy.get('coding-box-testcenter-settings').contains('mat-label', 'Basisadresse (HTTP oder HTTPS)').click();
    cy.get('coding-box-testcenter-settings input[name="baseUrl"]').should('be.focused').type('https://study.example');
    cy.get('coding-box-testcenter-settings button[type="submit"]').click();
    cy.wait('@limit');
    cy.get('coding-box-testcenter-settings [role="alert"]').should('contain.text', '100 zusätzliche');
    let reloadId = '';
    cy.task<{ id: string; url: string }>('deferred:create', { body: [instance] }).then(gate => {
      reloadId = gate.id;
      cy.intercept('GET', '**/api/admin/testcenter/instances', request => {
        request.url = gate.url;
        request.continue();
      }).as('reloadInstances');
    });
    cy.get('coding-box-testcenter-settings').contains('button', 'Liste erneut laden').click();
    cy.get('coding-box-testcenter-settings').contains('button', 'Name bearbeiten').should('be.disabled');
    cy.get('coding-box-testcenter-settings').contains('button', 'Freigabe aufheben').should('be.disabled');
    cy.then(() => cy.task('deferred:release', reloadId));
    cy.wait('@reloadInstances');
    cy.get('coding-box-testcenter-settings').contains('button', 'Name bearbeiten').click();
    cy.get('coding-box-testcenter-settings input[name="baseUrl"]').should('have.prop', 'readOnly', true).and('have.value', instance.baseUrl);
    cy.get('coding-box-testcenter-settings').contains('button', 'Freigabe aufheben').click();
    cy.get('coding-box-confirm-dialog').should('contain.text', instance.baseUrl).and('contain.text', 'gesamte Kodierbox');
    cy.get('coding-box-confirm-dialog').contains('button', 'Abbrechen').click();
    cy.get('coding-box-testcenter-settings li').should('contain.text', instance.label);
    cy.get('@revoke.all').should('have.length', 0);
    cy.get('coding-box-testcenter-settings').contains('button', 'Freigabe aufheben').click();
    cy.get('coding-box-confirm-dialog').closest('mat-dialog-container').screenshot('testcenter-iqb-revocation-confirmation');
    cy.get('coding-box-confirm-dialog').contains('button', 'Freigabe aufheben').click();
    cy.wait('@revoke');
    cy.get('coding-box-testcenter-settings li').should('not.exist');
    cy.get('coding-box-testcenter-settings input[name="baseUrl"]').should('have.value', '');
    cy.get('coding-box-error-message-display .other-error').should('not.exist');
    cy.get('mat-snack-bar-container').should('not.exist');
  });

  for (const protocol of ['https', 'http']) {
    it(`lets a system administrator approve, probe and revoke an ${protocol} instance in settings`, () => {
      cy.mockKeycloakAuthentication();
      cy.stubWorkspace({ workspaceId: 5 });
      const instance = { label: 'Study Testcenter', baseUrl: `${protocol}://study.example/tci`, source: 'administrator' };
      cy.intercept('GET', '**/api/admin/testcenter/instances', { body: [] });
      cy.intercept('POST', '**/api/admin/testcenter/instances', request => {
        expect(request.body.baseUrl).to.equal(instance.baseUrl);
        expect([instance.label, 'Renamed Study Testcenter']).to.include(request.body.label);
        request.reply({ body: [{ ...instance, label: request.body.label }] });
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
      cy.get('coding-box-testcenter-settings').contains('mat-label', 'Basisadresse (HTTP oder HTTPS)').click();
      cy.get('coding-box-testcenter-settings input[name="baseUrl"]').should('be.focused').type(instance.baseUrl);
      if (protocol === 'http') {
        cy.get('coding-box-testcenter-settings form .http-warning').should('be.visible')
          .and('contain.text', 'Kennwort, Sitzungstoken und Testdaten')
          .and('contain.text', 'mitgelesen oder verändert');
        cy.get('coding-box-testcenter-settings').screenshot('testcenter-http-approval-warning');
      } else cy.get('coding-box-testcenter-settings .http-warning').should('not.exist');
      cy.get('coding-box-testcenter-settings button[type="submit"]').should('be.enabled').click();
      cy.wait('@approveInstance');
      cy.get('coding-box-testcenter-settings li').should('contain.text', instance.label);
      if (protocol === 'http') cy.get('coding-box-testcenter-settings li .http-warning').should('be.visible').and('contain.text', 'Unverschlüsselte Übertragung (HTTP)');
      cy.get('coding-box-testcenter-settings').contains('button', 'Verbindung prüfen').click();
      cy.wait('@probeInstance');
      cy.get('coding-box-testcenter-settings [role="status"]').should('contain.text', '19.0.1');
      cy.get('coding-box-testcenter-settings').screenshot(`testcenter-${protocol}-instance-settings`);
      cy.get('coding-box-testcenter-settings').contains('button', 'Name bearbeiten').click();
      cy.get('coding-box-testcenter-settings input[name="baseUrl"]').should('have.prop', 'readOnly', true).and('have.value', instance.baseUrl);
      cy.get('coding-box-testcenter-settings input[name="name"]').clear().type('Renamed Study Testcenter');
      cy.get('coding-box-testcenter-settings').screenshot(`testcenter-${protocol}-instance-rename`);
      cy.get('coding-box-testcenter-settings').contains('button', 'Name speichern').click();
      cy.wait('@approveInstance');
      cy.get('coding-box-testcenter-settings li').should('have.length', 1).and('contain.text', 'Renamed Study Testcenter');
      cy.get('coding-box-testcenter-settings input[name="baseUrl"]').should('have.prop', 'readOnly', false);
      cy.get('coding-box-testcenter-settings').contains('button', 'Name bearbeiten').click();
      cy.get('coding-box-testcenter-settings').contains('button', 'Abbrechen').click();
      cy.get('coding-box-testcenter-settings input[name="baseUrl"]').should('have.value', '').and('have.prop', 'readOnly', false);
      cy.get('coding-box-testcenter-settings').contains('button', 'Name bearbeiten').click();
      cy.get('coding-box-testcenter-settings').contains('button', 'Freigabe aufheben').click();
      cy.get('coding-box-confirm-dialog').should('contain.text', 'gesamte Kodierbox');
      cy.get('coding-box-confirm-dialog').contains('button', 'Freigabe aufheben').click();
      cy.wait('@revokeInstance');
      cy.get('coding-box-testcenter-settings li').should('not.exist');
      cy.get('coding-box-testcenter-settings input[name="baseUrl"]').should('have.value', '').and('have.prop', 'readOnly', false);
    });
  }

});
