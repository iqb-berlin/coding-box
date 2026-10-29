describe('Answer-value and assigned-code analysis', () => {
  it('starts a separate code analysis for the chosen run and displays its denominators and metadata', () => {
    cy.viewport(1800, 1000);
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', { body: { data: [], total: 0 } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', {
      body: { testPersons: 4, testGroups: 1, uniqueBooklets: 1, uniqueUnits: 1, uniqueResponses: 4 }
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
    const rawCombo = { unitId: 1, unitName: 'UNIT', variableId: 'VAR', analysisMode: 'values', totalCount: 4, validCount: 4, invalidCount: 0, emptyCount: 0, emptyPercentage: 0, distinctValueCount: 1 };
    cy.intercept('GET', '**/variable-analysis/jobs/values-job/results/page?*', { body: {
      total: 1, unfilteredTotal: 1, page: 1, pageSize: 50, totalPages: 1,
      variableCombos: [rawCombo],
      frequencies: { '1:VAR': [{ unitId: 1, variableId: 'VAR', value: 'raw', label: 'Rohwert', count: 4, percentage: 100 }] }
    } }).as('rawResults');
    const codeCombo = { ...rawCombo, analysisMode: 'codes', codingVersion: 'v2', validCount: 3, invalidCount: 1, distinctValueCount: 2, statusCounts: [{ status: 5, count: 3, percentage: 75 }, { status: 7, count: 1, percentage: 25 }] };
    const codeFrequencies = [
      { unitId: 1, variableId: 'VAR', value: '0', label: 'Falsch', score: 0, count: 2, validOccurrenceCount: 2, percentage: 50, percentageTotal: 50, percentageValid: (2 / 3) * 100 },
      { unitId: 1, variableId: 'VAR', value: '1', label: 'Richtig', count: 2, validOccurrenceCount: 1, percentage: 50, percentageTotal: 50, percentageValid: (1 / 3) * 100 }
    ];
    cy.intercept('GET', '**/variable-analysis/jobs/codes-job/results/page?*', { body: {
      total: 1, unfilteredTotal: 1, page: 1, pageSize: 50, totalPages: 1,
      variableCombos: [codeCombo], frequencies: { '1:VAR': codeFrequencies },
      rows: codeFrequencies.map(frequency => ({ ...codeCombo, ...frequency, hiddenValueCount: 0, statusSummary: 'CODING_COMPLETE: 3 (75%), INVALID: 1 (25%)' }))
    } }).as('codeResults');
    cy.intercept('GET', '**/variable-analysis/jobs/codes-job/results/export/csv', {
      headers: { 'content-type': 'text/csv' }, body: 'Auswertung;Kodierlauf;Code\nCodes;v2;0'
    }).as('exportCsv');

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-results'; });
    cy.wait('@overview');
    cy.contains('button', 'Antwortwertanalyse').click();
    cy.wait('@rawResults');
    cy.get('coding-box-variable-analysis-dialog').as('dialog');
    cy.get('@dialog').find('.analysis-table').should('contain.text', 'Antwortwert/Kategorie').and('contain.text', 'Rohwert');
    cy.get('@dialog').find('.analysis-table .mat-column-score').should('not.exist');
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
      cy.get('.mat-column-score').should('have.text', '0');
      cy.get('.mat-column-invalidCount').should('have.text', '1');
      cy.get('.mat-column-percentageTotal').should('contain.text', '50');
      cy.get('.mat-column-percentageValid').should('contain.text', '66.7');
    });
    cy.get('@dialog').find('.variable-status-overview summary').click();
    cy.get('@dialog').find('.variable-status-entry').should('have.length', 1).and('contain.text', 'CODING_COMPLETE').and('contain.text', 'INVALID');
    cy.get('@dialog').find('.analysis-table .mat-column-statusSummary').should('not.exist');
    cy.get('@dialog').contains('.top-actions button', 'CSV').click();
    cy.wait('@exportCsv');
    cy.readFile(`cypress/downloads/variable-analysis-5-codes-v2-${new Date().toISOString().slice(0, 10)}.csv`).should('contain', 'Codes;v2;0');
  });
});
