describe('Workspace access rights', () => {
  it('waits for the workspace list before saving existing access rights', () => {
    let holdList = false;
    let releaseList: (() => void) | undefined;
    const workspaces = { data: [{ id: 5, name: 'E2E Workspace' }], total: 1, page: 1, limit: 20 };
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/admin/users/full', {
      body: [{ id: 2, username: 'e2e-user', firstName: 'E2E', lastName: 'User', isAdmin: true }]
    });
    cy.intercept('GET', '**/api/admin/users/2/workspaces', { body: [5] }).as('rights');
    cy.intercept('GET', '**/api/admin/workspace', request => {
      if (!holdList) {
        request.reply(workspaces);
        return;
      }
      return new Promise<void>(resolve => {
        releaseList = () => {
          request.reply(workspaces);
          resolve();
        };
      });
    }).as('workspaceList');
    cy.intercept('POST', '**/api/admin/users/2/workspaces/', request => {
      expect(request.body).to.deep.equal([5]);
      request.reply(true);
    }).as('saveRights');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/admin/users'; });
    cy.wait('@workspaceList');
    cy.contains('coding-box-users-selection mat-row', 'e2e-user').find('mat-checkbox').click();
    cy.then(() => { holdList = true; });
    cy.get('coding-box-users-menu button').eq(2).click();
    cy.wait('@rights');
    cy.get('coding-box-workspace-access-rights-dialog mat-dialog-actions button').first()
      .should('be.disabled');
    cy.wrap(null).should(() => { expect(releaseList).to.be.a('function'); });
    cy.then(() => releaseList!());
    cy.contains('coding-box-workspace-access-rights-dialog mat-row', 'E2E Workspace')
      .find('input[type="checkbox"]').should('be.checked');
    cy.get('coding-box-workspace-access-rights-dialog mat-dialog-actions button').first()
      .should('not.be.disabled').click();
    cy.wait('@saveRights').its('response.statusCode').should('eq', 200);
  });
});
