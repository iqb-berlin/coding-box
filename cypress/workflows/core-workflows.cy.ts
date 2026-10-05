type WorkflowSetup = {
  apiUrl: string;
  baseUrl: string;
  workspaceId: number;
  keycloakUrl: string;
  username: string;
  password: string;
};

type BackgroundJob = { status: string; error?: string };

describe('required workflows with real Keycloak, PostgreSQL and Redis', () => {
  let setup: WorkflowSetup;
  let accessToken: string;

  before(() => {
    cy.task('workflows:setup', null, { log: false, timeout: 180_000 }).then(value => {
      setup = value as WorkflowSetup;
    });
  });

  after(() => {
    cy.task('workflows:cleanup', null, { log: false });
  });

  function login(username: string) {
    cy.intercept('POST', '**/realms/coding-e2e/protocol/openid-connect/token', request => {
      request.continue(response => {
        if (response.body.access_token) accessToken = response.body.access_token;
      });
    }).as('loginToken');
    cy.intercept('GET', '**/api/auth-data*').as('authData');
    cy.visit('/');
    cy.get('.login-button').click();
    cy.origin(setup.keycloakUrl, {
      args: { username, password: setup.password }
    }, credentials => {
      cy.get('#username').type(credentials.username);
      cy.get('#password').type(credentials.password, { log: false });
      cy.get('#kc-login').click();
    });
    cy.wait('@loginToken', { log: false }).its('response.statusCode').should('eq', 200);
    cy.wait('@authData', { log: false }).its('response.statusCode').should('eq', 200);
    cy.get('coding-box-home').should('be.visible');
  }

  function apiRequest(route: string, options: Partial<Cypress.RequestOptions> = {}) {
    return cy.then(() => cy.request({
      url: `${setup.apiUrl}/api${route}`,
      headers: { authorization: `Bearer ${accessToken}` },
      log: false,
      ...options
    }));
  }

  function waitForJob(route: string, remaining = 120): Cypress.Chainable<Cypress.Response<BackgroundJob>> {
    return apiRequest(route).then(response => {
      const body = response.body as BackgroundJob;
      expect(body.status, body.error || 'background job status').not.to.equal('failed');
      if (body.status === 'completed') return cy.wrap(response, { log: false });
      expect(remaining, 'background job completes within its bounded timeout').to.be.greaterThan(0);
      return cy.wait(1000, { log: false }).then(() => waitForJob(route, remaining - 1));
    });
  }

  it('rejects an authenticated user without workspace or administration permission', () => {
    login('file-access-0');
    apiRequest('/admin/users/full', { failOnStatusCode: false })
      .its('status').should('eq', 401);
    apiRequest('/auth-data').then(({ body }) => {
      expect(body.isAdmin).to.equal(false);
      expect(body.userId).to.be.a('number').and.be.greaterThan(0);
      apiRequest(`/admin/users/${body.userId}`, {
        method: 'PATCH',
        body: { id: body.userId, isAdmin: true },
        failOnStatusCode: false
      }).then(response => {
        expect(response.status).to.equal(401);
        expect(response.body.message).to.equal('Admin privileges required');
      });
      apiRequest('/auth-data').its('body.isAdmin').should('eq', false);
    });
    apiRequest('/admin/system-notifications', { failOnStatusCode: false })
      .then(({ status, body }) => {
        expect(status).to.equal(401);
        expect(body.message).to.equal('Admin privileges required');
      });
    apiRequest(`/admin/workspace/${setup.workspaceId}/test-results/overview`, {
      failOnStatusCode: false
    }).its('status').should('eq', 401);
    cy.window().then(win => {
      win.location.hash = `/workspace-admin/${setup.workspaceId}/test-results`;
    });
    cy.location('hash').should('include', 'access-denied');
    cy.get('coding-box-test-results').should('not.exist');
  });

  it('imports in the browser, persists coding across reload, submits and exports the same result', () => {
    login(setup.username);
    cy.intercept('GET', '**/api/admin/workspace/*/test-results/overview').as('overview');
    cy.intercept('POST', '**/upload/results/responses/init').as('uploadInit');
    cy.intercept('PUT', '**/upload/results/*/chunk/*').as('uploadChunk');
    cy.intercept('POST', '**/upload/results/*/complete').as('uploadComplete');
    cy.window().then(win => {
      win.location.hash = `/workspace-admin/${setup.workspaceId}/test-results`;
    });
    cy.wait('@overview').its('response.body.testPersons').should('eq', 2);
    cy.get('coding-box-test-results .action-bar').contains('button', 'Import').click();
    cy.get('coding-box-test-results-import-dialog')
      .contains('mat-list-item', 'Antworten hochladen').click();
    cy.fixture('replay-datasets/two-person-multipage/responses.csv', 'utf8').then((csv: string) => {
      const [header, firstResponse] = csv.trimEnd().split(/\r?\n/);
      const importedResponse = firstResponse
        .replaceAll('replay-login-a', 'workflow-import')
        .replaceAll('replay-code-a', 'workflow-code')
        .replaceAll('PERSON-A-RESPONSE', 'WORKFLOW-RESPONSE');
      cy.get('coding-box-test-results input[accept=".json,.zip,.csv"]').first().selectFile({
        contents: Cypress.Buffer.from(`${header}\n${importedResponse}\n`),
        fileName: 'workflow-import.csv',
        mimeType: 'text/csv'
      }, { force: true });
    });
    cy.get('coding-box-test-results-upload-options-dialog').contains('button', 'Upload starten').click();
    cy.wait('@uploadInit').its('response.statusCode').should('eq', 201);
    cy.wait('@uploadChunk').its('response.statusCode').should('eq', 200);
    cy.wait('@uploadComplete').then(({ response }) => {
      expect(response?.statusCode).to.equal(201);
      expect(response?.body[0].jobId).to.be.a('string');
      waitForJob(`/admin/workspace/${setup.workspaceId}/upload/status/${response?.body[0].jobId}`);
    });
    cy.get('coding-box-test-results-upload-result-dialog', { timeout: 120_000 })
      .should('be.visible').and('contain.text', 'Antworten');
    apiRequest(`/admin/workspace/${setup.workspaceId}/test-results/overview`)
      .its('body.testPersons').should('eq', 3);

    cy.task('workflows:prepare-imported-coding', null, { log: false }).then(value => {
      const { codingJobId } = value as { codingJobId: number };
      apiRequest(`/wsg-admin/workspace/${setup.workspaceId}/coding-job/${codingJobId}/start`, {
        method: 'POST'
      }).then(({ body }) => {
        expect(body.total).to.equal(1);
        const replay = new URL(body.firstReplayUrl, setup.baseUrl);
        const local = new URL(setup.baseUrl);
        replay.protocol = local.protocol;
        replay.host = local.host;
        const [route, query = ''] = replay.hash.split('?');
        const params = new URLSearchParams(query);
        params.set('mode', 'coding');
        params.set('codingJobId', String(codingJobId));
        params.set('workspaceId', String(setup.workspaceId));
        replay.hash = `${route}?${params}`;
        cy.visit(replay.toString(), { log: false });
      });
      cy.intercept('POST', `**/coding-job/${codingJobId}/progress`).as('progress');
      cy.intercept('POST', `**/coding-job/${codingJobId}/notes`, request => {
        if (request.body.notes === 'Persisted workflow note') request.alias = 'completeNotes';
      });
      // Coding the sole case opens a completion overlay. Save the note while
      // the editable controls are still reachable, then finish the coding.
      cy.get('app-code-selector textarea').clear().type('Persisted workflow note')
        .should('have.value', 'Persisted workflow note').blur();
      cy.wait('@completeNotes').its('response.statusCode').should('eq', 201);
      cy.get('app-code-selector [data-code-id="1"]').should('be.visible').click();
      cy.wait('@progress').its('response.statusCode').should('eq', 201);
      cy.reload();
      cy.get('app-code-selector [data-code-id="1"]').should('have.class', 'selected');
      cy.get('app-code-selector textarea').should('have.value', 'Persisted workflow note');
      cy.intercept('POST', `**/coding-job/${codingJobId}/submit`).as('submit');
      cy.window().then(win => cy.stub(win, 'close').as('closeReplay'));
      cy.get('.completion-overlay .submit-button').should('not.be.disabled').click();
      cy.wait('@submit').its('response.statusCode').should('eq', 201);
      cy.get('@closeReplay').should('have.been.calledOnce');
      apiRequest(`/wsg-admin/workspace/${setup.workspaceId}/coding-job/${codingJobId}`)
        .its('body.status').should('eq', 'completed');
    });

    // Return from the replay window to the authenticated management application.
    cy.intercept('GET', '**/api/auth-data*').as('returnAuthData');
    cy.visit('/');
    cy.wait('@returnAuthData', { log: false })
      .its('response.statusCode').should('be.oneOf', [200, 304]);
    cy.get('coding-box-home').should('be.visible');
    cy.intercept('GET', `**/api/admin/workspace/${setup.workspaceId}/coders`)
      .as('exportCoders');
    cy.intercept('GET', `**/api/admin/workspace/${setup.workspaceId}/coding/job-definitions*`)
      .as('exportJobDefinitions');
    cy.intercept('POST', `**/api/admin/workspace/${setup.workspaceId}/coding/export/start`)
      .as('startWorkflowExport');
    cy.window().then(win => {
      win.location.hash = `/workspace-admin/${setup.workspaceId}/coding/manual`;
    });
    cy.get('coding-box-coding-management-manual', { timeout: 30_000 })
      .should('contain.text', 'Manuelle Kodierung');
    cy.wait('@exportCoders').its('response.statusCode').should('eq', 200);
    cy.get('coding-box-coding-management-manual .manual-coding-tabs')
      .contains('Planung').click();
    cy.wait('@exportJobDefinitions').its('response.statusCode').should('eq', 200);
    cy.get('coding-box-coding-management-manual .manual-coding-tabs')
      .contains('Durchführung').click();
    cy.get('coding-box-coding-management-manual .manual-tab-actions')
      .contains('button', 'Export').should('not.be.disabled').click();
    cy.get('coding-box-manual-coding-export-dialog').should('be.visible')
      .contains('mat-radio-button', 'Mehrfach-Job-Bericht')
      .find('input[type="radio"]').check({ force: true }).should('be.checked');
    cy.get('coding-box-manual-coding-export-dialog')
      .contains('mat-radio-button', 'Detailliertes Kodierprotokoll')
      .find('input[type="radio"]').check({ force: true }).should('be.checked');
    cy.get('coding-box-manual-coding-export-dialog mat-dialog-actions')
      .contains('button', 'Exportjob starten').should('not.be.disabled').click();
    cy.wait('@startWorkflowExport').then(({ request, response }) => {
      expect(request.body).to.include({
        exportType: 'detailed',
        includeReplayUrl: false,
        excludeAutoCoded: true
      });
      expect(response?.statusCode).to.equal(201);
      const jobId = response?.body.jobId;
      expect(jobId).to.be.a('string').and.not.be.empty;
      cy.get('coding-box-manual-coding-export-dialog').should('not.exist');
      waitForJob(`/admin/workspace/${setup.workspaceId}/coding/export/job/${jobId}`);
      cy.intercept(
        'GET',
        `**/api/admin/workspace/${setup.workspaceId}/coding/export/job/${jobId}/download`
      ).as('downloadWorkflowExport');
      cy.get('coding-box-export-toast .job-item.status-completed', { timeout: 120_000 })
        .should('contain.text', 'Detailliertes Kodierprotokoll');
      cy.then(() => {
        const date = new Date().toISOString().slice(0, 10);
        const downloadPath = `${Cypress.config('downloadsFolder')}/export-detailed-${date}.csv`;
        cy.get('coding-box-export-toast .job-item.status-completed')
          .find('button[aria-label="Herunterladen"]').should('be.visible').click();
        cy.wait('@downloadWorkflowExport').then(({ response: download }) => {
          expect(download?.statusCode).to.equal(200);
          expect(download?.headers['content-type']).to.include('text/csv');
        });
        cy.readFile(downloadPath, 'utf8', { timeout: 120_000 }).then((csv: string) => {
          const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
          const header = lines[0].split(';').map(value => value.replace(/^"|"$/g, ''));
          const rows = lines.slice(1).map(line => line.split(';').map(value => value.replace(/^"|"$/g, '')));
          const row = rows.find(values => values[header.indexOf('Person Login')] === 'workflow-import');
          expect(row, 'export contains the newly imported person').to.exist;
          expect(row?.[header.indexOf('Person Code')]).to.equal('workflow-code');
          expect(row?.[header.indexOf('Variable')]).to.equal('answer_1');
          expect(row?.[header.indexOf('Code')]).to.equal('1');
          expect(row?.[header.indexOf('Kommentar')]).to.equal('Persisted workflow note');
        });
      });
    });
  });
});
