describe('Zoneless asynchronous dialogs', () => {
  beforeEach(() => {
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', {
      body: { value: '{"enabled":false}' }
    });
  });

  it('loads delayed Content Pool settings, ACP choices and import progress', () => {
    const settings = { enabled: true, baseUrl: 'https://example.org', hasApplicationToken: true };
    cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', {
      delay: 800, body: settings
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', {
      body: { data: [], total: 0, page: 1, limit: 100, fileTypes: [] }
    }).as('files');
    cy.intercept('POST', '**/api/admin/workspace/5/content-pool/acps', {
      delay: 800, body: { settings, acps: [{ id: 'acp-1', name: 'Delayed ACP' }] }
    }).as('acps');
    cy.intercept('POST', '**/api/admin/workspace/5/content-pool/import-acp/start', {
      body: { jobId: 'job-1' }
    });
    let failJob = false;
    cy.intercept('GET', '**/api/admin/workspace/5/content-pool/import-acp/job-1/progress', request => {
      request.reply({
        jobId: 'job-1', status: failJob ? 'failed' : 'running', phase: 'loading-files',
        message: 'Dateien laden', error: failJob ? 'Transfer fehlgeschlagen' : undefined,
        processedFiles: 1, totalFiles: 2, progress: 50, createdAt: '', updatedAt: ''
      });
    });
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.contains('button', 'ACP aus Content Pool').should('be.visible').and('be.enabled').click();
    cy.get('coding-box-content-pool-import-dialog').as('dialog');
    cy.get('@dialog').contains('button', 'ACPs laden').click();
    cy.get('@dialog').should('contain.text', 'Lade ACPs...');
    cy.wait('@acps');
    cy.get('@dialog').find('mat-spinner').should('not.exist');
    cy.get('@dialog').find('mat-select').click();
    cy.contains('mat-option', 'Delayed ACP').click();
    cy.get('@dialog').contains('button', 'ACP importieren').click();
    cy.get('@dialog').find('.import-progress').should('contain.text', '50%');
    cy.get('@dialog').contains('button', 'Abbrechen').should('be.disabled');
    cy.then(() => { failJob = true; });
    cy.get('@dialog').find('.error-message').should('contain.text', 'Transfer fehlgeschlagen');
    cy.get('@dialog').contains('button', 'Abbrechen').should('not.be.disabled');
    cy.window().should('not.have.property', 'Zone');
  });

  it('renders delayed response-cleanup choices', () => {
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', { body: { data: [], total: 0 } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', {
      body: { testPersons: 0, testGroups: 0, uniqueBooklets: 0, uniqueUnits: 0, uniqueResponses: 0 }
    }).as('overview');
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/options', {
      delay: 800, body: { groups: [], booklets: [], testPersons: [], units: ['UNIT_1'] }
    }).as('options');
    cy.intercept('GET', '**/api/admin/workspace/5/files/unit-variables', { body: [] });
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-results'; });
    cy.wait('@overview');
    cy.contains('button', 'Antworten bereinigen').click();
    cy.get('coding-box-test-results-response-cleanup-dialog').as('dialog');
    cy.get('@dialog').find('.loading-state').should('be.visible');
    cy.wait('@options');
    cy.get('@dialog').find('.loading-state').should('not.exist');
    cy.get('@dialog').find('mat-select').first().click();
    cy.contains('mat-option', 'UNIT_1').should('be.visible');
    cy.window().should('not.have.property', 'Zone');
  });

  it('enables result export after delayed missing profiles arrive', () => {
    cy.intercept('GET', '**/api/admin/workspace/5/coding/export-missings-profiles', {
      delay: 1000, body: [{ id: 4, label: 'IQB-Standard' }]
    }).as('exportProfiles');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/export'; });
    cy.get('[data-cy="start-export"]').should('be.disabled');
    cy.wait('@exportProfiles');
    cy.get('[data-cy="results-missings-profile"]').should('contain.text', 'IQB-Standard');
    cy.get('[data-cy="start-export"]').should('not.be.disabled');
    cy.window().should('not.have.property', 'Zone');
  });

  it('renders journal entries after a delayed server response', () => {
    cy.intercept('GET', '**/api/admin/workspace/token-policy', {
      body: { scopes: {} }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/journal*', {
      delay: 1000,
      body: { data: [{
        id: 1, workspaceId: 5, actorType: 'user', actorUserId: 1,
        eventType: 'workspace.export', entityType: 'workspace', entityId: '5',
        result: 'success', summary: 'Verzögerter Journaleintrag', details: null,
        timestamp: '2026-09-29T10:00:00.000Z'
      }], total: 1, page: 1, limit: 20 }
    }).as('journal');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/settings'; });
    cy.wait('@journal');
    cy.get('coding-box-journal').should('contain.text', 'Verzögerter Journaleintrag');
    cy.window().should('not.have.property', 'Zone');
  });

});
