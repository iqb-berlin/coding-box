describe('Typed administration forms without Zone.js', () => {
  let unexpectedRequests: string[];
  let workspaces: { id: number; name: string }[];
  let mutations: string[];

  beforeEach(() => {
    unexpectedRequests = [];
    mutations = [];
    workspaces = [{ id: 5, name: 'Existing workspace' }];
    cy.viewport(1280, 900);
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/admin/workspace', request => {
      request.reply({ delay: 300, body: { data: workspaces, total: workspaces.length, page: 1, limit: 20 } });
    }).as('workspaces');
    cy.intercept('POST', '**/api/admin/workspace', request => {
      mutations.push('create');
      expect(request.body).to.deep.equal({ name: 'New workspace', settings: {} });
      workspaces.push({ id: 9, name: request.body.name });
      request.reply({ delay: 300, body: 9 });
    }).as('create');
    cy.intercept('PATCH', '**/api/admin/workspace', request => {
      mutations.push('rename');
      expect(request.body).to.deep.equal({ id: 5, name: 'Renamed workspace' });
      workspaces[0].name = request.body.name;
      request.reply({ delay: 300, body: true });
    }).as('rename');
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests, 'explicit API fixtures').to.deep.equal([]); });
  });

  function visitWorkspaces(): void {
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/admin/workspaces'; });
    cy.contains('coding-box-workspaces-selection mat-row', 'Existing workspace').should('be.visible');
  }

  function editWorkspace(): void {
    visitWorkspaces();
    cy.contains('coding-box-workspaces-selection mat-row', 'Existing workspace').find('input[type="checkbox"]').check();
    cy.get('coding-box-workspaces-menu button').eq(2).should('be.enabled').click();
    cy.get('coding-box-edit-workspace-group input[formControlName="name"]').should('have.value', 'Existing workspace');
  }

  it('requires a valid workspace name and creates the workspace from the typed dialog result', () => {
    visitWorkspaces();
    cy.get('coding-box-workspaces-menu button').first().click();
    cy.get('coding-box-edit-workspace-group input[formControlName="name"]').should('have.value', '').type('ab');
    cy.get('coding-box-edit-workspace-group button[type="submit"]').should('be.disabled');
    cy.get('coding-box-edit-workspace-group input[formControlName="name"]').clear().type('New workspace');
    cy.get('coding-box-edit-workspace-group button[type="submit"]').should('be.enabled').click();
    cy.wait('@create');
    cy.get('coding-box-edit-workspace-group').should('not.exist');
    cy.contains('coding-box-workspaces-selection mat-row', 'New workspace').should('be.visible');
    cy.then(() => { expect(mutations).to.deep.equal(['create']); });
  });

  it('prefills the selected name and saves a rename to the selected workspace ID', () => {
    editWorkspace();
    cy.get('coding-box-edit-workspace-group input[formControlName="name"]').clear().type('Renamed workspace');
    cy.get('coding-box-edit-workspace-group button[type="submit"]').click();
    cy.wait('@rename');
    cy.get('coding-box-edit-workspace-group').should('not.exist');
    cy.contains('coding-box-workspaces-selection mat-row', 'Renamed workspace').should('be.visible');
    cy.then(() => { expect(mutations).to.deep.equal(['rename']); });
  });

  it('cancels an edited workspace without sending a mutation', () => {
    editWorkspace();
    cy.get('coding-box-edit-workspace-group input[formControlName="name"]').clear().type('Unsaved workspace');
    cy.get('coding-box-edit-workspace-group mat-dialog-actions button').last().click();
    cy.get('coding-box-edit-workspace-group').should('not.exist');
    cy.contains('coding-box-workspaces-selection mat-row', 'Existing workspace').should('be.visible');
    cy.then(() => { expect(mutations).to.deep.equal([]); });
  });

  it('saves an unchecked admin flag as false while retaining the read-only username', () => {
    cy.intercept('GET', '**/api/admin/users/full', { body: [{ id: 7, username: 'existing-user', isAdmin: true }] });
    cy.intercept('GET', '**/api/admin/users/7/workspaces', { body: [5] });
    cy.intercept('PATCH', '**/api/admin/users/2', request => {
      expect(request.body).to.deep.equal({ id: 7, username: 'existing-user', isAdmin: false });
      request.reply({ delay: 300, body: true });
    }).as('editUser');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/admin/users'; });
    cy.contains('coding-box-users-selection mat-row', 'existing-user').find('input[type="checkbox"]').check();
    cy.get('coding-box-users-menu button').first().click();
    cy.get('coding-box-edit-user input[formControlName="username"]').should('have.value', 'existing-user').and('have.attr', 'readonly');
    cy.get('coding-box-edit-user mat-checkbox[formControlName="isAdmin"] input').should('be.checked').uncheck();
    cy.get('coding-box-edit-user button[type="submit"]').should('be.enabled').click();
    cy.wait('@editUser');
    cy.get('coding-box-edit-user').should('not.exist');
  });
});
