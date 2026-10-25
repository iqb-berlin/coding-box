const compatibilityError = 'Das Kodierschema "MMV032.VOCS" ist nicht mit der Unit "MMV032" kompatibel: Die technische Variable "technical-a" hat in der Unit den Alias "01a", im VOCS jedoch "wrong-alias".';
const completeFiles = { complete: true, missing: [], files: [] };

describe('Unit/VOCS compatibility feedback', () => {
  let unexpectedRequests: string[];

  beforeEach(() => {
    cy.viewport(1280, 1000);
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
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/active', { body: { hasActiveJob: false } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/readiness?*', { body: {
      workspaceId: 5, autoCoderRun: 1, readiness: 'BLOCKED', blockers: ['INVALID_CODING_SCHEMES'],
      rawResponsesTotal: 318, rawResponsesWithRelevantStatus: 318, resultUnitsTotal: 2,
      resultUnitKeysTotal: 2, matchedUnitFiles: 2, missingUnitFiles: [], matchedCodingSchemes: 2,
      missingCodingSchemes: [], invalidCodingSchemes: ['MMV032.VOCS'],
      validVariablePairs: 2, validResponses: 318, codeableResponses: 1, invalidVariableSamples: []
    } }).as('readiness');
  });

  afterEach(() => {
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  it('shows the blocking VOCS even when another Unit has codeable responses', () => {
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/coding/management'; });
    cy.wait('@readiness');
    cy.get('coding-box-coding-management .coding-freshness-panel')
      .should('contain.text', 'MMV032.VOCS')
      .contains('button', 'Testdateien prüfen').click();
    cy.wait('@files');
    cy.get('coding-box-test-files').should('be.visible');
  });

  it('displays the original aliases on both the Unit and VOCS validation markers', () => {
    cy.intercept('POST', '**/api/admin/workspace/5/validation-tasks?type=testFiles', { body: { id: 701, status: 'completed', progress: 100 } });
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/701/results', { body: {
      testTakersFound: true, validationResults: [{
        testTaker: 'SYNTHETIC', testTakerSchemaValid: true,
        booklets: completeFiles,
        units: { ...completeFiles, files: [{ filename: 'MMV032', exists: true, schemaValid: false, schemaErrors: [compatibilityError] }] },
        schemes: { ...completeFiles, files: [{ filename: 'MMV032.VOCS', exists: true, schemaValid: false, schemaErrors: [compatibilityError] }] },
        schemer: completeFiles, definitions: completeFiles, player: completeFiles, metadata: completeFiles
      }]
    } }).as('validation');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.get('coding-box-test-files').contains('button', 'Validieren').click();
    cy.wait('@validation');
    cy.get('coding-box-files-validation-dialog').contains('[role="tab"]', 'SYNTHETIC').click();
    cy.get('coding-box-files-validation-dialog .files-header').each(header => {
      cy.wrap(header).click();
    });
    for (const filename of ['MMV032', 'MMV032.VOCS']) {
      cy.get('coding-box-files-validation-dialog .file-name').filter((_, element) => element.textContent?.trim() === filename)
        .closest('.file-item-header').contains('mat-icon', 'report_problem').trigger('mouseenter');
      cy.get('[role="tooltip"]').should('contain.text', compatibilityError);
      cy.get('body').trigger('mousemove', { clientX: 0, clientY: 0 });
      cy.get('coding-box-files-validation-dialog .file-name').filter((_, element) => element.textContent?.trim() === filename)
        .closest('.file-item-header').contains('mat-icon', 'report_problem').trigger('mouseleave');
    }
  });
});
