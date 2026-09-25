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
});
