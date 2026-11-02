const originalPersons = [
  { id: 1, code: 'P01', group: 'G1', login: 'L1', uploaded_at: '2026-10-29T10:00:00Z' },
  { id: 2, code: 'P02', group: 'G1', login: 'L2', uploaded_at: '2026-10-29T10:00:00Z' }
];
const preview = (persons: number) => ({ scope: 'persons', label: 'Ausgewählte Personen', persons, booklets: 0, units: 0, responses: 0, groups: ['G1'], bookletNames: [], unitNames: [], warnings: [] });
const task = (status: string, progress = 0) => ({ id: 17, workspace_id: 5, validation_type: 'deleteTestResults', status, progress, created_at: '2026-10-30T06:00:00Z', updated_at: '2026-10-30T06:00:00Z' });

describe('zoneless test-results deletion', () => {
  let persons: typeof originalPersons;
  let posts: number;
  let previews: number;
  let unexpected: string[];
  beforeEach(() => {
    persons = [...originalPersons]; posts = 0; previews = 0; unexpected = [];
    cy.intercept('**/api/**', request => { unexpected.push(`${request.method} ${request.url}`); request.reply({ statusCode: 501, body: {} }); });
    cy.mockKeycloakAuthentication(); cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', request => request.reply({ body: { data: persons, total: persons.length } })).as('persons');
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', request => request.reply({ body: {
      testPersons: persons.length, testGroups: 1, uniqueBooklets: 0, uniqueUnits: 0, uniqueResponses: 0,
      responseStatusCounts: {}, sessionBrowserCounts: {}, sessionOsCounts: {}, sessionScreenCounts: {}
    } })).as('overview');
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', { body: [] });
    cy.intercept('POST', '**/api/admin/workspace/5/test-results/delete-preview', request => { previews += 1; request.reply({ body: preview(persons.length) }); }).as('preview');
    cy.intercept('POST', '**/api/admin/workspace/5/test-results/delete-jobs', request => { posts += 1; expect(request.body).to.deep.equal({ scope: 'persons', personIds: [1, 2] }); request.reply({ body: task('pending') }); }).as('create');
  });
  afterEach(() => {
    cy.task('deferred:reset');
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => expect(unexpected, 'unhandled API requests').to.deep.equal([]));
  });
  function openPreview(): void {
    cy.visit('/'); cy.wait('@authData');
    cy.window().then(window => { window.location.hash = '/workspace-admin/5/test-results'; });
    cy.wait(['@persons', '@overview']);
    cy.get('coding-box-test-results mat-header-row mat-checkbox').click();
    cy.contains('coding-box-test-results button', 'Ausgewählte Personen löschen').click();
    cy.wait('@preview'); cy.get('coding-box-test-results-delete-preview-dialog').should('be.visible');
  }
  function confirm(): void {
    cy.get('coding-box-test-results-delete-preview-dialog mat-checkbox').click();
    cy.contains('coding-box-test-results-delete-preview-dialog button', 'Löschung starten').click();
    cy.wait('@create');
  }

  it('cancels a preview without creating a job or clearing the current selection', () => {
    openPreview(); cy.contains('coding-box-test-results-delete-preview-dialog button', 'Abbrechen').click();
    cy.get('coding-box-test-results-delete-preview-dialog').should('not.exist');
    cy.get('coding-box-test-results .persons-table mat-row input[type="checkbox"]').should('have.length', 2).each(checkbox => cy.wrap(checkbox).should('be.checked'));
    cy.contains('coding-box-test-results button', 'Ausgewählte Personen löschen').should('be.enabled');
    cy.then(() => expect(posts).to.equal(0));
  });

  it('shows an unconfirmed enqueue without automatically submitting the deletion again', () => {
    cy.intercept('POST', '**/api/admin/workspace/5/test-results/delete-jobs', request => {
      posts += 1; request.reply({ statusCode: 503, body: { message: 'enqueue response unavailable' } });
    }).as('create');
    openPreview(); confirm();
    cy.contains('coding-box-test-results .delete-progress-container', 'konnte nicht bestätigt werden').scrollIntoView().should('be.visible');
    cy.contains('coding-box-test-results .delete-progress-container', 'Hintergrund').scrollIntoView().should('be.visible');
    cy.contains('coding-box-test-results button', 'Neue Löschvorschau').click(); cy.wait('@preview');
    cy.contains('coding-box-test-results-delete-preview-dialog button', 'Abbrechen').click();
    cy.then(() => { expect(posts).to.equal(1); expect(previews).to.equal(2); });
  });

  it('retries status and result reads for the same job and refreshes committed data even when the report fails', () => {
    let polls = 0; let reports = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/17', request => {
      polls += 1;
      if (polls === 1) request.reply({ statusCode: 503, body: { message: 'status temporarily unavailable' } });
      else { persons = []; request.reply({ body: task('completed', 100) }); }
    }).as('status');
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/17/results', request => {
      reports += 1;
      request.reply(reports === 1 ? { statusCode: 503, body: { message: 'report temporarily unavailable' } } : { body: { ...preview(2), deletedTargetCount: 2 } });
    }).as('report');
    openPreview(); confirm(); cy.wait('@status');
    cy.contains('coding-box-test-results .delete-progress-container', 'Hintergrund').scrollIntoView().should('be.visible');
    cy.contains('coding-box-test-results button', 'Ausgewählte Personen löschen').should('be.disabled');
    cy.contains('coding-box-test-results button', 'Fortschritt erneut laden').click(); cy.wait(['@status', '@report', '@persons']);
    cy.contains('coding-box-test-results .delete-progress-container', 'Ergebnisbericht').scrollIntoView().should('be.visible');
    cy.get('coding-box-test-results .persons-table mat-row').should('not.exist');
    cy.contains('coding-box-test-results .overview-metric', 'Testpersonen').find('.value').should('have.text', '0');
    cy.contains('coding-box-test-results button', 'Ergebnis erneut laden').click(); cy.wait('@report');
    cy.get('coding-box-test-results .delete-progress-container').should('not.exist');
    cy.then(() => { expect(posts).to.equal(1); expect(polls).to.equal(2); expect(reports).to.equal(2); });
  });

  it('refreshes after a partial failure and requires a new preview before retrying the remaining targets', () => {
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/17', request => {
      persons = [originalPersons[1]]; request.reply({ body: { ...task('failed', 40), error: 'Stapel 2 fehlgeschlagen' } });
    }).as('status');
    openPreview(); confirm(); cy.wait(['@status', '@persons']);
    cy.contains('coding-box-test-results .delete-progress-container', 'Teilschritte').scrollIntoView().should('be.visible');
    cy.get('coding-box-test-results .persons-table mat-row').should('have.length', 1).and('contain.text', 'P02');
    cy.get('coding-box-test-results .persons-table mat-row input[type="checkbox"]').should('not.be.checked');
    cy.contains('coding-box-test-results button', 'Neue Löschvorschau').click(); cy.wait('@preview');
    cy.get('coding-box-test-results-delete-preview-dialog .metric-value').first().should('have.text', '1');
    cy.contains('coding-box-test-results-delete-preview-dialog button', 'Abbrechen').click();
    cy.then(() => { expect(posts).to.equal(1); expect(previews).to.equal(2); });
  });

  it('ignores late replies in another workspace and resumes the known job on return', () => {
    let gateId: string; let requested = false; let reports = 0;
    cy.task<{ id: string; url: string }>('deferred:create', { body: task('completed', 100) }).then(gate => {
      gateId = gate.id;
      cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/17', request => { requested = true; request.url = gate.url; request.continue(); });
    });
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/17/results', request => { reports += 1; request.reply({ body: { ...preview(2), deletedTargetCount: 2 } }); }).as('resumedReport');
    openPreview(); confirm(); cy.wrap(null).should(() => expect(requested).to.equal(true));
    cy.window().then(window => { window.location.hash = ''; }); cy.get('coding-box-home').should('be.visible');
    cy.then(() => cy.task('deferred:release', gateId));
    // Entering the next workspace must be independent of the old job's response.
    cy.intercept('GET', '**/api/admin/users/access/6', { body: [] });
    cy.intercept('GET', '**/api/workspace/6/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/6/coding/export-missings-profiles', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/6/coding/freshness', { body: { workspaceId: 6, currentRevision: 0, items: [] } });
    cy.intercept('GET', '**/api/admin/workspace/6/responses/geogebra-existence', { body: false });
    cy.intercept('GET', '**/api/wsg-admin/workspace/6/coding-job*', { body: { data: [], total: 0, page: 1, limit: 1 } });
    cy.intercept('GET', '**/api/admin/workspace/6/results/export/jobs', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/6/test-results/?*', { body: { data: [{ ...originalPersons[1], code: 'WORKSPACE_6' }], total: 1 } }).as('nextPersons');
    cy.intercept('GET', '**/api/admin/workspace/6/test-results/overview', { body: { testPersons: 1, testGroups: 1, uniqueBooklets: 0, uniqueUnits: 0, uniqueResponses: 0, responseStatusCounts: {}, sessionBrowserCounts: {}, sessionOsCounts: {}, sessionScreenCounts: {} } });
    cy.window().then(window => { window.location.hash = '/workspace-admin/6/test-results'; }); cy.wait('@nextPersons');
    cy.get('coding-box-test-results .persons-table mat-row').should('have.length', 1).and('contain.text', 'WORKSPACE_6');
    cy.get('coding-box-test-results .delete-progress-container').should('not.exist');
    cy.then(() => { expect(reports).to.equal(0); expect(posts).to.equal(1); });
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/17', { body: task('completed', 100) }).as('resumedStatus');
    cy.window().then(window => { window.location.hash = ''; }); cy.get('coding-box-home').should('be.visible');
    cy.then(() => { persons = []; });
    cy.window().then(window => { window.location.hash = '/workspace-admin/5/test-results'; });
    cy.wait(['@resumedStatus', '@resumedReport']);
    cy.get('coding-box-test-results .persons-table mat-row').should('not.exist');
    cy.get('coding-box-test-results .delete-progress-container').should('not.exist');
    cy.then(() => { expect(posts).to.equal(1); expect(reports).to.equal(1); });
  });
});
