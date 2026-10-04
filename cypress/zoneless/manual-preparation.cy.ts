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
    } });
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
    cy.get('coding-box-coding-management-manual').should('be.visible');
  }

  function openTraining(): void {
    cy.contains('.manual-coding-tabs [role="tab"]', 'Schulung').click();
    cy.contains('#manual-support button', 'Kodierschulung erstellen').click();
    cy.get('coding-box-coder-training').as('training');
  }

  function selectTrainingInputs(): void {
    cy.get('@training').find('[formControlName="trainingLabel"]').type('Browser training');
    cy.get('@training').contains('.coder-item', 'Coder A').click();
    cy.get('@training').find('.variable-multiselect-field mat-select').click();
    cy.contains('mat-option', 'UNIT_A - VAR_1').click();
    cy.get('mat-select').filter('[aria-expanded="true"]').type('{esc}');
    cy.get('@training').find('.start-training-button').should('be.enabled');
  }

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

  it('discards a reference response after closing and renders fresh references on reopening', () => {
    setup();
    const oldGate = gate();
    let reads = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/coding/coder-trainings', async request => {
      reads += 1;
      if (reads === 1) {
        await oldGate.wait;
        request.reply({ body: [{ ...training, label: 'Old reference' }] });
      } else request.reply({ body: [{ ...training, id: 8, label: 'Fresh reference' }] });
    });
    openManual();
    openTraining();
    cy.wrap(null).should(() => { expect(reads).to.equal(1); });
    cy.get('@training').find('.close-button').click();
    openTraining();
    cy.get('@training').find('mat-select[formControlName="referenceTrainingIds"]').click();
    cy.contains('mat-option', 'Fresh reference').should('be.visible');
    cy.then(() => oldGate.release());
    cy.contains('mat-option', 'Old reference').should('not.exist');
    cy.get('mat-select[formControlName="referenceTrainingIds"]').type('{esc}');
    cy.get('@training').find('.close-button').click();
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
    cy.get('@bundle').find('.variable-card').should('have.length', 1).and('contain.text', 'UNIT_A_VAR_2').click();
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
    cy.get('app-error-message-display .close-button').click();
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
    cy.intercept('GET', '**/api/wsg-admin/workspace/6/coding-job?*', { body: { data: [], total: 0, page: 1, limit: 1 } });
  }

  function leaveWorkspace(): void {
    cy.window().then(win => { win.location.hash = ''; });
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/6/coding/manual'; });
    cy.get('coding-box-coding-management-manual').should('be.visible');
  }

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
