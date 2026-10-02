import '../e2e/workspace-access-rights.cy';

describe('zoneless users in workspace access rights', () => {
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
