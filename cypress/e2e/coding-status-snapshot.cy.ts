describe('Kodierstatus-Sitzungsspeicher', () => {
  it('restores the checked overview after leaving the view when automatic refresh is disabled', () => {
    const workspaceId = 5;
    const userId = 2;
    const revision = 12;
    const statusRevision = '34';
    const readiness = {
      workspaceId,
      autoCoderRun: 1,
      readiness: 'READY',
      blockers: [],
      rawResponsesTotal: 0,
      rawResponsesWithRelevantStatus: 0,
      resultUnitsTotal: 0,
      resultUnitKeysTotal: 0,
      matchedUnitFiles: 0,
      missingUnitFiles: [],
      matchedCodingSchemes: 0,
      missingCodingSchemes: [],
      invalidCodingSchemes: [],
      validVariablePairs: 0,
      validResponses: 0,
      codeableResponses: 0,
      invalidVariableSamples: []
    };
    let freshnessRequests = 0;
    let readinessRequests = 0;
    let appliedResultsOverviewRequests = 0;

    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId, userId });

    const settings: Array<[string, boolean]> = [
      ['evaluation-mode', false],
      ['auto-fetch-coding-statistics', false],
      ['auto-refresh-manual-coding-jobs', false],
      ['enable-regex-search', false]
    ];
    settings.forEach(([key, enabled]) => {
      cy.intercept(
        'GET',
        `**/api/workspace/${workspaceId}/settings/${key}`,
        {
          body: {
            key,
            value: JSON.stringify({ enabled })
          }
        }
      );
    });

    cy.intercept(
      'GET',
      `**/api/admin/workspace/${workspaceId}/coding/revision`,
      {
        body: {
          workspaceId,
          revision,
          statusRevision,
          stable: true
        }
      }
    ).as('codingStatusRevision');
    cy.intercept(
      'GET',
      `**/api/admin/workspace/${workspaceId}/coding/reset-version/active`,
      { body: { hasActiveJob: false } }
    );
    cy.intercept(
      'GET',
      `**/api/admin/workspace/${workspaceId}/coding/freshness`,
      request => {
        freshnessRequests += 1;
        request.reply({
          workspaceId,
          currentRevision: revision,
          items: []
        });
      }
    );
    cy.intercept(
      'GET',
      `**/api/admin/workspace/${workspaceId}/coding/readiness*`,
      request => {
        readinessRequests += 1;
        request.reply(readiness);
      }
    );
    cy.intercept(
      'GET',
      `**/api/admin/workspace/${workspaceId}/coding/applied-results-overview`,
      request => {
        appliedResultsOverviewRequests += 1;
        request.reply({});
      }
    );

    cy.visit('/');
    cy.wait('@authData');
    cy.contains('a.workspace', 'E2E Workspace').should('be.visible');
    cy.window().then(window => {
      window.sessionStorage.setItem(
        `coding-status-snapshot:v1:${userId}:${workspaceId}:overview`,
        JSON.stringify({
          schemaVersion: 1,
          userId,
          workspaceId,
          revision,
          statusRevision,
          checkedAt: new Date().toISOString(),
          surface: 'overview',
          fullyChecked: true,
          freshness: {
            workspaceId,
            currentRevision: revision,
            items: []
          },
          readiness,
          appliedResultsOverview: null
        })
      );
      window.location.hash = `/workspace-admin/${workspaceId}/coding/management`;
    });

    cy.wait('@codingStatusRevision');
    cy.get('.coding-freshness-panel')
      .should('contain.text', 'Für die aktuell berücksichtigten Testergebnisse')
      .and('not.contain.text', 'noch nicht geprüft');

    cy.window().then(window => {
      window.location.hash = '/home';
    });
    cy.get('coding-box-home').should('exist');
    cy.window().then(window => {
      window.location.hash = `/workspace-admin/${workspaceId}/coding/management`;
    });

    cy.wait('@codingStatusRevision');
    cy.get('.coding-freshness-panel')
      .should('contain.text', 'Für die aktuell berücksichtigten Testergebnisse')
      .and('not.contain.text', 'noch nicht geprüft');
    cy.then(() => {
      expect(freshnessRequests).to.equal(0);
      expect(readinessRequests).to.equal(0);
      expect(appliedResultsOverviewRequests).to.equal(0);
    });
  });
});
