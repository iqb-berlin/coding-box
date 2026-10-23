// Browser flow with a paginated API fixture; PostgreSQL expansion is covered in
// group-deletion.postgres.spec.ts using the production service and real queries.
describe('test-result group deletion over multiple pages', () => {
  it('clears page selections and submits the filter after previewing whole groups', () => {
    let rows = Array.from({ length: 130 }, (_, index) => ({
      id: index + 1,
      code: [0, 65].includes(index) ? 'needle' : `P${index + 1}`,
      login: 'login',
      group: index < 65 ? 'G1' : 'G2',
      uploaded_at: '2026-01-01T00:00:00Z'
    }));
    let previewRequest: { scope: string; searchText?: string; groups?: string[] };
    const preview = (request: typeof previewRequest) => {
      const searchText = request.searchText || '';
      const matches = rows.filter(row =>
        [row.code, row.group, row.login].some(value => value.includes(searchText)));
      const groups = request.scope === 'groups' ? request.groups || [] : [...new Set(matches.map(row => row.group))];
      const targets = request.scope === 'filteredPersons' ? matches : rows.filter(row => groups.includes(row.group));
      return {
        scope: request.scope, label: 'Gruppen mit Filtertreffern einschließlich aller Gruppenmitglieder',
        persons: targets.length, groups: [...new Set(targets.map(row => row.group))],
        booklets: 0, units: 0, responses: 0, bookletNames: [], unitNames: [], warnings: []
      };
    };
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', request => request.reply({ body: {
      testPersons: rows.length, testGroups: rows.length ? 2 : 0,
      uniqueBooklets: 0, uniqueUnits: 0, uniqueResponses: 0,
      responseStatusCounts: {}, sessionBrowserCounts: {}, sessionOsCounts: {}, sessionScreenCounts: {}
    } })).as('overview');
    cy.intercept('GET', /\/api\/admin\/workspace\/5\/test-results\/\?/, request => {
      const url = new URL(request.url);
      const page = Number(url.searchParams.get('page'));
      const limit = Number(url.searchParams.get('limit'));
      const search = url.searchParams.get('searchText') || '';
      const matches = rows.filter(row => [row.code, row.group, row.login].some(value => value.includes(search)));
      request.reply({ data: matches.slice(page * limit, (page + 1) * limit), total: matches.length });
    }).as('persons');
    cy.intercept('POST', '**/api/admin/workspace/5/test-results/delete-preview', request => {
      previewRequest = request.body;
      request.reply(preview(request.body));
    }).as('preview');
    cy.intercept('POST', '**/api/admin/workspace/5/test-results/delete-jobs', request => {
      expect(request.body).to.deep.equal(previewRequest);
      expect(request.body).to.deep.equal({ scope: 'filteredGroups', searchText: 'needle' });
      rows = [];
      request.reply({ id: 1028, status: 'pending', progress: 0 });
    }).as('delete');
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/1028', {
      body: { id: 1028, status: 'completed', progress: 100 }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/1028/results', {
      body: { deletedTargetCount: 130 }
    });

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-results'; });
    cy.wait(['@overview', '@persons']);
    cy.get('.persons-table mat-row').should('have.length', 50);
    cy.get('.persons-table mat-header-cell input[type=checkbox]').check({ force: true }).should('be.checked');
    cy.contains('button', 'Gruppen der Auswahl löschen').click();
    cy.wait('@preview').its('request.body').should('deep.equal', { scope: 'groups', groups: ['G1'] });
    cy.get('coding-box-test-results-delete-preview-dialog').contains('.metric', 'Testpersonen').should('contain.text', '65');
    cy.contains('button', 'Abbrechen').click();

    cy.get('.mat-mdc-paginator-navigation-next').click();
    cy.wait('@persons');
    cy.get('.persons-table mat-row').first().should('contain.text', 'P51');
    cy.get('.persons-table mat-header-cell input[type=checkbox]').should('not.be.checked');
    cy.get('.persons-table mat-cell input[type=checkbox]:checked').should('have.length', 0);
    cy.get('.persons-table mat-header-cell input[type=checkbox]').check({ force: true });
    cy.get('.search-input').type('needle');
    cy.wait('@persons');
    cy.get('.persons-table mat-row').should('have.length', 2);
    cy.get('.persons-table mat-header-cell input[type=checkbox]').should('not.be.checked');
    cy.contains('button', 'Gruppen der Auswahl löschen').should('be.disabled');
    cy.get('.search-input').type('x{backspace}');
    cy.contains('button', 'Alle gefilterten Gruppen löschen').should('be.enabled');

    cy.contains('button', 'Alle gefilterten Personen löschen').click();
    cy.wait('@preview').its('request.body').should('deep.equal', { scope: 'filteredPersons', searchText: 'needle' });
    cy.get('coding-box-test-results-delete-preview-dialog').contains('.metric', 'Testpersonen').find('.metric-value').should('have.text', '2');
    cy.contains('button', 'Abbrechen').click();
    cy.contains('button', 'Alle gefilterten Gruppen löschen').click();
    cy.wait('@preview');
    cy.get('coding-box-test-results-delete-preview-dialog').within(() => {
      cy.contains('.metric', 'Testpersonen').should('contain.text', '130');
      cy.contains('.detail-label', 'Testgruppen (2)').should('be.visible');
      cy.contains('button', 'Löschung starten').should('be.disabled');
      cy.get('input[type=checkbox]').check({ force: true });
      cy.contains('button', 'Löschung starten').click();
    });
    cy.wait('@delete');
    cy.get('.persons-table mat-row').should('have.length', 0);
    cy.contains('Löschung abgeschlossen: 130 Datensätze verarbeitet.').should('be.visible');
  });
});
