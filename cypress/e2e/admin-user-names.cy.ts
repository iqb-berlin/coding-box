describe('OIDC names in general system administration', () => {
  const users = [
    { id: 7, username: 'z-login', displayName: 'Ada Lovelace', isAdmin: false },
    { id: 8, username: 'a-login', displayName: 'Grace Hopper', isAdmin: false },
    { id: 9, username: 'legacy-login', displayName: '', isAdmin: false }
  ];

  beforeEach(() => {
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/admin/users/full', { delay: 200, body: users }).as('users');
    cy.intercept('GET', '**/api/admin/users/*/workspaces', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace', {
      body: { data: [{ id: 5, name: 'E2E Workspace' }], total: 1, page: 1, limit: 20 }
    });
    cy.visit('/');
    cy.wait('@authData');
  });

  it('shows given name before family name and supports name sorting and search', () => {
    cy.window().then(win => { win.location.hash = '/admin/users'; });
    cy.wait('@users');
    cy.contains('mat-row', 'z-login').find('.mat-column-displayName').should('contain.text', 'Ada Lovelace');
    cy.contains('mat-row', 'legacy-login').find('.mat-column-displayName').invoke('text').should('match', /^\s*$/);
    cy.get('mat-header-cell.mat-column-displayName').click().click();
    cy.get('mat-row').first().should('contain.text', 'Grace Hopper');
    cy.get('coding-box-users-selection coding-box-search-filter input').type('lovelace');
    cy.get('coding-box-users-selection mat-row').should('have.length', 1).and('contain.text', 'z-login');
  });

  it('shows the same full name when assigning users to a workspace', () => {
    cy.intercept('GET', '**/api/admin/workspace/5/users?*', {
      body: { data: [{ userId: 7, workspaceId: 5, accessLevel: 3, canCode: false }], total: 1, page: 1, limit: 100 }
    });
    cy.window().then(win => { win.location.hash = '/admin/workspaces'; });
    cy.contains('coding-box-workspaces-selection mat-row', 'E2E Workspace').find('mat-checkbox').click();
    cy.get('coding-box-workspaces-menu button').eq(3).should('be.enabled').click();
    cy.contains('coding-box-user-access-rights-dialog mat-row', 'Ada Lovelace')
      .should('contain.text', 'z-login').find('input[type="checkbox"]').should('be.checked');
  });
});
