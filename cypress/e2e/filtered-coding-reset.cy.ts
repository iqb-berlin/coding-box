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
    cy.intercept('POST', '**/api/admin/workspace/5/coding/reset-version/preview', { body: { jobId: 'preview-1' } }).as('preview');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/preview/preview-1', { body: {
      status: 'completed', result: { status: 'valid', unknownUnits: [], unknownVariables: [], affectedResponseCount: 1,
        resetResponseCount: 1, deletedGeneratedResponseCount: 0, checkedAt: '2026-11-17T10:00:00Z' }
    } });
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

  function checkScope(): void {
    cy.get('@dialog').find('.check-scope-button').click();
    cy.wait('@preview');
    cy.get('@dialog').find('.confirm-button').should('be.enabled');
  }

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
    cy.get('@dialog').find('.dialog-actions button').each(button => {
      const element = button[0];
      const bounds = element.getBoundingClientRect();
      const container = element.closest('.reset-dialog-container')!.getBoundingClientRect();
      expect(bounds.top, 'button top inside dialog').to.be.at.least(container.top);
      expect(bounds.bottom, 'button bottom inside dialog').to.be.at.most(container.bottom);
      if (!element.hasAttribute('disabled')) {
        const target = element.ownerDocument.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        expect(element.contains(target), 'button receives pointer input').to.equal(true);
      }
    });
    cy.get('@dialog').find('.scope-summary').should(summary => {
      summary[0].querySelectorAll<HTMLElement>('.scope-filter-line').forEach(line => {
        expect(line.scrollWidth, 'full summary width').to.be.at.most(line.clientWidth + 1);
        expect(line.scrollHeight, 'full summary height').to.be.at.most(line.clientHeight + 1);
      });
    });
    cy.get('@dialog').find('.dialog-content').should(content => {
      expect(content[0].scrollWidth, 'form width without horizontal scrolling').to.be.at.most(content[0].clientWidth + 1);
    });
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
    checkScope();
    expectConfirmationVisible();
    cy.get('@dialog').find('.scope-summary').should('be.visible').and('contain.text', 'Units: DHB003')
      .and('contain.text', 'alle Variablen der betroffenen Units');
    cy.get('@dialog').find('.confirmation-cascade').should('contain.text', 'Der 1. Autocoder-Lauf wird zurückgesetzt. Zusätzlich: manuelle Kodierung und 2. Autocoder-Lauf.');
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
    checkScope();
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
    checkScope();
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
      checkScope();
      expectConfirmationVisible();
      cy.get('@dialog').find('.dialog-content').scrollTo('bottom');
      expectConfirmationVisible();
      cy.get('@dialog').find('.dialog-content').scrollTo('top');
      expectConfirmationVisible();
    });
  }

  for (const [width, height] of [[1366, 768], [390, 844], [320, 568]]) {
    it(`exposes all filters in a scrollable dialog at ${width}x${height}`, () => {
      cy.viewport(width, height);
      const units = Array.from({ length: 30 }, (_, index) => `DHB${String(index).padStart(3, '0')}`);
      const variables = Array.from({ length: 30 }, (_, index) => `VAR_${index}`);
      cy.get('@dialog').contains('mat-radio-button', 'Gefilterter Reset').click();
      cy.get('@dialog').find('[data-cy="reset-unit-filters"]').type(units.join('; ')).should('have.value', units.join('; '));
      cy.get('@dialog').find('[data-cy="reset-variable-filters"]').type(variables.join('; ')).should('have.value', variables.join('; '));
      expectConfirmationVisible();
      cy.get('@dialog').find('.scope-summary').should('contain.text', 'Units: 30 ausgewählt')
        .and('contain.text', 'Variablen: 30 ausgewählt');
      cy.get('@dialog').contains('button', 'Alle Filter anzeigen').click();
      cy.get('coding-box-reset-filter-details-dialog').as('details');
      cy.get('@details').find('[data-cy="reset-unit-details"] li').should('have.length', units.length).each((item, index) => {
        expect(item.text()).to.equal(units[index]);
      });
      cy.get('@details').find('[data-cy="reset-variable-details"] li').should('have.length', variables.length).each((item, index) => {
        expect(item.text()).to.equal(variables[index]);
      });
      cy.get('@details').find('mat-dialog-content').should(content => {
        expect(content[0].scrollWidth, 'full detail width').to.be.at.most(content[0].clientWidth + 1);
      }).scrollTo('bottom', { ensureScrollable: false });
      cy.get('@details').contains('li', variables.at(-1)!).should('be.visible');
      cy.get('@details').contains('button', 'Schließen').click();
      cy.get('coding-box-reset-filter-details-dialog').should('not.exist');
      cy.get('@dialog').find('.filter-details-button').should('be.focused');
      expectConfirmationVisible();
    });
  }

  it('fully displays the unit-only scope and field guidance at 320px', () => {
    cy.viewport(320, 568);
    cy.get('@dialog').contains('mat-radio-button', 'Gefilterter Reset').click();
    cy.get('@dialog').find('[data-cy="reset-unit-filters"]').type('DHB003');
    cy.get('@dialog').find('.scope-summary').should('contain.text', 'Variablen: alle Variablen der betroffenen Units');
    cy.get('@dialog').find('mat-hint').should('contain.text', 'Ohne Unit-Filter');
    cy.get('@dialog').find('mat-label').first().should('have.text', 'Unit-Namen');
    expectConfirmationVisible();
  });
  it('does not query while typing and invalidates a successful count after editing', () => {
    cy.get('@preview.all').should('have.length', 0);
    cy.get('@dialog').contains('mat-radio-button', 'Gefilterter Reset').click();
    cy.get('@dialog').find('[data-cy="reset-unit-filters"]').type('DHB003');
    cy.get('@preview.all').should('have.length', 0);
    cy.get('@dialog').find('.confirm-button').should('be.disabled');
    checkScope();
    cy.get('@dialog').find('.confirmation-count').should('contain.text', 'Betroffene Antworten: 1');
    cy.get('@dialog').find('[data-cy="reset-variable-filters"]').type('V1');
    cy.get('@dialog').find('.confirm-button').should('be.disabled');
    cy.get('@dialog').find('.confirmation-count').should('contain.text', 'Bereich prüfen');
    cy.get('@preview.all').should('have.length', 1);
  });

  it('completes a preview when status responses take longer than the polling interval', () => {
    let statusRequests = 0;
    cy.intercept('GET', '**/coding/reset-version/preview/preview-1', request => {
      statusRequests += 1;
      request.reply({ delay: 2200, body: {
        status: 'completed', result: { status: 'valid', unknownUnits: [], unknownVariables: [], affectedResponseCount: 12345,
          resetResponseCount: 12345, deletedGeneratedResponseCount: 0, checkedAt: '2026-11-17T10:00:00Z' }
      } });
    }).as('slowPreview');
    cy.get('@dialog').find('.check-scope-button').click();
    cy.get('@dialog').find('.confirm-button').should('be.disabled');
    cy.wait('@slowPreview', { responseTimeout: 8000 }).its('response.statusCode').should('equal', 200);
    cy.get('@dialog').find('.confirm-button').should('be.enabled');
    cy.get('@dialog').find('.confirmation-count').invoke('text').should('match', /12\s345/);
    cy.then(() => { expect(statusRequests, 'one completed request without cancellation').to.equal(1); });
  });

  for (const [width, height] of [[667, 375], [844, 390]]) {
    it(`keeps both action buttons fully reachable in landscape at ${width}x${height}`, () => {
      cy.viewport(width, height);
      cy.intercept('POST', '**/api/admin/workspace/5/coding/reset-version', {
        body: { jobId: 'landscape-reset', message: 'Started' }
      }).as('reset');
      cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/job/landscape-reset', {
        body: { status: 'processing', progress: 10 }
      });
      cy.get('@dialog').contains('mat-radio-button', 'Gefilterter Reset').click();
      cy.get('@dialog').find('[data-cy="reset-unit-filters"]').type('DHB003; DHB004; DHB005; DHB006')
        .should('have.value', 'DHB003; DHB004; DHB005; DHB006');
      cy.get('@dialog').find('[data-cy="reset-variable-filters"]').type('V1; V2');
      checkScope();
      cy.get('@dialog').find('.reset-dialog-container').should(container => {
        const element = container[0];
        const style = element.ownerDocument.defaultView!.getComputedStyle(element);
        expect(['auto', 'scroll'], 'dialog allows user scrolling').to.include(style.overflowY);
        expect(element.scrollHeight, 'dialog has scrollable content').to.be.greaterThan(element.clientHeight);
      });
      cy.get('@dialog').find('.reset-dialog-container').scrollTo('bottom');
      expectConfirmationVisible();
      cy.get('@dialog').find('.scope-summary').should('contain.text', 'Units: 4 ausgewählt')
        .and('contain.text', 'Variablen: 2 ausgewählt').and('contain.text', 'Betroffene Antworten: 1');
      cy.screenshot(`filtered-reset-landscape-${width}x${height}`);
      cy.get('@dialog').find('.confirm-button').click();
      cy.wait('@reset').its('request.body').should('deep.equal', {
        version: 'v1', unitFilters: ['DHB003', 'DHB004', 'DHB005', 'DHB006'], variableFilters: ['V1', 'V2']
      });
      cy.get('coding-box-reset-version-dialog').should('not.exist');
    });
  }

  it('shows unknown filters and never permits a reset for them', () => {
    cy.intercept('GET', '**/coding/reset-version/preview/preview-1', { body: {
      status: 'completed', result: { status: 'invalid-filters', unknownUnits: ['UNKNOWN'], unknownVariables: [],
        affectedResponseCount: null, resetResponseCount: null, deletedGeneratedResponseCount: null, checkedAt: '2026-11-17T10:00:00Z' }
    } });
    cy.get('@dialog').contains('mat-radio-button', 'Gefilterter Reset').click();
    cy.get('@dialog').find('[data-cy="reset-unit-filters"]').type('UNKNOWN');
    cy.get('@dialog').find('.check-scope-button').click();
    cy.get('@dialog').find('coding-box-reset-coding-preview').should('contain.text', 'nicht gefunden: UNKNOWN');
    cy.get('@dialog').find('.confirm-button').should('be.disabled');
  });

  it('shows zero affected responses and keeps confirmation disabled', () => {
    cy.intercept('GET', '**/coding/reset-version/preview/preview-1', { body: {
      status: 'completed', result: { status: 'valid', unknownUnits: [], unknownVariables: [], affectedResponseCount: 0,
        resetResponseCount: 0, deletedGeneratedResponseCount: 0, checkedAt: '2026-11-17T10:00:00Z' }
    } });
    cy.get('@dialog').find('.check-scope-button').click();
    cy.get('@dialog').find('.confirmation-count').should('contain.text', 'Betroffene Antworten: 0');
    cy.get('@dialog').find('.confirm-button').should('be.disabled');
  });

});
