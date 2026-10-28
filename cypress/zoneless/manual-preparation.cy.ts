const variables = [
  { unitName: 'UNIT_A', variableId: 'VAR_1' },
  { unitName: 'UNIT_A', variableId: 'VAR_2' },
  { unitName: 'UNIT_B', variableId: 'VAR_1' }
].map(variable => ({
  ...variable, responseCount: 10, availableCases: 10, uniqueCasesAfterAggregation: 10,
  deriveErrorResponseCount: 0, casesInJobs: 0, isDerived: false
}));
const coders = [{ userId: 11, username: 'Coder A' }, { userId: 12, username: 'Coder B' }];
const training = { id: 7, workspace_id: 5, label: 'Reference training', assigned_coders: [11], jobsCount: 1 };
const definition = {
  id: 99, name: 'Browser definition', status: 'approved', createdJobsCount: 0,
  assigned_coders: [11, 12], assigned_variables: [variables[0]], assigned_variable_bundles: []
};
const preview = {
  selectedVariables: [variables[0]], selectedVariableBundles: [],
  selectedCoders: [{ id: 11, name: 'Coder A' }, { id: 12, name: 'Coder B' }],
  distribution: { 'UNIT_A::VAR_1': { 'Coder A': 5, 'Coder B': 5 } },
  distributionByCoderId: { 'UNIT_A::VAR_1': { '11': 5, '12': 5 } },
  doubleCodingInfo: {}, warnings: []
};

