const completeFiles = { complete: true, missing: [], files: [] };

describe('Zoneless information from file validation', () => {
  let unexpectedRequests: string[];
  beforeEach(() => {
    unexpectedRequests = [];
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501 });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/settings', { body: { ignoredUnits: [], ignoredBooklets: [], ignoredTestlets: [] } });
    cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', { body: { enabled: false, baseUrl: '', hasApplicationToken: false } });
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', { body: { data: [], total: 0, page: 1, limit: 100, fileTypes: [] } }).as('files');
    cy.intercept('POST', '**/api/admin/workspace/5/validation-tasks?type=testFiles', { body: { id: 701, status: 'completed', progress: 100 } });
    cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/701/results', {
      delay: 250,
      body: { testTakersFound: true, validationResults: [{ testTaker: 'TESTTAKER_ZL', testTakerSchemaValid: true,
        booklets: { ...completeFiles, files: [{ filename: 'BOOKLET_ZL', exists: true }] },
        units: completeFiles, schemes: completeFiles, schemer: completeFiles, definitions: completeFiles, player: completeFiles, metadata: { ...completeFiles, files: [{ filename: 'metadata.vomd', exists: true }] } }] }
    }).as('validation');
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.get('coding-box-test-files').contains('a', 'Validieren').click();
    cy.wait('@validation');
    cy.get('files-validation-dialog').contains('[role="tab"]', 'TESTTAKER_ZL').click();
  });
  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  it('retries test taker XML after an error and opens the actual viewer', () => {
    let attempts = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/files/testtakers/TESTTAKER_ZL/content', request => {
      request.reply(++attempts === 1 ? { delay: 250, statusCode: 500 } : { delay: 250, body: { content: '<TestTakers id="TESTTAKER_ZL"/>' } });
    }).as('xml');
    cy.get('files-validation-dialog button[aria-label="TestTaker XML anzeigen"]').click();
    cy.wait('@xml').its('response.statusCode').should('equal', 500);
    cy.get('mat-snack-bar-container').should('contain.text', 'Keine XML-Daten');
    cy.get('files-validation-dialog button[aria-label="TestTaker XML anzeigen"]').click();
    cy.wait('@xml').its('response.statusCode').should('equal', 200);
    cy.get('coding-box-xml-viewer').should('contain.text', 'TESTTAKER_ZL');
  });
  it('retries booklet information and shows its real metadata tab', () => {
    let attempts = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/booklet/BOOKLET_ZL/info', request => {
      request.reply(++attempts === 1 ? { delay: 250, statusCode: 500 } : {
        delay: 250, body: { metadata: { id: 'BOOKLET_ZL', label: 'Booklet validation metadata' }, units: [], restrictions: [], rawXml: '<Booklet/>' }
      });
    }).as('booklet');
    cy.get('files-validation-dialog .mat-mdc-tab-body-active .files-header').first().click();
    cy.get('files-validation-dialog button[aria-label="Testheft anzeigen"]').click();
    cy.wait('@booklet').its('response.statusCode').should('equal', 500);
    cy.get('mat-snack-bar-container').should('contain.text', 'Fehler beim Laden');
    cy.get('files-validation-dialog button[aria-label="Testheft anzeigen"]').click();
    cy.wait('@booklet').its('response.statusCode').should('equal', 200);
    cy.get('coding-box-booklet-info-dialog').contains('[role="tab"]', 'Metadaten').click();
    cy.get('coding-box-booklet-info-dialog .mat-mdc-tab-body-active').should('contain.text', 'Booklet validation metadata');
  });

  it('finishes metadata initialization without another interaction', () => {
    const profileId = '/api/zoneless-metadata-profile';
    cy.intercept('GET', '**/api/admin/workspace/5/files?*searchText=metadata.vomd*', {
      delay: 150, body: { data: [{ id: 17, filename: 'metadata.vomd' }], total: 1, fileTypes: ['Resource'] }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files/17/download', {
      delay: 150, body: { filename: 'metadata.vomd', base64Data: btoa(JSON.stringify({ profiles: [{ profileId, entries: [] }], items: [] })) }
    });
    cy.intercept('GET', '**/api/zoneless-metadata-profile', {
      delay: 150, body: { id: profileId, label: [{ lang: 'de', value: 'Metadaten ZL' }], target: ['UNIT'], groups: [{ label: [{ lang: 'de', value: 'Gruppe ZL' }], entries: [{ id: 'comment', label: [{ lang: 'de', value: 'Kommentar ZL' }], type: 'TEXT', parameters: { format: 'PLAIN', textLanguages: ['de'], pattern: '' } }] }] }
    }).as('profile');
    cy.get('files-validation-dialog .mat-mdc-tab-body-active .files-header').last().click();
    cy.get('files-validation-dialog button[aria-label="Metadaten anzeigen"]').click();
    cy.wait('@profile');
    cy.get('app-metadata-dialog h2').should('be.visible').and('contain.text', 'metadata.vomd');
    cy.get('app-metadata-dialog mat-progress-spinner').should('not.exist');
    cy.get('app-metadata-dialog mat-select').should('be.visible').and('contain.text', 'Unit (Aufgabe)');
    cy.get('app-metadata-dialog metadata-profile-form input').should('be.visible').and('be.disabled');
    cy.get('app-metadata-dialog mat-slide-toggle button').click();
    cy.get('app-metadata-dialog metadata-profile-form input').should('be.enabled').type('synthetic metadata');
    cy.get('app-metadata-dialog').contains('button', 'Speichern').should('be.visible');
  });

  for (const delays of [[150, 150], [300, 150], [150, 300]]) {
    it(`keeps two metadata dialogs independent with download delays ${delays.join('/')}`, () => {
      const profileId = '/api/zoneless-metadata-profile';
      let downloads = 0;
      cy.intercept('GET', '**/api/admin/workspace/5/files?*searchText=metadata.vomd*', {
        delay: 150, body: { data: [{ id: 17, filename: 'metadata.vomd' }], total: 1, fileTypes: ['Resource'] }
      });
      cy.intercept('GET', '**/api/admin/workspace/5/files/17/download', request => {
        downloads += 1;
        request.reply({ delay: delays[downloads - 1], body: { filename: 'metadata.vomd', base64Data: btoa(JSON.stringify({
          profiles: [{ profileId, entries: [{ id: 'comment', value: [{ lang: 'de', value: `instance-${downloads}` }] }] }], items: []
        })) } });
      });
      cy.intercept('GET', '**/api/zoneless-metadata-profile', {
        delay: 150, body: { id: profileId, label: [{ lang: 'de', value: 'Metadaten ZL' }], target: ['UNIT'], groups: [{ label: [{ lang: 'de', value: 'Gruppe ZL' }], entries: [{ id: 'comment', label: [{ lang: 'de', value: 'Kommentar ZL' }], type: 'TEXT', parameters: { format: 'PLAIN', textLanguages: ['de'], pattern: '' } }] }] }
      }).as('profile');
      cy.get('files-validation-dialog .mat-mdc-tab-body-active .files-header').last().click();
      cy.get('files-validation-dialog button[aria-label="Metadaten anzeigen"]').dblclick();
      cy.wait(['@profile', '@profile']);
      cy.get('app-metadata-dialog').should('have.length', 2);
      cy.get('app-metadata-dialog metadata-profile-form input').should(inputs => {
        expect(Array.from(inputs, input => (input as HTMLInputElement).value).sort()).to.deep.equal(['instance-1', 'instance-2']);
      });
      cy.get('app-metadata-dialog').first().find('metadata-profile-form input').should('be.disabled').invoke('val').as('firstValue');
      cy.get('app-metadata-dialog').last().find('metadata-profile-form input').should('be.disabled');
      cy.get('app-metadata-dialog').last().find('mat-slide-toggle button').click();
      cy.get('app-metadata-dialog').last().find('metadata-profile-form input').should('be.enabled').clear().type('second changed');
      cy.get('app-metadata-dialog').last().contains('button', 'Speichern').should('be.visible');
      cy.get('app-metadata-dialog').first().contains('button', 'Speichern').should('not.exist');
      cy.get('@firstValue').then(value => {
        cy.get('app-metadata-dialog').first().find('metadata-profile-form input').should('have.value', value).and('be.disabled');
      });
  });
  }

  it('preserves number, boolean, multiline and item edits across profile switches and resets on reopen', () => {
    const unitProfile = '/api/zoneless-unit-profile';
    const itemProfile = '/api/zoneless-item-profile';
    const label = (value: string) => [{ lang: 'de', value }];
    const values = {
      profiles: [{ profileId: unitProfile, entries: [
        { id: 'count', value: { raw: '12' } },
        { id: 'enabled', value: { raw: 'false' } },
        { id: 'notes', value: label('initial notes') }
      ] }],
      items: [{ id: 'ITEM-ZL', uuid: 'item-uuid', variableId: 'v1', description: 'initial item',
        profiles: [{ profileId: itemProfile, entries: [{ id: 'comment', value: label('initial comment') }] }] }]
    };
    cy.intercept('GET', '**/api/admin/workspace/5/files?*searchText=metadata.vomd*', {
      delay: 100, body: { data: [{ id: 17, filename: 'metadata.vomd' }], total: 1, fileTypes: ['Resource'] }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files/17/download', {
      delay: 100, body: { filename: 'metadata.vomd', base64Data: btoa(JSON.stringify(values)) }
    });
    cy.intercept('GET', '**/api/zoneless-unit-profile', {
      delay: 100, body: { id: unitProfile, label: label('Unit'), target: ['UNIT'], groups: [{ label: label('Unit fields'), entries: [
        { id: 'count', label: label('Count'), type: 'NUMBER', parameters: { digits: 0, minValue: 0, maxValue: 100, isPeriodSeconds: false } },
        { id: 'enabled', label: label('Enabled'), type: 'BOOLEAN', parameters: { trueLabel: label('Ja'), falseLabel: label('Nein') } },
        { id: 'notes', label: label('Notes'), type: 'TEXT', parameters: { format: 'MULTILINE', textLanguages: ['de'], pattern: '' } }
      ] }] }
    });
    cy.intercept('GET', '**/api/zoneless-item-profile', {
      delay: 100, body: { id: itemProfile, label: label('Item'), target: ['ITEM'], groups: [{ label: label('Item fields'), entries: [
        { id: 'comment', label: label('Comment'), type: 'TEXT', parameters: { format: 'PLAIN', textLanguages: ['de'], pattern: '' } }
      ] }] }
    }).as('itemProfile');
    const form = 'app-metadata-dialog metadata-profile-form';
    const selectItem = (name: string) => {
      cy.get('app-metadata-dialog .selection-container mat-select').click();
      cy.contains('mat-option', name).click();
    };
    cy.get('files-validation-dialog .mat-mdc-tab-body-active .files-header').last().click();
    cy.get('files-validation-dialog button[aria-label="Metadaten anzeigen"]').click();
    cy.wait('@itemProfile');
    cy.get(`${form} input[type="number"]`).should('have.value', '12').and('be.disabled');
    cy.get(`${form} textarea`).should('have.value', 'initial notes').and('be.disabled');
    cy.get(`${form} iqb-formly-toggle button`).should('have.attr', 'aria-checked', 'false').and('be.disabled');
    cy.get('app-metadata-dialog .dialog-header mat-slide-toggle button').click();
    cy.get(`${form} input[type="number"]`).clear().type('34');
    cy.get(`${form} textarea`).clear().type('changed notes');
    cy.get(`${form} iqb-formly-toggle button`).click().should('have.attr', 'aria-checked', 'true');
    selectItem('Item ITEM-ZL');
    cy.get(`${form} input`).should('have.value', 'initial comment').clear().type('changed comment');
    cy.get('app-metadata-dialog .item-info input').first().clear().type('ITEM-CHANGED');
    cy.get('app-metadata-dialog .item-info input').last().clear().type('v2');
    cy.get('app-metadata-dialog .item-info textarea').clear().type('changed item');
    selectItem('Unit (Aufgabe)');
    cy.get(`${form} input[type="number"]`).should('have.value', '34');
    cy.get(`${form} textarea`).should('have.value', 'changed notes');
    cy.get(`${form} iqb-formly-toggle button`).should('have.attr', 'aria-checked', 'true');
    selectItem('Item ITEM-CHANGED');
    cy.get(`${form} input`).should('have.value', 'changed comment');
    cy.get('app-metadata-dialog .item-info input').last().should('have.value', 'v2');
    cy.get('app-metadata-dialog .item-info textarea').should('have.value', 'changed item');
    cy.get('app-metadata-dialog').contains('button', 'Abbrechen').click();
    cy.get('app-metadata-dialog').should('not.exist');
    cy.get('files-validation-dialog button[aria-label="Metadaten anzeigen"]').click();
    cy.wait('@itemProfile');
    cy.get(`${form} input[type="number"]`).should('have.value', '12').and('be.disabled');
    selectItem('Item ITEM-ZL');
    cy.get(`${form} input`).should('have.value', 'initial comment').and('be.disabled');
    cy.get('app-metadata-dialog .item-info input').last().should('have.value', 'v1');
  });

  it('updates duration and both vocabulary controls with the actual metadata library', () => {
    const profileId = '/api/zoneless-advanced-profile';
    const vocabularyUrl = '/api/zoneless-vocabulary';
    const label = (value: string) => [{ lang: 'de', value }];
    const vocabulary = (selectionMode: string, allowMultipleValues: boolean) => ({
      url: vocabularyUrl, selectionMode, allowMultipleValues, maxLevel: 5,
      hideNumbering: false, hideDescription: false, hideTitle: false, addTextLanguages: []
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files?*searchText=metadata.vomd*', {
      delay: 100, body: { data: [{ id: 17, filename: 'metadata.vomd' }], total: 1, fileTypes: ['Resource'] }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files/17/download', {
      delay: 100, body: { filename: 'metadata.vomd', base64Data: btoa(JSON.stringify({ profiles: [{ profileId, entries: [
        { id: 'duration', value: { raw: '90' } }, { id: 'multiple', value: [] }, { id: 'single', value: [] }, { id: 'dialog', value: [] }
      ] }], items: [] })) }
    });
    cy.intercept('GET', '**/api/zoneless-advanced-profile', {
      delay: 100, body: { id: profileId, label: label('Advanced'), target: ['UNIT'], groups: [{ label: label('Advanced fields'), entries: [
        { id: 'duration', label: label('Duration'), type: 'NUMBER', parameters: { digits: 0, minValue: 0, maxValue: 600, isPeriodSeconds: true } },
        { id: 'multiple', label: label('Multiple'), type: 'VOCABULARY', parameters: vocabulary('IN_FORM', true) },
        { id: 'single', label: label('Single'), type: 'VOCABULARY', parameters: vocabulary('IN_FORM', false) },
        { id: 'dialog', label: label('Dialog'), type: 'VOCABULARY', parameters: vocabulary('DIALOG', true) }
      ] }] }
    });
    cy.intercept('GET', '**/api/zoneless-vocabulary', {
      delay: 150, headers: { 'content-type': 'application/ld+json' }, body: { id: vocabularyUrl, title: { de: 'Vokabular ZL' }, hasTopConcept: [
        { id: 'A', notation: ['A'], prefLabel: { de: 'Begriff A' } },
        { id: 'B', notation: ['B'], prefLabel: { de: 'Begriff B' } }
      ] }
    });
    cy.get('files-validation-dialog .mat-mdc-tab-body-active .files-header').last().click();
    cy.get('files-validation-dialog button[aria-label="Metadaten anzeigen"]').click();
    const form = 'app-metadata-dialog metadata-profile-form';
    cy.get(`${form} iqb-formly-duration input`).first().should('have.value', '01').and('be.disabled');
    cy.get(`${form} iqb-formly-duration input`).last().should('have.value', '30').and('be.disabled');
    cy.get(`${form} iqb-formly-inline`).first().contains('mat-checkbox', 'Begriff A').find('input').should('be.disabled');
    cy.get('app-metadata-dialog .dialog-header mat-slide-toggle button').click();
    const durationEvents: string[] = [];
    cy.get(`${form} iqb-formly-duration input`).first().then(input => {
      ['input', 'change', 'blur', 'focus'].forEach(type => input[0].addEventListener(type, () => {
        durationEvents.push(`${type}:${(input[0] as HTMLInputElement).value}`);
      }));
    });
    cy.get(`${form} iqb-formly-duration input`).first().clear().type('2').should(input => {
      expect(input.val(), durationEvents.join(' | ')).to.equal('2');
    }).blur().should('have.value', '02');
    cy.get(`${form} iqb-formly-duration input`).last().clear().type('15').should('have.value', '15').blur();
    cy.get(`${form} iqb-formly-inline`).first().contains('mat-checkbox', 'Begriff A').click().find('input').should('be.checked');
    cy.get(`${form} iqb-formly-inline`).first().contains('mat-checkbox', 'Begriff B').click().find('input').should('be.checked');
    cy.get(`${form} iqb-formly-inline`).last().contains('mat-radio-button', 'Begriff A').click().find('input').should('be.checked');
    cy.get(`${form} iqb-formly-inline`).last().contains('mat-radio-button', 'Begriff B').click().find('input').should('be.checked');
    cy.get(`${form} iqb-formly-inline`).last().contains('mat-radio-button', 'Begriff A').find('input').should('not.be.checked');
    cy.window().then(win => { cy.spy(win.console, 'error').as('vocabularyErrors'); });
    cy.get(`${form} iqb-formly-chips mat-chip-grid`).click();
    cy.get('@vocabularyErrors').should(spy => {
      const calls = (spy as unknown as { getCalls: () => Array<{ args: unknown[] }> }).getCalls();
      expect(calls.map(call => call.args.map(value => String((value as { stack?: string })?.stack || value)).join(' '))).to.deep.equal([]);
    });
    cy.get('iqb-nested-tree').contains('mat-tree-node', 'Begriff B').find('mat-checkbox').click();
    cy.get('[data-cy="metadata-nested-tree-confirm-button"]').click();
    cy.get(`${form} mat-chip-row`).should('contain.text', 'Begriff B');
    cy.get(`${form} mat-chip-row button`).click();
    cy.get(`${form} mat-chip-row`).should('not.exist');
    cy.get(`${form} iqb-formly-duration input`).first().should('have.value', '02');
    cy.get(`${form} iqb-formly-duration input`).last().should('have.value', '15');
    cy.get('app-metadata-dialog').contains('button', 'Speichern').should('be.visible');
  });

  it('keeps different vocabulary providers isolated across simultaneous dialogs', () => {
    let downloads = 0;
    const label = (value: string) => [{ lang: 'de', value }];
    cy.intercept('GET', '**/api/admin/workspace/5/files?*searchText=metadata.vomd*', {
      delay: 100, body: { data: [{ id: 17, filename: 'metadata.vomd' }], total: 1, fileTypes: ['Resource'] }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files/17/download', request => {
      const instance = ++downloads;
      request.reply({ delay: instance === 1 ? 100 : 300, body: {
        filename: 'metadata.vomd', base64Data: btoa(JSON.stringify({
          profiles: [{ profileId: `/api/isolated-profile-${instance}`, entries: [] }], items: []
        }))
      } });
    });
    for (const instance of [1, 2]) {
      const profileId = `/api/isolated-profile-${instance}`;
      const url = `/api/isolated-vocabulary-${instance}`;
      cy.intercept('GET', `**${profileId}`, { delay: 100, body: {
        id: profileId, label: label(`Profile ${instance}`), target: ['UNIT'],
        groups: [{ label: label('Vocabulary'), entries: ['IN_FORM', 'DIALOG'].map(selectionMode => ({
          id: selectionMode, label: label(selectionMode), type: 'VOCABULARY',
          parameters: { url, selectionMode, allowMultipleValues: true, maxLevel: 5,
            hideNumbering: false, hideDescription: false, hideTitle: false, addTextLanguages: [] }
        })) }]
      } });
      cy.intercept('GET', `**${url}`, { delay: 100, headers: { 'content-type': 'application/ld+json' }, body: {
        id: url, title: { de: `Vocabulary ${instance}` },
        hasTopConcept: [{ id: `term-${instance}`, notation: [`${instance}`], prefLabel: { de: `Term ${instance}` } }]
      } }).as(`vocabulary${instance}`);
    }
    cy.get('files-validation-dialog .mat-mdc-tab-body-active .files-header').last().click();
    cy.get('files-validation-dialog button[aria-label="Metadaten anzeigen"]').dblclick();
    cy.wait(['@vocabulary1', '@vocabulary2']);
    cy.get('app-metadata-dialog').should('have.length', 2);
    cy.get('app-metadata-dialog').first().find('iqb-formly-inline').should('contain.text', 'Term 1').and('not.contain.text', 'Term 2');
    cy.get('app-metadata-dialog').last().find('iqb-formly-inline').should('contain.text', 'Term 2').and('not.contain.text', 'Term 1');
    cy.get('app-metadata-dialog').last().find('.dialog-header mat-slide-toggle button').click();
    cy.get('app-metadata-dialog').last().contains('mat-checkbox', 'Term 2').click().find('input').should('be.checked');
    cy.get('app-metadata-dialog').last().contains('button', 'Abbrechen').click();
    cy.get('app-metadata-dialog').should('have.length', 1);
    cy.get('app-metadata-dialog').find('.dialog-header mat-slide-toggle button').click();
    cy.get('app-metadata-dialog').contains('mat-checkbox', 'Term 1').click().find('input').should('be.checked');
    cy.get('app-metadata-dialog iqb-formly-chips mat-chip-grid').click();
    cy.get('iqb-nested-tree').should('contain.text', 'Term 1').and('not.contain.text', 'Term 2');
    cy.get('iqb-nested-tree').contains('mat-tree-node', 'Term 1').find('mat-checkbox').click();
    cy.get('[data-cy="metadata-nested-tree-confirm-button"]').click();
    cy.get('app-metadata-dialog mat-chip-row').should('contain.text', 'Term 1');
  });

});
export {};
