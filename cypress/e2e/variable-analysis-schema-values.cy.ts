describe('Antwortwerte aus dem Kodierschema', () => {
  it('shows observed schema answers and toggles missing alternatives without changing their counts', () => {
    cy.viewport(1400, 900);
    const frequencies = [
      { unitId: 1, variableId: 'ANIMALS', value: 'Hai', score: 1, count: 2, percentage: 200 / 3, isFromSchema: true },
      { unitId: 1, variableId: 'ANIMALS', value: 'Elefant', score: 0, count: 1, percentage: 100 / 3, isFromSchema: true },
      { unitId: 1, variableId: 'ANIMALS', value: 'Zebra', score: 0, count: 0, percentage: 0, isFromSchema: true, isSchemaOnly: true }
    ];
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', { body: { data: [], total: 0 } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', {
      body: { testPersons: 1, testGroups: 1, uniqueBooklets: 1, uniqueUnits: 1, uniqueResponses: 3 }
    }).as('overview');
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/variable-analysis/jobs', { body: [{
      id: 'job-1', type: 'variable-analysis', status: 'completed',
      created_at: '2026-10-29T12:00:00Z', updated_at: '2026-10-29T12:00:00Z'
    }] });
    cy.intercept('GET', '**/api/admin/workspace/5/variable-analysis/jobs/job-1/results/page?*', request => {
      request.reply({ body: {
        variableCombos: [{ unitId: 1, unitName: 'Tiere', variableId: 'ANIMALS', totalCount: 3, validCount: 3, distinctValueCount: 2 }],
        frequencies: { '1:ANIMALS': frequencies.filter(row => request.query.includeSchemaCodes === 'true' || row.count > 0) },
        total: 1, unfilteredTotal: 1, page: 1, pageSize: 50, totalPages: 1
      } });
    }).as('answers');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(window => { window.location.hash = '/workspace-admin/5/test-results'; });
    cy.wait('@overview');
    cy.contains('button', 'Antwortwertanalyse').click();
    cy.wait('@answers');

    cy.contains('tr', 'Hai').as('shark');
    cy.get('@shark').find('.schema-chip').should('contain.text', 'Schema');
    cy.get('@shark').find('.mat-column-score').should('contain.text', '1');
    cy.get('@shark').find('.mat-column-count').should('contain.text', '2');
    cy.contains('tr', 'Elefant').find('.mat-column-score').should('contain.text', '0');
    cy.contains('tr', 'Zebra').should('not.exist');
    cy.contains('mat-slide-toggle', 'Nicht beobachtete Antwortwerte aus dem Kodierschema anzeigen').click();
    cy.wait('@answers').its('request.query.includeSchemaCodes').should('equal', 'true');
    cy.contains('tr', 'Zebra').as('zebra');
    cy.get('@zebra').find('.mat-column-count').should('contain.text', '0');
    cy.get('@zebra').find('.schema-chip').should('contain.text', 'Schema');
    cy.contains('button', 'Erklärung anzeigen').click();
    cy.get('.info-block').should('contain.text', 'Kodierschema ordnet Antworten')
      .and('contain.text', 'Score 0 kann gültig sein');
    cy.contains('mat-slide-toggle', 'Nicht beobachtete Antwortwerte aus dem Kodierschema anzeigen').click();
    cy.contains('tr', 'Zebra').should('not.exist');
    cy.wait('@answers').its('request.query').should('not.have.property', 'includeSchemaCodes');
    cy.get('@shark').find('.mat-column-count').should('contain.text', '2');
    cy.window().should('not.have.property', 'Zone');
  });
});
