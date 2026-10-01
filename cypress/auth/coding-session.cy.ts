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
    cy.get('app-code-selector [data-code-id="1"]').click();
    cy.intercept('POST', '**/coding-job/*/notes', (request) => {
      if (request.body.notes === 'Persisted live note') {
        request.alias = 'persistedNote';
      }
    });
    cy.get('app-code-selector textarea')
      .clear()
      .type('Persisted live note')
      .blur();
    cy.get('app-code-selector textarea').should(
      'have.value',
      'Persisted live note'
    );
    cy.wait('@persistedNote').its('response.statusCode').should('eq', 201);
    cy.get('app-code-selector .next-button').should('not.be.disabled');
    cy.reload();
    cy.get('app-code-selector [data-code-id="1"]').should(
      'have.class',
      'selected'
    );
    cy.get('app-code-selector textarea').should(
      'have.value',
      'Persisted live note'
    );

    let failNotes = true;
    cy.intercept('POST', '**/coding-job/*/notes', (request) => {
      if (failNotes)
        request.reply({
          statusCode: 503,
          body: { message: 'Simulated connection loss' }
        });
      else request.continue();
    });
    cy.get('app-code-selector textarea')
      .clear()
      .type('Recovered live draft')
      .blur();
    cy.task('coding:expire-session', null, { log: false });
    cy.get('app-code-selector textarea').then((textarea) => {
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
    cy.get('app-code-selector textarea').should(
      'have.value',
      'Recovered live draft'
    );
    cy.get('app-code-selector .next-button').should('not.be.disabled');
    cy.window().should((win) => {
      const drafts = Object.keys(win.sessionStorage).filter((key) =>
        key.startsWith('coding-box-session-recovery:')
      );
      expect(drafts, 'persisted recovery drafts are cleared').to.have.length(0);
    });
    cy.reload();
    cy.get('app-code-selector textarea').should(
      'have.value',
      'Recovered live draft'
    );

    cy.intercept('POST', '**/coding-job/*/pause').as('pause');
    cy.intercept('POST', '**/coding-job/*/resume').as('resume');
    cy.get('app-code-selector .pause-button').click();
    cy.wait('@pause').its('response.statusCode').should('eq', 201);
    cy.get('.pause-overlay .resume-button').should('be.visible').click();
    cy.wait('@resume').its('response.statusCode').should('eq', 201);
    cy.get('.pause-overlay').should('not.exist');
    cy.get('app-code-selector .next-button').click();
    cy.get('app-code-selector .current-position').should('have.text', '2');
    cy.get('app-code-selector [data-code-id="0"]').click();
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
    cy.get('tc-confirm-dialog')
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
    cy.get('coding-box-users-menu button').eq(2).click();
    cy.wait('@userWorkspaces').its('response.statusCode')
      .should('be.oneOf', [200, 304]);
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
    cy.get('tc-confirm-dialog')
      .should('contain.text', 'Zoneless Live Test')
      .contains('button', 'Löschen').click();
    cy.wait('@deleteNotification').its('response.statusCode').should('eq', 204);
    cy.get('coding-box-system-notifications-admin table')
      .should('not.contain.text', 'Zoneless Live Test');

    cy.window().then((win) => {
      win.location.hash = `/workspace-admin/${setup.workspaceId}/coding/manual`;
    });
    cy.get('coding-box-coding-management-manual', { timeout: 30_000 })
      .should('contain.text', 'Manuelle Kodierung');
    cy.get('coding-box-coding-management-manual .planning-status-banner')
      .should('be.visible');
    cy.get('coding-box-coding-management-manual .manual-coding-tabs')
      .contains('Durchführung').click();
    cy.get('coding-box-coding-jobs', { timeout: 30_000 })
      .should('contain.text', 'Live authentication coding job');
  });
});
