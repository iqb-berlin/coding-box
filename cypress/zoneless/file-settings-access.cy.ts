// JwtStrategy passes the system-admin flag to UsersService.syncKeycloakUser, which persists it.
const fileViewRoles = [
  { name: 'no workspace access', level: 0, allowed: false, destination: 'auth=access-denied', roles: [], isAdmin: false },
  { name: 'coder', level: 1, allowed: false, destination: '/coding/my-jobs', roles: [], isAdmin: false },
  { name: 'coding manager', level: 2, allowed: false, destination: '/coding/statistics', roles: [], isAdmin: false },
  { name: 'study manager', level: 3, allowed: true, destination: '/test-files', roles: [], isAdmin: false },
  { name: 'workspace administrator', level: 4, allowed: true, destination: '/test-files', roles: [], isAdmin: false },
  { name: 'system role administrator', level: 0, allowed: true, destination: '/test-files', roles: ['admin'], isAdmin: true },
  { name: 'auth-data administrator', level: 0, allowed: true, destination: '/test-files', roles: [], isAdmin: true }
];

describe('Zoneless file settings access', () => {
  let unexpectedRequests: string[];
  let configurationRequests: number;
  let fileRequests: number;
  beforeEach(() => {
    unexpectedRequests = [];
    configurationRequests = 0;
    fileRequests = 0;
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
  });
  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  for (const role of fileViewRoles) {
    it(`checks delayed file settings access for ${role.name}`, () => {
      cy.mockKeycloakAuthentication('e2e-user', role.roles);
      cy.stubWorkspace({ workspaceId: 5, isAdmin: role.isAdmin, accessLevel: role.level });
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
        request.alias = 'fileRouteRights';
        request.reply({ delay: 400, body: rights });
      });
      cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":true}' } });
      cy.intercept('GET', '**/api/admin/workspace/5/coding/applied-results-overview', {
        body: { totalIncompleteResponses: 0, appliedResponses: 0, remainingResponses: 0, completionPercentage: 0,
          rawTotalIncompleteResponses: 0, rawAppliedResponses: 0, rawCompletionPercentage: 0,
          aggregationActive: false, aggregationThreshold: null, aggregatedDuplicateCases: 0 }
      });
      cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/active', { body: { hasActiveJob: false } });
      cy.intercept('GET', '**/api/admin/workspace/5/files?*', request => {
        fileRequests += 1;
        request.reply({ body: { data: [], total: 0, page: 1, limit: 100, fileTypes: [] } });
      });
      cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', request => {
        configurationRequests += 1;
        request.reply({ delay: 250, body: {
          enabled: true, baseUrl: 'https://synthetic.example', hasApplicationToken: true
        } });
      });
      cy.visit('/');
      cy.wait('@authData');
      cy.get('coding-box-home').should('be.visible');
      if (!role.isAdmin && role.roles.length === 0) {
        cy.wrap(null).should(() => { expect(pendingHomeRights.length).to.be.greaterThan(0); });
      }
      cy.window().then(win => {
        navigationRequested = true;
        win.addEventListener('hashchange', () => {
          win.setTimeout(() => pendingHomeRights.splice(0).forEach(release => release()), 0);
        }, { once: true });
        win.location.hash = '/workspace-admin/5/test-files';
      });
      if (!role.isAdmin && role.roles.length === 0) {
        cy.wait('@fileRouteRights').its('response.statusCode').should('eq', 200);
      }
      // The manager redirect traverses several delayed guards and lazy routes.
      cy.location('hash', { timeout: 15_000 }).should('contain', role.destination);
      if (role.allowed) {
        cy.get('coding-box-test-files').should('be.visible');
        cy.get('coding-box-test-files').contains('button', 'ACP aus Content Pool').should('be.enabled');
        cy.get('coding-box-search-filter input').focus().type('[');
        cy.get('coding-box-search-filter .regex-filter-error').should('be.visible');
        cy.then(() => {
          expect(configurationRequests).to.equal(1);
          expect(fileRequests).to.equal(1);
        });
      } else {
        if (role.level === 1) cy.get('coding-box-my-coding-jobs').should('be.visible');
        if (role.level === 2) cy.get('coding-box-coding-statistics-view').should('be.visible');
        cy.get('coding-box-test-files').should('not.exist');
        cy.then(() => {
          expect(configurationRequests).to.equal(0);
          expect(fileRequests).to.equal(0);
        });
      }
    });
  }
});
