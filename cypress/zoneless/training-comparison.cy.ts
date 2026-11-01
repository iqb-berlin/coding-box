import type { TrainingDiscussionApplyPreviewDto } from '../../api-dto/coding/training-discussion-apply.dto';
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
    cy.task('deferred:reset');
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  function openTrainingList(): void {
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/coding/manual'; });
    cy.contains('.manual-coding-tabs [role="tab"]', 'Schulung').click();
    cy.contains('#manual-support button', 'Aktualisieren').click();
  }

  function openComparisonDialog(): void {
    openTrainingList();
    cy.wait('@trainings');
    cy.get('#manual-support .more-actions-button').first().click();
    cy.contains('[role="menuitem"]', 'Ergebnisse vergleichen').click();
    cy.get('coding-box-coding-results-comparison').as('dialog');
  }

  function openComparison(): void {
    openComparisonDialog();
    cy.wait('@comparison');
    cy.get('@dialog').find('.discussion-input input').should('exist');
  }

  it('previews and applies discussion results through the confirmation dialog without another UI interaction', () => {
    const previewGate = createResponseGate();
    const applyGate = createResponseGate();
    const preview: TrainingDiscussionApplyPreviewDto = {
      trainingId: 7, source: 'manual', totalTrainingResponses: 1, sourceResultsCount: 1, applicableResultsCount: 1,
      missingResultsCount: 0, missingScoreCount: 0, existingFinalResultsCount: 1, productiveJobConflictCount: 0,
      removableProductiveJobUnitCount: 0, blockingProductiveJobUnitCount: 0, approvedJobDefinitionConflictCount: 0,
      staleTrainingJobCount: 0, affectedJobIds: [], affectedJobDefinitionIds: [], canApply: true
    };
    cy.intercept('POST', '**/api/admin/workspace/5/coding/coder-trainings/7/apply-discussion-results-preview', async request => {
      expect(request.body).to.deep.equal({ source: 'manual' });
      await previewGate.wait;
      request.reply({ body: preview });
    }).as('applyPreview');
    cy.intercept('POST', '**/api/admin/workspace/5/coding/coder-trainings/7/apply-discussion-results', async request => {
      expect(request.body).to.deep.equal({ source: 'manual', existingResultStrategy: 'skip', jobConflictStrategy: 'skip' });
      await applyGate.wait;
      request.reply({ body: {
        ...preview, success: true, updatedResponsesCount: 0, skippedExistingResultsCount: 1,
        overwrittenExistingResultsCount: 0, skippedJobConflictCount: 0, skippedMissingScoreCount: 0,
        removedJobUnitCount: 0, messageKey: 'success'
      } });
    }).as('applyResults');

    openComparison();
    cy.get('@dialog').contains('button', 'Diskussionsergebnisse anwenden').click().should('be.disabled');
    cy.then(() => { previewGate.release(); });
    cy.wait('@applyPreview');
    cy.get('coding-box-apply-training-discussion-results-dialog').contains('button', 'Anwenden').click();
    cy.get('@dialog').contains('button', 'Diskussionsergebnisse anwenden').should('be.disabled');
    cy.then(() => { applyGate.release(); });
    cy.wait('@applyResults');
    cy.wait('@comparison');
    cy.get('coding-box-apply-training-discussion-results-dialog').should('not.exist');
    cy.get('@dialog').contains('button', 'Diskussionsergebnisse anwenden').should('be.enabled');
    cy.contains('1 bestehende Ergebnisse übersprungen').should('be.visible');
  });

  it('restores a discussion draft with its explicit score and notes, then clears only the accepted entry', () => {
    cy.intercept('POST', '**/api/admin/workspace/5/coding/coder-trainings/7/discussion-result', request => {
      expect(request.body).to.deep.equal({ responseId: 501, code: 2, score: 4, notes: 'Recovered note' });
      request.reply({ delay: 200, body: {
        success: true, code: 2, score: 4, notes: 'Recovered note', managerUserId: 2,
        managerName: 'Recovery manager', source: 'manual'
      } });
    }).as('recoverySave');
    openTrainingList();
    cy.wait('@trainings');
    cy.window().then(win => {
      const key = 'training-discussion-active-state';
      win.sessionStorage.setItem(`coding-box-session-recovery:${key}`, JSON.stringify({
        key, version: 1, createdAt: Date.now(), expiresAt: Date.now() + 60_000,
        data: { workspaceId: 5, trainingId: 7, entries: [
          { responseId: 501, codeValue: '2', score: 4, notes: 'Recovered note' },
          { responseId: 999, codeValue: '1', score: 1, notes: 'Other page' }
        ] }
      }));
    });
    cy.get('#manual-support .more-actions-button').first().click();
    cy.contains('[role="menuitem"]', 'Ergebnisse vergleichen').click();
    cy.get('coding-box-coding-results-comparison').as('dialog');
    cy.wait('@recoverySave');
    cy.get('@dialog').find('.discussion-input input').should('have.value', '2');
    cy.get('@dialog').find('.discussion-notes textarea').should('have.value', 'Recovered note');
    cy.get('@dialog').find('.discussion-score').should('contain.text', '4');
    cy.get('@dialog').find('.discussion-saving').should('not.exist');
    cy.window().then(win => {
      const draft = JSON.parse(win.sessionStorage.getItem('coding-box-session-recovery:training-discussion-active-state')!);
      expect(draft.data.entries.map((entry: { responseId: number }) => entry.responseId)).to.deep.equal([999]);
    });
  });

  it('saves the latest replay notes after the pending code write without replacing the explicit score', () => {
    const codeGate = createResponseGate();
    const notesGate = createResponseGate();
    const writes: Array<{ responseId: number; code: number; score: number; notes: string | null }> = [];
    cy.intercept('POST', '**/api/admin/workspace/5/coding/coder-trainings/7/discussion-result', async request => {
      writes.push(request.body);
      request.alias = writes.length === 1 ? 'codeWrite' : 'notesWrite';
      await (writes.length === 1 ? codeGate.wait : notesGate.wait);
      request.reply({ body: {
        success: true, code: request.body.code, score: request.body.score, notes: request.body.notes,
        managerUserId: 2, managerName: 'Discussion manager', source: 'manual'
      } });
    });
    openComparison();
    const reference = { responseId: 501, testPerson: 'synthetic-person@P001@GROUP', unitId: 'UNIT', variableId: 'VAR' };
    cy.window().then(win => {
      win.postMessage({ type: 'replayCodeSelected', ...reference, code: '2', score: 4 }, win.location.origin);
    });
    cy.wrap(null).should(() => { expect(writes).to.have.length(1); });
    cy.get('@dialog').find('.discussion-input input').should('have.value', '2');
    cy.get('@dialog').find('.discussion-saving').scrollIntoView().should('be.visible');
    cy.window().then(win => {
      win.postMessage({ type: 'replayNotesCommitted', ...reference, notes: 'Earlier note' }, win.location.origin);
      win.postMessage({ type: 'replayNotesCommitted', ...reference, notes: 'Latest replay note' }, win.location.origin);
    });
    cy.get('@dialog').find('.discussion-notes textarea').should('have.value', 'Latest replay note');
    cy.then(() => {
      expect(writes).to.deep.equal([{ responseId: 501, code: 2, score: 4, notes: null }]);
      codeGate.release();
    });
    cy.wait('@codeWrite');
    cy.wrap(null).should(() => { expect(writes).to.have.length(2); });
    cy.get('@dialog').find('.discussion-notes textarea').should('have.value', 'Latest replay note');
    cy.get('@dialog').find('.discussion-saving').scrollIntoView().should('be.visible');
    cy.then(() => {
      expect(writes[1]).to.deep.equal({ responseId: 501, code: 2, score: 4, notes: 'Latest replay note' });
      notesGate.release();
    });
    cy.wait('@notesWrite');
    cy.get('@dialog').find('.discussion-saving').should('not.exist');
    cy.get('@dialog').find('.discussion-score').should('contain.text', '4');
    cy.get('@dialog').find('.discussion-notes textarea').should('have.value', 'Latest replay note');
    cy.get('@dialog').find('.discussion-error').should('not.exist');
    cy.then(() => { expect(writes).to.have.length(2); });
  });

  it('finishes a pending reliability export after changing the comparison page', () => {
    let exportId: string;
    let exportsStarted = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/compare-within-training?*', request => {
      if (request.query.page === '2') request.alias = 'secondComparisonPage';
      request.reply({ body: { ...comparison, total: 100, totalPages: 2, page: Number(request.query.page) } });
    }).as('comparison');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings/7/interrater-reliability?*', {
      body: {
        ...statistics,
        variables: [{
          unitName: 'UNIT', variableId: 'VAR', meanKappa: 0.8, meanBrennanPredigerKappa: 0.9,
          fleissKappa: null, fleissCaseCount: 0, fleissPossibleCaseCount: 1, meanAgreement: 1,
          caseCount: 1, validPairCount: 1, coderPairCount: 1, coderPairs: []
        }]
      }
    }).as('statistics');
    cy.task<{ id: string; url: string }>('deferred:create', {
      headers: { 'content-type': 'text/csv' }, body: 'unit,variable,kappa\nUNIT,VAR,0.8'
    }).then(gate => {
      exportId = gate.id;
      cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings/7/interrater-reliability/export/csv?*', request => {
        exportsStarted += 1;
        request.url = gate.url;
        request.continue();
      }).as('reliabilityExport');
    });
    openComparison();
    cy.window().then(win => {
      cy.stub(win.URL, 'createObjectURL').returns('blob:reliability').as('csvUrl');
      cy.stub(win.URL, 'revokeObjectURL');
      cy.stub(win.HTMLAnchorElement.prototype, 'click').as('downloadCsv');
    });
    cy.get('@dialog').find('.kappa-header').click();
    cy.wait('@statistics');
    cy.get('@dialog').find('.kappa-export-actions button').as('exportButton').should('be.enabled').click();
    cy.wrap(null).should(() => { expect(exportsStarted).to.equal(1); });
    cy.get('@dialog').find('mat-paginator .mat-mdc-paginator-navigation-next').click();
    cy.wait('@secondComparisonPage').its('request.query.page').should('equal', '2');
    cy.wait('@statistics');
    cy.get('@exportButton').should('be.disabled');
    cy.then(() => cy.task('deferred:release', exportId));
    cy.wait('@reliabilityExport');
    cy.get('@csvUrl').should('have.been.calledOnce');
    cy.get('@downloadCsv').should('have.been.calledOnce');
    cy.get('@exportButton').should('be.enabled');
  });

  it('renders delayed training options, filters them and sends only the visible selection', () => {
    const gate = createResponseGate();
    const trainings = [
      { id: 7, workspace_id: 5, label: 'Synthetic training', jobsCount: 2, assigned_coders: [11, 12] },
      { id: 8, workspace_id: 5, label: 'Second training', jobsCount: 2, assigned_coders: [11, 12] }
    ];
    let reads = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings', async request => {
      reads += 1;
      await gate.wait;
      request.reply({ body: trainings });
    }).as('trainings');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings/8/comparison-freshness', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/compare-within-training?*', request => {
      if (request.query.trainingId === '8') request.alias = 'selectedComparison';
      request.reply({ delay: 300, body: {
        ...comparison, data: comparison.data.map(row => ({
          ...row, givenAnswer: request.query.trainingId === '8' ? 'Second training answer' : 'First training answer'
        }))
      } });
    }).as('comparison');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/compare-training-results?*', {
      delay: 300, body: { ...comparison, data: [], total: 0, availableCoders: [] }
    }).as('betweenComparison');

    openTrainingList();
    cy.get('coding-box-coder-trainings-list .loading-container').should('be.visible');
    cy.get('#manual-support .more-actions-button').should('not.exist');
    cy.then(() => gate.release());
    cy.wait('@trainings');
    cy.get('coding-box-coder-trainings-list .training-title').should('have.length', 2);
    cy.get('#manual-support .more-actions-button').first().click();
    cy.contains('[role="menuitem"]', 'Ergebnisse vergleichen').click();
    cy.get('coding-box-coding-results-comparison').as('dialog');
    cy.wait('@comparison').its('request.query.trainingId').should('equal', '7');
    cy.get('@dialog').find('.training-selection > mat-form-field mat-select').click();
    cy.get('mat-option .training-option-title').should('have.length', 2);
    cy.contains('mat-option', 'Second training').click();
    cy.wait('@selectedComparison').its('request.query.trainingId').should('equal', '8');
    cy.get('@dialog').find('.selected-training-title').should('contain.text', 'Second training');
    cy.get('@dialog').should('contain.text', 'Second training answer');

    cy.get('@dialog').find('mat-radio-button[value="between-trainings"] input').check();
    cy.get('@dialog').find('.training-checkbox').should('have.length', 2);
    cy.get('@dialog').find('input[placeholder="Schulungen filtern..."]').focus().type('Second');
    cy.get('@dialog').find('.training-checkbox').should('have.length', 1).and('contain.text', 'Second training');
    cy.get('@dialog').find('.training-checkbox input').check();
    cy.get('@dialog').find('input[placeholder="Schulungen filtern..."]').clear();
    cy.get('@dialog').find('.training-checkbox').should('have.length', 2);
    cy.get('@dialog').find('.training-checkbox input:checked').should('have.length', 1);
    cy.get('@dialog').contains('.training-checkbox', 'Synthetic training').find('input').check();
    cy.wait('@betweenComparison').its('request.query.trainingIds').should('equal', '8,7');

    cy.get('@dialog').find('input[placeholder="Schulungen filtern..."]').type('missing');
    cy.get('@dialog').find('.training-checkbox').should('not.exist');
    cy.get('@dialog').find('mat-radio-button[value="within-training"] input').check();
    cy.get('@dialog').find('mat-radio-button[value="between-trainings"] input').check();
    cy.get('@dialog').find('.training-checkbox').should('have.length', 2);
    cy.get('@dialog').find('.training-checkbox input:checked').should('not.exist');
    cy.then(() => { expect(reads, 'comparison reuses the loaded training list').to.equal(1); });
  });

  it('ignores the closed dialog’s pending comparison response when reopened', { defaultCommandTimeout: 15_000 }, () => {
    const gate = createResponseGate();
    let reopened = false;
    let oldRequests = 0;
    let oldReplies = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/compare-within-training?*', async request => {
      const oldContext = !reopened;
      if (oldContext) {
        oldRequests += 1;
        await gate.wait;
      } else request.alias = 'freshComparison';
      request.reply({ body: {
        ...comparison, data: comparison.data.map(row => ({
          ...row, givenAnswer: oldContext ? 'Old comparison answer' : 'Fresh comparison answer'
        }))
      } });
      if (oldContext) oldReplies += 1;
    }).as('comparison');
    openComparisonDialog();
    cy.wrap(null).should(() => { expect(oldRequests).to.be.greaterThan(0); });
    cy.get('@dialog').find('.loading-container').should('be.visible');
    cy.get('@dialog').contains('button', 'Schließen').click();
    cy.get('coding-box-coding-results-comparison').should('not.exist');
    cy.then(() => { reopened = true; });
    cy.get('#manual-support .more-actions-button').click();
    cy.contains('[role="menuitem"]', 'Ergebnisse vergleichen').click();
    cy.get('coding-box-coding-results-comparison').as('dialog');
    cy.wait('@freshComparison');
    cy.get('@dialog').should('contain.text', 'Fresh comparison answer');
    cy.then(() => gate.release());
    cy.wrap(null).should(() => { expect(oldReplies).to.equal(oldRequests); });
    cy.get('@dialog').should('contain.text', 'Fresh comparison answer');
    cy.get('@dialog').should('not.contain.text', 'Old comparison answer');
  });

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
        cy.get('.mat-mdc-snack-bar-container').should('contain.text', 'Fehler beim Laden der Interrater-Reliabilität');
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
