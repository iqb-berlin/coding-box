import { AUTH_SESSION_WARNING_DELAY_MS } from '../../apps/frontend/src/app/core/services/auth-session.config';

type CodingSetup = {
  apiUrl: string;
  baseUrl: string;
  workspaceId: number;
  codingJobId: number;
  keycloakUrl: string;
  username: string;
  password: string;
  zoneless: boolean;
};

describe('real Keycloak coding session', () => {
  let setup: CodingSetup;
  let accessToken: string;

  before(() => {
    cy.task('coding:setup', null, { log: false }).then((value) => {
      setup = value as CodingSetup;
    });
  });

  after(() => {
    cy.task('coding:cleanup', null, { log: false });
  });

  it('persists coding, recovers an expired session, and completes the job', () => {
    cy.intercept(
      'POST',
      '**/realms/coding-e2e/protocol/openid-connect/token'
    ).as('loginToken');
    cy.intercept('GET', '**/realms/coding-e2e/account').as('profile');
    cy.intercept('GET', '**/api/auth-data*').as('authData');
    cy.visit('/');
    cy.window().then(win => {
      expect(win.isSecureContext, 'Keycloak requires a secure browser context').to.equal(true);
      expect(win.crypto.subtle, 'native Web Crypto').to.exist;
    });
    cy.get('.login-button').click();
    cy.origin(
      setup.keycloakUrl,
      { args: { username: setup.username, password: setup.password } },
      ({ username, password }) => {
        cy.get('#username').type(username);
        cy.get('#password').type(password, { log: false });
        cy.get('#kc-login').click();
      }
    );
    cy.wait('@loginToken').then(({ response }) => {
      expect(response?.statusCode).to.equal(200);
      accessToken = response?.body.access_token;
    });
    cy.wait('@profile', { log: false })
      .its('response.statusCode')
      .should('eq', 200);
    cy.wait('@authData', { log: false })
      .its('response.statusCode')
      .should('eq', 200);
    cy.get('coding-box-home').should('be.visible');
    cy.window().then((win) => {
      expect('Zone' in win).to.equal(!setup.zoneless);
    });
    cy.then(() =>
      cy.request({
        method: 'POST',
        url: `${setup.apiUrl}/api/wsg-admin/workspace/${setup.workspaceId}/coding-job/${setup.codingJobId}/start`,
        headers: { authorization: `Bearer ${accessToken}` },
        log: false,
        failOnStatusCode: false
      })
    ).then(({ status, body }) => {
      expect(status, 'start coding job HTTP status').to.equal(201);
      expect(body.total).to.equal(2);
      const replay = new URL(body.firstReplayUrl, setup.baseUrl);
      const local = new URL(setup.baseUrl);
      replay.protocol = local.protocol;
      replay.host = local.host;
      const [route, query = ''] = replay.hash.split('?');
      const params = new URLSearchParams(query);
      params.set('mode', 'coding');
      params.set('codingJobId', String(setup.codingJobId));
      params.set('workspaceId', String(setup.workspaceId));
      replay.hash = `${route}?${params}`;
      cy.visit(replay.toString(), { log: false });
    });
    cy.get('coding-box-code-selector [data-code-id="1"]').should('be.visible');
    // Advance only browser timeout callbacks; Keycloak and the backend retain real time.
    cy.clock(Date.now(), ['setTimeout', 'clearTimeout']);
    cy.window().then(win => win.dispatchEvent(new Event('mousemove')));
    cy.tick(AUTH_SESSION_WARNING_DELAY_MS);
    cy.get('.session-expiry-warning').should('be.visible');
    cy.clock().then(clock => clock.restore());
    cy.intercept('POST', '**/realms/coding-e2e/protocol/openid-connect/token', request => {
      if (String(request.body).includes('grant_type=refresh_token')) request.alias = 'extendSession';
    });
    cy.get('.session-expiry-warning button').click();
    cy.wait('@extendSession').its('response.statusCode').should('eq', 200);
    cy.get('.session-expiry-warning').should('not.exist');
    cy.get('.re-authentication').should('not.exist');
    cy.get('coding-box-code-selector [data-code-id="1"]').click();
    cy.intercept('POST', '**/coding-job/*/notes', (request) => {
      if (request.body.notes === 'Persisted live note') {
        request.alias = 'persistedNote';
      }
    });
    cy.get('coding-box-code-selector textarea')
      .clear()
      .type('Persisted live note')
      .blur();
    cy.get('coding-box-code-selector textarea').should(
      'have.value',
      'Persisted live note'
    );

    cy.wait('@persistedNote').its('response.statusCode').should('eq', 201);
    cy.get('coding-box-code-selector .next-button').should('not.be.disabled');
    cy.reload();
    cy.get('coding-box-code-selector [data-code-id="1"]').should(
      'have.class',
      'selected'
    );
    cy.get('coding-box-code-selector textarea').should(
      'have.value',
      'Persisted live note'
    );

    // Hold a real progress save while the coder adds a problem marker.
    let releaseProgress: (() => void) | undefined;
    let holdProgress = true;
    cy.intercept('POST', '**/coding-job/*/progress', request => {
      if (request.body.selectedCode?.codingIssueOption === -2) request.alias = 'newCodeNeeded';
      if (!holdProgress) return;
      holdProgress = false;
      return new Promise<void>(resolve => {
        releaseProgress = () => { request.continue(); resolve(); };
      });
    });
    cy.get('coding-box-code-selector [data-code-id="0"]').click();
    cy.wrap(null).should(() => { expect(releaseProgress).to.be.a('function'); });
    cy.get('coding-box-code-selector [data-code-id="-2"]').click();
    cy.then(() => releaseProgress!());
    cy.wait('@newCodeNeeded').its('response.statusCode').should('eq', 201);
    cy.reload();
    cy.get('coding-box-code-selector [data-code-id="-2"]').should('have.class', 'selected');
    cy.get('coding-box-code-selector .deselect-button').click();
    cy.get('coding-box-code-selector [data-code-id="1"]').click();
    cy.get('coding-box-code-selector .next-button').should('not.be.disabled');

    let failNotes = true;
    cy.intercept('POST', '**/coding-job/*/notes', (request) => {
      if (failNotes)
        request.reply({
          statusCode: 503,
          body: { message: 'Simulated connection loss' }
        });
      else request.continue();
    });
    cy.get('coding-box-code-selector textarea')
      .clear()
      .type('Recovered live draft')
      .blur();
    let rejectExpiredRefresh = false;
    cy.intercept('POST', '**/realms/coding-e2e/protocol/openid-connect/token', request => {
      if (rejectExpiredRefresh && String(request.body).includes('grant_type=refresh_token')) {
        request.alias = 'expiredRefresh';
        request.reply({
          statusCode: 400,
          body: { error: 'invalid_grant', error_description: 'Session not active' }
        });
      }
    });
    // A refresh can race with the server-side session revocation. Arm its observer first.
    cy.then(() => { rejectExpiredRefresh = true; });
    cy.task('coding:expire-session', null, { log: false });
    cy.get('coding-box-code-selector textarea').then((textarea) => {
      const field = textarea[0] as HTMLTextAreaElement;
      if (!field.disabled) {
        const InputEvent = field.ownerDocument.defaultView?.Event;
        if (!InputEvent) throw new Error('Browser input event is unavailable');
        field.value = 'Recovered live draft!';
        field.dispatchEvent(new InputEvent('input', { bubbles: true }));
        field.value = 'Recovered live draft';
        field.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
    });
    cy.wait('@expiredRefresh').its('response.statusCode').should('eq', 400);
    cy.get('.re-authentication button', { timeout: 60_000 }).should(
      'be.visible'
    );
    cy.window().then((win) => {
      const drafts = Object.keys(win.sessionStorage).filter((key) =>
        key.startsWith('coding-box-session-recovery:')
      );
      expect(drafts.length).to.be.greaterThan(0);
      expect(
        drafts.some((key) =>
          win.sessionStorage.getItem(key)?.includes('Recovered live draft')
        )
      ).to.equal(true);
    });
    cy.then(() => {
      failNotes = false;
      rejectExpiredRefresh = false;
    });
    cy.get('.re-authentication button').click();
    cy.origin(
      setup.keycloakUrl,
      { args: { username: setup.username, password: setup.password } },
      ({ username, password }) => {
        cy.get('#username').clear().type(username);
        cy.get('#password').type(password, { log: false });
        cy.get('#kc-login').click();
      }
    );
    cy.get('coding-box-code-selector textarea').should(
      'have.value',
      'Recovered live draft'
    );
    cy.get('coding-box-code-selector .next-button').should('not.be.disabled');
    cy.window().should((win) => {
      const drafts = Object.keys(win.sessionStorage).filter((key) =>
        key.startsWith('coding-box-session-recovery:')
      );
      expect(drafts, 'persisted recovery drafts are cleared').to.have.length(0);
    });
    cy.reload();
    cy.get('coding-box-code-selector textarea').should(
      'have.value',
      'Recovered live draft'
    );

    cy.intercept('PUT', '**/coding-job/*', (request) => {
      if (request.body.comment === 'Live job comment') request.alias = 'jobComment';
    });
    cy.get('coding-box-code-selector .comment-button').click();
    cy.get('coding-box-coding-job-comment-dialog textarea').type('Live job comment');
    cy.get('coding-box-coding-job-comment-dialog').contains('button', 'Speichern').click();
    cy.wait('@jobComment').its('response.statusCode').should('be.oneOf', [200, 201]);
    cy.reload();
    cy.get('coding-box-code-selector .comment-button').click();
    cy.get('coding-box-coding-job-comment-dialog textarea')
      .should('have.value', 'Live job comment');
    cy.get('coding-box-coding-job-comment-dialog').contains('button', 'Abbrechen').click();

    cy.intercept('POST', '**/coding-job/*/pause').as('pause');
    cy.intercept('POST', '**/coding-job/*/resume').as('resume');
    cy.get('coding-box-code-selector .pause-button').click();
    cy.wait('@pause').its('response.statusCode').should('eq', 201);
    cy.get('.pause-overlay .resume-button').should('be.visible').click();
    cy.wait('@resume').its('response.statusCode').should('eq', 201);
    cy.get('.pause-overlay').should('not.exist');
    cy.get('coding-box-code-selector .next-button').click();
    cy.get('coding-box-code-selector .current-position').should('have.text', '2');
    cy.get('coding-box-code-selector .prev-button').click();
    cy.get('coding-box-code-selector .current-position').should('have.text', '1');
    cy.get('coding-box-code-selector [data-code-id="1"]').should('have.class', 'selected');
    cy.get('coding-box-code-selector .next-button').click();
    cy.get('coding-box-code-selector .current-position').should('have.text', '2');
    cy.get('coding-box-code-selector [data-code-id="0"]').click();
    cy.intercept('POST', '**/coding-job/*/submit').as('submit');
    // Production opens replay in a separate window; keep the Cypress tab alive.
    cy.window().then((win) => {
      cy.stub(win, 'close').as('closeReplay');
    });
    cy.get('.completion-overlay .submit-button')
      .should('not.be.disabled')
      .click();
    cy.wait('@submit').its('response.statusCode').should('eq', 201);
    cy.get('@closeReplay').should('have.been.calledOnce');
    cy.visit('/');
    cy.get('coding-box-user-menu > button').click();
    cy.contains('coding-box-account-action button', 'Abmelden').click();
    cy.get('.login-button').should('be.visible');
    cy.get('.re-authentication').should('not.exist');
  });

  it('uploads responses through the UI and shows the backend result', () => {
    cy.intercept('GET', '**/api/auth-data*').as('authData');
    cy.intercept('GET', '**/api/admin/workspace/*/test-results/overview')
      .as('overview');
    cy.intercept('POST', '**/api/admin/workspace/*/upload/results/responses/init')
      .as('uploadInit');
    cy.intercept('PUT', '**/api/admin/workspace/*/upload/results/*/chunk/*')
      .as('uploadChunk');
    cy.intercept('POST', '**/api/admin/workspace/*/upload/results/*/complete')
      .as('uploadComplete');

    cy.visit('/');
    cy.get('.login-button').click();
    cy.origin(
      setup.keycloakUrl,
      { args: { username: setup.username, password: setup.password } },
      ({ username, password }) => {
        cy.get('#username').type(username);
        cy.get('#password').type(password, { log: false });
        cy.get('#kc-login').click();
      }
    );
    cy.wait('@authData').its('response.statusCode')
      .should('be.oneOf', [200, 304]);
    cy.window().then((win) => {
      expect('Zone' in win).to.equal(!setup.zoneless);
      win.location.hash = `/workspace-admin/${setup.workspaceId}/test-results`;
    });
    cy.wait('@overview').its('response.statusCode')
      .should('be.oneOf', [200, 304]);
    cy.get('coding-box-test-results .overview-card')
      .should('contain.text', 'Testpersonen');
    cy.get('coding-box-test-results .action-bar')
      .contains('button', 'Import').click();
    cy.get('coding-box-test-results-import-dialog')
      .contains('mat-list-item', 'Antworten hochladen').click();
    cy.fixture('replay-datasets/two-person-multipage/responses.csv', 'utf8')
      .then((csv: string) => {
        cy.get('coding-box-test-results input[accept=".json,.zip,.csv"]')
          .first()
          .selectFile({
            contents: Cypress.Buffer.from(csv),
            fileName: 'responses.csv',
            mimeType: 'text/csv'
          }, { force: true });
      });
    cy.get('coding-box-test-results-upload-options-dialog')
      .contains('button', 'Upload starten').click();
    cy.wait('@uploadInit').its('response.statusCode').should('eq', 201);
    cy.wait('@uploadChunk').its('response.statusCode').should('eq', 200);
    cy.wait('@uploadComplete').then(({ request, response }) => {
      expect(request.body).to.include({
        overwriteMode: 'skip',
        scope: 'person'
      });
      expect(response?.statusCode).to.equal(201);
      expect(response?.body?.[0]?.jobId).to.be.a('string');
    });
    cy.get('coding-box-test-results-upload-result-dialog', {
      timeout: 120_000
    }).should('be.visible').and('contain.text', 'Antworten');
    cy.get('coding-box-test-results .overview-card')
      .should('contain.text', 'Testpersonen');
  });

  it('updates administration and manual coding views from the real backend', () => {
    cy.intercept('GET', '**/api/auth-data*').as('authData');
    cy.intercept('GET', '**/api/admin/workspace*').as('workspaces');
    cy.intercept('POST', '**/api/admin/workspace').as('createWorkspace');
    cy.intercept('DELETE', '**/api/admin/workspace?ids=*').as('deleteWorkspace');
    cy.intercept('GET', '**/api/admin/users/full').as('users');
    cy.intercept('GET', '**/api/admin/users/*/workspaces').as('userWorkspaces');
    cy.intercept('GET', '**/api/admin/system-notifications').as('notifications');
    cy.intercept('POST', '**/api/admin/system-notifications').as('createNotification');
    cy.intercept('DELETE', '**/api/admin/system-notifications/*').as('deleteNotification');

    cy.visit('/');
    cy.get('.login-button').click();
    cy.origin(
      setup.keycloakUrl,
      { args: { username: setup.username, password: setup.password } },
      ({ username, password }) => {
        cy.get('#username').type(username);
        cy.get('#password').type(password, { log: false });
        cy.get('#kc-login').click();
      }
    );
    cy.wait('@authData').its('response.statusCode')
      .should('be.oneOf', [200, 304]);
    cy.window().then((win) => {
      expect('Zone' in win).to.equal(!setup.zoneless);
      win.location.hash = '/admin/workspaces';
    });
    cy.wait('@workspaces').its('response.statusCode')
      .should('be.oneOf', [200, 304]);
    cy.get('coding-box-workspaces-selection mat-row')
      .should('contain.text', 'replay-e2e-');
    cy.get('coding-box-workspaces-menu button').first().click();
    cy.get('coding-box-edit-workspace-group input[formcontrolname="name"]')
      .type('Zoneless workspace');
    cy.get('coding-box-edit-workspace-group button[type="submit"]').click();
    cy.wait('@createWorkspace').its('response.statusCode').should('eq', 201);
    cy.contains('coding-box-workspaces-selection mat-row', 'Zoneless workspace')
      .should('be.visible');
    cy.contains('coding-box-workspaces-selection mat-row', 'Zoneless workspace')
      .find('mat-checkbox').click();
    cy.get('coding-box-workspaces-menu button').eq(1).click();
    cy.get('coding-box-confirm-dialog')
      .should('contain.text', 'Arbeitsbereich')
      .contains('button', 'Löschen').click();
    cy.wait('@deleteWorkspace').its('response.statusCode').should('eq', 200);
    cy.get('coding-box-workspaces-selection mat-table')
      .should('not.contain.text', 'Zoneless workspace');

    cy.window().then((win) => {
      win.location.hash = '/admin/users';
    });
    cy.wait('@users').its('response.statusCode')
      .should('be.oneOf', [200, 304]);
    cy.get('coding-box-users-selection mat-row')
      .should('contain.text', setup.username);
    cy.contains('coding-box-users-selection mat-row', setup.username)
      .find('mat-checkbox').click();
    let releaseWorkspaceList: (() => void) | undefined;
    cy.intercept('GET', '**/api/admin/workspace', request => new Promise<void>(resolve => {
      releaseWorkspaceList = () => { request.continue(); resolve(); };
    }));
    cy.get('coding-box-users-menu button').eq(2).click();
    cy.wait('@userWorkspaces').its('response.statusCode')
      .should('be.oneOf', [200, 304]);
    cy.get('coding-box-workspace-access-rights-dialog mat-dialog-actions button').first()
      .should('be.disabled');
    cy.wrap(null).should(() => { expect(releaseWorkspaceList).to.be.a('function'); });
    cy.then(() => releaseWorkspaceList!());
    cy.contains('coding-box-workspace-access-rights-dialog mat-row', 'replay-e2e-')
      .find('input[type="checkbox"]').should('be.checked');
    cy.get('coding-box-workspace-access-rights-dialog')
      .contains('button', 'Schließen').click();

    cy.window().then((win) => {
      win.location.hash = '/admin/notifications';
    });
    cy.wait('@notifications').its('response.statusCode')
      .should('be.oneOf', [200, 304]);
    cy.get('coding-box-system-notifications-admin')
      .should('contain.text', 'Systemhinweise verwalten');
    cy.get('coding-box-system-notifications-admin input[formcontrolname="title"]')
      .type('Zoneless Live Test');
    cy.get('coding-box-system-notifications-admin textarea[formcontrolname="message"]')
      .type('Visible after the backend confirms creation');
    cy.get('coding-box-system-notifications-admin button[type="submit"]')
      .click();
    cy.wait('@createNotification').its('response.statusCode').should('eq', 201);
    cy.get('coding-box-system-notifications-admin td.mat-column-title')
      .should('contain.text', 'Zoneless Live Test');
    cy.get('coding-box-system-notifications-admin button[aria-label="Hinweis löschen"]')
      .click();
    cy.get('coding-box-confirm-dialog')
      .should('contain.text', 'Zoneless Live Test')
      .contains('button', 'Löschen').click();
    cy.wait('@deleteNotification').its('response.statusCode').should('eq', 204);
    cy.get('coding-box-system-notifications-admin table')
      .should('not.contain.text', 'Zoneless Live Test');

    cy.window().then((win) => {
      win.location.hash = `/workspace-admin/${setup.workspaceId}/coding/manual`;
    });
    cy.intercept('GET', '**/api/wsg-admin/workspace/*/coding-job?*').as('codingJobs');
    cy.get('coding-box-coding-management-manual', { timeout: 30_000 })
      .should('contain.text', 'Manuelle Kodierung');
    cy.get('coding-box-coding-management-manual .planning-status-banner')
      .should('be.visible');
    cy.get('coding-box-coding-management-manual .manual-coding-tabs')
      .contains('Durchführung').click();
    cy.wait('@codingJobs').then(({ response }) => {
      expect(response?.statusCode).to.be.oneOf([200, 304]);
      if (response?.statusCode === 200) {
        expect(response.body?.data?.some((job: { name: string }) =>
          job.name === 'Live authentication coding job')).to.equal(true);
      }
    });
    cy.get('coding-box-coding-jobs', { timeout: 30_000 })
      .should('contain.text', 'Live authentication coding job');
    cy.contains('coding-box-coding-jobs mat-row', 'Live authentication coding job')
      .find('button[aria-label^="Weitere Aktionen:"]').click();
    cy.get('button[aria-label="Ergebnisse anzeigen: Live authentication coding job"]')
      .click();
    cy.get('coding-box-coding-job-result-dialog .result-summary', { timeout: 30_000 })
      .should('contain.text', '2 von 2 Ergebnissen');
    cy.get('coding-box-coding-job-result-dialog button[aria-label="Dialog schließen"]')
      .click();

    cy.intercept('GET', '**/api/admin/content-pool/settings').as('contentPoolSettings');
    cy.window().then((win) => { win.location.hash = '/admin/settings'; });
    cy.wait('@contentPoolSettings').its('response.statusCode')
      .should('be.oneOf', [200, 304]);
    cy.get('coding-box-sys-admin-settings .content-pool-settings-card')
      .should('contain.text', 'Content-Pool Integration');
    cy.get('coding-box-sys-admin-settings input[placeholder*="content-pool.example.org"]')
      .clear().type('https://content-pool.test');
    cy.intercept('PUT', '**/api/admin/content-pool/settings').as('saveContentPoolSettings');
    cy.get('coding-box-sys-admin-settings .content-pool-settings-card')
      .contains('button', 'Einstellungen speichern').click();
    cy.wait('@saveContentPoolSettings').its('response.statusCode').should('eq', 200);
    cy.reload();
    cy.get('coding-box-sys-admin-settings input[placeholder*="content-pool.example.org"]')
      .should('have.value', 'https://content-pool.test');

    cy.intercept('GET', '**/api/admin/workspace/*/processes').as('processes');
    cy.window().then((win) => {
      win.location.hash = `/workspace-admin/${setup.workspaceId}/settings`;
    });
    cy.get('coding-box-ws-settings').contains('button', 'Prozesse anzeigen').click();
    cy.wait('@processes').its('response.statusCode')
      .should('be.oneOf', [200, 304]);
    cy.get('coding-box-process-overview-dialog .loading-overlay').should('not.exist');
    cy.get('coding-box-process-overview-dialog').should('contain.text', 'Zentrale Prozess-Übersicht');
  });

  it('creates, codes, reviews and applies a manual coding job', () => {
    const createdJobName = 'Job UNIT-REPLAY - answer_1 (coding-e2e)';
    cy.intercept('GET', '**/api/auth-data*').as('authData');
    cy.visit('/');
    cy.get('.login-button').click();
    cy.origin(
      setup.keycloakUrl,
      { args: { username: setup.username, password: setup.password } },
      ({ username, password }) => {
        cy.get('#username').type(username);
        cy.get('#password').type(password, { log: false });
        cy.get('#kc-login').click();
      }
    );
    cy.wait('@authData').its('response.statusCode').should('be.oneOf', [200, 304]);
    cy.window().then(win => {
      expect('Zone' in win).to.equal(!setup.zoneless);
      win.location.hash = `/workspace-admin/${setup.workspaceId}/coding/manual`;
    });
    cy.get('coding-box-coding-management-manual .manual-coding-tabs')
      .contains('Planung').click();
    cy.get('coding-box-coding-job-definitions')
      .contains('button', 'Neue Definition erstellen').click();
    cy.get('coding-box-coding-job-definition-dialog input[formcontrolname="name"]')
      .type('Zoneless UI coding job');
    cy.get('coding-box-coding-job-definition-dialog .coder-card')
      .contains('coding-e2e').click();
    cy.get('coding-box-coding-job-definition-dialog mat-tab-group')
      .contains('Einzelne Variablen').click();
    cy.get('coding-box-coding-job-definition-dialog .variable-card')
      .contains('UNIT-REPLAY_answer_1').click();
    cy.intercept('POST', '**/coding/job-definitions').as('createDefinition');
    cy.get('coding-box-coding-job-definition-dialog .dialog-actions')
      .contains('button', 'Definition erstellen').click();
    cy.wait('@createDefinition').its('response.statusCode').should('eq', 201);
    cy.contains('coding-box-coding-job-definitions tr', 'Zoneless UI coding job')
      .contains('button', 'Einreichen').click();
    cy.contains('coding-box-coding-job-definitions tr', 'Zoneless UI coding job')
      .contains('button', 'Freigeben').click();
    cy.contains('coding-box-coding-job-definitions tr', 'Zoneless UI coding job')
      .contains('button', 'Jobs erstellen').click();
    cy.get('coding-box-coding-job-bulk-creation-dialog .dialog-actions')
      .contains('button', 'Trotzdem fortfahren').click();
    cy.intercept('POST', '**/coding/job-definitions/*/create-job').as('createJobs');
    cy.get('coding-box-coding-job-bulk-creation-dialog .dialog-actions')
      .contains('button', '1 Aufträge erstellen').click();
    cy.wait('@createJobs').then(({ response }) => {
      expect(response?.statusCode).to.equal(201);
      expect(response?.body?.jobsCreated).to.equal(1);
      expect(response?.body?.jobs?.[0]?.jobName).to.equal(createdJobName);
    });

    cy.get('coding-box-coding-management-manual .manual-coding-tabs')
      .contains('Durchführung').click();
    cy.contains('coding-box-coding-jobs mat-row', createdJobName)
      .should('contain.text', 'Ausstehend');
    cy.intercept('POST', '**/coding-job/*/start').as('startCreatedJob');
    cy.window().then(win => { cy.stub(win, 'open').as('openCoding'); });
    cy.contains('coding-box-coding-jobs mat-row', createdJobName)
      .contains('button', 'Starten').click();
    cy.wait('@startCreatedJob').then(({ request, response }) => {
      expect(response?.statusCode).to.equal(201);
      expect(response?.body?.total).to.equal(1);
      const jobId = request.url.match(/coding-job\/(\d+)\/start$/)?.[1];
      expect(jobId).to.be.a('string');
      const replay = new URL(response.body.firstReplayUrl, setup.baseUrl);
      const local = new URL(setup.baseUrl);
      replay.protocol = local.protocol;
      replay.host = local.host;
      const [route, query = ''] = replay.hash.split('?');
      const params = new URLSearchParams(query);
      params.set('mode', 'coding');
      params.set('codingJobId', jobId!);
      params.set('workspaceId', String(setup.workspaceId));
      replay.hash = `${route}?${params}`;
      cy.visit(replay.toString());
    });
    cy.get('coding-box-code-selector [data-code-id="1"]').click();
    cy.intercept('POST', '**/coding-job/*/submit').as('submitCreatedJob');
    cy.window().then(win => { cy.stub(win, 'close'); });
    cy.get('.completion-overlay .submit-button').should('not.be.disabled').click();
    cy.wait('@submitCreatedJob').its('response.statusCode').should('eq', 201);
    cy.intercept('GET', '**/api/auth-data*').as('returnAuthData');
    cy.visit('/');
    cy.wait('@returnAuthData').its('response.statusCode').should('be.oneOf', [200, 304]);
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => {
      win.location.hash = `/workspace-admin/${setup.workspaceId}/coding/manual`;
    });
    cy.get('coding-box-coding-management-manual .manual-coding-tabs')
      .contains('Durchführung').click();
    cy.contains('coding-box-coding-jobs mat-row', createdJobName)
      .should('contain.text', 'Abgeschlossen');

    cy.intercept('GET', '**/coding-job/*/review').as('prepareReview');
    cy.window().then(win => { cy.stub(win, 'open').as('openReview'); });
    cy.contains('coding-box-coding-jobs mat-row', createdJobName)
      .find(`button[aria-label="Review öffnen: ${createdJobName}"]`).click();
    cy.wait('@prepareReview').then(({ response }) => {
      expect(response?.statusCode).to.equal(200);
      expect(response?.body?.total).to.equal(1);
      expect(response?.body?.firstReplayUrl).to.be.a('string');
    });
    cy.get('@openReview').should('have.been.calledOnce');
    cy.get('@openReview').then(openReview => {
      const reviewUrl = (openReview as { firstCall: { args: string[] } }).firstCall.args[0];
      expect(reviewUrl).to.include('mode=coding-review');
      cy.visit(reviewUrl);
    });
    cy.get('coding-box-code-selector [data-code-id="1"]')
      .should('have.class', 'selected')
      .and('have.class', 'read-only');
    cy.intercept('GET', '**/api/auth-data*').as('reviewReturnAuthData');
    cy.visit('/');
    cy.wait('@reviewReturnAuthData').its('response.statusCode').should('be.oneOf', [200, 304]);
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => {
      win.location.hash = `/workspace-admin/${setup.workspaceId}/coding/manual`;
    });

    cy.get('coding-box-coding-management-manual .manual-coding-tabs')
      .contains('Abschluss').click();
    cy.contains('.completed-job-apply-row', createdJobName)
      .scrollIntoView()
      .should('be.visible');
    cy.intercept('POST', '**/coding/jobs/*/apply-results').as('applyResults');
    cy.contains('.completed-job-apply-row', createdJobName)
      .contains('button', 'Ergebnisse anwenden').click();
    cy.get('coding-box-apply-coding-results-dialog')
      .should('contain.text', createdJobName)
      .contains('button', 'Anwenden').click();
    cy.wait('@applyResults').then(({ request, response }) => {
      expect(response?.statusCode).to.equal(201);
      expect(request.body).to.deep.equal({ overwriteExisting: false });
      expect(response?.body?.success).to.equal(true);
    });
    cy.get('coding-box-coding-management-manual .manual-coding-tabs')
      .contains('Durchführung').click();
    cy.contains('coding-box-coding-jobs mat-row', createdJobName)
      .should('contain.text', 'Ergebnisse angewendet');
  });

  it('persists further settings and completes a background database export', () => {
    cy.intercept('GET', '**/api/auth-data*').as('authData');
    cy.visit('/');
    cy.get('.login-button').click();
    cy.origin(
      setup.keycloakUrl,
      { args: { username: setup.username, password: setup.password } },
      ({ username, password }) => {
        cy.get('#username').type(username);
        cy.get('#password').type(password, { log: false });
        cy.get('#kc-login').click();
      }
    );
    cy.wait('@authData').its('response.statusCode').should('be.oneOf', [200, 304]);
    cy.window().then(win => {
      expect('Zone' in win).to.equal(!setup.zoneless);
      win.location.hash = '/admin/settings';
    });

    cy.intercept('PUT', '**/api/legal-notice').as('saveLegalNotice');
    cy.get('coding-box-sys-admin-settings .legal-notice-settings-card textarea')
      .should('not.be.disabled').clear().type('<p>Zoneless legal notice</p>');
    cy.get('coding-box-sys-admin-settings .legal-notice-settings-card')
      .contains('button', 'Text speichern').click();
    cy.wait('@saveLegalNotice').its('response.statusCode').should('eq', 200);
    cy.reload();
    cy.get('coding-box-sys-admin-settings .legal-notice-settings-card textarea')
      .should('have.value', '<p>Zoneless legal notice</p>');
    cy.intercept('DELETE', '**/api/legal-notice').as('resetLegalNotice');
    cy.get('coding-box-sys-admin-settings .legal-notice-settings-card')
      .contains('button', 'Standard wiederherstellen').click();
    cy.wait('@resetLegalNotice').its('response.statusCode').should('eq', 200);
    cy.get('coding-box-sys-admin-settings .legal-notice-settings-card textarea')
      .should('not.have.value', '<p>Zoneless legal notice</p>');

    cy.intercept('GET', '**/settings/replay-url-export-mode').as('loadReplayMode');
    cy.window().then(win => {
      win.location.hash = `/workspace-admin/${setup.workspaceId}/settings`;
    });
    cy.wait('@loadReplayMode').its('response.statusCode').should('be.oneOf', [200, 304]);
    cy.intercept('POST', '**/workspace/*/settings', request => {
      if (request.body.key === 'replay-url-export-mode') request.alias = 'saveReplayMode';
    });
    cy.get('coding-box-ws-settings .replay-url-export-mode-card mat-slide-toggle button')
      .should('have.attr', 'aria-checked', 'true').click();
    cy.wait('@saveReplayMode').its('response.statusCode').should('eq', 201);
    cy.get('coding-box-ws-settings .replay-url-export-mode-card mat-slide-toggle button')
      .should('have.attr', 'aria-checked', 'false');
    cy.reload();
    cy.wait('@loadReplayMode').its('response.statusCode').should('be.oneOf', [200, 304]);
    cy.get('coding-box-ws-settings .replay-url-export-mode-card mat-slide-toggle button')
      .should('have.attr', 'aria-checked', 'false').click();
    cy.wait('@saveReplayMode').its('response.statusCode').should('eq', 201);
    cy.reload();
    cy.wait('@loadReplayMode').its('response.statusCode').should('be.oneOf', [200, 304]);
    cy.get('coding-box-ws-settings .replay-url-export-mode-card mat-slide-toggle button')
      .should('have.attr', 'aria-checked', 'true');

    cy.intercept('POST', '**/export/sqlite/job').as('startDatabaseExport');
    let runningPolls = 3;
    cy.intercept('GET', /\/export\/sqlite\/job\/[^/]+$/, request => {
      if (runningPolls > 0) {
        runningPolls -= 1;
        request.reply({ statusCode: 200, body: { status: 'running', progress: 42 } });
      } else {
        request.continue();
      }
    }).as('databaseExportStatus');
    cy.intercept('GET', '**/export/sqlite/job/*/download').as('downloadDatabaseExport');
    cy.get('coding-box-ws-settings .database-export-card button')
      .contains('Datenbank exportieren').click();
    cy.wait('@startDatabaseExport').its('response.statusCode').should('eq', 201);
    for (let poll = 0; poll < 3; poll += 1) {
      cy.wait('@databaseExportStatus').its('response.body.status').should('eq', 'running');
      cy.get('coding-box-ws-settings .database-export-card .progress-text')
        .should('contain.text', '42%');
      cy.get('coding-box-ws-settings .database-export-actions button')
        .should('contain.text', 'Exportiere...')
        .and('be.disabled');
    }
    cy.get('coding-box-ws-settings .database-export-card .export-progress')
      .should('be.visible');
    cy.wait('@downloadDatabaseExport', { timeout: 120_000 })
      .its('response.statusCode').should('eq', 200);
    cy.get('coding-box-ws-settings .database-export-card .export-progress')
      .should('not.exist');
  });

  for (const role of [
    ...[0, 1, 2, 3].map(accessLevel => ({ username: `file-access-${accessLevel}`, accessLevel, isAdmin: false })),
    { username: 'file-access-admin', accessLevel: 0, isAdmin: true },
    { username: 'coding-e2e', accessLevel: 3, isAdmin: true }
  ]) {
    it(`verifies persisted file settings and backend access for ${role.username}`, () => {
      let roleToken = '';
      let fileRequests = 0;
      let configRequests = 0;
      let releaseRegex: (() => void) | undefined;
      let releaseConfig: (() => void) | undefined;
      const allowed = role.isAdmin || role.accessLevel >= 3;
      const api = (method: 'GET' | 'POST' | 'PUT', route: string, body?: Record<string, unknown>) => (
        cy.then(() => cy.request({
          method, url: `${setup.apiUrl}/api${route}`,
          headers: { authorization: `Bearer ${roleToken}` },
          body, log: false, failOnStatusCode: false
        }))
      );
      cy.task('coding:prepare-file-settings', null, { log: false });
      cy.intercept('POST', '**/realms/coding-e2e/protocol/openid-connect/token').as('fileRoleToken');
      cy.intercept('GET', '**/api/auth-data*', request => {
        delete request.headers['if-none-match'];
        request.continue();
      }).as('fileRoleAuth');
      cy.visit('/');
      cy.get('.login-button').click();
      cy.origin(setup.keycloakUrl, { args: { username: role.username, password: setup.password } },
        ({ username, password }) => {
          cy.get('#username').type(username);
          cy.get('#password').type(password, { log: false });
          cy.get('#kc-login').click();
        });
      cy.wait('@fileRoleToken', { log: false }).then(({ response }) => {
        expect(response?.statusCode).to.equal(200);
        roleToken = response?.body.access_token;
      });
      cy.wait('@fileRoleAuth', { log: false }).then(({ response }) => {
        expect(response?.statusCode).to.equal(200);
        expect(response?.body.isAdmin).to.equal(role.isAdmin);
      });
      cy.get('coding-box-home').should('be.visible');
      cy.window().should('not.have.property', 'Zone');

      // These calls go directly to the real backend; browser intercepts below only hold real responses.
      api('GET', `/admin/workspace/${setup.workspaceId}/files?page=1&limit=100`).then(({ status, body }) => {
        expect(status).to.equal(allowed ? 200 : 401);
        if (allowed) expect(body.data.some((file: { filename: string }) => file.filename === 'UNIT-REPLAY.xml')).to.equal(true);
      });
      api('GET', `/admin/workspace/${setup.workspaceId}/content-pool/config`).then(({ status, body }) => {
        expect(status).to.equal(allowed ? 200 : 401);
        if (allowed) {
          expect(body).to.include({ enabled: true, hasApplicationToken: true, baseUrl: 'https://synthetic.example.invalid' });
          expect(body).not.to.have.property('applicationToken');
        }
      });
      api('POST', `/workspace/${setup.workspaceId}/settings`, {
        key: 'enable-regex-search', value: JSON.stringify({ enabled: false })
      }).then(({ status }) => { expect(status).to.equal(allowed ? 201 : 401); });
      api('GET', `/workspace/${setup.workspaceId}/settings/enable-regex-search`).then(({ status, body }) => {
        expect(status).to.equal(role.isAdmin || role.accessLevel > 0 ? 200 : 401);
        if (status === 200) expect(JSON.parse(body.value).enabled).to.equal(!allowed);
      });
      if (allowed) {
        api('POST', `/workspace/${setup.workspaceId}/settings`, {
          key: 'enable-regex-search', value: JSON.stringify({ enabled: true })
        }).then(({ status }) => { expect(status).to.equal(201); });
      }
      api('PUT', '/admin/content-pool/settings', {
        enabled: false, baseUrl: '', clearApplicationToken: true
      }).then(({ status }) => { expect(status).to.equal(role.isAdmin ? 200 : 401); });
      if (role.isAdmin) {
        api('GET', `/admin/workspace/${setup.workspaceId}/content-pool/config`).then(({ body }) => {
          expect(body).to.deep.equal({ enabled: false, baseUrl: '', hasApplicationToken: false });
        });
        api('PUT', '/admin/content-pool/settings', {
          enabled: true, baseUrl: 'https://synthetic.example.invalid', applicationToken: 'file-settings-e2e-synthetic-token'
        }).then(({ status }) => { expect(status).to.equal(200); });
      }
      cy.task('coding:read-file-settings', null, { log: false }).then(value => {
        const stored = value as { regex: { enabled: boolean }; pool: { enabled: boolean; hasApplicationToken: boolean } };
        expect(stored.regex.enabled).to.equal(true);
        expect(stored.pool).to.include({ enabled: true, hasApplicationToken: true });
      });

      cy.intercept('GET', `**/workspace/${setup.workspaceId}/files?*`, request => {
        fileRequests += 1;
        delete request.headers['if-none-match'];
        request.continue();
      }).as('realRoleFiles');
      cy.intercept('GET', `**/workspace/${setup.workspaceId}/settings/enable-regex-search`, request => (
        new Cypress.Promise<void>(resolve => {
          releaseRegex = () => {
            delete request.headers['if-none-match'];
            request.continue(); resolve();
          };
        })
      )).as('realRoleRegex');
      cy.intercept('GET', `**/workspace/${setup.workspaceId}/content-pool/config`, request => {
        configRequests += 1;
        return new Cypress.Promise<void>(resolve => {
          releaseConfig = () => {
            delete request.headers['if-none-match'];
            request.continue(); resolve();
          };
        });
      }).as('realRoleConfig');
      cy.window().then(win => { win.location.hash = `/workspace-admin/${setup.workspaceId}/test-files`; });
      if (allowed) {
        cy.wait('@realRoleFiles').its('response.statusCode').should('equal', 200);
        cy.get('coding-box-test-files mat-row').should('contain.text', 'UNIT-REPLAY.xml');
        cy.get('coding-box-test-files').should('not.contain.text', 'ACP aus Content Pool');
        cy.get('coding-box-test-files mat-row mat-checkbox input').first().check();
        cy.get('coding-box-search-filter input').focus().type('[');
        cy.wrap(null).should(() => {
          expect(releaseRegex).to.be.a('function');
          expect(releaseConfig).to.be.a('function');
        });
        cy.then(() => { releaseRegex?.(); });
        cy.wait('@realRoleRegex').its('response.statusCode').should('equal', 200);
        cy.get('coding-box-search-filter .regex-filter-error').should('be.visible');
        cy.then(() => { releaseConfig?.(); });
        cy.wait('@realRoleConfig').its('response.statusCode').should('equal', 200);
        cy.get('coding-box-test-files').contains('a', 'ACP aus Content Pool').should('not.have.attr', 'aria-disabled', 'true');
        cy.get('coding-box-test-files').contains('a', 'Auswahl zu Content Pool').should('not.have.attr', 'aria-disabled', 'true');
        cy.then(() => {
          expect(fileRequests).to.equal(1);
          expect(configRequests).to.equal(1);
        });
      } else {
        const destination = role.accessLevel === 1 ? '/coding/my-jobs' :
          role.accessLevel === 2 ? '/coding/statistics' : 'auth=access-denied';
        cy.location('hash').should('contain', destination);
        cy.get('coding-box-test-files').should('not.exist');
        cy.then(() => {
          expect(fileRequests).to.equal(0);
          expect(configRequests).to.equal(0);
        });
      }
      cy.window().should('not.have.property', 'Zone');
    });
  }
});
