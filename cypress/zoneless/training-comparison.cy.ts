import type { TrainingKappaStatisticsDto } from '../../api-dto/coding/training-kappa-statistics.dto';
import type { WithinTrainingCodingComparisonPageDto } from '../../api-dto/coding/training-comparison.dto';

describe('Zoneless training comparison', () => {
  let unexpectedRequests: string[];
  let responseGateReleases: Array<() => void>;
  const coders = [{ jobId: 11, coderName: 'Coder 1' }, { jobId: 12, coderName: 'Coder 2' }];
  const comparison: WithinTrainingCodingComparisonPageDto = {
    data: [{
      responseId: 501, unitName: 'UNIT', variableId: 'VAR',
      personCode: 'P001', personLogin: 'synthetic-person', personGroup: 'GROUP',
      bookletName: 'BOOKLET', testPerson: 'synthetic-person@P001@GROUP', givenAnswer: 'Synthetic answer',
      replayCode: null, replayScore: null, discussionCode: null, discussionScore: null,
      discussionNotes: null, discussionManagerUserId: null, discussionManagerName: null, discussionSource: null,
      coders: coders.map(coder => ({ ...coder, code: '1', score: 1, notes: null, codingIssueOption: null }))
    }],
    total: 1, page: 1, limit: 50, totalPages: 1,
    summary: {
      visibleRows: 1, comparableRows: 1, matchingRows: 1, matchingPercentage: 100,
      incompleteRows: 0, notComparableRows: 0, deviationRows: 0, completionRate: 100
    },
    availableCoders: coders
  };
  const statistics: TrainingKappaStatisticsDto = {
    variables: [],
    workspaceSummary: {
      totalDoubleCodedResponses: 1, totalCoderPairs: 1, averageKappa: 0.8,
      averageBrennanPredigerKappa: 0.9, variablesIncluded: 1, codersIncluded: 2,
      weightingMethod: 'weighted', calculationLevel: 'code'
    }
  };

  function createResponseGate(): { wait: Promise<void>; release: () => void } {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    responseGateReleases.push(release);
    return { wait, release };
  }

  beforeEach(() => {
    unexpectedRequests = [];
    responseGateReleases = [];
    cy.viewport(1400, 1000);
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
    cy.intercept('GET', '**/api/admin/workspace/5/coding/aggregation-settings', { body: { flags: [], threshold: 2 } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings', {
      body: [{
        id: 7, workspace_id: 5, label: 'Synthetic training', jobsCount: 2, assigned_coders: [11, 12],
        created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z'
      }]
    }).as('trainings');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings/7/comparison-freshness', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/compare-within-training?*', { delay: 300, body: comparison }).as('comparison');
  });

  afterEach(() => {
    responseGateReleases.splice(0).forEach(release => release());
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  function openComparison(): void {
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/coding/manual'; });
    cy.contains('.manual-coding-tabs [role="tab"]', 'Schulung').click();
    cy.contains('#manual-support button', 'Aktualisieren').click();
    cy.wait('@trainings');
    cy.get('#manual-support .more-actions-button').click();
    cy.contains('[role="menuitem"]', 'Ergebnisse vergleichen').click();
    cy.get('coding-box-coding-results-comparison').as('dialog');
    cy.wait('@comparison');
    cy.get('@dialog').find('.discussion-input input').should('exist');
  }

  for (const outcome of ['loaded', 'failed']) {
    it(`settles a delayed ${outcome} Kappa request without another interaction`, () => {
      const gate = createResponseGate();
      cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings/7/interrater-reliability?*', async request => {
        expect(request.query.jobIds).to.equal('11,12');
        await gate.wait;
        request.reply({
          delay: 300, statusCode: outcome === 'failed' ? 500 : 200,
          body: outcome === 'failed' ? { message: 'Synthetic statistics failure' } : {
            ...statistics,
            workspaceSummary: {
              ...statistics.workspaceSummary,
              weightingMethod: request.query.weightedMean === 'true' ? 'weighted' : 'unweighted',
              calculationLevel: request.query.level
            }
          }
        });
      }).as('statistics');

      openComparison();
      cy.get('@dialog').find('.kappa-header').click();
      cy.get('@dialog').find('.kappa-content .loading-container').should('exist').scrollIntoView().should('be.visible');
      cy.then(() => { gate.release(); });
      cy.wait('@statistics');
      cy.get('@dialog').find('.kappa-content .loading-container').should('not.exist');
      if (outcome === 'loaded') {
        cy.get('@dialog').find('.kappa-statistics').should('exist').and('contain.text', '0,800');
        cy.get('@dialog').contains('mat-slide-toggle', 'Gewichteter Mittelwert').find('button').click();
        cy.wait('@statistics').its('request.query.weightedMean').should('equal', 'false');
        cy.get('@dialog').find('.kappa-statistics').should('contain.text', 'Ungewichtet');
        cy.get('@dialog').contains('mat-slide-toggle', 'Kappa auf Ebene der Codes').find('button').click();
        cy.wait('@statistics').its('request.query.level').should('equal', 'score');
        cy.get('@dialog').find('.level-indicator').should('contain.text', 'Score-Ebene');
      } else {
        cy.get('@dialog').find('.kappa-statistics').should('not.exist');
      }
    });

    it(`settles a delayed ${outcome} discussion save without another interaction`, () => {
      const gate = createResponseGate();
      cy.intercept('POST', '**/api/admin/workspace/5/coding/coder-trainings/7/discussion-result', async request => {
        expect(request.body).to.deep.equal({ responseId: 501, code: 1, score: 1, notes: null });
        await gate.wait;
        request.reply({
          delay: 300, statusCode: outcome === 'failed' ? 500 : 200,
          body: outcome === 'failed' ? { message: 'Synthetic save failure' } : {
            success: true, code: 1, score: 1, notes: null,
            managerUserId: 2, managerName: 'Saved manager', source: 'manual'
          }
        });
      }).as('save');

      openComparison();
      cy.get('@dialog').find('.discussion-input input').type('1').blur();
      cy.get('@dialog').find('.discussion-saving').should('be.visible');
      cy.then(() => { gate.release(); });
      cy.wait('@save');
      cy.get('@dialog').find('.discussion-saving').should('not.exist');
      if (outcome === 'loaded') {
        cy.get('@dialog').should('contain.text', 'Saved manager');
        cy.get('@dialog').find('.discussion-score').should('contain.text', '1');
        cy.get('@dialog').find('.discussion-error').should('not.exist');
      } else {
        cy.get('@dialog').find('.discussion-error').should('contain.text', 'Synthetic save failure');
      }
    });
  }
});
