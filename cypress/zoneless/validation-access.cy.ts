const roles = [
  { name: 'no workspace access', level: 0, destination: 'auth=access-denied', allowed: false },
  { name: 'coder', level: 1, destination: '/coding/my-jobs', allowed: false },
  { name: 'coding manager', level: 2, destination: '/coding/statistics', allowed: false },
  { name: 'study manager', level: 3, destination: '/test-results', allowed: true },
  { name: 'workspace administrator', level: 4, destination: '/test-results', allowed: true }
];

describe('Zoneless validation access', () => {
  let unexpectedRequests: string[];
  let validationRequests: string[];

  beforeEach(() => {
    unexpectedRequests = [];
    validationRequests = [];
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests, 'explicit API fixtures').to.deep.equal([]); });
  });

  for (const role of roles) {
    it(`handles delayed rights for ${role.name}`, () => {
      cy.mockKeycloakAuthentication('e2e-user', []);
      cy.stubWorkspace({ workspaceId: 5, isAdmin: false, accessLevel: role.level });
      let navigationRequested = false;
      const pendingHomeRights: (() => void)[] = [];
      const rights = [{ id: 2, accessLevel: role.level, canCode: role.level === 1 }];
      cy.intercept('GET', '**/api/admin/users/access/5', request => {
        if (!navigationRequested) {
          return new Cypress.Promise<void>(resolve => {
            pendingHomeRights.push(() => {
              request.reply({ body: rights });
              resolve();
            });
          });
        }
        request.reply({ delay: 400, body: rights });
      }).as('rights');
      cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":true}' } });
      cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', { body: { data: [], total: 0 } });
      cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', {
        body: { testPersons: 0, testGroups: 0, uniqueBooklets: 0, uniqueUnits: 0, uniqueResponses: 0 }
      });
      cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', { body: [] });
      cy.intercept('GET', '**/api/admin/workspace/5/coding/applied-results-overview', {
        body: { totalIncompleteResponses: 0, appliedResponses: 0, remainingResponses: 0, completionPercentage: 0,
          rawTotalIncompleteResponses: 0, rawAppliedResponses: 0, rawCompletionPercentage: 0,
          aggregationActive: false, aggregationThreshold: null, aggregatedDuplicateCases: 0 }
      });
      cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/active', { body: { hasActiveJob: false } });
      let taskId = 0;
      cy.intercept('POST', '**/api/admin/workspace/5/validation-tasks?*', request => {
        validationRequests.push(String(request.query.type));
        request.reply({ id: ++taskId, workspace_id: 5, status: 'pending' });
      });
      cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/**', request => {
        request.reply(request.url.endsWith('/results') ?
          { data: [], total: 0, testTakersFound: true, missingPersons: [], allGroupsHaveResponses: true, groupsWithResponses: [] } :
          { id: taskId, workspace_id: 5, status: 'completed', progress: 100 });
      });
      cy.visit('/');
      cy.wait('@authData');
      cy.get('coding-box-home').should('be.visible');
      cy.wrap(null).should(() => { expect(pendingHomeRights.length, 'pending Home rights').to.be.greaterThan(0); });
      cy.window().then(win => {
        navigationRequested = true;
        // Release the old response after Router has processed the hash navigation.
        win.addEventListener('hashchange', () => {
          win.setTimeout(() => pendingHomeRights.splice(0).forEach(release => release()), 0);
        }, { once: true });
        win.location.hash = '/workspace-admin/5/test-results';
      });
      cy.location('hash').should('contain', role.destination);
      if (role.allowed) {
        cy.get('coding-box-test-results').should('be.visible');
        cy.contains('button', 'Validieren').should('be.enabled').click();
        cy.get('coding-box-validation-dialog').should('contain.text', 'Alle Prüfungen bestanden');
        cy.then(() => { expect(validationRequests).to.have.length(6); });
      } else {
        if (role.level === 1) cy.get('coding-box-my-coding-jobs').should('be.visible');
        if (role.level === 2) cy.get('coding-box-coding-statistics-view').should('be.visible');
        cy.get('coding-box-test-results').should('not.exist');
        cy.get('coding-box-validation-dialog').should('not.exist');
        cy.then(() => { expect(validationRequests).to.deep.equal([]); });
      }
    });
  }
});

export {};
