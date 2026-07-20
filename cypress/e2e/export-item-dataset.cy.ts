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
          mappingIssues: []
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
});
