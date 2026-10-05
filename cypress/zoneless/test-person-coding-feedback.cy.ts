describe('zoneless auto-coding job feedback when the list answers first', () => {
  let unexpectedRequests: string[];

  beforeEach(() => {
    cy.viewport(1280, 900);
    unexpectedRequests = [];
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', {
      body: { value: '{"enabled":false}' }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/active', {
      body: { hasActiveJob: false }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/readiness?*', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/statistics', {
      body: { totalResponses: 1, statusCounts: { CODED: 1 } }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/groups/stats', {
      delay: 150,
      body: [{ groupName: 'delayed-group', testPersonCount: 1, responsesToCode: 1 }]
    }).as('groups');
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  for (const outcome of ['completed', 'failed'] as const) {
    it(`automatically shows the ${outcome === 'completed' ? 'warning' : 'error'} from the earlier job list`, () => {
      const jobId = `list-first-${outcome}`;
      const feedback = outcome === 'completed' ?
        'Synthetic cache finalization warning' :
        'Synthetic auto-coding failure';
      const expectedMessage = outcome === 'completed' ?
        `Kodierungsauftrag abgeschlossen, aber mit Warnung: ${feedback}` :
        `Kodierungsauftrag fehlgeschlagen: ${feedback}`;
      const terminalJob = {
        jobId,
        status: outcome,
        progress: 100,
        groupNames: 'delayed-group',
        autoCoderRun: 1,
        result: outcome === 'completed' ? {
          totalResponses: 1, statusCounts: { CODED: 1 }, warnings: [feedback]
        } : undefined,
        error: outcome === 'failed' ? feedback : undefined
      };
      let started = false;
      let terminalListEnabled = false;
      let terminalListRequested = false;
      let statusRequested = false;
      let statusResponded = false;
      cy.intercept('GET', '**/api/admin/workspace/5/coding/jobs', request => {
        if (terminalListEnabled && !terminalListRequested) {
          // Prove the ordering that previously lost the terminal feedback.
          expect(statusRequested).to.equal(true);
          expect(statusResponded).to.equal(false);
          terminalListRequested = true;
        }
        request.reply({
          delay: 150,
          body: terminalListEnabled ? [terminalJob] : started ? [{
            jobId, status: 'processing', progress: 20, groupNames: 'delayed-group', autoCoderRun: 1
          }] : []
        });
      }).as('jobs');
      cy.intercept('GET', '**/api/admin/workspace/5/coding?*', request => {
        expect(request.query.testPersons).to.equal('delayed-group');
        expect(request.query.autoCoderRun).to.equal('1');
        started = true;
        request.reply({
          delay: 150,
          body: { jobId, message: 'Synthetic auto-coding started', totalResponses: 0, statusCounts: {} }
        });
      }).as('startJob');
      cy.intercept('GET', `**/api/admin/workspace/5/coding/job/${jobId}`, request => {
        statusRequested = true;
        request.on('after:response', () => { statusResponded = true; });
        request.reply({ delay: 3500, body: terminalJob });
      }).as('jobStatus');

      cy.visit('/');
      cy.wait('@authData');
      cy.window().then(window => { window.location.hash = '/workspace-admin/5/coding/management'; });
      cy.get('app-coding-management .action-buttons-toolbar button').contains('Automatisch Kodieren').click();
      cy.get('coding-box-test-person-coding-dialog coding-box-test-person-coding').as('dialog');
      cy.wait(['@jobs', '@groups']);
      cy.get('@dialog').contains('.button-container button', 'Alle Testgruppen kodieren')
        .scrollIntoView().should('be.enabled').click({ scrollBehavior: false });
      cy.wait('@startJob');
      cy.wrap(null).should(() => { expect(statusRequested).to.equal(true); });
      cy.then(() => { terminalListEnabled = true; });
      cy.get('@dialog').find('.jobs-actions button')
        .scrollIntoView().should('be.enabled').click({ scrollBehavior: false });
      cy.wait('@jobs');
      // Cypress waits for the automatic DOM update; no click follows the response.
      cy.get('mat-snack-bar-container').should('contain.text', expectedMessage);
      cy.then(() => { expect(statusResponded).to.equal(false); });
      cy.get('@dialog').find('.job-status-card').should('not.exist');
      cy.wait('@jobStatus');
      cy.get('mat-snack-bar-container').should('have.length', 1).and('contain.text', expectedMessage);
      cy.get('@dialog').find('.job-status-card').should('not.exist');
    });
  }
});
