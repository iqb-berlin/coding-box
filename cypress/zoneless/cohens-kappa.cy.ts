describe('Zoneless Cohen kappa statistics', () => {
  let unexpectedRequests: string[];
  const response = {
    variables: [{
      unitName: 'UNIT', variableId: 'VAR', caseCount: 3,
      doubleCodedCount: 2, doubleCodedRate: 2 / 3, validPairCount: 2,
      coderPairCount: 1, meanKappa: 0.5, meanAgreement: 0.75,
      coderPairs: [{
        coder1Id: 1, coder1Name: 'Coder 1', coder2Id: 2, coder2Name: 'Coder 2',
        kappa: 0.5, agreement: 0.75, totalItems: 3, validPairs: 2,
        interpretation: 'kappa.moderate'
      }]
    }],
    workspaceSummary: {
      totalCodedResponses: 3, totalDoubleCodedResponses: 2, totalCoderPairs: 1,
      averageKappa: 0.5, meanAgreement: 0.75, variablesIncluded: 1,
      codersIncluded: 2, weightingMethod: 'weighted', calculationLevel: 'code'
    }
  };

  beforeEach(() => {
    unexpectedRequests = [];
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/active', { body: { hasActiveJob: false } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/readiness?*', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coders', { body: { data: [], total: 0 } });
    cy.intercept('GET', '**/api/admin/workspace/5/missings-profiles/IQB-Standard', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/aggregation-settings', {
      body: { flags: [], threshold: 2 }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions', { body: [] }).as('jobDefinitions');
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  function openDialog(): void {
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/coding/manual'; });
    cy.contains('.manual-coding-tabs [role="tab"]', 'Durchführung').click();
    // The first attempt loads the execution scope before allowing the dialog.
    cy.contains('#manual-execution button', 'Interrater-Reliabilität').click();
    cy.wait('@jobDefinitions');
    cy.contains('#manual-execution button', 'Interrater-Reliabilität').click();
    cy.get('coding-box-cohens-kappa-statistics').as('dialog');
    cy.get('@dialog').find('mat-spinner').should('be.visible');
  }

  it('renders delayed statistics, reloads weighting and releases export buttons after a failure', () => {
    cy.intercept('GET', '**/api/admin/workspace/5/coding/cohens-kappa?*', request => {
      expect(request.query.excludeTrainings).to.equal('true');
      expect(request.query.level).to.equal('code');
      const weighted = request.query.weightedMean === 'true';
      request.reply({ delay: 800, body: {
        ...response,
        workspaceSummary: {
          ...response.workspaceSummary,
          averageKappa: weighted ? 0.5 : 0.75,
          weightingMethod: weighted ? 'weighted' : 'unweighted'
        }
      } });
    }).as('statistics');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/cohens-kappa/export/summary/csv?*', {
      delay: 800, statusCode: 500, body: { message: 'Synthetic export failure' }
    }).as('export');

    openDialog();
    cy.wait('@statistics');
    cy.get('@dialog').find('mat-spinner').should('not.exist');
    cy.get('@dialog').find('.kappa-stats .kappa').should('contain.text', '0,500');
    cy.get('@dialog').find('.kappa-summary-table').first().should('contain.text', 'UNIT - VAR');
    cy.get('@dialog').find('.coder-selection').should('be.visible');
    cy.get('@dialog').contains('mat-slide-toggle', 'Gewichteter Mittelwert').find('button').click();
    cy.get('@dialog').find('mat-spinner').should('be.visible');
    cy.wait('@statistics').its('request.query.weightedMean').should('equal', 'false');
    cy.get('@dialog').find('mat-spinner').should('not.exist');
    cy.get('@dialog').find('.kappa-stats .kappa').should('contain.text', '0,750');
    cy.get('@dialog').find('.kappa-detail-actions button').eq(1).click();
    cy.get('@dialog').find('.kappa-detail-actions button').each(button => {
      cy.wrap(button).should('be.disabled');
    });
    cy.wait('@export');
    cy.get('@dialog').find('.kappa-detail-actions button').each(button => {
      cy.wrap(button).should('not.be.disabled');
    });
  });

  for (const outcome of ['empty', 'failed']) {
    it(`ends loading after a delayed ${outcome} response`, () => {
      cy.intercept('GET', '**/api/admin/workspace/5/coding/cohens-kappa?*', {
        delay: 800,
        statusCode: outcome === 'failed' ? 500 : 200,
        body: outcome === 'failed' ? { message: 'Synthetic statistics failure' } : {
          variables: [], workspaceSummary: {
            totalCodedResponses: 0, totalDoubleCodedResponses: 0, totalCoderPairs: 0,
            averageKappa: null, meanAgreement: null, variablesIncluded: 0,
            codersIncluded: 0, weightingMethod: 'weighted', calculationLevel: 'code'
          }
        }
      }).as('statistics');

      openDialog();
      cy.wait('@statistics');
      cy.get('@dialog').find('mat-spinner').should('not.exist');
      cy.get('@dialog').find('.no-kappa-data').should('exist').scrollIntoView().should('be.visible');
      cy.get('@dialog').find('.kappa-detail-actions button').each(button => {
        cy.wrap(button).should('be.disabled');
      });
    });
  }
});
