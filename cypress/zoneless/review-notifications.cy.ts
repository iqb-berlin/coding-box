import type {
  DoubleCodedManagerDecisionDto,
  DoubleCodedReviewItemDto
} from '../../api-dto/coding/double-coded-review.dto';
import type { ExternalCodingImportResultDto } from '../../api-dto/coding/external-coding-import-result.dto';

describe('Zoneless import and review notifications', () => {
  let unexpectedRequests: string[];
  let responseGateReleases: Array<() => void>;

  beforeEach(() => {
    cy.viewport(1400, 1000);
    unexpectedRequests = [];
    responseGateReleases = [];
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', {
      body: { value: '{"enabled":false}' }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/active', {
      body: { hasActiveJob: false }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/readiness?*', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coders', { body: { data: [], total: 0 } });
    cy.intercept('GET', '**/api/admin/workspace/5/missings-profiles/IQB-Standard', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/aggregation-settings', {
      body: { flags: [], threshold: 2 }
    }).as('aggregationSettings');
  });

  afterEach(() => {
    responseGateReleases.splice(0).forEach(release => release());
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests, 'all API calls have explicit fixtures').to.deep.equal([]); });
  });

  function openManualManagement(): void {
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/coding/manual'; });
    cy.wait('@aggregationSettings');
    cy.get('coding-box-coding-management-manual .external-coding-file-input').should('exist');
    cy.window().should('not.have.property', 'Zone');
  }

  function createResponseGate(): { wait: Promise<void>; release: () => void } {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    responseGateReleases.push(release);
    return { wait, release };
  }

  it('renders delayed import progress, releases controls after creation and polling errors, and permits retry', () => {
    const preview: ExternalCodingImportResultDto = {
      message: 'Synthetic import preview', processedRows: 1, updatedRows: 1, errors: [],
      affectedRows: [{
        unitAlias: 'UNIT_IMPORT', variableId: 'VAR', personLogin: 'synthetic-person',
        originalCodedStatus: 'CODING_INCOMPLETE', originalCode: null, originalScore: null,
        updatedCodedStatus: 'CODING_COMPLETE', updatedCode: 2, updatedScore: 1,
        importAction: 'update', hasExistingCoding: false
      }]
    };
    cy.intercept('POST', '**/api/admin/workspace/5/coding/external-coding-import/stream', request => {
      expect(request.body.previewOnly).to.equal(true);
      expect(request.body.sourceFormat).to.equal('external-coding');
      request.reply({
        delay: 300, headers: { 'Content-Type': 'text/event-stream' },
        body: `data: ${JSON.stringify({ result: preview })}\n\n`
      });
    }).as('importPreview');

    let attempts = 0;
    cy.intercept('POST', '**/api/admin/workspace/5/coding/external-coding-import/apply', request => {
      attempts += 1;
      request.reply(attempts === 1 ? {
        delay: 800, statusCode: 409, body: { message: 'Synthetic active import' }
      } : { delay: 300, body: { jobId: `synthetic-import-${attempts}` } });
    }).as('applyImport');
    let polls = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/external-coding-import/job/*', request => {
      polls += 1;
      if (request.url.endsWith('synthetic-import-2')) {
        request.reply({ delay: 300, body: polls === 1 ?
          { status: 'processing', progress: 45 } :
          { status: 'failed', progress: 45, error: 'Synthetic import processing failure' } });
      } else {
        request.reply({ delay: 300, body: { status: 'completed', progress: 100 } });
      }
    }).as('importStatus');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/external-coding-import/job/*/result', {
      delay: 800, body: preview
    }).as('importResult');

    openManualManagement();
    cy.get('coding-box-coding-management-manual .external-coding-file-input').selectFile({
      contents: Cypress.Buffer.from('unit_alias,variable_id,code,score\nUNIT_IMPORT,VAR,2,1\n'),
      fileName: 'synthetic-external-coding.csv', mimeType: 'text/csv'
    }, { force: true });
    cy.get('coding-box-coding-import-format-dialog').contains('button', 'Vorschau starten').click();
    cy.wait('@importPreview');
    cy.get('coding-box-import-comparison-dialog').as('comparison');
    cy.get('@comparison').find('.comparison-table tbody tr').should('contain.text', 'UNIT_IMPORT');

    cy.get('@comparison').contains('button', 'Änderungen anwenden').click();
    cy.get('@comparison').contains('button', 'Änderungen anwenden').should('be.disabled');
    cy.get('@comparison').find('.apply-progress').should('contain.text', '0%');
    cy.wait('@applyImport').its('response.statusCode').should('equal', 409);
    cy.get('@comparison').find('.apply-progress').should('not.exist');
    cy.get('@comparison').contains('button', 'Herunterladen').should('not.be.disabled');
    cy.get('@comparison').contains('button', 'Änderungen anwenden').should('not.be.disabled').click();

    cy.wait('@applyImport').its('response.statusCode').should('equal', 200);
    cy.wait('@importStatus');
    cy.get('@comparison').find('.apply-progress').should('contain.text', '45%');
    cy.get('@comparison').find('mat-progress-bar').should('have.attr', 'aria-valuenow', '45');
    cy.get('@comparison').contains('button', 'Änderungen anwenden').should('be.disabled');
    cy.wait('@importStatus').its('response.body.status').should('equal', 'failed');
    cy.get('@comparison').find('.apply-progress').should('not.exist');
    cy.get('@comparison').contains('button', 'Herunterladen').should('not.be.disabled');
    cy.get('@comparison').contains('button', 'Änderungen anwenden').should('not.be.disabled').click();

    cy.wait('@applyImport');
    cy.wait('@importStatus').its('response.body.status').should('equal', 'completed');
    cy.get('@comparison').find('.apply-progress').should('contain.text', '100%');
    cy.get('@comparison').contains('button', 'Änderungen anwenden').should('be.disabled');
    cy.wait('@importResult');
    cy.get('coding-box-import-comparison-dialog').should('not.exist');
    cy.then(() => { expect(attempts).to.equal(3); });
  });

  it('refreshes a manager column and coder highlighting after a delayed own draft save without reloading the review', () => {
    const savedAt = '2026-10-02T10:00:00.000Z';
    const ownDecision: DoubleCodedManagerDecisionDto = {
      id: 41, responseId: 501, managerUserId: 2, managerKey: '2', managerName: 'E2E Manager',
      state: 'draft', effectiveCode: 1, selectedCode: 1, score: 0, comment: null,
      createdAt: savedAt, updatedAt: savedAt, finalizedAt: null, legacy: false
    };
    const item: DoubleCodedReviewItemDto = {
      responseId: 501, sourceUnitId: 1501, unitName: 'UNIT_REVIEW', variableId: 'VAR',
      personLogin: 'synthetic-person', personCode: 'P001', personGroup: 'GROUP', bookletName: 'BOOKLET',
      givenAnswer: 'Synthetic review answer', isResolved: false,
      appliedCode: null, appliedScore: null, appliedComment: null,
      availableCodes: [
        { code: 1, label: 'Incorrect', score: 0, source: 'schema' },
        { code: 2, label: 'Correct', score: 1, source: 'schema' }
      ],
      managerDrafts: [ownDecision],
      managerHistory: [{
        ...ownDecision, id: 40, state: 'superseded',
        createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z',
        finalizedAt: '2026-10-01T10:00:00.000Z'
      }],
      coderResults: [1, 2].map(code => ({
        coderId: code + 10, coderName: `Coder ${code}`, jobId: code + 100,
        jobName: `Definition 99 / Coder ${code}`, jobDefinitionId: 99,
        trainingId: null, trainingLabel: null, code, codingIssueOption: null, score: code - 1,
        notes: null, supervisorComment: null, codedAt: savedAt
      }))
    };
    cy.intercept('GET', '**/api/admin/workspace/5/coders', {
      body: { data: [{ userId: 11, username: 'Coder 1' }, { userId: 12, username: 'Coder 2' }], total: 2 }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions', {
      body: [{ id: 99, name: 'Definition 99', status: 'approved', createdJobsCount: 2 }]
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings', { body: [] });
    let loads = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/double-coded-review?*', request => {
      loads += 1;
      request.reply({ delay: 300, body: { data: [item], total: 1, page: 1, limit: 50 } });
    }).as('reviewData');
    const draftGate = createResponseGate();
    cy.intercept('PUT', '**/api/admin/workspace/5/coding/double-coded-review/501/draft', async request => {
      expect(request.body).to.deep.equal({ sourceUnitId: 1501, code: 2, score: 1, comment: null });
      await draftGate.wait;
      request.reply({ delay: 300, body: {
        ...ownDecision, effectiveCode: 2, selectedCode: 2, score: 1,
        updatedAt: '2026-10-02T11:00:00.000Z'
      } });
    }).as('saveDraft');

    openManualManagement();
    cy.contains('.manual-coding-tabs [role="tab"]', 'Durchführung').click();
    cy.contains('#manual-execution button', 'Doppelkodierungsreview').click();
    cy.wait('@reviewData');
    cy.get('coding-box-double-coded-review .review-table tbody tr').as('reviewRow');
    cy.get('@reviewRow').should('have.length', 1).and('contain.text', 'UNIT_REVIEW');
    cy.get('@reviewRow').find('.manager-decision-cell .coder-code-row > span').first()
      .invoke('text').should('match', /^\s*1\s*$/);
    cy.get('@reviewRow').find('.coder-column-cell.selected-code-match .coder-code-value').should('have.text', '1');
    cy.get('@reviewRow').find('.decision-select-field mat-select').click();
    cy.contains('mat-option .decision-option-code', /^2$/).click();
    cy.get('@reviewRow').find('.decision-code-value').should('contain.text', '2');
    cy.get('@reviewRow').find('.coder-column-cell.selected-code-match .coder-code-value').should('have.text', '2');
    cy.get('@reviewRow').find('.manager-decision-cell .coder-code-row > span').first()
      .invoke('text').should('match', /^\s*1\s*$/);
    cy.then(() => { draftGate.release(); });
    cy.wait('@saveDraft');
    cy.get('@reviewRow').find('.manager-decision-cell .coder-code-row > span').first()
      .invoke('text').should('match', /^\s*2\s*$/);
    cy.get('@reviewRow').find('.manager-decision-state').should('contain.text', 'Entwurf');
    cy.get('@reviewRow').find('.decision-code-value').should('contain.text', '2');
    cy.get('@reviewRow').find('.coder-column-cell.selected-code-match .coder-code-value').should('have.text', '2');
    cy.then(() => { expect(loads, 'draft save does not reload the review').to.equal(1); });
  });
});
