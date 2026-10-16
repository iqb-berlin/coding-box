type OwnershipKind = 'bundle' | 'definition' | 'job' | 'training';
type OwnershipRows = Record<OwnershipKind, {
  own: number;
  foreign: number;
  legacy: number;
}> & {
  legacyCoding: {
    testPerson: string;
    unitId: string;
    variableId: string;
  };
} & {
  job: {
    review: number;
    results_applied: number;
  };
};
describe('coding ownership with real role login and PostgreSQL', () => {
  let setup: {
    apiUrl: string;
    keycloakUrl: string;
    password: string;
    workspaceId: number;
    userId: number;
    username: string;
    fileAccessUserIds: Record<string, number>;
  };
  let rows: OwnershipRows;
  let token: string;
  before(() => {
    cy.task('workflows:setup', null, { log: false, timeout: 180000 }).then(value => { setup = value as typeof setup; });
  });
  after(() => { cy.task('workflows:cleanup', null, { log: false }); });
  function prepareOwnershipRows() {
    cy.task('workflows:prepare-ownership', null, { log: false }).then(value => { rows = value as OwnershipRows; });
  }
  function login(username: string) {
    cy.intercept('POST', '**/realms/coding-e2e/protocol/openid-connect/token', request => {
      request.continue(response => { token = response.body.access_token; });
    }).as('roleToken');
    cy.visit('/');
    cy.get('.login-button').click();
    cy.origin(setup.keycloakUrl, { args: { username, password: setup.password } }, credentials => {
      cy.get('#username').type(credentials.username);
      cy.get('#password').type(credentials.password, { log: false });
      cy.get('#kc-login').click();
    });
    cy.wait('@roleToken', { log: false }).its('response.statusCode').should('eq', 200);
    cy.get('coding-box-home').should('be.visible');
    api('/auth-data').its('body.userId').should('eq', setup.fileAccessUserIds[username]);
  }
  function api(route: string, method = 'GET', body?: unknown) {
    return cy.then(() => cy.request({
      url: `${setup.apiUrl}/api${route}`,
      method,
      body,
      headers: { authorization: `Bearer ${token}` },
      failOnStatusCode: false,
      log: false
    }));
  }
  function resource(kind: OwnershipKind, id: number) {
    const admin = `/admin/workspace/${setup.workspaceId}`;
    switch (kind) {
      case 'bundle': return { read: `${admin}/variable-bundle/${id}`, edit: `${admin}/variable-bundle/${id}`, body: { name: 'Edited by role' } };
      case 'definition': return { read: `${admin}/coding/job-definitions/${id}`, edit: `${admin}/coding/job-definitions/${id}`, body: { name: 'Edited by role' } };
      case 'job': return { read: `/wsg-admin/workspace/${setup.workspaceId}/coding-job/${id}`, edit: `/wsg-admin/workspace/${setup.workspaceId}/coding-job/${id}`, body: { name: 'Edited by role' } };
      case 'training': return { read: `${admin}/coding/coder-trainings`, edit: `${admin}/coding/coder-trainings/${id}/label`, body: { label: 'Edited by role' } };
      default: throw new Error(`Unsupported ownership kind: ${kind}`);
    }
  }
  it('denies manager actions while preserving assigned-coder writes on a legacy job', () => {
    prepareOwnershipRows();
    login('file-access-1');
    api(`/admin/workspace/${setup.workspaceId}/variable-bundle`, 'POST', {
      name: 'Forbidden bundle', variables: []
    }).its('status').should('eq', 403);
    cy.then(() => {
      const route = resource('job', rows.job.legacy);
      api(route.edit, 'PUT', { name: 'Forbidden rename' }).its('status').should('eq', 401);
      api(`${route.edit}/pause`, 'POST').its('status').should('eq', 201);
      api(`${route.edit}/resume`, 'POST').its('status').should('eq', 201);
      api(`${route.edit}/notes`, 'POST', { ...rows.legacyCoding, notes: 'Assigned coder note' }).its('status').should('eq', 201);
      api(`/admin/workspace/${setup.workspaceId}/coding-job/${rows.job.legacy}/notes`).then(({ body }) => {
        expect(Object.values(body)).to.include('Assigned coder note');
      });
      api(`${route.edit}/progress`, 'POST', { ...rows.legacyCoding, selectedCode: { id: 1, score: 1 }, isOpen: false })
        .its('status').should('eq', 201);
      api(`${route.edit}/submit`, 'POST').then(({ status, body }) => {
        expect(status).to.equal(201);
        expect(body.status).to.equal('completed');
        expect(body.creatorUserId).to.equal(null);
      });
    });
  });
  (['file-access-2', 'file-access-3', 'file-access-admin']).forEach(username => {
    it(`${username} can read all resources and mutate only permitted owners, including legacy rows`, () => {
      prepareOwnershipRows();
      login(username);
      (['bundle', 'definition', 'job', 'training'] as const).forEach(kind => {
        (['own', 'foreign', 'legacy'] as const).forEach(ownership => {
          cy.then(() => {
            const route = resource(kind, rows[kind][ownership]);
            api(route.read).its('status').should('eq', 200);
            api(route.edit, 'PUT', route.body).then(response => {
              expect(response.status, `${kind}/${ownership}: ${JSON.stringify(response.body)}`).to.equal(username === 'file-access-2' && ownership !== 'own' ? 403 : 200);
              if (response.status === 200 && kind === 'training') expect(response.body.success).to.equal(true);
            });
          });
        });
      });
      if (username === 'file-access-2') {
        (['completed', 'review', 'results_applied']).forEach(status => {
          api(`/wsg-admin/workspace/${setup.workspaceId}/coding-job`, 'POST', { name: 'Invalid initial state', status })
            .its('status').should('eq', 400);
        });
        cy.then(() => api(`/wsg-admin/workspace/${setup.workspaceId}/coding-job/${rows.job.own}/restart-open-units`, 'POST'))
          .its('status').should('eq', 400);
        (['review', 'results_applied'] as const).forEach(status => {
          cy.then(() => {
            const route = resource('job', rows.job[status]);
            api(route.edit, 'PUT', { status: 'active' }).its('status').should('eq', 400);
            api(`${route.edit}/restart-open-units`, 'POST').its('status').should('eq', 400);
            api(route.read).its('body.status').should('eq', status);
          });
        });
        api(`/admin/workspace/${setup.workspaceId}/coding/double-coded-review/apply-resolutions`, 'POST', { decisions: [] })
          .its('status').should('eq', 401);
        api(`/admin/workspace/${setup.workspaceId}/coding/coder-trainings/${rows.training.own}/apply-discussion-results`, 'POST', { source: 'manual' })
          .its('status').should('eq', 401);
        api(`/wsg-admin/workspace/${setup.workspaceId}/coding-job/bulk-delete`, 'POST', {
          ids: [rows.job.own, rows.job.foreign]
        }).its('status').should('eq', 403);
        cy.then(() => api(resource('job', rows.job.own).read)).its('status').should('eq', 200);
      }
    });
  });
  it('creates all four resources as Level 2 and preserves creator inheritance', () => {
    // The permission matrix deliberately reserves its cases with synthetic definitions.
    // Creation gets its own real, unreserved imported data instead.
    cy.task('workflows:cleanup', null, { log: false });
    cy.task('workflows:setup', null, { log: false, timeout: 180000 }).then(value => {
      setup = value as typeof setup;
      login('file-access-2');
      api(`/admin/workspace/${setup.workspaceId}/coding/job-definitions`).its('body').should('deep.equal', []);
      api('/auth-data').then(({ body: actor }) => {
        api(`/admin/users/access/${setup.workspaceId}`).then(({ status, body }) => {
          expect(status).to.equal(200);
          expect(body.find((user: {
            id: number;
          }) => user.id === actor.userId).accessLevel).to.equal(2);
        });
        api(`/admin/workspace/${setup.workspaceId}/coding/job-definitions`, 'POST', {
          name: 'Created by manager',
          status: 'draft',
          maxCodingCases: 1,
          assignedVariables: [{ unitName: 'UNIT-REPLAY', variableId: 'answer_1' }],
          assignedCoders: [setup.userId]
        }).then(({ status, body }) => {
          expect(status, JSON.stringify(body)).to.equal(201);
          expect(body.creatorUserId).to.equal(actor.userId);
          // Release this definition's reservation before the training creation.
          api(`/admin/workspace/${setup.workspaceId}/coding/job-definitions/${body.id}`, 'DELETE')
            .its('status').should('eq', 200);
        });
        api(`/wsg-admin/workspace/${setup.workspaceId}/coding-job`, 'POST', {
          name: 'Created by manager', assignedCoders: [], variables: [], creatorUserId: -1
        }).then(({ status, body }) => {
          expect(status, JSON.stringify(body)).to.equal(201);
          expect(body.creatorUserId).to.equal(actor.userId);
        });
        api(`/admin/workspace/${setup.workspaceId}/coding/coder-training-jobs`, 'POST', {
          trainingLabel: 'Created by manager',
          selectedCoders: [{ id: setup.userId, name: setup.username }],
          variableConfigs: [{ unitId: 'UNIT-REPLAY', variableId: 'answer_1', sampleCount: 1 }]
        }).then(({ status, body }) => {
          expect(status, JSON.stringify(body)).to.equal(201);
          expect(body.success, body.message).to.equal(true);
          expect(body.jobsCreated).to.be.greaterThan(0);
          api(`/admin/workspace/${setup.workspaceId}/coding/coder-trainings`).then(response => {
            expect(response.body.find((training: {
              id: number;
            }) => training.id === body.trainingId).creatorUserId).to.equal(actor.userId);
          });
          (body.jobs as {
            jobId: number;
          }[]).forEach(job => {
            api(`/wsg-admin/workspace/${setup.workspaceId}/coding-job/${job.jobId}`).its('body.creatorUserId').should('eq', actor.userId);
          });
        });
        api(`/admin/workspace/${setup.workspaceId}/variable-bundle`, 'POST', {
          name: 'Created by manager', variables: [], creatorUserId: -1
        }).then(({ status, body }) => {
          expect(status, JSON.stringify(body)).to.equal(201);
          expect(body.creatorUserId).to.equal(actor.userId);
          api(`/admin/workspace/${setup.workspaceId}/variable-bundle/${body.id}`, 'PUT', {
            name: 'Renamed', creatorUserId: -1
          }).then(response => {
            expect(response.status).to.equal(200);
            expect(response.body.creatorUserId).to.equal(actor.userId);
          });
        });
      });
    });
  });
});
