describe('User directory request states and accessible actions', () => {
  let unexpectedRequests: string[];

  beforeEach(() => {
    unexpectedRequests = [];
    cy.viewport(1280, 900);
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/admin/workspace', { body: { data: [], total: 0, page: 1, limit: 20 } });
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  function visitUsers(): void {
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/admin/users'; });
  }

  it('shows a load error and retries without representing it as an empty directory', () => {
    let requests = 0;
    cy.intercept('GET', '**/api/admin/users/full', request => {
      requests += 1;
      request.reply(requests === 1 ?
        { statusCode: 500, delay: 300, body: { message: 'Unavailable' } } :
        { delay: 300, body: [{ id: 7, username: 'Recovered user', isAdmin: false }] });
    }).as('users');
    visitUsers();
    cy.contains('coding-box-user-directory-status [role="status"]', 'Benutzer werden geladen').should('be.visible');
    cy.wait('@users');
    cy.contains('coding-box-user-directory-status [role="alert"]', 'Die Benutzer konnten nicht geladen werden').should('be.visible');
    cy.get('coding-box-user-directory-status').should('not.contain.text', 'Keine Benutzer vorhanden');
    cy.contains('coding-box-user-directory-status button', 'Erneut versuchen').click();
    cy.wait('@users');
    cy.contains('coding-box-users-selection mat-row', 'Recovered user').should('be.visible');
    cy.get('coding-box-user-directory-status [role="alert"]').should('not.exist');
    cy.then(() => { expect(requests).to.equal(2); });
    cy.get('coding-box-users-menu button').each(button => {
      expect(button.attr('aria-label') || button.attr('aria-labelledby'), 'accessible action name').to.be.a('string').and.not.be.empty;
    });
  });

  it('shows a successful empty response as an empty directory', () => {
    cy.intercept('GET', '**/api/admin/users/full', { delay: 300, body: [] }).as('users');
    visitUsers();
    cy.wait('@users');
    cy.contains('coding-box-user-directory-status [role="status"]', 'Keine Benutzer vorhanden').should('be.visible');
    cy.get('coding-box-user-directory-status [role="alert"]').should('not.exist');
    cy.get('coding-box-users-selection mat-row').should('not.exist');
  });
});
