describe('Filtered coding version reset', () => {
  let unexpectedRequests: string[];

  beforeEach(() => {
    unexpectedRequests = [];
    cy.viewport(1366, 768);
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/active', {
      body: { hasActiveJob: false }
    }).as('activeReset');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/readiness?*', { body: null });
    cy.intercept({ method: 'POST', pathname: '/api/admin/workspace/5/coding/statistics/job' }, {
      body: { jobId: '', message: 'Use cached statistics' }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/statistics?*', {
      body: { totalResponses: 2, statusCounts: { CODING_COMPLETE: 2 } }
    }).as('statistics');
    cy.visit('/');
    cy.wait('@authData');
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/coding/management'; });
    cy.wait('@activeReset');
    cy.get('coding-box-statistics-card .statistics-load-button').click();
    cy.wait('@statistics');
    cy.get('coding-box-statistics-card .reset-version-button').click();
    cy.get('coding-box-reset-version-dialog').as('dialog');
  });

  afterEach(() => {
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  function expectConfirmationVisible(): void {
    cy.get('@dialog').find('.confirmation-footer').should('be.visible').should(footer => {
      const element = footer[0];
      const viewport = element.ownerDocument.defaultView!;
      const bounds = element.getBoundingClientRect();
      expect(bounds.top, 'confirmation top').to.be.at.least(0);
      expect(bounds.bottom, 'confirmation bottom').to.be.at.most(viewport.innerHeight);
      expect(bounds.left, 'confirmation left').to.be.at.least(0);
      expect(bounds.right, 'confirmation right').to.be.at.most(viewport.innerWidth);
    });
    cy.get('@dialog').find('.confirmation-footer .scope-summary').should('be.visible');
    cy.get('@dialog').find('.confirmation-footer .confirmation-cascade').should('be.visible');
    cy.get('@dialog').find('.confirm-button').should('be.visible');
  }

  it('resets v1 for DHB003 only and keeps progress and completion feedback', () => {
    let complete = false;
    cy.intercept('POST', '**/api/admin/workspace/5/coding/reset-version', {
      body: { jobId: 'reset-1', message: 'Started' }
    }).as('reset');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/job/reset-1', request => {
      request.reply({ body: complete ? {
        status: 'completed', progress: 100,
        result: { affectedResponseCount: 1, cascadeResetVersions: ['v2', 'v3'], message: 'Completed' }
      } : { status: 'processing', progress: 42 } });
    });

    cy.get('@dialog').contains('mat-radio-button', 'Gefilterter Reset').click();
    cy.get('@dialog').find('.confirm-button').should('be.disabled');
    cy.get('@dialog').find('[data-cy="reset-unit-filters"]').type(' DHB003; DHB003');
    expectConfirmationVisible();
    cy.get('@dialog').find('.scope-summary').should('be.visible').and('contain.text', 'Units: DHB003')
      .and('contain.text', 'alle Variablen der betroffenen Units');
    cy.get('@dialog').find('.confirmation-cascade').should('contain.text', 'Reset: v1 · Kaskade: v2, v3');
    cy.screenshot('filtered-reset-DHB003');
    cy.get('@dialog').find('.confirm-button').should('contain.text', 'Gefilterten Bereich zurücksetzen').click();

    cy.wait('@reset').its('request.body').should('deep.equal', {
      version: 'v1', unitFilters: ['DHB003'], variableFilters: []
    });
    cy.get('coding-box-reset-version-dialog').should('not.exist');
    cy.get('coding-box-statistics-card .reset-progress-label').should('contain.text', '42%');
    cy.get('coding-box-statistics-card .reset-version-button').should('be.disabled');
    cy.then(() => { complete = true; });
    cy.get('coding-box-statistics-card .reset-progress-label').should('not.exist');
    cy.get('coding-box-statistics-card .reset-version-button').should('be.enabled');
    cy.contains('1 Antworten zurückgesetzt (+ v2, v3)').should('be.visible');
  });

  it('shows and sends the combined unit and variable scope', () => {
    cy.intercept('POST', '**/api/admin/workspace/5/coding/reset-version', {
      body: { jobId: 'reset-2', message: 'Started' }
    }).as('reset');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/job/reset-2', {
      body: { status: 'processing', progress: 10 }
    });
    cy.get('@dialog').contains('mat-radio-button', 'Gefilterter Reset').click();
    cy.get('@dialog').find('[data-cy="reset-unit-filters"]').type('DHB003');
    cy.get('@dialog').find('[data-cy="reset-variable-filters"]').type('V1; V2');
    cy.get('@dialog').find('.scope-summary').should('contain.text', 'Units: DHB003')
      .and('contain.text', 'Variablen: V1, V2');
    cy.get('@dialog').find('.filter-fields').should('contain.text', 'Unit und Variable übereinstimmen');
    cy.get('@dialog').find('.confirm-button').click();
    cy.wait('@reset').its('request.body').should('deep.equal', {
      version: 'v1', unitFilters: ['DHB003'], variableFilters: ['V1', 'V2']
    });
  });

  it('clearly confirms a global reset and ignores previously entered filters', () => {
    cy.intercept('POST', '**/api/admin/workspace/5/coding/reset-version', {
      body: { jobId: 'reset-3', message: 'Started' }
    }).as('reset');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/job/reset-3', {
      body: { status: 'processing', progress: 10 }
    });
    cy.get('@dialog').contains('mat-radio-button', 'Gefilterter Reset').click();
    cy.get('@dialog').find('[data-cy="reset-unit-filters"]').type('DHB003');
    cy.get('@dialog').contains('mat-radio-button', 'Globaler Reset').click();
    cy.get('@dialog').find('.scope-summary').should('contain.text', 'Globaler Reset')
      .and('contain.text', 'gesamter Arbeitsbereich').and('not.contain.text', 'DHB003');
    expectConfirmationVisible();
    cy.get('@dialog').find('.confirm-button').should('contain.text', 'Gesamten Arbeitsbereich zurücksetzen').click();
    cy.wait('@reset').its('request.body').should('deep.equal', {
      version: 'v1', unitFilters: [], variableFilters: []
    });
  });

  it('does not start a reset when cancelled', () => {
    cy.intercept('POST', '**/api/admin/workspace/5/coding/reset-version', {
      body: { jobId: 'unexpected', message: 'Unexpected reset' }
    }).as('reset');
    cy.get('@dialog').contains('mat-radio-button', 'Gefilterter Reset').click();
    cy.get('@dialog').find('[data-cy="reset-unit-filters"]').type('DHB003');
    cy.get('@dialog').contains('button', 'Abbrechen').click();
    cy.get('coding-box-reset-version-dialog').should('not.exist');
    cy.get('@reset.all').should('have.length', 0);
  });

  for (const [width, height] of [[1366, 768], [390, 844], [320, 568]]) {
    it(`keeps the scope and cascade visible while scrolling at ${width}x${height}`, () => {
      cy.viewport(width, height);
      expectConfirmationVisible();
      cy.get('@dialog').contains('mat-radio-button', 'Gefilterter Reset').click();
      cy.get('@dialog').find('[data-cy="reset-unit-filters"]').type('DHB003');
      cy.get('@dialog').find('[data-cy="reset-variable-filters"]').type('V1; V2');
      cy.get('@dialog').find('.scope-summary').should('contain.text', 'Units: DHB003')
        .and('contain.text', 'Variablen: V1, V2');
      cy.get('@dialog').find('.confirm-button').should('be.enabled');
      expectConfirmationVisible();
      cy.get('@dialog').find('.dialog-content').scrollTo('bottom');
      expectConfirmationVisible();
      cy.get('@dialog').find('.dialog-content').scrollTo('top');
      expectConfirmationVisible();
    });
  }

  it('keeps confirmation visible for long filter lists and exposes the full values', () => {
    const units = Array.from({ length: 30 }, (_, index) => `DHB${String(index).padStart(3, '0')}`);
    const variables = Array.from({ length: 30 }, (_, index) => `VAR_${index}`);
    cy.get('@dialog').contains('mat-radio-button', 'Gefilterter Reset').click();
    cy.get('@dialog').find('[data-cy="reset-unit-filters"]').type(units.join('; '), { delay: 0 });
    cy.get('@dialog').find('[data-cy="reset-variable-filters"]').type(variables.join('; '), { delay: 0 });
    expectConfirmationVisible();
    cy.get('@dialog').find('.scope-filter-line').first()
      .should('have.attr', 'title', `Units: ${units.join(', ')}`);
    cy.get('@dialog').find('.scope-filter-line').last()
      .should('have.attr', 'title', `Variablen: ${variables.join(', ')}`);
  });
});
