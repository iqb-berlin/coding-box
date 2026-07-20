const keycloakUrl = 'https://keycloak.kodierbox.iqb.hu-berlin.de';

const createToken = (nonce: string): string => {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) =>
    Cypress.Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      sub: 'e2e-user',
      nonce,
      iat: now,
      exp: now + 3600,
      session_state: 'e2e-session',
      realm_access: { roles: ['admin'] }
    }),
    'e2e'
  ].join('.');
};

const authenticate = (): void => {
  let nonce = '';

  cy.intercept(
    'GET',
    `${keycloakUrl}/realms/coding-box/protocol/openid-connect/auth*`,
    (request) => {
      const url = new URL(request.url);
      nonce = url.searchParams.get('nonce') || '';
      const redirectUri = url.searchParams.get('redirect_uri') || '';
      const state = url.searchParams.get('state') || '';
      request.redirect(
        `${redirectUri}#code=e2e-code&state=${state}` +
          '&session_state=e2e-session',
        302
      );
    }
  );
  cy.intercept(
    'POST',
    `${keycloakUrl}/realms/coding-box/protocol/openid-connect/token`,
    (request) => {
      const token = createToken(nonce);
      request.reply({
        access_token: token,
        refresh_token: token,
        id_token: token,
        expires_in: 3600,
        refresh_expires_in: 3600,
        token_type: 'Bearer',
        session_state: 'e2e-session'
      });
    }
  );
  cy.intercept('GET', `${keycloakUrl}/realms/coding-box/account`, {
    body: {
      id: 'e2e-user',
      username: 'e2e-user',
      firstName: 'E2E',
      lastName: 'User'
    }
  });
};

describe('Itemdatensatz-Export', () => {
  it('configures the dialog and starts the export job', () => {
    authenticate();

    cy.intercept('GET', '**/api//admin/logo/settings', {
      statusCode: 404,
      body: {}
    });
    cy.intercept('GET', '**/api/system-notifications/active', { body: [] });
    cy.intercept('GET', '**/api/auth-data?identity=e2e-user', {
      body: {
        userId: 2,
        userName: 'e2e-user',
        email: 'e2e@example.org',
        firstName: 'E2E',
        lastName: 'User',
        isAdmin: true,
        workspaces: [{ id: 5, name: 'E2E Workspace' }]
      }
    }).as('authData');
    cy.intercept('GET', '**/api/admin/users/access/5', { body: [] });
    cy.intercept('GET', '**/api/wsg-admin/workspace/5/coding-job*', {
      body: {
        data: [],
        total: 0,
        page: 1,
        limit: 1
      }
    });
    cy.intercept(
      'GET',
      '**/api/workspace/5/settings/auth-session-idle-timeout-minutes',
      { body: 30 }
    );
    cy.intercept(
      'GET',
      '**/api/admin/workspace/5/responses/geogebra-existence',
      { body: false }
    );
    cy.intercept('GET', '**/api/admin/workspace/5/coding/missings-profiles', {
      body: [{ id: 4, label: 'IQB-Standard' }]
    }).as('missingProfiles');
    cy.intercept(
      'GET',
      '**/api/admin/workspace/5/coding/export/item-dataset-options',
      {
        body: {
          items: [
            {
              unitId: 'UNIT1',
              unitLabel: 'Aufgabe 1',
              itemId: 'ITEM1',
              itemLabel: 'Item 1',
              columnName: 'Aufgabe1_ITEM1'
            },
            {
              unitId: 'UNIT2',
              unitLabel: 'Aufgabe 2',
              itemId: 'ITEM2',
              itemLabel: 'Item 2',
              columnName: 'Aufgabe2_ITEM2'
            }
          ],
          mappingIssues: []
        }
      }
    ).as('itemDatasetOptions');
    cy.intercept(
      'POST',
      '**/api/admin/workspace/5/coding/export/start',
      (request) => {
        expect(request.body).to.deep.include({
          exportType: 'item-matrix',
          missingsProfileId: 4,
          notReachedScope: 'testlet',
          recodeTrailingOmissions: true
        });
        expect(request.body.items).to.deep.equal([
          { unitId: 'UNIT1', itemId: 'ITEM1' }
        ]);
        request.reply({ jobId: 'export-1', message: 'started' });
      }
    ).as('startExport');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/export/job/export-1', {
      body: { status: 'waiting', progress: 0 }
    });

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then((window) => {
      window.location.hash = '/workspace-admin/5/export';
    });

    cy.get('[data-cy="export-type"]').click();
    cy.contains('mat-option', 'Itemdatensatz').click();
    cy.wait(['@missingProfiles', '@itemDatasetOptions']);

    cy.get('[data-cy="item-dataset-missings-profile"]').should(
      'contain.text',
      'IQB-Standard'
    );
    cy.get('[data-cy="item-dataset-search"]').type('Aufgabe2');
    cy.get('[data-cy="item-dataset-items"]').click();
    cy.contains('mat-option', 'Aufgabe2_ITEM2').click();
    cy.get('body').type('{esc}');

    cy.get('[data-cy="item-dataset-mnr-scope"]').click();
    cy.contains('mat-option', 'Pro Testlet').click();
    cy.get('[data-cy="item-dataset-recode-trailing"]').click();
    cy.get('[data-cy="start-export"]').click();

    cy.wait('@startExport');
    cy.get('coding-box-export-toast').should('contain.text', 'Itemdatensatz');
  });
});
