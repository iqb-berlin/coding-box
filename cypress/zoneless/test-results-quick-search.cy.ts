describe('zoneless test-results quick search', () => {
  beforeEach(() => {
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', {
      body: { value: '{"enabled":false}' }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', {
      body: { data: [], total: 0 }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', {
      body: {
        testPersons: 0,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 0,
        uniqueResponses: 0,
        responseStatusCounts: {},
        sessionBrowserCounts: {},
        sessionOsCounts: {},
        sessionScreenCounts: {}
      }
    }).as('overview');
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', { body: [] });
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
  });

  function openSearch(): void {
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(window => { window.location.hash = '/workspace-admin/5/test-results'; });
    cy.wait('@overview');
    cy.get('coding-box-test-results .action-bar').contains('button', 'Schnellsuche').click();
    cy.get('coding-box-test-results-search input').type('P01');
    cy.get('coding-box-test-results-search mat-spinner').should('be.visible');
  }

  it('renders a delayed response without another user interaction', () => {
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/quick-search?*', {
      delay: 700,
      body: {
        query: 'P01',
        limit: 8,
        persons: [{
          kind: 'person', id: 7, label: 'Person P01', personId: 7
        }],
        booklets: [],
        units: [],
        responses: [],
        totals: {
          person: 1, booklet: 0, unit: 0, response: 0
        }
      }
    }).as('search');

    openSearch();
    cy.wait('@search');

    cy.get('coding-box-test-results-search mat-spinner').should('not.exist');
    cy.get('coding-box-test-results-search .result-item').should('contain.text', 'Person P01');
    cy.get('coding-box-test-results-search .type-count').first().should('have.text', '1');
  });

  it('ends loading after a delayed failure', () => {
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/quick-search?*', {
      delay: 700,
      statusCode: 503,
      body: { message: 'Search unavailable' }
    }).as('search');

    openSearch();
    cy.wait('@search');

    cy.get('coding-box-test-results-search mat-spinner').should('not.exist');
    cy.get('coding-box-test-results-search .result-item').should('not.exist');
    cy.get('coding-box-test-results-search').should('contain.text', 'Keine Treffer gefunden.');
  });
});
