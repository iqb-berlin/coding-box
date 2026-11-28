describe('Database exports from settings', () => {
  beforeEach(() => {
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/admin/workspace/token-policy', { body: { scopes: {} } });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/journal*', { body: { data: [], total: 0, page: 1, limit: 20 } });
    cy.intercept('GET', '**/api/legal-notice', { body: { html: '<p>Legal notice</p>', isDefault: false } });
    cy.intercept('GET', '**/api/admin/content-pool/settings', { body: { enabled: false, baseUrl: '', hasApplicationToken: false } });
  });

  it('downloads the same completed workspace file again after reopening settings', () => {
    const base = '**/api/admin/workspace/5/export/sqlite';
    cy.intercept('GET', `${base}/available`, { body: { readyJobId: 'saved' } }).as('available');
    cy.intercept('POST', `${base}/job`, { statusCode: 500 }).as('newJob');
    cy.intercept('GET', `${base}/job/saved/download/prepare`, { body: {} }).as('prepare');
    cy.intercept('GET', `${base}/job/saved/download/file`, {
      headers: { 'content-disposition': 'attachment; filename="saved.sqlite"' }, body: 'retained file'
    }).as('file');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/settings'; });
    cy.wait('@available');
    cy.contains('button', 'Fertige SQLite-Datei herunterladen').click();
    cy.wait('@prepare');
    cy.wait('@file');
    cy.reload();
    cy.wait('@available');
    cy.contains('button', 'Fertige SQLite-Datei herunterladen').click();
    cy.wait('@prepare');
    cy.wait('@file');
    cy.get('@newJob.all').should('have.length', 0);
  });

  const scopes = [
    { name: 'system', route: '/admin/settings', api: '/admin/database/export/sqlite', file: 'database-export', host: 'coding-box-sys-admin-settings' },
    { name: 'workspace', route: '/workspace-admin/5/settings', api: '/admin/workspace/5/export/sqlite', file: 'workspace-5-export', host: 'coding-box-ws-settings' }
  ];

  for (const scope of scopes) {
    it(`downloads a ${scope.name} export after slow polling and updates the zoneless UI`, () => {
      cy.intercept('POST', `**/api${scope.api}/job`, { body: { jobId: 'export-1' } }).as('start');
      let polls = 0;
      cy.intercept('GET', `**/api${scope.api}/job/export-1`, request => {
        polls += 1;
        request.reply(polls === 1 ?
          { delay: 2500, body: { status: 'running', progress: 42 } } :
          { body: { status: 'completed', progress: 100 } });
      }).as('status');
      cy.intercept('GET', `**/api${scope.api}/job/export-1/download`, {
        headers: { 'content-type': 'application/octet-stream' }, body: 'synthetic sqlite export'
      }).as('download');
      cy.visit('/');
      cy.wait('@authData');
      cy.window().then(win => { win.location.hash = scope.route; });
      cy.get(scope.host).find('.database-export-card button').first().as('export').click();
      cy.wait('@start');
      cy.get('@export').should('be.disabled');
      cy.wait('@status');
      cy.get(scope.host).find('.export-progress').should('contain.text', '42%');
      cy.wait('@status');
      if (scope.name === 'workspace') {
        cy.intercept('GET', `**/api${scope.api}/job/export-1/download/prepare`, { body: {} }).as('prepare');
        cy.intercept('GET', `**/api${scope.api}/job/export-1/download/file`, {
          headers: { 'content-disposition': 'attachment; filename="workspace-5-export-1.sqlite"' },
          body: 'synthetic sqlite export'
        }).as('nativeDownload');
        cy.contains('button', 'Fertige SQLite-Datei herunterladen').click();
        cy.wait('@prepare');
        cy.wait('@nativeDownload');
      } else {
        cy.wait('@download');
      }
      cy.get('@export').should('not.be.disabled');
      const name = scope.name === 'workspace' ? 'workspace-5-export-1' : `${scope.file}-${new Date().toISOString().slice(0, 10)}`;
      cy.readFile(`cypress/downloads/${name}.sqlite`)
        .should('equal', 'synthetic sqlite export');
      cy.get(scope.host).find('.export-error').should('not.exist');
      cy.window().should('not.have.property', 'Zone');
      cy.then(() => { expect(polls).to.equal(2); });
    });

    it(`shows a ${scope.name} export failure and permits a new attempt`, () => {
      cy.intercept('POST', `**/api${scope.api}/job`, { body: { jobId: 'export-1' } }).as('start');
      cy.intercept('GET', `**/api${scope.api}/job/export-1`, {
        body: { status: 'failed', progress: 20, error: 'Synthetischer Exportfehler' }
      }).as('failed');
      cy.visit('/');
      cy.wait('@authData');
      cy.window().then(win => { win.location.hash = scope.route; });
      cy.get(scope.host).find('.database-export-card button').first().as('export').click();
      cy.wait('@failed');
      cy.get(scope.host).find('.export-error').should('contain.text', 'Synthetischer Exportfehler');
      cy.get('@export').should('not.be.disabled').click();
      cy.wait('@start');
      cy.wait('@failed');
      cy.get('@export').should('not.be.disabled');
    });
  }
});
