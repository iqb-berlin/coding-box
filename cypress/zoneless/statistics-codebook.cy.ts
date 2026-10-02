describe('Zoneless replay statistics and codebook export', () => {
  let unexpectedRequests: string[];

  beforeEach(() => {
    unexpectedRequests = [];
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/active', { body: { hasActiveJob: false } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/readiness?*', { body: null });
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  it('renders replay statistics after the delayed final response without another click', () => {
    cy.intercept('GET', '**/api/admin/workspace/token-policy', { body: { scopes: {} } });
    cy.intercept('GET', '**/api/admin/workspace/5/journal*', { body: { data: [], total: 0, page: 1, limit: 20 } });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/sources?*', {
      delay: 300, body: { internal: 3, external: 1, total: 4 }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/frequency?*', { body: { UNIT: 4 } });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/distribution/day?*', { body: {} });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/distribution/hour?*', { body: {} });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/duration?*', {
      body: { min: 1000, max: 3000, average: 2000, distribution: {} }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/errors?*', {
      body: { successRate: 75, totalReplays: 4, successfulReplays: 3, failedReplays: 1, commonErrors: [] }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/failures/unit?*', { body: {} });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/failures/day?*', { body: {} });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/failures/hour?*', {
      delay: 800, body: {}
    }).as('finalStatistics');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/settings'; });
    cy.get('coding-box-ws-settings .replay-statistics-actions button').click();
    cy.get('coding-box-replay-statistics-dialog mat-spinner').should('be.visible');
    cy.wait('@finalStatistics');
    cy.get('coding-box-replay-statistics-dialog mat-spinner').should('not.exist');
    cy.get('coding-box-replay-statistics-dialog .source-summary .stat-value')
      .then(values => { expect([...values].map(value => value.textContent?.trim())).to.deep.equal(['4', '3', '1']); });
    cy.get('coding-box-replay-statistics-dialog ngx-charts-bar-vertical svg path.bar')
      .should('have.length', 1)
      .and('have.attr', 'd')
      .should('not.be.empty');
  });

  for (const outcome of ['completed', 'failed']) {
    it(`renders delayed codebook progress and the ${outcome} status`, () => {
      cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions', { body: [] });
      cy.intercept('GET', '**/api/admin/workspace/5/variable-bundle?*', { body: { data: [], total: 0 } });
      cy.intercept('GET', '**/api/admin/workspace/5/coding/missings-profiles', { body: [] });
      cy.intercept('GET', '**/api/admin/workspace/5/files/units-with-file-ids', {
        delay: 600, body: [{ id: 1, unitId: 'UNIT', fileName: 'UNIT.vocs', data: '{}' }]
      }).as('units');
      cy.intercept('POST', '**/api/admin/workspace/5/coding/codebook/job', request => {
        expect(request.body.unitList).to.deep.equal([1]);
        expect(request.body.contentOptions.hasGeneralInstructions).to.equal(false);
        request.reply({ delay: 300, body: { jobId: 'job-1', message: 'Started' } });
      }).as('startCodebook');
      let finish = false;
      cy.intercept('GET', '**/api/admin/workspace/5/coding/codebook/job/job-1', request => {
        request.reply({ delay: 400, body: finish ? {
          status: outcome, progress: 100, error: outcome === 'failed' ? 'Codebook failed' : undefined
        } : { status: 'processing', progress: 64 } });
      }).as('codebookProgress');
      cy.intercept('GET', '**/api/admin/workspace/5/coding/codebook/job/job-1/download', {
        headers: { 'Content-Type': 'application/octet-stream' }, body: 'Synthetic codebook output'
      }).as('download');
      cy.visit('/');
      cy.wait('@authData');
      cy.window().then(win => { win.location.hash = '/workspace-admin/5/coding/management'; });
      cy.get('app-coding-management .action-buttons-toolbar a').contains('Codebook').click();
      cy.get('shared-export-coding-book').as('dialog');
      cy.get('@dialog').find('mat-spinner').should('be.visible');
      cy.wait('@units');
      cy.get('@dialog').find('mat-spinner').should('not.exist');
      cy.get('@dialog').find('.select-all-container input').check();
      cy.get('@dialog').find('.options-grid mat-checkbox').eq(1).find('input').uncheck();
      cy.get('@dialog').find('button[type="submit"]').click();
      cy.wait('@startCodebook');
      cy.get('@dialog').find('button[type="submit"]').should('be.disabled');
      cy.wait('@codebookProgress');
      cy.get('@dialog').find('.progress-percentage').should('contain.text', '64%');
      cy.then(() => { finish = true; });
      cy.get('@dialog').find(`.progress-container.${outcome}`).should('be.visible');
      cy.get('@dialog').find('button[type="submit"]').should('not.be.disabled');
      if (outcome === 'completed') {
        cy.wait('@download');
      } else {
        cy.get('@dialog').find('.progress-container.failed').should('contain.text', 'Codebook failed');
        cy.get('@dialog').find('.progress-container.failed button').click();
        cy.get('@dialog').find('.codebook-progress-section').should('not.exist');
      }
    });
  }
});
