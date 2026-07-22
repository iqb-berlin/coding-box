describe('Itemdatensatz-Export', () => {
  it('configures the dialog and starts the export job', () => {
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/missings-profiles', {
      body: [{ id: 4, label: 'IQB-Standard' }]
    }).as('missingProfiles');
    cy.intercept(
      'GET',
      '**/api/admin/workspace/5/coding/export/item-dataset-options',
      {
        body: {
          items: [
            {
              unitId: 'UNIT1',
              unitLabel: 'Aufgabe 1',
              itemId: 'ITEM1',
              itemLabel: 'Item 1',
              columnName: 'Aufgabe1_ITEM1'
            },
            {
              unitId: 'UNIT2',
              unitLabel: 'Aufgabe 2',
              itemId: 'ITEM2',
              itemLabel: 'Item 2',
              columnName: 'Aufgabe2_ITEM2'
            }
          ],
          mappingIssues: [],
          mappingWarnings: [{
            code: 'vomd-fallback-used',
            message: 'UNIT1/ITEM1: eindeutiger Fallback verwendet',
            unitId: 'UNIT1',
            itemId: 'ITEM1',
            variableId: 'VAR1',
            sourceFile: 'unit-one.vomd',
            suggestedAction: 'variableId im VOMD-Item korrigieren.'
          }]
        }
      }
    ).as('itemDatasetOptions');
    cy.intercept(
      'POST',
      '**/api/admin/workspace/5/coding/export/start',
      (request) => {
        expect(request.body).to.deep.include({
          exportType: 'item-matrix',
          missingsProfileId: 4,
          notReachedScope: 'testlet',
          recodeTrailingOmissions: true
        });
        expect(request.body.items).to.deep.equal([
          { unitId: 'UNIT1', itemId: 'ITEM1' }
        ]);
        request.reply({ jobId: 'export-1', message: 'started' });
      }
    ).as('startExport');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/export/job/export-1', {
      body: { status: 'waiting', progress: 0 }
    });

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then((window) => {
      window.location.hash = '/workspace-admin/5/export';
    });

    cy.get('[data-cy="export-type"]').click();
    cy.contains('mat-option', 'Itemdatensatz').click();
    cy.wait(['@missingProfiles', '@itemDatasetOptions']);

    cy.get('[data-cy="item-dataset-missings-profile"]').should(
      'contain.text',
      'IQB-Standard'
    );
    cy.get('[data-cy="item-dataset-mapping-warnings"]')
      .should('contain.text', 'Item-Metadatenwarnungen: 1')
      .should('contain.text', 'eindeutiger Fallback verwendet')
      .and('contain.text', 'variableId im VOMD-Item korrigieren')
      .and('contain.text', 'VOMD-Datei: unit-one.vomd')
      .and('contain.text', 'Ziel-variableId: VAR1');
    cy.get('[data-cy="item-dataset-mapping-warnings"] .mapping-diagnostic')
      .should('have.length', 1);
    cy.get('[data-cy="start-export"]').should('not.be.disabled');
    cy.get('[data-cy="item-dataset-search"]').type('Aufgabe2');
    cy.get('[data-cy="item-dataset-items"]').click();
    cy.contains('mat-option', 'Aufgabe2_ITEM2').click();
    cy.get('body').type('{esc}');

    cy.get('[data-cy="item-dataset-mnr-scope"]').click();
    cy.contains('mat-option', 'Pro Testlet').click();
    cy.get('[data-cy="item-dataset-recode-trailing"]').click();
    cy.get('[data-cy="start-export"]').click();

    cy.wait('@startExport');
    cy.get('coding-box-export-toast').should('contain.text', 'Itemdatensatz');
  });

  it('explains genuine mapping errors and blocks the export', () => {
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/missings-profiles', {
      body: [{ id: 4, label: 'IQB-Standard' }]
    });
    cy.intercept(
      'GET',
      '**/api/admin/workspace/5/coding/export/item-dataset-options',
      {
        body: {
          items: [{
            unitId: 'UNIT1',
            unitLabel: 'Aufgabe 1',
            itemId: 'ITEM1',
            itemLabel: 'Item 1',
            columnName: 'Aufgabe1_ITEM1'
          }],
          mappingIssues: [{
            code: 'missing-vomd',
            message: 'UNIT2: keine VOMD-Datei',
            unitId: 'UNIT2',
            sourceFile: 'UNIT2.vomd',
            suggestedAction: 'VOMD-Datei erzeugen oder Unit ausschließen.'
          }],
          mappingWarnings: []
        }
      }
    );

    cy.visit('/');
    cy.wait('@authData');
    cy.window().then((window) => {
      window.location.hash = '/workspace-admin/5/export';
    });
    cy.get('[data-cy="export-type"]').click();
    cy.contains('mat-option', 'Itemdatensatz').click();

    cy.get('[data-cy="item-dataset-mapping-errors"]')
      .should('contain.text', 'Fehlerhafte Item-Metadaten: 1')
      .should('contain.text', 'UNIT2: keine VOMD-Datei')
      .and('contain.text', 'VOMD-Datei erzeugen oder Unit ausschließen')
      .and('contain.text', 'Erwartete VOMD-Datei: UNIT2.vomd');
    cy.get('[data-cy="item-dataset-mapping-errors"] .mapping-diagnostic')
      .should('have.length', 1);
    cy.get('[data-cy="start-export"]').should('be.disabled');
  });
});
