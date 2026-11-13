describe('Answer-value and assigned-code analysis', () => {
  it('lets the first analysis select assigned codes and a coding run before creating a job', () => {
    cy.viewport(1800, 1000);
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', { body: { data: [], total: 0 } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', {
      body: { testPersons: 5, testGroups: 1, uniqueBooklets: 1, uniqueUnits: 1, uniqueResponses: 5 }
    }).as('overview');
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/files/unit-variables', { body: [] });
    const job = {
      id: 'first-code-job', type: 'variable-analysis', status: 'pending',
      created_at: new Date().toISOString(), analysisMode: 'codes', codingVersion: 'v2'
    };
    let started = false;
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/variable-analysis/jobs' }, request => {
      request.reply({ body: started ? [job] : [] });
    }).as('jobs');
    cy.intercept({ method: 'POST', pathname: '/api/admin/workspace/5/variable-analysis/jobs' }, request => {
      expect(request.query).to.include({ analysisMode: 'codes', codingVersion: 'v2' });
      started = true;
      request.reply({ body: job });
    }).as('startAnalysis');

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-results'; });
    cy.wait('@overview');
    cy.contains('button', 'Antwortwertanalyse').click();
    cy.wait('@jobs').its('response.body').should('deep.equal', []);
    cy.get('coding-box-variable-analysis-dialog').as('dialog');
    cy.get('@dialog').find('.analysis-options mat-select').first().should('have.attr', 'aria-disabled', 'false').click();
    cy.contains('mat-option', 'Vergebene Codes').click();
    cy.get('@dialog').find('.analysis-options mat-select').eq(1).click();
    cy.contains('mat-option', 'Manuelle Kodierung').click();
    cy.get('@startAnalysis.all').should('have.length', 0);
    cy.get('@dialog').contains('.top-actions button', 'Neue Analyse starten').click();
    cy.wait('@startAnalysis');
    cy.get('@startAnalysis.all').should('have.length', 1);
    cy.get('@dialog').find('.analysis-options mat-select').first().should('have.attr', 'aria-disabled', 'true');
  });

  it('starts a code analysis and preserves its export filename after switching results', () => {
    cy.viewport(1800, 1000);
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', { body: { data: [], total: 0 } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', {
      body: { testPersons: 5, testGroups: 1, uniqueBooklets: 1, uniqueUnits: 1, uniqueResponses: 5 }
    }).as('overview');
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/files/unit-variables', { body: [] });
    const existingJob = { id: 'values-job', type: 'variable-analysis', status: 'completed', created_at: new Date().toISOString(), analysisMode: 'values' };
    const codeJob = { ...existingJob, id: 'codes-job', analysisMode: 'codes', codingVersion: 'v2' };
    let started = false;
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/variable-analysis/jobs' }, request => {
      request.reply({ body: started ? [codeJob, existingJob] : [existingJob] });
    });
    cy.intercept({ method: 'POST', pathname: '/api/admin/workspace/5/variable-analysis/jobs' }, request => {
      expect(request.query).to.include({ analysisMode: 'codes', codingVersion: 'v2' });
      started = true;
      request.reply({ body: { ...codeJob, status: 'pending' } });
    }).as('startAnalysis');
    const rawCombo = { unitId: 1, unitName: 'UNIT', variableId: 'VAR', analysisMode: 'values', totalCount: 5, validCount: 5, invalidCount: 0, emptyCount: 0, emptyPercentage: 0, distinctValueCount: 1 };
    cy.intercept('GET', '**/variable-analysis/jobs/values-job/results/page?*', { body: {
      total: 1, unfilteredTotal: 1, page: 1, pageSize: 50, totalPages: 1,
      variableCombos: [rawCombo],
      frequencies: { '1:VAR': [{ unitId: 1, variableId: 'VAR', value: 'raw', label: 'Rohwert', count: 5, percentage: 100 }] }
    } }).as('rawResults');
    const codeCombo = { ...rawCombo, analysisMode: 'codes', codingVersion: 'v2', totalCount: 5, validCount: 4, invalidCount: 1, distinctValueCount: 4, statusCounts: [{ status: 5, count: 3, percentage: 60 }, { status: 7, count: 1, percentage: 20 }, { status: 12, count: 1, percentage: 20 }] };
    const codeFrequencies = [
      { unitId: 1, variableId: 'VAR', value: '0', label: 'Richtig', score: 1, count: 2, validOccurrenceCount: 2, percentage: 40, percentageTotal: 40, percentageValid: 50 },
      { unitId: 1, variableId: 'VAR', value: '1', label: 'Falsch', score: 0, count: 1, validOccurrenceCount: 1, percentage: 20, percentageTotal: 20, percentageValid: 25 },
      { unitId: 1, variableId: 'VAR', value: '1 (INVALID)', count: 1, validOccurrenceCount: 0, percentage: 20, percentageTotal: 20, percentageValid: 0 },
      { unitId: 1, variableId: 'VAR', value: '0 (INTENDED_INCOMPLETE)', label: 'Unvollständig', score: 0, count: 1, validOccurrenceCount: 1, percentage: 20, percentageTotal: 20, percentageValid: 25 }
    ];
    cy.intercept('GET', '**/variable-analysis/jobs/codes-job/results/page?*', { body: {
      total: 1, unfilteredTotal: 1, page: 1, pageSize: 50, totalPages: 1,
      variableCombos: [codeCombo], frequencies: { '1:VAR': codeFrequencies },
      rows: codeFrequencies.map(frequency => ({ ...codeCombo, ...frequency, hiddenValueCount: 0, statusSummary: 'CODING_COMPLETE: 3 (60%), INVALID: 1 (20%), INTENDED_INCOMPLETE: 1 (20%)' }))
    } }).as('codeResults');
    let exportId = '';
    let exportStarted = false;
    cy.task<{ id: string; url: string }>('deferred:create', {
      headers: { 'content-type': 'text/csv' }, body: 'Auswertung;Kodierlauf;Code\nCodes;v2;0'
    }).then(gate => {
      exportId = gate.id;
      cy.intercept('GET', '**/variable-analysis/jobs/codes-job/results/export/csv', request => {
        exportStarted = true;
        request.url = gate.url;
        request.continue();
      }).as('exportCsv');
    });

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-results'; });
    cy.wait('@overview');
    cy.contains('button', 'Antwortwertanalyse').click();
    cy.wait('@rawResults');
    cy.get('coding-box-variable-analysis-dialog').as('dialog');
    cy.get('@dialog').find('[role="tab"]').first().should('contain.text', 'Analyseergebnisse');
    cy.get('@dialog').find('.analysis-table th.mat-column-totalCount').should('contain.text', 'Antworten gesamt');
    cy.get('@dialog').find('.analysis-table').should('contain.text', 'Antwortwert/Kategorie').and('contain.text', 'Rohwert');
    cy.get('@dialog').find('.analysis-table .mat-column-score').should('exist');
    cy.get('@dialog').find('.analysis-table .mat-column-code').should('exist');
    cy.get('@dialog').find('.analysis-options mat-select').first().click();
    cy.contains('mat-option', 'Vergebene Codes').click();
    cy.get('@dialog').find('.analysis-context').should('contain.text', 'Antwortwerte und Kategorien');
    cy.get('@dialog').find('.analysis-options mat-select').eq(1).click();
    cy.contains('mat-option', 'Manuelle Kodierung').click();
    cy.get('@dialog').contains('.top-actions button', 'Neue Analyse starten').click();
    cy.wait(['@startAnalysis', '@codeResults']);
    cy.get('@dialog').find('.analysis-context').should('contain.text', 'Vergebene Codes').and('contain.text', 'Manuelle Kodierung');
    cy.get('@dialog').find('.analysis-table').should('contain.text', 'Falsch').and('contain.text', 'Richtig').and('contain.text', 'Fehlend/ungültig');
    cy.get('@dialog').find('.analysis-table tbody tr').first().within(() => {
      cy.get('.mat-column-value').should('have.text', '0');
      cy.get('.mat-column-score').should('have.text', '1');
      cy.get('.mat-column-invalidCount').should('have.text', '1');
      cy.get('.mat-column-percentageTotal').should('contain.text', '40');
      cy.get('.mat-column-percentageValid').should('contain.text', '50');
    });
    cy.get('@dialog').contains('.analysis-table tbody tr', '0 (INTENDED_INCOMPLETE)').within(() => {
      cy.get('.mat-column-label').should('contain.text', 'Unvollständig').and('not.contain.text', 'Richtig');
      cy.get('.mat-column-score').should('have.text', '0');
      cy.get('.mat-column-count').should('have.text', '1');
      cy.get('.mat-column-percentageValid').should('contain.text', '25');
    });
    cy.get('@dialog').find('.variable-status-overview summary').click();
    cy.get('@dialog').find('.variable-status-entry').should('have.length', 1).and('contain.text', 'CODING_COMPLETE').and('contain.text', 'INVALID');
    cy.get('@dialog').find('.analysis-table .mat-column-statusSummary').should('not.exist');
    cy.get('@dialog').contains('.top-actions button', 'CSV').click();
    cy.wrap(null).should(() => { expect(exportStarted).to.equal(true); });
    cy.get('@dialog').find('[role="tab"]').eq(1).click();
    cy.get('@dialog').contains('tr', 'values-job').find('button[aria-label="Ergebnisse anzeigen"]').click();
    cy.wait('@rawResults');
    cy.get('@dialog').find('[role="tab"]').first().click();
    cy.get('@dialog').find('.analysis-context').should('contain.text', 'Antwortwerte und Kategorien');
    cy.then(() => cy.task('deferred:release', exportId));
    cy.wait('@exportCsv');
    cy.readFile(`cypress/downloads/variable-analysis-5-codes-v2-${new Date().toISOString().slice(0, 10)}.csv`).should('contain', 'Codes;v2;0');
  });
  [
    { name: 'mixed', totalCount: 3, validCount: 2, emptyCount: 1 },
    { name: 'entirely empty', totalCount: 2, validCount: 0, emptyCount: 2 }
  ].forEach(({ name, totalCount, validCount, emptyCount }) => {
    it(`shows the observed empty row for ${name} multiple responses`, () => {
      cy.viewport(1800, 1000);
      cy.mockKeycloakAuthentication();
      cy.stubWorkspace({ workspaceId: 5 });
      cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
      cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', { body: { data: [], total: 0 } });
      cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', {
        body: { testPersons: totalCount, testGroups: 1, uniqueBooklets: 1, uniqueUnits: 1, uniqueResponses: totalCount }
      }).as('overview');
      cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', { body: [] });
      cy.intercept('GET', '**/api/admin/workspace/5/files/unit-variables', { body: [] });
      cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/variable-analysis/jobs' }, {
        body: [{ id: 'empty-job', type: 'variable-analysis', status: 'completed', created_at: new Date().toISOString(), analysisMode: 'values' }]
      });
      const combo = {
        unitId: 1, unitName: 'MULTI_UNIT', variableId: 'MULTI', analysisMode: 'values',
        totalCount, validCount, invalidCount: emptyCount, emptyCount,
        emptyPercentage: (emptyCount / totalCount) * 100, distinctValueCount: validCount > 0 ? 3 : 1
      };
      const frequencies = [
        { value: '', isEmptyValue: true, count: emptyCount, validOccurrenceCount: 0, percentageTotal: (emptyCount / totalCount) * 100, percentageValid: validCount > 0 ? 0 : null },
        ...(validCount > 0 ? [
          { value: 'A', count: 1, validOccurrenceCount: 1, percentageTotal: 100 / 3, percentageValid: 50 },
          { value: 'B', count: 2, validOccurrenceCount: 2, percentageTotal: 200 / 3, percentageValid: 100 }
        ] : [])
      ];
      cy.intercept('GET', '**/variable-analysis/jobs/empty-job/results/page?*', { body: {
        total: 1, unfilteredTotal: 1, page: 1, pageSize: 50, totalPages: 1,
        variableCombos: [combo], frequencies: { '1:MULTI': frequencies },
        rows: frequencies.map(frequency => ({ ...combo, ...frequency, hiddenValueCount: 0, statusSummary: '' }))
      } }).as('emptyResults');

      cy.visit('/');
      cy.wait('@authData');
      cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-results'; });
      cy.wait('@overview');
      cy.contains('button', 'Antwortwertanalyse').click();
      cy.wait('@emptyResults');
      cy.get('coding-box-variable-analysis-dialog .analysis-table tbody tr').should('have.length', frequencies.length);
      cy.contains('coding-box-variable-analysis-dialog .analysis-table tbody tr', '[Leer]').within(() => {
        cy.get('.mat-column-count').should('have.text', String(emptyCount));
        cy.get('.mat-column-validOccurrenceCount').should('have.text', '0');
        cy.get('.mat-column-totalCount').should('have.text', String(totalCount));
        cy.get('.schema-chip').should('not.exist');
      });
    });
  });
});
