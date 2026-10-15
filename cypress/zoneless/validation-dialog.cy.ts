const exportPanels = [
  { type: 'variables', selector: 'variables', file: 'variablen' },
  { type: 'variableTypes', selector: 'variable-types', file: 'variablentypen' },
  { type: 'responseStatus', selector: 'response-status', file: 'antwortstatus' },
  { type: 'groupResponses', selector: 'group-responses', file: 'gruppenantworten' },
  { type: 'duplicateResponses', selector: 'duplicate-responses', file: 'duplikate' }
];

const result = {
  data: [{
    responseId: 1, fileName: 'UNIT_ZL', unitName: 'UNIT_ZL', variableId: 'v', value: 'synthetic',
    testTakerLogin: 'synthetic', duplicates: [{ responseId: 1, value: 'synthetic', status: 'VALUE_CHANGED' },
      { responseId: 2, value: 'newer', status: 'VALUE_CHANGED' }]
  }],
  total: 1, page: 1, limit: 10,
  testTakersFound: true, missingPersons: [],
  groupsWithResponses: [{ group: 'GROUP_ZL', hasResponse: false }],
  totalGroups: 1, totalGroupsWithoutResponses: 1, allGroupsHaveResponses: false
};

describe('Zoneless validation dialog in the browser', () => {
  let unexpectedRequests: string[];
  let nextId: number;
  let tasks: Record<number, { id: number; workspace_id: number; validation_type: string; status: string }>;
  let clearedTypes: Set<string>;

  function createTask(type: string) {
    const id = nextId++;
    tasks[id] = { id, workspace_id: 5, validation_type: type, status: 'pending' };
    return tasks[id];
  }

  beforeEach(() => {
    unexpectedRequests = [];
    // Later, specific routes take precedence. A missing fixture must fail the test.
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', { body: { data: [], total: 0 } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', {
      body: { testPersons: 1, testGroups: 1, uniqueBooklets: 1, uniqueUnits: 1, uniqueResponses: 1 }
    }).as('overview');
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', { body: [] });
    nextId = 1;
    tasks = {};
    clearedTypes = new Set();
    cy.intercept('POST', '**/api/admin/workspace/5/validation-tasks?*', request => {
      request.reply({ delay: 100, body: createTask(String(request.query.type)) });
    });
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/**', request => {
      if (request.url.endsWith('/results')) {
        const id = Number(request.url.split('/').slice(-2)[0]);
        request.reply({ delay: 100, body: clearedTypes.has(tasks[id].validation_type) ?
          { ...result, data: [], total: 0 } : result });
      }
      else {
        const id = Number(request.url.split('/').pop());
        request.reply({ delay: 100, body: { ...tasks[id], status: 'completed', progress: 100 } });
      }
    });
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-results'; });
    cy.wait('@overview');
    cy.contains('button', 'Validieren').click();
    cy.get('coding-box-validation-dialog').should('contain.text', 'Einige Prüfungen sind fehlgeschlagen');
    cy.get('coding-box-group-responses-validation-panel').should('contain.text', 'GROUP_ZL');
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests, 'all API calls have explicit fixtures').to.deep.equal([]); });
  });

  for (const selector of ['variables', 'variable-types', 'response-status']) {
    it(`opens delayed XML from ${selector} and resets the copy confirmation`, () => {
      cy.intercept('GET', '**/api/admin/workspace/5/unit/UNIT_ZL/content', {
        delay: 400, body: { content: '<Unit id="SYNTHETIC_XML"/>' }
      }).as('unitXml');
      cy.get(`coding-box-${selector}-validation-panel`).as('panel');
      cy.get('@panel').find('mat-expansion-panel-header').first().click();
      cy.get('@panel').contains('button', 'Details anzeigen').click();
      cy.get('@panel').contains('a', 'UNIT_ZL').click();
      cy.wait('@unitXml');
      cy.get('coding-box-content-dialog').should('contain.text', 'SYNTHETIC_XML');
      cy.document().then(doc => {
        cy.stub(doc, 'execCommand').callsFake(command => {
          expect(command).to.equal('copy');
          expect((doc.activeElement as HTMLTextAreaElement).value).to.equal('<Unit id="SYNTHETIC_XML"/>');
          return true;
        }).as('clipboardWrite');
      });
      cy.get('coding-box-xml-viewer').contains('button', 'content_copy').click();
      cy.get('@clipboardWrite').should('have.been.calledOnce');
      cy.get('coding-box-xml-viewer').contains('button', 'done').should('be.visible');
      cy.get('coding-box-xml-viewer').contains('button', 'content_copy').should('be.visible');
    });
  }

  for (const panel of exportPanels) {
    it(`downloads the actual ${panel.type} CSV after an export error and retry`, () => {
      let attempts = 0;
      cy.intercept('GET', `**/api/admin/workspace/5/files/validate-${panel.selector}?*`, request => {
        attempts += 1;
        request.reply(attempts === 1 ?
          { delay: 400, statusCode: 500, body: { message: 'Synthetic export failure' } } :
          { delay: 400, body: result });
      }).as('exportPage');
      cy.get(`coding-box-${panel.selector}-validation-panel`).as('panel');
      cy.get('@panel').find('mat-expansion-panel-header').first().click();
      cy.get('@panel').contains('button', 'CSV exportieren').click();
      cy.get('@panel').contains('button', 'Export...').should('be.disabled');
      cy.wait('@exportPage').its('response.statusCode').should('equal', 500);
      cy.get('@panel').contains('button', 'CSV exportieren').should('not.be.disabled').click();
      cy.wait('@exportPage').its('response.statusCode').should('equal', 200);
      cy.get('@panel').contains('button', 'CSV exportieren').should('not.be.disabled');
      cy.readFile(`${Cypress.config('downloadsFolder')}/validierung-${panel.file}.csv`)
        .should('contain', panel.type === 'groupResponses' ? '"GROUP_ZL"' : '"UNIT_ZL"');
    });
  }

  const mutationCases = exportPanels.filter(panel => panel.type !== 'groupResponses').flatMap(panel =>
    (panel.type === 'duplicateResponses' ? ['Alle automatisch auflösen', 'Ausgewählte behalten', 'Auflösen'] :
      ['Alle löschen', 'Ausgewählte löschen']).map(label => ({ ...panel, label }))
  );

  for (const action of mutationCases) {
    it(`recovers and refreshes ${action.type}: ${action.label}`, () => {
      let attempts = 0;
      cy.intercept('POST', '**/api/admin/workspace/5/validation-tasks?*', request => {
        const type = String(request.query.type);
        if (type.startsWith('delete')) {
          request.alias = 'mutationAttempt';
          attempts += 1;
          if (attempts === 1) {
            request.reply({ delay: 400, statusCode: 500, body: { message: 'Synthetic mutation failure' } });
            return;
          }
          clearedTypes.add(action.type);
        }
        request.reply({ delay: 400, body: createTask(type) });
      });
      cy.get(`coding-box-${action.selector}-validation-panel`).as('panel');
      cy.get('@panel').find('mat-expansion-panel-header').first().click();
      if (action.type === 'duplicateResponses') {
        cy.get('@panel').contains('button', 'Details anzeigen').click();
        cy.get('@panel').contains('button', 'Vorschlag übernehmen').click();
      } else {
        cy.get('@panel').contains('button', 'Alle auswählen').click();
      }
      cy.get('@panel').contains('button', action.label).click();
      cy.get('@panel').contains('button', /Löschen\.\.\.|Wird bearbeitet\.\.\./).should('be.disabled');
      cy.wait('@mutationAttempt').its('response.statusCode').should('equal', 500);
      cy.get('@panel').contains('button', action.label).should('not.be.disabled').click();
      cy.wait('@mutationAttempt').its('response.statusCode').should('equal', 200);
      cy.get('@panel').find('.validation-success', { timeout: 8000 }).should('be.visible');
      cy.get('@panel').should('not.contain.text', 'UNIT_ZL');
      cy.then(() => { expect(attempts).to.equal(2); });
    });
  }
});

export {};
