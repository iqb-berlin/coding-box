describe('Workspace settings writes', () => {
  let unexpectedRequests: string[];
  let storedRegex: boolean;
  let writes: boolean[];

  beforeEach(() => {
    unexpectedRequests = [];
    storedRegex = false;
    writes = [];
    cy.viewport(1400, 1000);
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5, isAdmin: true, accessLevel: 3 });
    cy.intercept('GET', '**/api/admin/workspace/token-policy', {
      body: { scopes: { 'replay:read': { maxDurationDays: 90 } } }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/journal*', { body: { data: [], total: 0 } });
    cy.intercept('GET', '**/api/workspace/5/settings/*', request => {
      const key = new URL(request.url).pathname.split('/').pop();
      const value = key === 'enable-regex-search' ? JSON.stringify({ enabled: storedRegex }) : '{"enabled":false}';
      request.reply({ body: { id: 1, key, value } });
    });
  });

  afterEach(() => {
    cy.task('deferred:reset');
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests, 'explicit API fixtures').to.deep.equal([]); });
  });

  function regexSwitch() {
    return cy.contains('coding-box-ws-settings .setting-item', 'Reguläre Ausdrücke in Suchfeldern')
      .find('button[role="switch"]');
  }

  function modeSwitch() {
    return cy.contains('coding-box-ws-settings .setting-item', 'Auswertungsmodus').find('button[role="switch"]');
  }

  function refreshSwitch() {
    return cy.contains('coding-box-ws-settings .setting-item', 'Kodierübersichten und Kodierjob-Tabellen automatisch aktualisieren')
      .find('button[role="switch"]');
  }

  it('preserves the latest input after an older failure and persists it before reload', () => {
    cy.task<{ id: string; url: string }>('deferred:create', {
      statusCode: 500, body: { message: 'First save failed' }
    }).then(gate => {
      cy.intercept('POST', '**/api/workspace/5/settings', request => {
        expect(request.body.key).to.equal('enable-regex-search');
        const enabled = JSON.parse(request.body.value).enabled as boolean;
        writes.push(enabled);
        if (writes.length === 1) {
          request.url = gate.url;
          request.continue();
        } else {
          storedRegex = enabled;
          request.reply({ body: { id: 1, ...request.body } });
        }
      }).as('saveSetting');

      cy.visit('/#/workspace-admin/5/settings');
      cy.get('coding-box-ws-settings').should('be.visible');
      regexSwitch().should('have.attr', 'aria-checked', 'false').click();
      cy.wrap(null).should(() => { expect(writes).to.deep.equal([true]); });
      regexSwitch().should('have.attr', 'aria-checked', 'true').click();
      regexSwitch().should('have.attr', 'aria-checked', 'false');
      cy.then(() => { expect(writes).to.deep.equal([true]); });
      cy.task('deferred:release', gate.id);
      cy.wait('@saveSetting').its('response.statusCode').should('eq', 500);
      cy.wait('@saveSetting').its('response.statusCode').should('eq', 200);
      regexSwitch().should('have.attr', 'aria-checked', 'false');
      cy.then(() => {
        expect(writes).to.deep.equal([true, false]);
        expect(storedRegex).to.equal(false);
      });
      cy.reload();
      regexSwitch().should('have.attr', 'aria-checked', 'false');
    });
  });

  it('locks automatic refresh until evaluation-mode writes settle and permits retry after failure', () => {
    let presets = 0;
    cy.task<{ id: string; url: string }>('deferred:create', {
      statusCode: 500, body: { message: 'Mode change failed' }
    }).then(gate => {
      cy.intercept('POST', '**/api/workspace/5/settings/batch', request => {
        presets += 1;
        if (presets === 2) {
          request.url = gate.url;
          request.continue();
        } else request.reply({ body: request.body.settings });
      }).as('savePreset');
      cy.visit('/#/workspace-admin/5/settings');
      modeSwitch().should('have.attr', 'aria-checked', 'false').click();
      cy.wait('@savePreset');
      modeSwitch().should('have.attr', 'aria-checked', 'true').click();
      modeSwitch().should('have.attr', 'aria-checked', 'false');
      refreshSwitch().should('be.disabled');
      cy.task('deferred:release', gate.id);
      cy.wait('@savePreset').its('response.statusCode').should('eq', 500);
      modeSwitch().should('have.attr', 'aria-checked', 'true');
      refreshSwitch().should('be.disabled').and('have.attr', 'aria-checked', 'false');
      modeSwitch().click();
      cy.wait('@savePreset').its('response.statusCode').should('eq', 200);
      refreshSwitch().should('be.enabled').and('have.attr', 'aria-checked', 'true');
    });
  });

  it('preserves numeric edits after a rejected save and persists the draft on retry', () => {
    let storedTimeout = 45;
    const submitted: number[] = [];
    cy.task<{ id: string; url: string }>('deferred:create', {
      statusCode: 500, body: { message: 'Timeout save failed' }
    }).then(gate => {
      cy.intercept('GET', '**/api/workspace/5/settings/auth-session-idle-timeout-minutes', request => {
        request.reply({ body: { id: 1, key: 'auth-session-idle-timeout-minutes', value: JSON.stringify({ timeoutMinutes: storedTimeout }) } });
      }).as('loadTimeout');
      cy.intercept('POST', '**/api/workspace/5/settings', request => {
        expect(request.body.key).to.equal('auth-session-idle-timeout-minutes');
        const timeout = JSON.parse(request.body.value).timeoutMinutes as number;
        submitted.push(timeout);
        if (submitted.length === 1) {
          request.url = gate.url;
          request.continue();
        } else {
          storedTimeout = timeout;
          request.reply({ body: { id: 1, ...request.body } });
        }
      }).as('saveTimeout');

      cy.visit('/#/workspace-admin/5/settings');
      cy.wait('@loadTimeout');
      cy.get('.auth-session-timeout input').should('have.value', '45').clear().type('60');
      cy.get('.auth-session-timeout button').click();
      cy.wrap(null).should(() => { expect(submitted).to.deep.equal([60]); });
      cy.get('.auth-session-timeout input').clear().type('90');
      cy.task('deferred:release', gate.id);
      cy.wait('@saveTimeout').its('response.statusCode').should('eq', 500);
      cy.get('.auth-session-timeout input').should('have.value', '90');
      cy.get('.auth-session-timeout button').click();
      cy.wait('@saveTimeout').its('response.statusCode').should('eq', 200);
      cy.then(() => { expect(submitted).to.deep.equal([60, 90]); });
      cy.reload();
      cy.get('.auth-session-timeout input').should('have.value', '90');
    });
  });

  it('restores persisted refresh after a delayed initial read and a rejected evaluation preset', () => {
    cy.task<{ id: string; url: string }>('deferred:create', {
      statusCode: 200, body: { id: 1, key: 'auto-refresh-manual-coding-jobs', value: '{"enabled":true}' }
    }).then(initialGate => {
      cy.task<{ id: string; url: string }>('deferred:create', {
        statusCode: 500, body: { message: 'Mode change failed' }
      }).then(saveGate => {
        let saving = false;
        cy.intercept('GET', '**/api/workspace/5/settings/auto-refresh-manual-coding-jobs', request => {
          request.url = initialGate.url;
          request.continue();
        }).as('initialRefresh');
        cy.intercept('POST', '**/api/workspace/5/settings/batch', request => {
          saving = true;
          request.url = saveGate.url;
          request.continue();
        }).as('rejectedPreset');

        cy.visit('/#/workspace-admin/5/settings');
        modeSwitch().should('have.attr', 'aria-checked', 'false').click();
        cy.wrap(null).should(() => { expect(saving).to.equal(true); });
        modeSwitch().should('have.attr', 'aria-checked', 'true');
        refreshSwitch().should('have.attr', 'aria-checked', 'false');
        cy.task('deferred:release', initialGate.id);
        cy.wait('@initialRefresh');
        cy.task('deferred:release', saveGate.id);
        cy.wait('@rejectedPreset').its('response.statusCode').should('eq', 500);
        modeSwitch().should('have.attr', 'aria-checked', 'false');
        refreshSwitch().should('be.enabled').and('have.attr', 'aria-checked', 'true');
      });
    });
  });
});
