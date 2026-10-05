import * as ExcelJS from 'exceljs';

describe('Zoneless asynchronous coding dialogs', () => {
  let unexpectedRequests: string[];
  let releaseResponses: Array<() => void>;

  beforeEach(() => {
    unexpectedRequests = [];
    releaseResponses = [];
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept({ method: 'GET', pathname: '/api/workspace/5/settings/*' }, { body: { value: '{"enabled":false}' } });
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/coding/reset-version/active' }, {
      body: { hasActiveJob: false }
    }).as('activeReset');
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/coding/readiness' }, {
      body: null
    }).as('readiness');
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/token/*' }, {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify('synthetic-replay-token')
    });
  });

  afterEach(() => {
    releaseResponses.splice(0).forEach(release => release());
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  function createResponseGate(): { wait: Promise<void>; release: () => void } {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    releaseResponses.push(release);
    return { wait, release };
  }

  function openManagement(): void {
    cy.visit('/');
    cy.wait('@authData');
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/coding/management'; });
    cy.wait(['@activeReset', '@readiness']);
    cy.get('coding-box-coding-management .action-buttons-toolbar').should('be.visible');
  }

  function loadStatistics(): void {
    cy.intercept({ method: 'POST', pathname: '/api/admin/workspace/5/coding/statistics/job' }, {
      body: { jobId: '', message: 'Use cached statistics' }
    });
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/coding/statistics' }, {
      delay: 300, body: { totalResponses: 1, statusCounts: { CODING_COMPLETE: 1 } }
    }).as('statistics');
    cy.get('coding-box-statistics-card .statistics-load-button').click();
    cy.wait('@statistics');
    cy.get('coding-box-statistics-card .statistics-card').should('be.visible');
  }

  it('renders delayed distribution rows and updates the page without another interaction', () => {
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/coding/variable-analysis' }, request => {
      const page = Number(request.query.page);
      request.reply({ delay: 800, body: {
        data: [{
          replayUrl: '/replay', unitId: `UNIT_${page}`, variableId: 'VAR',
          derivation: '', code: '1', description: 'Correct', score: 1,
          occurrenceCount: 3, totalCount: 4, relativeOccurrence: 0.75
        }],
        total: 201, page, limit: 200
      } });
    }).as('analysis');

    openManagement();
    cy.contains('coding-box-coding-management .action-buttons-toolbar button', 'Code-/Score-Verteilung').click();
    cy.get('coding-box-variable-analysis-dialog').as('dialog');
    cy.get('@dialog').find('.loading-container').should('be.visible');
    cy.wait('@analysis').its('request.query.page').should('equal', '1');
    cy.get('@dialog').find('.loading-container').should('not.exist');
    cy.get('@dialog').find('table').should('contain.text', 'UNIT_1');
    cy.get('@dialog').find('.result-context-number').should('have.text', '201');
    cy.get('@dialog').find('mat-paginator button[aria-label="Nächste Seite"]').click();
    cy.get('@dialog').find('.loading-container').should('be.visible');
    cy.wait('@analysis').its('request.query.page').should('equal', '2');
    cy.get('@dialog').find('.loading-container').should('not.exist');
    cy.get('@dialog').find('table').should('contain.text', 'UNIT_2').and('not.contain.text', 'UNIT_1');
    cy.get('@dialog').find('.mat-mdc-paginator-range-label').should('contain.text', '201 - 201 von 201');
  });


  function distribution(unitId: string) {
    return {
      data: [{ replayUrl: '/replay', unitId, variableId: 'VAR', derivation: '', code: '1',
        description: 'Correct', score: 1, occurrenceCount: 3, totalCount: 4, relativeOccurrence: 0.75 }],
      total: 1, page: 1, limit: 200
    };
  }

  it('applies successive debounced filters while an older response is held', () => {
    const old = createResponseGate();
    let oldStarted = false;
    let oldReleased = false;
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/coding/variable-analysis' }, async request => {
      const unitId = String(request.query.unitId || 'INITIAL');
      if (unitId === 'FIRST') {
        oldStarted = true;
        await old.wait;
        request.reply({ body: distribution('STALE_FIRST') });
        oldReleased = true;
      } else {
        request.alias = unitId === 'SECOND' ? 'latestFilter' : 'initialDistribution';
        request.reply({ body: distribution(unitId) });
      }
    });
    openManagement();
    cy.contains('coding-box-coding-management .action-buttons-toolbar button', 'Code-/Score-Verteilung').click();
    cy.wait('@initialDistribution');
    cy.get('coding-box-variable-analysis-dialog').as('dialog');
    cy.get('@dialog').find('table').should('contain.text', 'INITIAL');
    cy.get('@dialog').find('input[placeholder="Filter nach Aufgaben-ID"]').type('FIRST');
    cy.wrap(null).should(() => { expect(oldStarted).to.equal(true); });
    cy.get('@dialog').find('.loading-container').should('be.visible');
    cy.get('@dialog').find('input[placeholder="Filter nach Aufgaben-ID"]').clear().type('SECOND');
    cy.wait('@latestFilter').its('request.query.unitId').should('equal', 'SECOND');
    cy.get('@dialog').find('table').should('contain.text', 'SECOND');
    cy.then(() => old.release());
    cy.wrap(null).should(() => { expect(oldReleased).to.equal(true); });
    cy.get('@dialog').find('table').should('contain.text', 'SECOND').and('not.contain.text', 'STALE_FIRST');
  });

  it('keeps a reopened distribution dialog independent of the closed dialog request', () => {
    const old = createResponseGate();
    let requests = 0;
    let oldReleased = false;
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/coding/variable-analysis' }, async request => {
      requests += 1;
      if (requests === 1) {
        await old.wait;
        request.reply({ body: distribution('CLOSED_DIALOG') });
        oldReleased = true;
      } else {
        request.alias = 'reopenedDistribution';
        request.reply({ body: distribution('REOPENED_DIALOG') });
      }
    });
    openManagement();
    cy.contains('coding-box-coding-management .action-buttons-toolbar button', 'Code-/Score-Verteilung').click();
    cy.get('coding-box-variable-analysis-dialog .loading-container').should('be.visible');
    cy.wrap(null).should(() => { expect(requests).to.equal(1); });
    cy.contains('coding-box-variable-analysis-dialog .dialog-actions button', 'Schließen').click();
    cy.get('coding-box-variable-analysis-dialog').should('not.exist');
    cy.contains('coding-box-coding-management .action-buttons-toolbar button', 'Code-/Score-Verteilung').click();
    cy.wait('@reopenedDistribution');
    cy.get('coding-box-variable-analysis-dialog table').should('contain.text', 'REOPENED_DIALOG');
    cy.then(() => old.release());
    cy.wrap(null).should(() => { expect(oldReleased).to.equal(true); });
    cy.get('coding-box-variable-analysis-dialog table')
      .should('contain.text', 'REOPENED_DIALOG').and('not.contain.text', 'CLOSED_DIALOG');
  });

  for (const outcome of ['loaded', 'failed']) {
    it(`settles the delayed ${outcome} Missing profiles and download button`, () => {
      const profilesGate = createResponseGate();
      cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/coding/export-missings-profiles' }, async request => {
        await profilesGate.wait;
        request.reply({
          delay: 300,
          statusCode: outcome === 'failed' ? 500 : 200,
          body: outcome === 'failed' ? { message: 'Synthetic profile failure' } : [
            { id: 7, label: 'Custom Missing profile' }, { id: 4, label: 'IQB-Standard' }
          ]
        });
      }).as('profiles');

      openManagement();
      loadStatistics();
      cy.get('coding-box-statistics-card .download-results-button').click();
      cy.get('coding-box-download-coding-results-dialog').as('dialog');
      cy.get('@dialog').find('.profile-hint').scrollIntoView().should('be.visible');
      cy.get('@dialog').find('mat-select').should('have.attr', 'aria-disabled', 'true');
      cy.get('@dialog').contains('button', 'Herunterladen').should('be.disabled');
      cy.then(() => { profilesGate.release(); });
      cy.wait('@profiles');
      cy.get('@dialog').find('.profile-hint').should('not.exist');
      if (outcome === 'loaded') {
        cy.get('@dialog').find('mat-select').should('contain.text', 'IQB-Standard')
          .and('have.attr', 'aria-disabled', 'false');
        cy.get('@dialog').contains('button', 'Herunterladen').should('not.be.disabled');
      } else {
        cy.get('@dialog').find('.profile-error').should('exist')
          .and('contain.text', 'Die Missing-Profile konnten nicht geladen werden.');
        cy.get('@dialog').contains('button', 'Herunterladen').should('be.disabled');
      }
    });
  }

  it('shows a parsing error and allows a valid Excel upload retry without another interaction', () => {
    const validationGate = createResponseGate();
    const combination = {
      unit_key: 'UNIT', login_name: 'synthetic-login', login_code: 'synthetic-code',
      booklet_id: 'BOOKLET', variable_id: 'VAR'
    };
    cy.intercept({ method: 'POST', pathname: '/api/admin/workspace/5/coding/validate-completeness' }, async request => {
      expect(request.body).to.deep.equal({ expectedCombinations: [combination], page: 1, pageSize: 50 });
      await validationGate.wait;
      request.reply({ delay: 800, body: {
        results: [{ combination, status: 'EXISTS', responseFound: true, issues: [] }],
        total: 1, missing: 0, currentPage: 1, pageSize: 50, totalPages: 1,
        hasNextPage: false, hasPreviousPage: false, cacheKey: 'retry-validation'
      } });
    }).as('validationRetry');

    openManagement();
    cy.contains('coding-box-coding-management .action-buttons-toolbar button', 'Kodierliste').click();
    cy.get('coding-box-export-dialog').as('exportDialog');
    cy.get('@exportDialog').find('input[type="file"]').selectFile({
      contents: Cypress.Buffer.from('Invalid workbook'), fileName: 'invalid.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }, { force: true });
    cy.get('@exportDialog').find('.validation-error-section')
      .should('exist').and('contain.text', 'Fehler beim Parsen der Excel-Datei');
    cy.get('@exportDialog').find('.validation-progress-section').should('not.exist');
    cy.get('@exportDialog').find('.validation-controls button').should('be.enabled');
    cy.get('@exportDialog').find('.validation-error-section button').should('be.enabled');
    // Establish async rendering before scrolling the newly rendered error into view.
    cy.get('@exportDialog').find('.validation-error-section').scrollIntoView().should('be.visible');

    cy.then(async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Coding list');
      worksheet.addRow(['unit_key', 'login_name', 'login_code', 'booklet_id', 'variable_id']);
      worksheet.addRow(Object.values(combination));
      return Cypress.Buffer.from(await workbook.xlsx.writeBuffer());
    }).then(contents => {
      cy.get('@exportDialog').find('input[type="file"]').selectFile({
        contents, fileName: 'valid-retry.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }, { force: true });
    });
    cy.get('@exportDialog').find('.validation-error-section').should('not.exist');
    cy.get('@exportDialog').find('.validation-progress-section').should('exist');
    cy.get('@exportDialog').find('.validation-progress-section h4').scrollIntoView().should('be.visible');
    cy.get('@exportDialog').find('.validation-controls button').should('be.disabled');
    cy.then(() => { validationGate.release(); });
    cy.wait('@validationRetry');
    cy.get('coding-box-coding-validation-results-dialog').should('exist');
    cy.get('coding-box-coding-validation-results-dialog .results-table').should('be.visible');
    cy.get('coding-box-coding-validation-results-dialog .results-table tbody tr')
      .should('have.length', 1).and('contain.text', 'UNIT');
    cy.get('@exportDialog').find('.validation-progress-section').should('not.exist');
    cy.get('@exportDialog').find('.validation-results-section').should('exist');
  });

  it('renders delayed completeness pagination after uploading an Excel coding list', () => {
    const combinations = Array.from({ length: 51 }, (_, index) => ({
      unit_key: `UNIT_${index + 1}`, login_name: 'synthetic-login', login_code: 'synthetic-code',
      booklet_id: 'BOOKLET', variable_id: 'VAR'
    }));
    cy.intercept({ method: 'POST', pathname: '/api/admin/workspace/5/coding/validate-completeness' }, request => {
      const page = request.body.page;
      expect(request.body.expectedCombinations).to.have.length(51);
      expect(request.body.pageSize).to.equal(50);
      request.reply({ delay: page === 1 ? 300 : 800, body: {
        results: combinations.slice((page - 1) * 50, page * 50).map(combination => ({
          combination, status: 'EXISTS', issues: []
        })),
        total: 51, missing: 0, currentPage: page, pageSize: 50, totalPages: 2,
        hasNextPage: page === 1, hasPreviousPage: page === 2, cacheKey: `validation-page-${page}`
      } });
    }).as('validation');

    openManagement();
    cy.contains('coding-box-coding-management .action-buttons-toolbar button', 'Kodierliste').click();
    cy.then(async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Coding list');
      worksheet.addRow(['unit_key', 'login_name', 'login_code', 'booklet_id', 'variable_id']);
      combinations.forEach(combination => worksheet.addRow(Object.values(combination)));
      return Cypress.Buffer.from(await workbook.xlsx.writeBuffer());
    }).then(contents => {
      cy.get('coding-box-export-dialog input[type="file"]').selectFile({
        contents, fileName: 'synthetic-coding-list.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }, { force: true });
    });
    cy.wait('@validation').its('request.body.page').should('equal', 1);
    cy.get('coding-box-coding-validation-results-dialog').as('dialog');
    cy.get('@dialog').find('.pagination-info').first().should('contain.text', 'Seite 1 von 2');
    cy.get('@dialog').find('.pagination-controls').first().contains('button', 'Nächste').click();
    cy.get('@dialog').contains('button', 'Als Excel herunterladen').should('be.disabled');
    cy.wait('@validation').its('request.body.page').should('equal', 2);
    cy.get('@dialog').find('.pagination-info').first().should('contain.text', 'Seite 2 von 2');
    cy.get('@dialog').find('.results-table tbody tr').should('have.length', 1).and('contain.text', 'UNIT_51');
    cy.get('@dialog').contains('button', 'Als Excel herunterladen').should('not.be.disabled');
    cy.get('@dialog').find('.pagination-controls').first().contains('button', 'Nächste').should('be.disabled');
  });

  it('loads lazy review iframes after delayed URLs, including an item scrolled into view', { defaultCommandTimeout: 10000 }, () => {
    const firstReplayGate = createResponseGate();
    const secondReplayGate = createResponseGate();
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/responses/geogebra-existence' }, { body: true });
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/responses/search' }, {
      delay: 300, body: {
        data: [101, 102].map(responseId => ({
          responseId, variableId: 'VAR', value: 'Synthetic response', status: 'VALUE_CHANGED',
          code: responseId, score: 1, codedStatus: 'CODING_COMPLETE', unitId: 1,
          unitName: 'UNIT', unitAlias: null, bookletId: 1, bookletName: 'BOOKLET',
          personId: responseId, personLogin: `synthetic-login-${responseId}`,
          personCode: 'synthetic-code', personGroup: 'synthetic-group'
        })), total: 2
      }
    }).as('responses');
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/coding/responses/*/replay-url' }, async request => {
      const responseId = request.url.match(/\/responses\/(\d+)\/replay-url/)?.[1];
      request.alias = responseId === '101' ? 'firstReplay' : 'secondReplay';
      await (responseId === '101' ? firstReplayGate.wait : secondReplayGate.wait);
      request.reply({ delay: 300, body: { replayUrl: `/zoneless-review-player.html?response=${responseId}` } });
    }).as('replayUrl');
    cy.intercept({ method: 'GET', pathname: '/zoneless-review-player.html' }, {
      headers: { 'Content-Type': 'text/html' }, body: '<!doctype html><title>Synthetic replay</title>'
    });

    openManagement();
    cy.get('coding-box-response-filters .filter-checkbox input').check();
    cy.wait('@responses');
    cy.contains('coding-box-response-table button', 'Review').click();
    cy.get('coding-box-review-list-dialog').as('dialog');
    cy.get('@dialog').find('.review-item').first().scrollIntoView();
    cy.get('@dialog').find('.review-item').first().find('.loading-overlay').should('exist');
    cy.then(() => { firstReplayGate.release(); });
    cy.wait('@firstReplay').its('request.url').should('include', '/responses/101/replay-url');
    cy.get('@dialog').find('.review-item').first().find('.loading-overlay').should('not.exist');
    cy.get('@dialog').find('.review-item').first().find('iframe').should('have.attr', 'src')
      .and('include', 'response=101');
    cy.get('@dialog').find('.review-item').eq(1).scrollIntoView();
    cy.get('@dialog').find('.review-item').eq(1).find('.loading-overlay').should('exist');
    cy.then(() => { secondReplayGate.release(); });
    cy.wait('@secondReplay').its('request.url').should('include', '/responses/102/replay-url');
    cy.get('@dialog').find('.review-item').eq(1).find('.loading-overlay').should('not.exist');
    cy.get('@dialog').find('.review-item').eq(1).find('iframe').should('have.attr', 'src')
      .and('include', 'response=102');
  });
});
