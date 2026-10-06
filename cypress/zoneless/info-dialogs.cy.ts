const infoCases = [
  {
    kind: 'booklet', id: 'BOOKLET_ZL', selector: 'coding-box-booklet-info-dialog',
    xmlTab: 'XML',
    tabs: [['Konfiguration (1)', 'CONFIG_ZL'], ['Testlets (1)', 'INSIDE'], ['Aufgaben (1)', 'OUTSIDE']],
    body: { metadata: { id: 'BOOKLET_ZL', label: 'Booklet metadata' }, rawXml: '<Booklet id="BOOKLET_ZL"/>', units: [{ id: 'INSIDE', position: 1 }, { id: 'OUTSIDE', position: 2 }], restrictions: [],
      config: { items: [{ key: 'CONFIG_ZL', value: 'enabled' }] },
      testlets: [{ id: 'TESTLET_ZL', units: [{ id: 'INSIDE', position: 1 }] }] }
  },
  {
    kind: 'unit', id: 'UNIT_ZL', selector: 'coding-box-unit-info-dialog',
    xmlTab: 'Roh-XML',
    tabs: [['Definition', 'PLAYER_ZL'], ['Variablen', 'DERIVED_ZL'], ['Abhängigkeiten', 'RESOURCE_ZL'], ['Kodierungsschema', 'SCHEME_ZL']],
    body: { metadata: { id: 'UNIT_ZL', label: 'Unit metadata' }, rawXml: '<Unit id="UNIT_ZL"/>', definition: { type: 'verona', player: 'PLAYER_ZL' },
      baseVariables: [{ id: 'BASE_ZL', type: 'string' }], derivedVariables: [{ id: 'DERIVED_ZL', type: 'integer' }],
      dependencies: [{ type: 'resource', for: 'PLAYER_ZL', content: 'RESOURCE_ZL' }],
      codingSchemeRef: { schemer: 'SCHEMER_ZL', content: 'SCHEME_ZL' } }
  }
];

describe('Zoneless information dialogs from the results table', () => {
  let unexpectedRequests: string[];

  beforeEach(() => {
    unexpectedRequests = [];
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/?*', { body: { data: [], total: 0 } });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/overview', {
      body: { testPersons: 1, testGroups: 1, uniqueBooklets: 1, uniqueUnits: 1, uniqueResponses: 1 }
    }).as('overview');
    cy.intercept('GET', '**/api/admin/workspace/5/results/export/jobs', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/flat-responses?*', {
      body: { data: [{ bookletId: 1, responseId: 1, unitId: 10, personId: 20, code: 'C', group: 'G', login: 'synthetic',
        booklet: 'BOOKLET_ZL', unit: 'UNIT_ZL', response: 'v', responseStatus: 'VALUE_CHANGED', responseValue: 'synthetic', tags: [] }], total: 1 }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/flat-responses/filter-options*', {
      body: { codes: [], groups: [], logins: [], booklets: [], units: [], responses: [], responseStatuses: [], tags: [],
        processingDurations: [], unitProgresses: [], sessionBrowsers: [], sessionOs: [], sessionScreens: [], sessionIds: [] }
    });
    cy.intercept('POST', '**/api/admin/workspace/5/test-results/flat-responses/frequencies', { body: {} });
    cy.intercept('POST', '**/api/admin/workspace/5/unit-notes/units/notes', { body: {} });
    cy.intercept('GET', '**/api/admin/workspace/5/test-results/20', {
      body: [{ id: 1, name: 'BOOKLET_ZL', units: [{ id: 10, name: 'UNIT_ZL' }] }]
    });
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-results'; });
    cy.wait('@overview');
    cy.contains('button', 'Tabellenansicht').click();
    cy.get('coding-box-test-results-flat-table').should('contain.text', 'BOOKLET_ZL');
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  for (const info of infoCases) {
    it(`retries ${info.kind} loading and updates its real XML viewer`, () => {
      let attempts = 0;
      cy.intercept('GET', `**/api/admin/workspace/5/${info.kind}/${info.id}/info`, request => {
        request.reply(++attempts === 1 ?
          { delay: 300, statusCode: 500, body: { message: 'Synthetic failure' } } :
          { delay: 300, body: info.body });
      }).as('info');
      cy.get('coding-box-test-results-flat-table').contains('button', info.id).click();
      cy.wait('@info').its('response.statusCode').should('equal', 500);
      cy.get(info.selector).should('not.exist');
      cy.get('mat-snack-bar-container').should('contain.text', 'Fehler beim Laden');
      cy.get('app-error-message-display .other-error').should('have.length', 1).should('be.visible')
        .find('button.close-button').click();
      cy.get('app-error-message-display .other-error').should('not.exist');
      cy.get('coding-box-test-results-flat-table').contains('button', info.id).click();
      cy.wait('@info').its('response.statusCode').should('equal', 200);
      cy.get(info.selector).should('contain.text', info.id);
      cy.get(info.selector).contains('[role="tab"]', 'Metadaten').click();
      cy.get(info.selector).find('.mat-mdc-tab-body-active').should('contain.text', info.body.metadata.label);
      for (const [label, content] of info.tabs) {
        cy.get(info.selector).contains('[role="tab"]', label).click();
        cy.get(info.selector).find('.mat-mdc-tab-body-active').should('contain.text', content);
      }
      cy.get(info.selector).contains('[role="tab"]', info.xmlTab).click();
      cy.get(info.selector).find('coding-box-xml-viewer').contains('button', 'wrap_text').click();
      cy.get(info.selector).find('.xml-code').should('have.class', 'wrap');
      let copySucceeds = false;
      cy.document().then(doc => {
        cy.stub(doc, 'execCommand').callsFake(command => {
          expect(command).to.equal('copy');
          expect((doc.activeElement as HTMLTextAreaElement).value).to.equal(info.body.rawXml);
          return copySucceeds;
        });
      });
      cy.get(info.selector).find('coding-box-xml-viewer').contains('button', 'content_copy').click();
      cy.get(info.selector).find('coding-box-xml-viewer').contains('button', 'content_copy').should('be.visible');
      cy.then(() => { copySucceeds = true; });
      cy.get(info.selector).find('coding-box-xml-viewer').contains('button', 'content_copy').click();
      cy.get(info.selector).find('coding-box-xml-viewer').contains('button', 'done').should('be.visible');
      cy.get(info.selector).find('coding-box-xml-viewer').contains('button', 'content_copy').should('be.visible');
      cy.get(info.selector).contains('button', 'Schließen').click();
      cy.get(info.selector).should('not.exist');
    });
  }
});

export {};
