const completeFiles = { complete: true, missing: [], files: [] };

describe('Zoneless information from file validation', () => {
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
    cy.intercept('GET', '**/api/admin/workspace/5/settings', { body: { ignoredUnits: [], ignoredBooklets: [], ignoredTestlets: [] } });
    cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', { body: { enabled: false, baseUrl: '', hasApplicationToken: false } });
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', { body: { data: [], total: 0, page: 1, limit: 100, fileTypes: [] } }).as('files');
    cy.intercept('POST', '**/api/admin/workspace/5/validation-tasks?type=testFiles', { body: { id: 701, status: 'completed', progress: 100 } });
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/701/results', {
      delay: 250,
      body: { testTakersFound: true, validationResults: [{ testTaker: 'TESTTAKER_ZL', testTakerSchemaValid: true,
        booklets: { ...completeFiles, files: [{ filename: 'BOOKLET_ZL', exists: true }] },
        units: completeFiles, schemes: completeFiles, schemer: completeFiles, definitions: completeFiles, player: completeFiles, metadata: completeFiles }] }
    }).as('validation');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.get('coding-box-test-files').contains('a', 'Validieren').click();
    cy.wait('@validation');
    cy.get('files-validation-dialog').contains('[role="tab"]', 'TESTTAKER_ZL').click();
  });
  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  it('retries test taker XML after an error and opens the actual viewer', () => {
    let attempts = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/files/testtakers/TESTTAKER_ZL/content', request => {
      request.reply(++attempts === 1 ? { delay: 250, statusCode: 500 } : { delay: 250, body: { content: '<TestTakers id="TESTTAKER_ZL"/>' } });
    }).as('xml');
    cy.get('files-validation-dialog button[aria-label="TestTaker XML anzeigen"]').click();
    cy.wait('@xml').its('response.statusCode').should('equal', 500);
    cy.get('mat-snack-bar-container').should('contain.text', 'Keine XML-Daten');
    cy.get('files-validation-dialog button[aria-label="TestTaker XML anzeigen"]').click();
    cy.wait('@xml').its('response.statusCode').should('equal', 200);
    cy.get('coding-box-xml-viewer').should('contain.text', 'TESTTAKER_ZL');
  });
  it('retries booklet information and shows its real metadata tab', () => {
    let attempts = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/booklet/BOOKLET_ZL/info', request => {
      request.reply(++attempts === 1 ? { delay: 250, statusCode: 500 } : {
        delay: 250, body: { metadata: { id: 'BOOKLET_ZL', label: 'Booklet validation metadata' }, units: [], restrictions: [], rawXml: '<Booklet/>' }
      });
    }).as('booklet');
    cy.get('files-validation-dialog .mat-mdc-tab-body-active .files-header').first().click();
    cy.get('files-validation-dialog button[aria-label="Testheft anzeigen"]').click();
    cy.wait('@booklet').its('response.statusCode').should('equal', 500);
    cy.get('mat-snack-bar-container').should('contain.text', 'Fehler beim Laden');
    cy.get('files-validation-dialog button[aria-label="Testheft anzeigen"]').click();
    cy.wait('@booklet').its('response.statusCode').should('equal', 200);
    cy.get('coding-box-booklet-info-dialog').contains('[role="tab"]', 'Metadaten').click();
    cy.get('coding-box-booklet-info-dialog .mat-mdc-tab-body-active').should('contain.text', 'Booklet validation metadata');
  });

});
export {};
