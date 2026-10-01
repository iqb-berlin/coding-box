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

  it('blocks editing until user rights arrive and saves the visible selection', () => {
    let holdRights = false;
    let releaseRights: (() => void) | undefined;
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/admin/users/full', {
      body: [{ id: 2, username: 'e2e-user', firstName: 'E2E', lastName: 'User', isAdmin: true }]
    });
    cy.intercept('GET', '**/api/admin/workspace', {
      body: {
        data: [{ id: 5, name: 'Workspace A' }, { id: 6, name: 'Workspace B' }],
        total: 2,
        page: 1,
        limit: 20
      }
    }).as('workspaceList');
    cy.intercept('GET', '**/api/admin/users/2/workspaces', request => {
      if (!holdRights) {
        request.reply([5]);
        return;
      }
      return new Promise<void>(resolve => {
        releaseRights = () => {
          request.reply([5]);
          resolve();
        };
      });
    }).as('rights');
    cy.intercept('POST', '**/api/admin/users/2/workspaces/', request => {
      expect(request.body).to.deep.equal([6]);
      request.reply(true);
    }).as('saveRights');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/admin/users'; });
    cy.wait('@workspaceList');
    cy.contains('coding-box-users-selection mat-row', 'e2e-user').find('mat-checkbox').click();
    cy.wait('@rights');
    cy.then(() => { holdRights = true; });
    cy.get('coding-box-users-menu button').eq(2).click();
    cy.wrap(null).should(() => { expect(releaseRights).to.be.a('function'); });
    cy.get('coding-box-workspace-access-rights-dialog mat-table input[type="checkbox"]')
      .should('have.length', 3).each(checkbox => { cy.wrap(checkbox).should('be.disabled'); });
    cy.get('coding-box-workspace-access-rights-dialog mat-dialog-actions button').first()
      .should('be.disabled');

    cy.then(() => releaseRights!());
    cy.wait('@rights');
    cy.contains('coding-box-workspace-access-rights-dialog mat-row', 'Workspace A')
      .find('input[type="checkbox"]').should('be.checked').and('not.be.disabled');
    cy.contains('coding-box-workspace-access-rights-dialog mat-row', 'Workspace A').find('mat-checkbox').click();
    cy.contains('coding-box-workspace-access-rights-dialog mat-row', 'Workspace B').find('mat-checkbox').click();
    cy.contains('coding-box-workspace-access-rights-dialog mat-row', 'Workspace A')
      .find('input[type="checkbox"]').should('not.be.checked');
    cy.contains('coding-box-workspace-access-rights-dialog mat-row', 'Workspace B')
      .find('input[type="checkbox"]').should('be.checked');
    cy.get('coding-box-workspace-access-rights-dialog mat-dialog-actions button').first()
      .should('not.be.disabled').click();
    cy.wait('@saveRights').its('response.statusCode').should('eq', 200);
  });

  [false, true].forEach(failSecondPage => {
    it(`preserves rights beyond page one when the second page ${failSecondPage ? 'fails' : 'loads'}`, () => {
      let releasePage: (() => void) | undefined;
      let dialogOpen = false;
      const rows = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, name: `Workspace ${index + 1}` }));
      cy.mockKeycloakAuthentication();
      cy.stubWorkspace({ workspaceId: 5 });
      cy.intercept('GET', '**/api/admin/users/full', {
        body: [{ id: 2, username: 'e2e-user', firstName: 'E2E', lastName: 'User', isAdmin: true }]
      });
      cy.intercept('GET', '**/api/admin/users/2/workspaces', { body: [21] }).as('rights');
      cy.intercept('GET', '**/api/admin/workspace*', request => {
        if (new URL(request.url).pathname !== '/api/admin/workspace') {
          request.continue();
          return;
        }
        if (request.query.page !== '2') {
          request.reply({ data: rows, total: 21, page: 1, limit: 20 });
          return;
        }
        const reply = () => {
          if (failSecondPage && dialogOpen) request.reply({ statusCode: 503, body: 'Unavailable' });
          else request.reply({ data: [{ id: 21, name: 'Later workspace' }], total: 21, page: 2, limit: 20 });
        };
        if (!dialogOpen) {
          reply();
          return;
        }
        request.alias = 'dialogPage';
        return new Promise<void>(resolve => {
          releasePage = () => { reply(); resolve(); };
        });
      });
      cy.intercept('POST', '**/api/admin/users/2/workspaces/', request => {
        expect(request.body).to.deep.equal([21]);
        request.reply(true);
      }).as('saveRights');
      cy.visit('/');
      cy.wait('@authData');
      cy.window().then(win => { win.location.hash = '/admin/users'; });
      cy.contains('coding-box-users-selection mat-row', 'e2e-user').find('mat-checkbox').click();
      cy.wait('@rights');
      cy.then(() => { dialogOpen = true; });
      cy.get('coding-box-users-menu button').eq(2).click();
      cy.wrap(null).should(() => { expect(releasePage).to.be.a('function'); });
      cy.get('coding-box-workspace-access-rights-dialog mat-dialog-actions button').first().should('be.disabled');
      cy.then(() => releasePage!());
      cy.wait('@dialogPage');
      if (failSecondPage) {
        cy.get('coding-box-workspace-access-rights-dialog mat-dialog-actions button').first().should('be.disabled');
        cy.get('coding-box-workspace-access-rights-dialog mat-row').should('not.exist');
        cy.get('@saveRights.all').should('have.length', 0);
      } else {
        cy.get('coding-box-workspace-access-rights-dialog mat-row').should('have.length', 21);
        cy.contains('coding-box-workspace-access-rights-dialog mat-row', 'Later workspace')
          .find('input[type="checkbox"]').should('be.checked');
        cy.get('coding-box-workspace-access-rights-dialog mat-dialog-actions button').first()
          .should('not.be.disabled').click();
        cy.wait('@saveRights').its('response.statusCode').should('eq', 200);
      }
    });
  });

});
