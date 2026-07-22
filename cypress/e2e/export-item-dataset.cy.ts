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
      .and('contain.text', 'Details anzeigen')
      .and('not.contain.text', 'unit-one.vomd');
    cy.get('[data-cy="item-dataset-mapping-warnings-details"]').click();
    cy.get('[data-cy="item-dataset-diagnostics-dialog"]')
      .should('contain.text', 'Eindeutiger Fallback verwendet')
      .and('contain.text', 'variableId im VOMD-Item korrigieren')
      .and('contain.text', 'VOMD-Datei: unit-one.vomd')
      .and('contain.text', 'Ziel-variableId: VAR1');
    cy.get('[data-cy="item-dataset-diagnostics-dialog"] .mapping-diagnostic')
      .should('have.length', 1);
    cy.contains('mat-dialog-actions button', 'Schließen').click();
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
      .and('contain.text', 'Details anzeigen')
      .and('not.contain.text', 'UNIT2.vomd');
    cy.get('[data-cy="item-dataset-mapping-errors-details"]').click();
    cy.get('[data-cy="item-dataset-diagnostics-dialog"]')
      .should('contain.text', 'UNIT2: keine VOMD-Datei')
      .and('contain.text', 'VOMD-Datei erzeugen oder Unit ausschließen')
      .and('contain.text', 'Erwartete VOMD-Datei: UNIT2.vomd');
    cy.get('[data-cy="item-dataset-diagnostics-dialog"] .mapping-diagnostic')
      .should('have.length', 1);
    cy.contains('mat-dialog-actions button', 'Schließen').click();
    cy.get('[data-cy="start-export"]').should('be.disabled');
  });

  it('keeps large mixed diagnostics compact, searchable and paginated', () => {
    const warnings = Array.from({ length: 30 }, (_, index) => ({
      code: index < 24 ? 'vomd-fallback-ignored' : 'vomd-fallback-used',
      message: `WARN${index}/ITEM: Fallback-Hinweis`,
      unitId: `WARN${index}`,
      itemId: 'ITEM',
      sourceFile: `WARN${index}.vomd`,
      suggestedAction: 'VOMD-Datei korrigieren.'
    }));
    const mappingIssues = Array.from({ length: 60 }, (_, index) => ({
      code: index < 40 ? 'missing-vomd' : 'variable-not-found',
      message: index < 40 ?
        `ERR${index}: keine VOMD-Datei` :
        `ERR${index}/ITEM: Variable nicht gefunden`,
      unitId: `ERR${index}`,
      itemId: index < 40 ? undefined : 'ITEM',
      sourceFile: `ERR${index}.vomd`,
      suggestedAction: index < 40 ?
        'VOMD-Datei erzeugen und hochladen.' :
        'variableId mit der Unit-Variable abgleichen.'
    }));

    cy.viewport(1280, 720);
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
          mappingIssues,
          mappingWarnings: warnings
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

    cy.get('[data-cy="item-dataset-mapping-warnings"]')
      .should('contain.text', 'Item-Metadatenwarnungen: 30')
      .and(($element) => {
        expect($element.outerHeight()).to.be.lessThan(160);
      });
    cy.get('[data-cy="item-dataset-mapping-errors"]')
      .should('contain.text', 'Fehlerhafte Item-Metadaten: 60')
      .and(($element) => {
        expect($element.outerHeight()).to.be.lessThan(160);
      });
    cy.get('[data-cy="item-dataset-mapping-warnings"] .mapping-diagnostic')
      .should('not.exist');
    cy.get('[data-cy="item-dataset-mapping-errors"] .mapping-diagnostic')
      .should('not.exist');
    cy.get('[data-cy="start-export"]').should('be.disabled');

    cy.get('[data-cy="item-dataset-mapping-errors-details"]').click();
    cy.get('[data-cy="item-dataset-diagnostics-dialog"]')
      .should('contain.text', 'Fehlerhafte Item-Metadaten (60)')
      .and('contain.text', 'Fehlende VOMD-Datei')
      .and('contain.text', '40 Diagnosen')
      .and('contain.text', 'Variable nicht gefunden')
      .and('contain.text', '20 Diagnosen');
    cy.get(
      '[data-cy="item-dataset-diagnostics-dialog"] ' +
      'mat-expansion-panel.mat-expanded .mapping-diagnostic'
    )
      .should('have.length', 25);
    cy.get('mat-expansion-panel.mat-expanded mat-paginator').should('exist');

    cy.viewport(600, 800);
    cy.get('[data-cy="item-dataset-diagnostics-dialog"]')
      .should(($dialog) => {
        expect($dialog[0].getBoundingClientRect().width).to.be.at.most(570);
      });
    cy.get(
      'mat-expansion-panel.mat-expanded ' +
      '[data-cy="item-dataset-diagnostics-group-count-mobile"]'
    )
      .should('be.visible')
      .and('contain.text', '40 Diagnosen');
    cy.get('[data-cy="item-dataset-diagnostics-search"]').then(($search) => {
      cy.get('[data-cy="item-dataset-diagnostics-cause"]').then(($cause) => {
        expect($cause[0].getBoundingClientRect().top).to.be.greaterThan(
          $search[0].getBoundingClientRect().top
        );
      });
    });

    cy.get('[data-cy="item-dataset-diagnostics-search"]').type('ERR59');
    cy.get('[data-cy="item-dataset-diagnostics-result-count"]')
      .should('contain.text', '1 von 60 Diagnosen');
    cy.get('[data-cy="item-dataset-diagnostics-dialog"]')
      .should('contain.text', 'ERR59/ITEM: Variable nicht gefunden')
      .and('not.contain.text', 'ERR40/ITEM: Variable nicht gefunden');

    cy.window().then((window) => {
      cy.stub(window.URL, 'createObjectURL').returns('blob:diagnostics');
      cy.stub(window.URL, 'revokeObjectURL');
      cy.stub(window.HTMLAnchorElement.prototype, 'click').as(
        'diagnosticDownload'
      );
    });
    cy.get('[data-cy="item-dataset-diagnostics-download"]').click();
    cy.get('@diagnosticDownload').should('have.been.calledOnce');
  });
});
