import '../e2e/workspace-access-rights.cy';

describe('zoneless users in workspace access rights', () => {
  for (const role of [{ name: 'administrator', isAdmin: true }, { name: 'study manager', isAdmin: false }]) {
    it(`retains edited rights after a delayed save failure and retries as ${role.name}`, () => {
      const unexpectedRequests: string[] = [];
      cy.intercept('**/api/**', request => {
        unexpectedRequests.push(`${request.method} ${request.url}`);
        request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
      });
      cy.mockKeycloakAuthentication('e2e-user', role.isAdmin ? ['admin'] : []);
      cy.stubWorkspace({ workspaceId: 5, isAdmin: role.isAdmin, accessLevel: 3 });
      cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
      cy.intercept('GET', '**/api/admin/workspace/token-policy', {
        body: { scopes: { 'replay:read': { maxDurationDays: 365 } } }
      });
      cy.intercept('GET', '**/api/admin/workspace/5/journal?*', {
        body: { data: [], total: 0, page: 1, limit: 20 }
      });
      cy.intercept('GET', '**/api/admin/users/access/5', { delay: 400, body: [
        { id: 2, name: 'Current manager', accessLevel: 3, canCode: false },
        { id: 7, name: 'Workspace user', accessLevel: 1, canCode: false }
      ] });
      let saves = 0;
      cy.intercept('PATCH', '**/api/admin/users/access/5', request => {
        saves += 1;
        expect(request.body).to.deep.equal([
          { id: 2, accessLevel: 3, canCode: false }, { id: 7, accessLevel: 3, canCode: false }
        ]);
        request.reply(saves === 1 ? { delay: 400, statusCode: 500, body: { message: 'Synthetic rights save failure' } } :
          { delay: 400, body: true });
      }).as('saveRightsRetry');
      cy.visit('/');
      cy.wait('@authData');
      cy.window().then(win => { win.location.hash = '/workspace-admin/5/settings'; });
      cy.get('coding-box-ws-access-rights').as('rights');
      cy.get('@rights').contains('tr', 'Workspace user').find('input[type="checkbox"]').eq(2).check();
      cy.get('@rights').find('button').should('be.enabled').click();
      cy.wait('@saveRightsRetry').its('response.statusCode').should('eq', 500);
      cy.get('@rights').contains('tr', 'Workspace user').find('input[type="checkbox"]').eq(2).should('be.checked');
      cy.get('@rights').find('button').should('be.enabled');
      cy.get('coding-box-error-message-display .close-button').click();
      cy.get('@rights').find('button').click();
      cy.wait('@saveRightsRetry').its('response.statusCode').should('eq', 200);
      cy.get('@rights').find('button').should('be.disabled');
      cy.get('@rights').contains('tr', 'Workspace user').find('input[type="checkbox"]').eq(2).should('be.checked');
      cy.window().should('not.have.property', 'Zone');
      cy.then(() => {
        expect(saves).to.equal(2);
        expect(unexpectedRequests, 'explicit API fixtures').to.deep.equal([]);
      });
    });
  }

  it('clears the saved change indicator even when the delayed auth refresh fails', () => {
    const unexpectedRequests: string[] = [];
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/token-policy', {
      body: { scopes: { 'replay:read': { maxDurationDays: 365 } } }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/journal?*', {
      body: { data: [], total: 0, page: 1, limit: 20 }
    });
    cy.intercept('GET', '**/api/admin/users/access/5', { body: [
      { id: 7, name: 'Workspace user', accessLevel: 1, canCode: false }
    ] });
    cy.intercept('PATCH', '**/api/admin/users/access/5', request => {
      expect(request.body).to.deep.equal([{ id: 7, accessLevel: 3, canCode: false }]);
      request.reply({ delay: 300, body: true });
    }).as('saveWorkspaceRights');

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/settings'; });
    cy.get('coding-box-ws-access-rights').as('rights');
    cy.get('@rights').contains('tr', 'Workspace user').find('input[type="checkbox"]').eq(2).check();
    cy.get('@rights').find('button').should('be.enabled');
    cy.intercept('GET', '**/api/auth-data?identity=e2e-user', {
      delay: 800, statusCode: 400, body: { message: 'Synthetic auth refresh failure' }
    }).as('failedAuthRefresh');
    cy.get('@rights').find('button').click();
    cy.wait(['@saveWorkspaceRights', '@failedAuthRefresh']);
    cy.get('@rights').find('button').should('be.disabled');
    cy.get('mat-snack-bar-container').should('contain.text', 'gespeichert');
    cy.get('@rights').contains('tr', 'Workspace user').find('input[type="checkbox"]').eq(2)
      .should('be.checked');
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  it('renders users when their response arrives after the existing rights', () => {
    let releaseUsers: (() => void) | undefined;
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/admin/workspace', {
      body: {
        data: [{ id: 5, name: 'E2E Workspace' }], total: 1, page: 1, limit: 20
      }
    }).as('workspaces');
    cy.intercept('GET', '**/api/admin/workspace/5/users?*', {
      body: {
        data: [{ userId: 7, workspaceId: 5, accessLevel: 3, canCode: false }],
        total: 1,
        page: 1,
        limit: 100
      }
    }).as('rights');
    cy.intercept('GET', '**/api/admin/users/full', request => new Promise<void>(resolve => {
      releaseUsers = () => {
        request.reply({
          body: [{ id: 7, username: 'Existing user' }, { id: 8, username: 'Other user' }]
        });
        resolve();
      };
    })).as('users');

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(window => { window.location.hash = '/admin/workspaces'; });
    cy.wait('@workspaces');
    cy.contains('coding-box-workspaces-selection mat-row', 'E2E Workspace').find('mat-checkbox').click();
    cy.get('coding-box-workspaces-menu button').eq(3).should('be.enabled').click();
    cy.wait('@rights');
    cy.get('coding-box-user-access-rights-dialog button[color="primary"]').should('be.enabled');
    cy.get('coding-box-user-access-rights-dialog mat-row').should('not.exist');
    cy.wrap(null).should(() => { expect(releaseUsers).to.be.a('function'); });

    cy.then(() => releaseUsers!());
    cy.wait('@users');

    cy.get('coding-box-user-access-rights-dialog mat-row').should('have.length', 2);
    cy.contains('coding-box-user-access-rights-dialog mat-row', 'Existing user')
      .find('input[type="checkbox"]').should('be.checked');
    cy.contains('coding-box-user-access-rights-dialog mat-row', 'Other user')
      .find('input[type="checkbox"]').should('not.be.checked');
    cy.window().should('not.have.property', 'Zone');
  });
});
