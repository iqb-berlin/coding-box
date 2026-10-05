describe('Zoneless TestTaker selection batches', () => {
  let unexpectedRequests: string[];

  beforeEach(() => {
    unexpectedRequests = [];
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501 });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/settings', {
      body: { ignoredUnits: [], ignoredBooklets: [], ignoredTestlets: [] }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', {
      body: { enabled: false, baseUrl: '', hasApplicationToken: false }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', {
      body: { data: [], total: 0, page: 1, limit: 100, fileTypes: [] }
    }).as('files');
    cy.intercept('POST', '**/api/admin/workspace/5/validation-tasks?type=testFiles', {
      body: { id: 701, status: 'completed', progress: 100 }
    });
    const filteredTestTakers = Array.from({ length: 1201 }, (_, index) => ({
      testTaker: 'TESTTAKERS', login: `login-${index}`, mode: 'run-hot-return', consider: false
    }));
    filteredTestTakers.push({
      testTaker: 'TESTTAKERS', login: 'other-login', mode: 'other-mode', consider: false
    });
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/701/results', {
      delay: 150, body: { testTakersFound: true, validationResults: [], filteredTestTakers }
    }).as('validation');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.get('coding-box-test-files').contains('button', 'Validieren').click();
    cy.wait('@validation');
    cy.get('files-validation-dialog').contains('mat-expansion-panel-header', 'TestTaker zum Filtern').click();
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  it('renders the final count after selecting all timer batches', () => {
    cy.get('files-validation-dialog .select-all-row input').check();
    cy.get('files-validation-dialog .exclude-button').each(button => {
      cy.wrap(button).should('contain.text', '(1202)').and('not.be.disabled');
    });
    cy.get('files-validation-dialog .select-all-row input').should('be.checked');
  });

  it('renders the final mode count and clears every later batch', () => {
    cy.get('files-validation-dialog .mode-group').contains('mat-checkbox', 'run-hot-return').find('input').check();
    cy.get('files-validation-dialog .exclude-button').each(button => {
      cy.wrap(button).should('contain.text', '(1201)').and('not.be.disabled');
    });
    cy.get('files-validation-dialog .mode-group').contains('mat-checkbox', 'run-hot-return').find('input')
      .should('be.checked').uncheck();
    cy.get('files-validation-dialog .exclude-button').each(button => {
      cy.wrap(button).should('contain.text', '(0)').and('be.disabled');
    });
    cy.get('files-validation-dialog .mode-group').contains('mat-checkbox', 'run-hot-return').find('input')
      .should('not.be.checked');
  });
});

export {};
