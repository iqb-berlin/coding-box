describe('User onboarding and live assignment lists', () => {
  it('adds newly imported people to an open directory without clearing selection or search', () => {
    let imported = false;
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/admin/workspace', {
      body: { data: [{ id: 5, name: 'Workspace' }], total: 1, page: 1, limit: 20 }
    });
    cy.intercept('GET', '**/api/admin/users/2/workspaces', { body: [5] });
    cy.intercept('GET', '**/api/admin/users/full', request => {
      request.reply([{ id: 2, username: 'coder-existing' }, ...(imported ? [{ id: 7, username: 'coder-imported' }] : [])]);
    }).as('directory');
    cy.clock(Date.now(), ['Date', 'setInterval', 'clearInterval']);
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/admin/users'; });
    cy.wait('@directory');
    cy.contains('coding-box-users-selection mat-row', 'coder-existing').find('mat-checkbox').click();
    cy.get('coding-box-users-selection coding-box-search-filter input').type('coder');
    cy.then(() => { imported = true; });
    cy.tick(30_000);
    cy.wait('@directory');
    cy.contains('coding-box-users-selection mat-row', 'coder-imported').should('be.visible');
    cy.contains('coding-box-users-selection mat-row', 'coder-existing').find('input[type="checkbox"]').should('be.checked');
    cy.get('coding-box-users-selection coding-box-search-filter input').should('have.value', 'coder');
    cy.viewport(390, 844);
    cy.screenshot('user-onboarding-directory-mobile');
  });

  it('moves a waiting coder to newly assigned jobs without logging in again', () => {
    let assigned = false;
    cy.mockKeycloakAuthentication('e2e-user', []);
    cy.stubWorkspace({ workspaceId: 5, isAdmin: false, accessLevel: 1 });
    cy.intercept('GET', '**/api/auth-data?identity=e2e-user', request => {
      request.reply({ userId: 2, userName: 'e2e-user', isAdmin: false,
        workspaces: assigned ? [{ id: 5, name: 'Workspace' }] : [] });
    }).as('assignments');
    cy.intercept('GET', '**/api/wsg-admin/workspace/5/coding-job*', {
      body: { data: [], total: 0, page: 1, limit: 20 }
    }).as('jobs');
    cy.clock(Date.now(), ['Date', 'setInterval', 'clearInterval']);
    cy.visit('/');
    cy.wait('@assignments');
    cy.contains('coding-box-user-workspaces', 'Ihre Anmeldung war erfolgreich.').should('be.visible');
    cy.viewport(390, 844);
    cy.screenshot('user-onboarding-waiting-mobile');
    cy.viewport(1280, 900);
    cy.screenshot('user-onboarding-waiting-desktop');
    cy.then(() => { assigned = true; });
    cy.contains('coding-box-user-workspaces button', 'Zuweisungen aktualisieren').should('not.exist');
    cy.tick(30_000);
    cy.wait('@jobs');
    cy.location('hash').should('eq', '#/coding');
    cy.contains('coding-box-my-coding-jobs', 'Bitte warten Sie auf die Zuweisung durch die Studienleitung.').should('be.visible');
    cy.intercept('GET', '**/api/wsg-admin/workspace/5/coding-job*', {
      body: { data: [{ id: 42, workspace_id: 5, name: 'Newly assigned job', status: 'pending',
        assignedCoders: [2], totalUnits: 1, codedUnits: 0, progress: 0 }], total: 1, page: 1, limit: 20 }
    }).as('newJobs');
    cy.contains('coding-box-my-coding-jobs button', 'Zuweisungen aktualisieren').should('not.exist');
    cy.tick(30_000);
    cy.wait('@newJobs');
    cy.contains('coding-box-my-coding-jobs mat-row', 'Newly assigned job').should('be.visible');

    cy.intercept('GET', '**/api/auth-data?identity=e2e-user', request => {
      request.reply({ userId: 2, userName: 'e2e-user', isAdmin: false,
        workspaces: [{ id: 5, name: 'Workspace' }, { id: 6, name: 'Second workspace' }] });
    }).as('secondAssignment');
    cy.intercept('GET', '**/api/wsg-admin/workspace/6/coding-job*', {
      body: { data: [{ id: 43, workspace_id: 6, name: 'Job in second workspace', status: 'pending',
        assignedCoders: [2], totalUnits: 1, codedUnits: 0, progress: 0 }], total: 1, page: 1, limit: 20 }
    }).as('secondWorkspaceJobs');
    cy.tick(30_000);
    cy.wait('@secondAssignment');
    cy.wait('@secondWorkspaceJobs');
    cy.contains('coding-box-my-coding-jobs mat-row', 'Job in second workspace').should('be.visible');
  });
});