describe('Zoneless manual preparation workflows', () => {
  let unexpectedRequests: string[];
  let releases: Array<() => void>;

  beforeEach(() => {
    unexpectedRequests = [];
    releases = [];
    cy.viewport(1400, 1000);
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
  });

  afterEach(() => {
    releases.splice(0).forEach(release => release());
    cy.task('deferred:reset');
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests, 'explicit API fixtures').to.deep.equal([]); });
  });

  function gate(): { wait: Promise<void>; release: () => void } {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    releases.push(release);
    return { wait, release };
  }

  function setup(isAdmin = true, accessLevel = 3): void {
    cy.mockKeycloakAuthentication('e2e-user', isAdmin ? ['admin'] : []);
    cy.stubWorkspace({ workspaceId: 5, isAdmin, accessLevel });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/active', { body: { hasActiveJob: false } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/readiness?*', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/statistics?*', { body: { totalResponses: 0, statusCounts: {} } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/aggregation-settings', { body: { flags: [], threshold: 2 } });
    cy.intercept('GET', '**/api/admin/workspace/5/missings-profiles/IQB-Standard', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coders', { delay: 300, body: { data: coders, total: 2 } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/incomplete-variables?*', { delay: 300, body: variables }).as('variables');
    cy.intercept('GET', '**/api/admin/workspace/5/variable-bundle?*', { delay: 300, body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions', { delay: 300, body: [definition] });
    cy.intercept('POST', '**/api/admin/workspace/5/coding/coder-training-packages', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/progress-overview', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/variable-coverage-overview', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/case-coverage-overview', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/cohens-kappa/workspace-summary?*', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/incomplete-variables/scope-summary?*', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/incomplete-variables/code-availability?*', {
      body: { checkedVariables: 3, warningCount: 0, warnings: [] }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/response-analysis?*', { body: {
      emptyResponses: { total: 0, totalUncoded: 0, items: [] },
      duplicateValues: { total: 0, totalResponses: 0, groups: [], isAggregationApplied: false },
      aggregationSummary: { duplicateGroups: 0, duplicateResponses: 0, collapsedCases: 0, rawCases: 30,
        effectiveCases: 30, threshold: 2, aggregationActive: false },
      matchingFlags: [], analysisTimestamp: '2026-10-03T10:00:00Z'
    } }).as('preparationAnalysis');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/double-coded-review?*', {
      body: { data: [], total: 0, page: 1, limit: 1 }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/applied-results-overview', { body: null });
  }

  function openManual(): void {
    cy.visit('/');
    cy.wait('@authData');
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/coding/manual'; });
    cy.get('coding-box-coding-management-manual > .coding-container')
      .then(manual => settleFiniteAncestorAnimations(manual[0]))
      .should('be.visible');
  }

  function openTraining(options: { holdEntrance?: boolean } = {}): void {
    cy.contains('.manual-coding-tabs [role="tab"]', 'Schulung').click();
    cy.contains('#manual-support button', 'Kodierschulung erstellen').click();
    cy.get('coding-box-coder-training').as('training').then(training => {
      if (options.holdEntrance) {
        for (const selector of ['.coding-container', '.coder-training-overlay', '.coder-training-modal']) {
          const ancestor = training[0].closest(selector)!;
          const held = ancestor.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
          held.pause();
          held.currentTime = 0;
          expect(ancestor.ownerDocument.defaultView!.getComputedStyle(ancestor).opacity,
            `${selector} entrance was held at its invisible first frame`).to.equal('0');
        }
      }
      settleFiniteAncestorAnimations(training[0]);
    });
  }

  it('keeps extracted view styles scoped and preserves the job-definition notice styling', () => {
    setup();
    openManual();
    cy.get('coding-box-manual-coding-preparation-view .aggregation-config').should('be.visible');
    cy.get('coding-box-manual-coding-preparation-view .aggregation-config .subsection-title')
      .should('have.css', 'color', 'rgb(25, 118, 210)');
    cy.contains('.manual-coding-tabs [role="tab"]', 'Planung').click();
    cy.contains('#manual-planning button', 'Aktualisieren').click();
    cy.get('coding-box-coding-job-definitions .info-button').click();
    cy.get('coding-box-coding-job-definitions .info-alert')
      .should('be.visible').and('have.css', 'background-color', 'rgb(252, 228, 236)');
  });

  function settleFiniteAncestorAnimations(element: HTMLElement): void {
    // Electron can stall entrance motion on the workspace, modal and Material menu.
    // Settle only finite animations along this ancestor chain; loading indicators keep running.
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      ancestor.getAnimations().forEach(animation => {
        const endTime = animation.effect?.getComputedTiming().endTime;
        if (typeof endTime === 'number' && Number.isFinite(endTime)) animation.finish();
      });
    }
  }

  function closeTraining(): void {
    cy.get('@training').find<HTMLButtonElement>('.close-button')
      .should('be.visible')
      .should(buttons => {
        const button = buttons[0];
        const { left, top, width, height } = button.getBoundingClientRect();
        const target = button.ownerDocument.elementFromPoint(left + width / 2, top + height / 2);
        expect(button.contains(target), 'close button is reachable at its center').to.equal(true);
      })
      // The fixed modal is already in view; scrolling its ancestors moves the background.
      .click({ scrollBehavior: false });
  }

  function selectTrainingInputs(): void {
    cy.get('@training').find('[formControlName="trainingLabel"]').type('Browser training');
    cy.get('@training').contains('.coder-item', 'Coder A').click();
    cy.get('@training').find('.variable-multiselect-field mat-select').click();
    cy.contains('mat-option', 'UNIT_A - VAR_1').click();
    cy.get('mat-select').filter('[aria-expanded="true"]').type('{esc}');
    cy.get('@training').find('.start-training-button').should('be.enabled');
  }

  it('can dismiss the training editor while its deferred JavaScript download is pending', () => {
    setup();
    openManual();
    cy.contains('.manual-coding-tabs [role="tab"]', 'Schulung').click();
    const download = gate();
    cy.intercept('GET', '**/chunk-*.js', request => download.wait.then(() => { request.continue(); }))
      .as('trainingChunk');
    cy.contains('#manual-support button', 'Kodierschulung erstellen').click();
    cy.get('.coder-training-modal [role="status"]').should('contain.text', 'Ansicht wird geladen');
    cy.get('.coder-training-modal').then(modal => settleFiniteAncestorAnimations(modal[0]));
    cy.contains('.coder-training-modal button', 'Schließen').click({ scrollBehavior: false });
    cy.get('.coder-training-overlay').should('not.exist');
    cy.then(() => download.release());
    cy.wait('@trainingChunk');
    cy.get('coding-box-coder-training').should('not.exist');
  });

  it('can dismiss the training editor when its deferred JavaScript download fails', () => {
    setup();
    openManual();
    cy.contains('.manual-coding-tabs [role="tab"]', 'Schulung').click();
    cy.intercept('GET', '**/chunk-*.js', {
      statusCode: 503, body: 'Deferred download unavailable'
    }).as('trainingChunk');
    cy.contains('#manual-support button', 'Kodierschulung erstellen').click();
    cy.wait('@trainingChunk');
    cy.get('.coder-training-modal [role="alert"]').should('contain.text', 'Die Ansicht konnte nicht geladen werden.');
    cy.get('coding-box-coder-training').should('not.exist');
    cy.get('.coder-training-modal').then(modal => settleFiniteAncestorAnimations(modal[0]));
    cy.contains('.coder-training-modal button', 'Schließen').click({ scrollBehavior: false });
    cy.get('.coder-training-overlay').should('not.exist');
  });

  it('keeps the latest variable filter and scope after earlier responses arrive last', () => {
    setup();
    const old = gate();
    let oldRequests = 0;
    let oldReplies = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/missings-profiles', { body: [{ id: 1, label: 'IQB-Standard' }] });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions?includePlannedUsage=true', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/incomplete-variables?*', async request => {
      const unitName = String(request.query.unitName || '');
      if (unitName === 'UNIT_A') {
        oldRequests += 1;
        await old.wait;
        request.reply({ body: variables.filter(variable => variable.unitName === unitName) });
        oldReplies += 1;
      } else {
        if (unitName === 'UNIT_B') request.alias = 'filteredVariables';
        request.reply({ body: unitName ? variables.filter(variable => variable.unitName === unitName) : variables });
      }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/incomplete-variables/scope-summary?*', async request => {
      const unitName = String(request.query.unitName || '');
      if (unitName === 'UNIT_A') {
        oldRequests += 1;
        await old.wait;
      }
      if (unitName === 'UNIT_B') request.alias = 'filteredScope';
      request.reply({ body: {
        manualVariableCount: 1, manualResponseCount: 10, coveredSourceVariableCount: 1,
        coveredSourceResponseCount: unitName === 'UNIT_A' ? 99 : 7, coveredSourceVariables: []
      } });
      if (unitName === 'UNIT_A') oldReplies += 1;
    });
    openManual();
    cy.contains('.manual-coding-tabs [role="tab"]', 'Planung').click();
    cy.contains('#manual-planning button', 'Aktualisieren').click();
    cy.get('coding-box-coding-job-definitions .header-actions button[mat-raised-button]').click();
    cy.get('coding-box-coding-job-definition-dialog').as('definitionDialog');
    cy.get('@definitionDialog').contains('[role="tab"]', 'Einzelne Variablen').click();
    cy.get('@definitionDialog').find('input[placeholder="Filter nach Aufgaben-ID"]').type('UNIT_A');
    cy.get('@definitionDialog').contains('button', 'Filter anwenden').click();
    cy.wrap(null).should(() => { expect(oldRequests).to.equal(2); });
    cy.get('@definitionDialog').find('input[placeholder="Filter nach Aufgaben-ID"]').clear().type('UNIT_B');
    cy.get('@definitionDialog').contains('button', 'Filter anwenden').click();
    cy.wait('@filteredVariables');
    cy.wait('@filteredScope');
    cy.get('@definitionDialog').find('.variable-card').should('have.length', 1).and('contain.text', 'UNIT_B_VAR_1');
    cy.get('@definitionDialog').find('.manual-scope-note').should('contain.text', '7');
    cy.then(() => old.release());
    cy.wrap(null).should(() => { expect(oldReplies).to.equal(2); });
    cy.get('@definitionDialog').find('.variable-card').should('have.length', 1).and('contain.text', 'UNIT_B_VAR_1');
    cy.get('@definitionDialog').find('.manual-scope-note').should('contain.text', '7').and('not.contain.text', '99');
  });

  it('updates the workload estimate from variable selection, case limit and duration without losing the form', () => {
    setup();
    cy.intercept('GET', '**/api/admin/workspace/5/coding/missings-profiles', { body: [{ id: 1, label: 'IQB-Standard' }] });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions?includePlannedUsage=true', { body: [] });
    openManual();
    cy.contains('.manual-coding-tabs [role="tab"]', 'Planung').click();
    cy.contains('#manual-planning button', 'Aktualisieren').click();
    cy.get('coding-box-coding-job-definitions .header-actions button[mat-raised-button]').click();
    cy.get('coding-box-coding-job-definition-dialog').as('definitionDialog');
    cy.get('@definitionDialog').find('[formControlName="name"]').type('Workload draft');
    cy.get('@definitionDialog').find('[formControlName="durationSeconds"]').type('{selectall}30');
    cy.get('@definitionDialog').contains('[role="tab"]', 'Einzelne Variablen').click();
    cy.get('@definitionDialog').contains('.variable-card', 'UNIT_A_VAR_2').click();
    cy.get('@definitionDialog').contains('.count-item', 'Für neue Jobs verfügbar:').find('.count-value').should('have.text', '10');
    cy.get('@definitionDialog').contains('.count-item', 'Geschätzte Zeit:').find('.count-value').should('have.text', '5:00');
    cy.get('@definitionDialog').find('[formControlName="maxCodingCases"]').type('4');
    cy.get('@definitionDialog').contains('.count-item', 'Für neue Jobs verfügbar:').find('.count-value').should('have.text', '4');
    cy.get('@definitionDialog').contains('.count-item', 'Geschätzte Zeit:').find('.count-value').should('have.text', '2:00');
    cy.get('@definitionDialog').find('[formControlName="name"]').should('have.value', 'Workload draft');
  });

  it('estimates a scoped manual export, offers the compact format and releases startup after failure', () => {
    setup();
    let attempts = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions', { delay: 300, body: [definition] }).as('exportDefinitions');
    cy.intercept('POST', '**/api/admin/workspace/5/coding/export/estimate', request => {
      expect(request.body.exportType).to.equal('by-variable');
      expect(request.body.jobDefinitionIds).to.deep.equal([99]);
      expect(request.body.excludeAutoCoded).to.equal(true);
      request.reply({ delay: 300, body: { exportType: 'by-variable', unitVariableCount: 1200, worksheetLimit: 1000, exceedsWorksheetLimit: true } });
    }).as('estimateManualExport');
    cy.intercept('POST', '**/api/admin/workspace/5/coding/export/start', request => {
      attempts += 1;
      expect(request.body.exportType).to.equal('by-variable-compact');
      expect(request.body.jobDefinitionIds).to.deep.equal([99]);
      expect(request.body.excludeAutoCoded).to.equal(true);
      request.reply({ delay: 300, statusCode: 503, body: { message: 'Temporarily unavailable' } });
    }).as('startManualExport');
    openManual();
    cy.contains('.manual-coding-tabs [role="tab"]', 'Durchführung').click();
    cy.get('#manual-execution').contains('button', 'Export').as('exportButton').should('be.enabled').click();
    cy.wait('@exportDefinitions');
    cy.get('@exportButton').click();
    cy.get('coding-box-manual-coding-export-dialog').as('exportDialog');
    cy.get('@exportDialog').find('mat-radio-button[value="new-row-per-variable"] input[type="radio"]').check({ force: true }).should('be.checked');
    cy.get('@exportDialog').find('mat-select').first().click();
    cy.contains('mat-option', 'Browser definition').click();
    cy.get('@exportDialog').find('mat-select').first().type('{esc}');
    cy.get('@exportDialog').find('mat-dialog-actions button').last().click();
    cy.wait('@estimateManualExport');
    cy.get('coding-box-confirm-dialog').should('contain.text', '1200');
    cy.get('coding-box-confirm-dialog').contains('button', 'kompakt', { matchCase: false }).click();
    cy.get('@exportButton').should('be.disabled');
    cy.wait('@startManualExport');
    cy.get('@exportButton').should('be.enabled');
    cy.get('mat-snack-bar-container').should('contain.text', 'Datenexport konnte nicht gestartet werden');
    cy.then(() => { expect(attempts).to.equal(1); });
  });

  it('keeps matching options when the extracted settings view is recreated', () => {
    setup();
    cy.intercept('GET', '**/api/admin/workspace/5/coding/statistics?*', { body: { totalResponses: 0, statusCounts: {} } });
    cy.intercept('POST', '**/api/admin/workspace/5/coding/aggregation-settings', request => {
      expect(request.body.threshold).to.equal(3);
      expect(request.body.flags).to.deep.equal(['IGNORE_CASE']);
      request.reply({ delay: 300, body: { success: true, threshold: 3, flags: request.body.flags, aggregationActive: true, revertedResponses: 0, message: 'saved' } });
    }).as('saveMatching');
    openManual();
    cy.get('coding-box-manual-coding-aggregation-settings').as('settings');
    cy.get('@settings').find('input[type="number"]').should('have.value', '2');
    cy.get('@settings').find('mat-checkbox').first().click();
    cy.get('@settings').should('contain.text', 'Optionen geändert');
    cy.contains('.manual-coding-tabs [role="tab"]', 'Schulung').click();
    cy.get('coding-box-manual-coding-aggregation-settings').should('not.exist');
    cy.contains('.manual-coding-tabs [role="tab"]', 'Vorbereitung').click();
    cy.get('coding-box-manual-coding-aggregation-settings mat-checkbox input').first().should('be.checked');
    cy.get('coding-box-manual-coding-aggregation-settings').should('contain.text', 'Optionen geändert');
    cy.get('coding-box-manual-coding-aggregation-settings input[type="number"]').clear().type('3');
    cy.get('coding-box-manual-coding-aggregation-settings .saving-indicator').should('be.visible');
    cy.wait('@saveMatching');
    cy.get('coding-box-manual-coding-aggregation-settings input[type="number"]').should('have.value', '3');
    cy.get('coding-box-manual-coding-aggregation-settings .saving-indicator').should('not.exist');
    cy.get('coding-box-manual-coding-aggregation-settings mat-checkbox input').first().should('be.checked');
    cy.screenshot('manual-aggregation-settings-refactor', { capture: 'viewport' });
  });

  it('interprets quoted CSV headers and permits selecting the same file again after cancelling', () => {
    setup();
    openManual();
    const file = { contents: Cypress.Buffer.from('\uFEFF"Unit Alias";"Variable-ID";"score"\nUNIT_A;VAR_1;1'), fileName: 'codes.csv', mimeType: 'text/csv' };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      cy.get('coding-box-coding-management-manual input[type="file"]').selectFile(file, { force: true });
      cy.get('coding-box-coding-import-format-dialog').should('contain.text', 'codes.csv');
      cy.get('coding-box-coding-import-format-dialog mat-dialog-content').should('be.visible');
      cy.get('coding-box-coding-import-format-dialog .header-list').should('contain.text', 'unit_alias').and('contain.text', 'variable_id');
      cy.get('coding-box-coding-import-format-dialog').contains('button', 'Abbrechen').click();
      cy.get('coding-box-coding-import-format-dialog').should('not.exist');
      cy.get('coding-box-coding-management-manual .header-actions button').first().should('be.enabled');
    }
  });

  it('preserves newer input and the saving indicator while an older threshold save finishes', () => {
    setup();
    const firstSave = gate();
    const secondSave = gate();
    const thresholds: number[] = [];
    cy.intercept('GET', '**/api/admin/workspace/5/coding/statistics?version=v2', {
      body: { totalResponses: 0, statusCounts: {} }
    });
    cy.intercept('POST', '**/api/admin/workspace/5/coding/aggregation-settings', async request => {
      thresholds.push(request.body.threshold);
      await (thresholds.length === 1 ? firstSave.wait : secondSave.wait);
      request.reply({ body: {
        success: true,
        threshold: request.body.threshold,
        flags: request.body.flags,
        aggregationActive: false,
        revertedResponses: 0,
        message: 'saved'
      } });
    }).as('saveThreshold');
    openManual();
    cy.get('.threshold-control input').scrollIntoView().as('threshold').should('be.enabled');
    cy.get('@threshold').type('{selectall}3').should('have.value', '3');
    cy.wrap(thresholds).should('deep.equal', [3]);
    cy.get('@threshold').type('{selectall}4').should('have.value', '4');
    cy.then(() => { expect(thresholds).to.deep.equal([3]); });
    cy.then(() => firstSave.release());
    cy.wait('@saveThreshold').its('request.body.threshold').should('eq', 3);
    cy.wrap(thresholds).should('deep.equal', [3, 4]);
    cy.get('@threshold').should('have.value', '4');
    cy.get('.threshold-control .saving-indicator').should('be.visible');
    cy.then(() => secondSave.release());
    cy.wait('@saveThreshold').its('request.body.threshold').should('eq', 4);
    cy.get('@threshold').should('have.value', '4');
    cy.get('.threshold-control .saving-indicator').should('not.exist');
  });

  it('renders delayed reference trainings and preserves selections through a failed save and retry', () => {
    setup();
    const trainingsGate = gate();
    cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings', async request => {
      await trainingsGate.wait;
      request.reply({ body: [training] });
    }).as('trainings');
    let saves = 0;
    cy.intercept('POST', '**/api/admin/workspace/5/coding/coder-training-jobs', request => {
      saves += 1;
      expect(request.body.trainingLabel).to.equal('Browser training');
      expect(request.body.selectedCoders.map((coder: { id: number }) => coder.id)).to.deep.equal([11]);
      expect(request.body.assignedVariables).to.deep.equal([{ unitName: 'UNIT_A', variableId: 'VAR_1', sampleCount: 10 }]);
      expect(request.body.referenceTrainingIds).to.deep.equal([7]);
      expect(request.body.referenceMode).to.equal('same');
      request.reply(saves === 1 ? { delay: 400, statusCode: 500, body: { message: 'Synthetic save failure' } } :
        { delay: 400, body: { success: true, jobsCreated: 1, message: '' } });
    }).as('saveTraining');
    openManual();
    openTraining();
    cy.get('@training').find('mat-select[formControlName="referenceTrainingIds"]').should('not.exist');
    cy.then(() => trainingsGate.release());
    cy.wait('@trainings');
    cy.get('@training').find('mat-select[formControlName="referenceTrainingIds"]').scrollIntoView().should('be.visible').click();
    cy.contains('mat-option', 'Reference training').click();
    cy.get('mat-select[formControlName="referenceTrainingIds"]').type('{esc}');
    cy.get('@training').find('mat-radio-button[value="same"] input').check();
    selectTrainingInputs();
    cy.get('@training').find('.start-training-button').click().should('be.disabled');
    cy.wait('@saveTraining').its('response.statusCode').should('eq', 500);
    cy.get('@training').find('.start-training-button').should('be.enabled');
    cy.get('@training').find('[formControlName="trainingLabel"]').should('have.value', 'Browser training');
    cy.get('@training').find('.coder-item.selected').should('have.length', 1);
    cy.get('@training').find('mat-select[formControlName="referenceTrainingIds"]').should('contain.text', 'Reference training');
    cy.get('@training').find('.start-training-button').click();
    cy.wait('@saveTraining').its('response.statusCode').should('eq', 200);
    cy.get('coding-box-coder-training').should('not.exist');
    cy.then(() => { expect(saves).to.equal(2); });
  });

  it('cancels the pending reference request on closing and renders fresh references on reopening', () => {
    setup();
    let reads = 0;
    let referenceAborts = 0;
    let referenceRequest: XMLHttpRequest | undefined;
    cy.task<{ id: string; url: string }>('deferred:create', { body: [{ ...training, label: 'Old reference' }] }).then(gate => {
      cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings', request => {
        reads += 1;
        if (reads === 1) {
          request.url = gate.url;
          request.continue();
        } else request.reply({ body: [{ ...training, id: 8, label: 'Fresh reference' }] });
      });
    });
    openManual();
    cy.window().then(win => {
      const prototype = win.XMLHttpRequest.prototype;
      const originalOpen = prototype.open;
      prototype.open = new Proxy(originalOpen, {
        apply(target, request: XMLHttpRequest, args: unknown[]) {
          if (!referenceRequest && String(args[1]).endsWith('/coding/coder-trainings')) {
            referenceRequest = request;
            request.addEventListener('abort', () => { referenceAborts += 1; });
          }
          return Reflect.apply(target, request, args);
        }
      });
      releases.push(() => { prototype.open = originalOpen; });
    });
    openTraining({ holdEntrance: true });
    cy.wrap(null).should(() => { expect(reads).to.equal(1); });
    cy.then(() => {
      // Inspect scalars only: native getters such as responseXML can throw during object formatting.
      expect(Boolean(referenceRequest), 'reference request started').to.equal(true);
      expect(referenceRequest!.readyState, 'reference response still pending').not.to.equal(XMLHttpRequest.DONE);
    });
    cy.get('.router-panel').scrollTo('bottom', { ensureScrollable: false });
    closeTraining();
    cy.get('coding-box-coder-training').should('not.exist');
    cy.wrap(null).should(() => { expect(referenceAborts, 'reference request aborted').to.equal(1); });
    openTraining();
    cy.get('@training').find('mat-select[formControlName="referenceTrainingIds"]').click();
    cy.contains('mat-option', 'Fresh reference').then(options => {
      const panel = options[0].closest('.mat-mdc-select-panel')!;
      const held = panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
      held.pause();
      held.currentTime = 0;
      expect(panel.ownerDocument.defaultView!.getComputedStyle(panel).opacity,
        'reference menu entrance was held at its invisible first frame').to.equal('0');
      settleFiniteAncestorAnimations(options[0]);
    });
    cy.contains('mat-option', 'Fresh reference').should('be.visible');
    cy.contains('mat-option', 'Old reference').should('not.exist');
    cy.get('mat-select[formControlName="referenceTrainingIds"]').type('{esc}');
    closeTraining();
  });

  for (const role of [{ name: 'coding manager', level: 2 }, { name: 'study manager', level: 3 }]) {
    it(`saves the visible training selection as ${role.name} after delayed rights`, () => {
      setup(false, role.level);
      cy.intercept('GET', '**/api/admin/users/access/5', { delay: 400, body: [{ id: 2, accessLevel: role.level, canCode: false }] });
      cy.intercept('POST', '**/api/admin/workspace/5/coding/coder-training-jobs', request => {
        expect(request.body.selectedCoders.map((coder: { id: number }) => coder.id)).to.deep.equal([11]);
        expect(request.body.variableConfigs).to.deep.equal([{ unitId: 'UNIT_A', variableId: 'VAR_1', sampleCount: 10 }]);
        request.reply({ delay: 400, body: { success: true, jobsCreated: 1, message: '' } });
      }).as('saveTraining');
      openManual();
      openTraining();
      selectTrainingInputs();
      cy.get('@training').find('.start-training-button').click();
      cy.wait('@saveTraining').its('response.statusCode').should('eq', 200);
      cy.get('coding-box-coder-training').should('not.exist');
    });
  }

  for (const role of [{ name: 'no workspace access', level: 0 }, { name: 'coder', level: 1 }]) {
    it(`keeps training and bulk mutations unreachable for ${role.name} while rights arrive late`, () => {
      setup(false, role.level);
      cy.intercept('GET', '**/api/admin/users/access/5', {
        delay: 400, body: [{ id: 2, accessLevel: role.level, canCode: role.level === 1 }]
      }).as('roleRights');
      let mutations = 0;
      cy.intercept('POST', '**/api/admin/workspace/5/coding/**', request => {
        mutations += 1;
        request.reply({ statusCode: 403 });
      });
      cy.visit('/');
      cy.wait('@authData');
      // Finish the home redirect before testing a new, guarded navigation.
      if (role.level === 1) {
        cy.location('hash', { timeout: 15_000 }).should('equal', '#/coding');
        cy.get('coding-box-my-coding-jobs').should('be.visible');
      } else {
        cy.get('coding-box-home').should('be.visible');
      }
      cy.window().then(win => { win.location.hash = '/workspace-admin/5/coding/manual'; });
      cy.wait('@roleRights');
      cy.location('hash', { timeout: 15_000 }).should('contain', role.level === 1 ? '/coding/my-jobs' : 'auth=access-denied');
      cy.get('coding-box-coding-management-manual').should('not.exist');
      cy.get('coding-box-coder-training').should('not.exist');
      cy.get('coding-box-coding-job-bulk-creation-dialog').should('not.exist');
      cy.then(() => { expect(mutations).to.equal(0); });
    });
  }

  it('filters delayed variable cards after debounce and saves precisely the selected filtered variable', () => {
    setup();
    cy.intercept('POST', '**/api/admin/workspace/5/variable-bundle', request => {
      request.reply({ delay: 400, body: { ...request.body, id: 9, created_at: '2026-10-03', updated_at: '2026-10-03' } });
    }).as('saveBundle');
    openManual();
    cy.contains('.manual-coding-tabs [role="tab"]', 'Vorbereitung').click();
    cy.contains('.statistics-card > .header-row > .header-actions button', 'Aktualisieren').click();
    const variablesGate = gate();
    let requested = false;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/incomplete-variables?*', async request => {
      requested = true;
      await variablesGate.wait;
      request.reply({ body: variables });
    }).as('bundleVariables');
    cy.contains('coding-box-variable-bundle-manager button', 'Variablenbündel erstellen').click();
    cy.wrap(null).should(() => { expect(requested).to.equal(true); });
    cy.get('coding-box-variable-bundle-dialog').should('not.exist');
    cy.then(() => variablesGate.release());
    cy.wait('@bundleVariables');
    cy.get('coding-box-variable-bundle-dialog').as('bundle');
    // Let Material finish its initial focus before typing into another control.
    cy.get('@bundle').find('input[formControlName="name"]').should('be.focused');
    cy.get('@bundle').find('.variable-card').should('have.length', 3);
    cy.get('@bundle').find('input[placeholder="Filter nach Aufgaben-ID"]').focus().type('UNIT_A');
    cy.get('@bundle').find('input[placeholder="Filter nach Aufgaben-ID"]').should('have.value', 'UNIT_A');
    cy.get('@bundle').find('.variable-card').should('have.length', 2);
    cy.get('@bundle').find('.selection-count').should('contain.text', '0 von 2');
    cy.get('@bundle').find('input[placeholder="Filter nach Variablen-ID"]').focus().type('missing');
    cy.get('@bundle').find('.variable-card').should('not.exist');
    cy.get('@bundle').find('input[placeholder="Filter nach Variablen-ID"]').clear().type('VAR_2');
    cy.get('@bundle').find('.variable-card').should('have.length', 1).and('contain.text', 'UNIT_A_VAR_2')
      .focus().should('have.focus');
    cy.press(Cypress.Keyboard.Keys.ENTER);
    cy.get('@bundle').find('.selection-count').should('contain.text', '1 von 1');
    cy.press(Cypress.Keyboard.Keys.SPACE);
    cy.get('@bundle').find('.selection-count').should('contain.text', '0 von 1');
    cy.press(Cypress.Keyboard.Keys.SPACE);
    cy.get('@bundle').find('.selection-count').should('contain.text', '1 von 1');
    cy.get('@bundle').find('.variable-card input[type="checkbox"]').focus().should('have.focus');
    cy.press(Cypress.Keyboard.Keys.SPACE);
    cy.get('@bundle').find('.selection-count').should('contain.text', '0 von 1');
    cy.press(Cypress.Keyboard.Keys.SPACE);
    cy.get('@bundle').find('.selection-count').should('contain.text', '1 von 1');
    cy.get('@bundle').find('input[formControlName="name"]').focus().clear().type('Filtered bundle');
    cy.get('@bundle').contains('button', 'Filter zurücksetzen').click();
    cy.get('@bundle').find('.variable-card').should('have.length', 3);
    cy.get('@bundle').find('.variable-card.selected').should('have.length', 1);
    cy.get('@bundle').find('.dialog-actions').should('be.visible');
    cy.get('@bundle').find('.dialog-actions').contains('button', 'Erstellen').click();
    cy.wait('@saveBundle').then(({ request, response }) => {
      expect(response?.statusCode).to.equal(200);
      expect(request.body.variables.map((variable: { unitName: string; variableId: string }) => ({
        unitName: variable.unitName, variableId: variable.variableId
      }))).to.deep.equal([{ unitName: 'UNIT_A', variableId: 'VAR_2' }]);
      expect(request.body.name).to.equal('Filtered bundle');
    });
    cy.get('coding-box-variable-bundle-dialog').should('not.exist');
    cy.get('mat-snack-bar-container').should('contain.text', 'wurde erstellt');
  });

  function openBulk(): void {
    cy.contains('.manual-coding-tabs [role="tab"]', 'Planung').click();
    cy.contains('#manual-planning button', 'Aktualisieren').click();
    cy.contains('coding-box-coding-job-definitions tr', 'Browser definition')
      .find('.primary-row-action').click();
  }

  it('recovers from a delayed bulk preview failure, renders the server distribution and creates only after confirmation', () => {
    setup();
    let previews = 0;
    let creates = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions/99/create-job-preview', request => {
      previews += 1;
      request.reply(previews === 1 ? { delay: 400, statusCode: 500, body: { message: 'Synthetic preview failure' } } :
        { delay: 400, body: preview });
    }).as('preview');
    const creationGate = gate();
    cy.intercept('POST', '**/api/admin/workspace/5/coding/job-definitions/99/create-job', async request => {
      creates += 1;
      expect(request.body).to.deep.equal({});
      await creationGate.wait;
      request.reply({ body: { success: true, jobsCreated: 2, message: '' } });
    }).as('createJobs');
    openManual();
    openBulk();
    cy.wait('@preview').its('response.statusCode').should('eq', 500);
    cy.get('coding-box-coding-job-bulk-creation-dialog').should('not.exist');
    cy.get('coding-box-error-message-display .close-button').each(button => cy.wrap(button).click());
    cy.get('coding-box-error-message-display .close-button').should('not.exist');
    cy.contains('coding-box-coding-job-definitions tr', 'Browser definition').find('.primary-row-action').click();
    cy.wait('@preview').its('response.statusCode').should('eq', 200);
    cy.get('coding-box-coding-job-bulk-creation-dialog').as('bulk');
    cy.get('@bulk').find('.matrix-header').should('contain.text', 'Coder A').and('contain.text', 'Coder B');
    cy.get('@bulk').find('.matrix-row').first().find('.data-cell').each(cell => {
      cy.wrap(cell).invoke('text').should('match', /^\s*5\s*$/);
    });
    cy.get('@bulk').find('.job-preview-item').should('have.length', 2);
    cy.then(() => { expect(creates).to.equal(0); });
    cy.get('@bulk').find('.dialog-actions button[color="primary"]').click();
    cy.get('coding-box-coding-job-definitions .bulk-creation-loading-container').should('be.visible');
    cy.then(() => creationGate.release());
    cy.wait('@createJobs');
    cy.get('coding-box-coding-job-definitions .bulk-creation-loading-container').should('not.exist');
    cy.get('mat-snack-bar-container').should('contain.text', '2');
    cy.then(() => { expect(creates).to.equal(1); });
  });

  it('cancels the bulk confirmation without creating jobs', () => {
    setup();
    let creates = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions/99/create-job-preview', { delay: 400, body: preview });
    cy.intercept('POST', '**/api/admin/workspace/5/coding/job-definitions/99/create-job', request => {
      creates += 1;
      request.reply({ body: { success: true } });
    });
    openManual();
    openBulk();
    cy.get('coding-box-coding-job-bulk-creation-dialog').contains('button', 'Abbrechen').click();
    cy.get('coding-box-coding-job-bulk-creation-dialog').should('not.exist');
    cy.then(() => { expect(creates).to.equal(0); });
  });

  function stubNextWorkspace(): void {
    cy.intercept('GET', '**/api/workspace/6/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/6/coding/aggregation-settings', {
      delay: 800, body: { flags: [], threshold: 2 }
    }).as('newWorkspace');
    cy.intercept('GET', '**/api/admin/workspace/6/coding/reset-version/active', { body: { hasActiveJob: false } });
    cy.intercept('GET', '**/api/admin/workspace/6/coding/readiness?*', { body: null });
    cy.intercept('GET', '**/api/admin/workspace/6/missings-profiles/IQB-Standard', { body: null });
    cy.intercept('GET', '**/api/admin/users/access/6', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/6/coders', { body: { data: [], total: 0 } });
    cy.intercept('GET', '**/api/admin/workspace/6/coding/coder-trainings', { body: [] });
    cy.intercept('GET', '**/api/wsg-admin/workspace/6/coding-job?*', { body: { data: [], total: 0, page: 1, limit: 1 } });
  }

  function leaveWorkspace(): void {
    cy.window().then(win => { win.location.hash = ''; });
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/6/coding/manual'; });
    cy.get('coding-box-coding-management-manual').should('be.visible');
  }

  function stubWorkspaceJobs(): void {
    for (const workspaceId of [5, 6]) {
      cy.intercept('GET', `**/api/wsg-admin/workspace/${workspaceId}/coding-job?*`, {
        body: { data: [{
          id: workspaceId * 10, workspace_id: workspaceId, creatorUserId: 2,
          name: `Workspace ${workspaceId} job`, status: 'completed',
          assignedCoders: [11], assignedVariables: [], totalUnits: 1, codedUnits: 1,
          openUnits: 0, progress: 100, created_at: '2026-10-27', updated_at: '2026-10-27'
        }], total: 1, page: 1, limit: 50 }
      });
    }
  }

  it('reloads the existing job view and closes old confirmations when only the workspace route parameter changes', () => {
    setup();
    stubNextWorkspace();
    stubWorkspaceJobs();
    let deletions = 0;
    cy.intercept('DELETE', '**/api/wsg-admin/workspace/*/coding-job/*', request => {
      deletions += 1;
      request.reply({ body: { success: true } });
    });
    openManual();
    cy.title().should('equal', 'Manuelle Kodierung | IQB-Kodierbox');
    cy.contains('.manual-coding-tabs [role="tab"]', 'Durchführung').click();
    cy.contains('#manual-execution button', 'Aktualisieren').click();
    cy.contains('coding-box-coding-jobs mat-row', 'Workspace 5 job')
      .find('button.more-actions-button').click();
    cy.get('button[aria-label="Kodierjob löschen: Workspace 5 job"]').click();
    cy.get('coding-box-confirm-dialog').find('mat-dialog-content').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/6/coding/manual'; });
    cy.get('coding-box-confirm-dialog').should('not.exist');
    cy.contains('coding-box-coding-jobs mat-row', 'Workspace 6 job').should('be.visible');
    cy.get('coding-box-coding-jobs').should('not.contain.text', 'Workspace 5 job');
    cy.then(() => { expect(deletions).to.equal(0); });
  });

  it('loads the job-list chunk only when the execution tab is opened', () => {
    setup();
    let entranceHeld = false;
    cy.on('window:before:load', win => {
      const observer = new win.MutationObserver(() => {
        const container = win.document.querySelector<HTMLElement>('coding-box-coding-management-manual > .coding-container');
        if (!container) return;
        const held = container.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
        held.pause();
        held.currentTime = 0;
        expect(win.getComputedStyle(container).opacity,
          'manual page entrance was held at its invisible first frame').to.equal('0');
        entranceHeld = true;
        observer.disconnect();
      });
      observer.observe(win.document, { childList: true, subtree: true });
      releases.push(() => observer.disconnect());
    });
    openManual();
    cy.then(() => { expect(entranceHeld, 'paused page entrance was exercised').to.equal(true); });
    cy.window().then(win => {
      const requests = win.performance.getEntriesByType('resource').filter(entry => entry.name.endsWith('.js')).length;
      cy.wrap(requests).as('initialScriptRequests');
    });
    cy.get('coding-box-coding-jobs').should('not.exist');
    cy.contains('.manual-coding-tabs [role="tab"]', 'Durchführung').click();
    cy.contains('#manual-execution button', 'Aktualisieren').click();
    cy.get('coding-box-coding-jobs').should('be.visible');
    cy.get<number>('@initialScriptRequests').then(initial => {
      cy.window().should(win => {
        const requests = win.performance.getEntriesByType('resource').filter(entry => entry.name.endsWith('.js')).length;
        expect(requests).to.be.greaterThan(initial);
      });
    });
  });

  it('renders focus refreshes while throttling repeated requests and keeping productive jobs idle', () => {
    setup();
    cy.intercept('GET', '**/api/workspace/5/settings/auto-refresh-manual-coding-jobs', {
      body: { value: '{"enabled":true}' }
    }).as('autoRefreshSetting');
    let progressReads = 0;
    let productiveReads = 0;
    let productiveReadsBeforeFocus = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/progress-overview', request => {
      progressReads += 1;
      request.reply({ body: {
        totalCasesToCode: 10, completedCases: progressReads,
        completionPercentage: progressReads * 10
      } });
    }).as('progressOverview');
    cy.intercept('GET', '**/api/wsg-admin/workspace/5/coding-job?*', request => {
      if (request.query.scope === 'productive') productiveReads += 1;
      request.reply({ body: { data: [], total: 0, page: 1, limit: 50 } });
    });
    openManual();
    cy.wait(['@autoRefreshSetting', '@preparationAnalysis']);
    cy.clock(Date.now(), ['Date']);
    cy.contains('.manual-coding-tabs [role="tab"]', 'Durchführung').click();
    cy.wait('@progressOverview');
    cy.get('coding-box-manual-coding-execution-view .stat-value.covered').should('be.visible').and('have.text', '1');
    cy.get('#manual-execution coding-box-coding-jobs .no-data-message').should('exist');
    cy.get('#manual-execution coding-box-coding-jobs mat-spinner').should('not.exist');
    cy.then(() => {
      expect(productiveReads).to.be.greaterThan(0);
      productiveReadsBeforeFocus = productiveReads;
    });

    cy.window().then(win => win.dispatchEvent(new Event('focus')));
    cy.wait('@progressOverview');
    cy.get('coding-box-manual-coding-execution-view .stat-value.covered').should('be.visible').and('have.text', '2');
    cy.window().then(win => win.dispatchEvent(new Event('focus')));
    cy.tick(29999);
    cy.window().then(win => win.dispatchEvent(new Event('focus')));
    cy.get('coding-box-manual-coding-execution-view .stat-value.covered').should('be.visible').and('have.text', '2');
    cy.then(() => { expect(progressReads).to.equal(2); expect(productiveReads).to.equal(productiveReadsBeforeFocus); });

    cy.tick(1);
    cy.window().then(win => win.dispatchEvent(new Event('focus')));
    cy.wait('@progressOverview');
    cy.get('coding-box-manual-coding-execution-view .stat-value.covered').should('be.visible').and('have.text', '3');
    cy.then(() => { expect(progressReads).to.equal(3); expect(productiveReads).to.equal(productiveReadsBeforeFocus); });
  });

  it('refreshes hidden productive jobs once after a definition change without reloading training jobs', () => {
    setup();
    cy.intercept({
      method: 'GET', url: '**/api/admin/workspace/5/coding/job-definitions', middleware: true
    }, request => {
      request.on('before:response', response => response.setDelay(400));
    });
    cy.intercept('GET', '**/api/workspace/5/settings/auto-refresh-manual-coding-jobs', {
      body: { value: '{"enabled":true}' }
    });
    let deleted = false;
    let definitionReadsAfterDelete = 0;
    const reloads = { productive: 0, training: 0 };
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions', request => {
      if (deleted) definitionReadsAfterDelete += 1;
      request.reply({ body: deleted ? [] : [{ ...definition, blockingCreatedJobsCount: 0 }] });
    }).as('jobDefinitions');
    cy.intercept('DELETE', '**/api/admin/workspace/5/coding/job-definitions/99', request => {
      deleted = true;
      request.reply({ body: { success: true } });
    }).as('deleteDefinition');
    cy.intercept('GET', '**/api/wsg-admin/workspace/5/coding-job?*', request => {
      const scope = request.query.scope;
      if (scope !== 'productive' && scope !== 'training') {
        request.reply({ body: { data: [], total: 0, page: 1, limit: 50 } });
        return;
      }
      if (deleted) reloads[scope] += 1;
      request.reply({ body: { data: [{
        id: scope === 'productive' ? 50 : 51, workspace_id: 5, creatorUserId: 2,
        name: `${scope} ${deleted ? 'updated' : 'original'}`, status: 'completed',
        assignedCoders: [11], assignedVariables: [], totalUnits: 1, codedUnits: 1,
        openUnits: 0, progress: 100, created_at: '2026-10-27', updated_at: '2026-10-27'
      }], total: 1, page: 1, limit: 50 } });
    });
    openManual();
    cy.contains('.manual-coding-tabs [role="tab"]', 'Durchführung').click();
    cy.contains('#manual-execution mat-row', 'productive original').scrollIntoView().should('be.visible');
    cy.contains('.manual-coding-tabs [role="tab"]', 'Schulung').click();
    cy.contains('#manual-support mat-row', 'training original').scrollIntoView().should('be.visible');
    cy.contains('.manual-coding-tabs [role="tab"]', 'Planung').click();
    cy.wait('@jobDefinitions');
    cy.get('coding-box-coding-job-definitions .job-definitions-table-wrapper')
      .should('have.attr', 'aria-busy', 'false');
    cy.contains('#manual-planning button', 'Aktualisieren').click();
    // Await both export choices and the visible list before opening its row menu.
    cy.wait(['@jobDefinitions', '@jobDefinitions']);
    cy.get('coding-box-coding-job-definitions .job-definitions-table-wrapper')
      .should('have.attr', 'aria-busy', 'false');
    cy.contains('coding-box-coding-job-definitions tr', 'Browser definition')
      .find('.more-actions-button').click();
    cy.get('.danger-menu-item').click();
    cy.wait('@deleteDefinition');
    // The child refreshes immediately; the second read comes from the debounced parent workflow.
    cy.wrap(null).should(() => { expect(definitionReadsAfterDelete).to.equal(2); });
    cy.then(() => { expect(reloads).to.deep.equal({ productive: 0, training: 0 }); });

    cy.contains('.manual-coding-tabs [role="tab"]', 'Durchführung').click();
    cy.contains('#manual-execution mat-row', 'productive updated').scrollIntoView().should('be.visible');
    cy.then(() => { expect(reloads).to.deep.equal({ productive: 1, training: 0 }); });
    cy.contains('.manual-coding-tabs [role="tab"]', 'Schulung').click();
    cy.contains('#manual-support mat-row', 'training original').scrollIntoView().should('be.visible');
    cy.contains('.manual-coding-tabs [role="tab"]', 'Durchführung').click();
    cy.contains('#manual-execution mat-row', 'productive updated').scrollIntoView().should('be.visible');
    cy.then(() => { expect(reloads).to.deep.equal({ productive: 1, training: 0 }); });
  });

  it('does not open an old bulk preview after leaving its workspace', () => {
    setup();
    stubNextWorkspace();
    const previewGate = gate();
    let requested = false;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions/99/create-job-preview', async request => {
      requested = true;
      await previewGate.wait;
      request.reply({ body: preview });
    });
    openManual();
    openBulk();
    cy.wrap(null).should(() => { expect(requested).to.equal(true); });
    leaveWorkspace();
    cy.then(() => previewGate.release());
    cy.wait('@newWorkspace');
    cy.get('coding-box-coding-job-bulk-creation-dialog').should('not.exist');
  });

  it('closes the old bulk confirmation on workspace navigation without creating jobs', () => {
    setup();
    stubNextWorkspace();
    let creates = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions/99/create-job-preview', { delay: 400, body: preview });
    cy.intercept('POST', '**/api/admin/workspace/5/coding/job-definitions/99/create-job', request => {
      creates += 1;
      request.reply({ body: { success: true } });
    });
    openManual();
    openBulk();
    cy.get('coding-box-coding-job-bulk-creation-dialog .dialog-actions', { timeout: 15_000 }).should('be.visible');
    leaveWorkspace();
    cy.wait('@newWorkspace');
    cy.get('coding-box-coding-job-bulk-creation-dialog').should('not.exist');
    cy.then(() => { expect(creates).to.equal(0); });
  });

  it('keeps an accepted bulk completion from updating the next workspace', { defaultCommandTimeout: 15_000 }, () => {
    setup();
    stubNextWorkspace();
    const creationGate = gate();
    let creates = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions/99/create-job-preview', { body: preview });
    cy.intercept('POST', '**/api/admin/workspace/5/coding/job-definitions/99/create-job', async request => {
      creates += 1;
      await creationGate.wait;
      request.reply({ body: { success: true, jobsCreated: 2 } });
    }).as('acceptedCreation');
    openManual();
    openBulk();
    cy.get('coding-box-coding-job-bulk-creation-dialog .dialog-actions button[color="primary"]').click();
    cy.get('coding-box-coding-job-definitions .bulk-creation-loading-container').should('be.visible');
    cy.wrap(null).should(() => { expect(creates).to.equal(1); });
    leaveWorkspace();
    cy.then(() => creationGate.release());
    cy.wait('@acceptedCreation');
    cy.wait('@newWorkspace');
    cy.get('coding-box-coding-job-bulk-creation-dialog').should('not.exist');
    cy.get('mat-snack-bar-container').should('not.exist');
    cy.then(() => { expect(creates).to.equal(1); });
  });
});

export {};
