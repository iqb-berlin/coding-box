const filesBody = (filename: string, page = 1) => ({
  data: [{ id: page, filename, file_type: 'Unit', file_size: '1024' }],
  total: 300,
  page,
  limit: 100,
  fileTypes: ['Unit']
});

// Force is used only to deliver a context change while the list overlay is active.
// Regular success, empty, retry, pagination and debouncing cases use available controls.
describe('Zoneless file list', () => {
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
    cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', {
      body: { enabled: false, baseUrl: '', hasApplicationToken: false }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', { body: filesBody('initial-file.xml') }).as('files');
    cy.visit('/');
    cy.wait('@authData');
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.get('coding-box-test-files mat-row').should('contain.text', 'initial-file.xml');
    cy.get('coding-box-test-files .busy-overlay').should('not.exist');
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  it('shows loading after the actual search control debounces and renders the delayed result', () => {
    let requested = false;
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', request => {
      expect(new URL(request.url).searchParams.get('searchText')).to.equal('debounced');
      requested = true;
      request.reply({ delay: 350, body: filesBody('debounced-file.xml') });
    }).as('searchFiles');
    cy.get('coding-box-search-filter input').focus().type('debounced');
    cy.wrap(null).should(() => { expect(requested).to.equal(true); });
    cy.get('coding-box-test-files .busy-overlay').should('be.visible');
    cy.get('coding-box-test-files').contains('button', 'Validieren').should('be.disabled');
    cy.wait('@searchFiles');
    cy.get('coding-box-test-files mat-row').should('contain.text', 'debounced-file.xml');
    cy.get('coding-box-test-files .busy-overlay').should('not.exist');
    cy.get('coding-box-test-files').contains('button', 'Validieren').should('be.enabled');
  });

  it('renders the empty state after a delayed list response', () => {
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', {
      delay: 250, body: { data: [], total: 0, page: 1, limit: 100, fileTypes: [] }
    }).as('emptyFiles');
    cy.get('.clear-filters-btn').click();
    cy.get('coding-box-test-files .busy-overlay').should('be.visible');
    cy.wait('@emptyFiles');
    cy.get('coding-box-test-files .empty-state').should('contain.text', 'Keine Test-Dateien vorhanden');
    cy.get('coding-box-test-files mat-row').should('not.exist');
    cy.get('coding-box-test-files .busy-overlay').should('not.exist');
  });

  it('filters pasted text without keyup and clears it through the enabled button', () => {
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', request => {
      const search = new URL(request.url).searchParams.get('searchText');
      request.alias = search ? 'pastedSearch' : 'clearedSearch';
      request.reply({ body: filesBody(search ? 'pasted-file.xml' : 'cleared-file.xml') });
    });
    cy.get('coding-box-search-filter button').should('be.disabled');
    cy.get('coding-box-search-filter input').focus().invoke('val', 'pasted').trigger('input');
    cy.get('coding-box-search-filter button').should('be.enabled');
    cy.wait('@pastedSearch').then(({ request }) => {
      expect(new URL(request.url).searchParams.get('searchText')).to.equal('pasted');
    });
    cy.get('coding-box-test-files mat-row').should('contain.text', 'pasted-file.xml');
    cy.get('coding-box-search-filter button').click();
    cy.get('coding-box-search-filter input').should('have.value', '');
    cy.get('coding-box-search-filter button').should('be.disabled');
    cy.wait('@clearedSearch');
    cy.get('coding-box-test-files mat-row').should('contain.text', 'cleared-file.xml');
  });

  it('releases the list after HTTP 500 and renders a successful retry', () => {
    let requests = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', request => {
      requests += 1;
      request.reply(requests === 1 ? { delay: 150, statusCode: 500 } : { delay: 150, body: filesBody('retry-file.xml') });
    }).as('retryFiles');
    cy.get('.clear-filters-btn').click();
    cy.wait('@retryFiles').its('response.statusCode').should('equal', 500);
    cy.get('mat-snack-bar-container').should('contain.text', 'Fehler beim Laden der Dateiliste');
    cy.get('coding-box-test-files .busy-overlay').should('not.exist');
    cy.get('.clear-filters-btn').click();
    cy.wait('@retryFiles').its('response.statusCode').should('equal', 200);
    cy.get('coding-box-test-files mat-row').should('contain.text', 'retry-file.xml');
    cy.get('coding-box-test-files .busy-overlay').should('not.exist');
    cy.then(() => { expect(requests).to.equal(2); });
  });

  it('updates the real paginator and clears a previous row selection', () => {
    cy.get('coding-box-test-files mat-row mat-checkbox input').check();
    cy.get('coding-box-test-files').contains('button', 'Test Datei(en) löschen').should('be.enabled');
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', request => {
      expect(new URL(request.url).searchParams.get('page')).to.equal('2');
      request.reply({ delay: 250, body: filesBody('second-page.xml', 2) });
    }).as('nextPage');
    cy.get('mat-paginator .mat-mdc-paginator-navigation-next').click();
    cy.wait('@nextPage');
    cy.get('coding-box-test-files mat-row').should('contain.text', 'second-page.xml');
    cy.get('mat-paginator .mat-mdc-paginator-range-label').should('contain.text', '101');
    cy.get('coding-box-test-files mat-row mat-checkbox input').should('not.be.checked');
    cy.get('coding-box-test-files').contains('button', 'Test Datei(en) löschen').should('be.disabled');
  });

  for (const order of ['old-first', 'new-first', 'old-error']) {
    it(`keeps the current search with ${order} responses`, () => {
      let oldStarted = false;
      let newStarted = false;
      cy.intercept('GET', '**/api/admin/workspace/5/files?*', request => {
        const search = new URL(request.url).searchParams.get('searchText');
        if (search === 'old') {
          oldStarted = true;
          request.alias = 'oldSearch';
          request.reply(order === 'old-error' ? { delay: 1000, statusCode: 500 } : {
            delay: order === 'new-first' ? 2000 : 1000, body: filesBody('old-file.xml')
          });
        } else {
          expect(search).to.equal('new');
          newStarted = true;
          request.alias = 'newSearch';
          request.reply({ delay: order === 'new-first' ? 150 : 1000, body: filesBody('new-file.xml') });
        }
      });
      cy.get('coding-box-search-filter input').focus().type('old');
      cy.wrap(null).should(() => { expect(oldStarted).to.equal(true); });
      cy.get('coding-box-search-filter input').clear({ force: true }).type('new', { force: true });
      cy.wrap(null).should(() => { expect(newStarted).to.equal(true); });
      if (order !== 'new-first') {
        cy.wait('@oldSearch');
        cy.get('coding-box-test-files .busy-overlay').should('be.visible');
        cy.get('coding-box-test-files').should('not.contain.text', 'old-file.xml');
        cy.get('mat-snack-bar-container').should('not.exist');
      }
      cy.wait('@newSearch');
      cy.get('coding-box-test-files mat-row').should('contain.text', 'new-file.xml');
      if (order === 'new-first') cy.wait('@oldSearch');
      cy.get('coding-box-test-files mat-row').should('contain.text', 'new-file.xml');
      cy.get('coding-box-test-files').should('not.contain.text', 'old-file.xml');
      cy.get('coding-box-test-files .busy-overlay').should('not.exist');
    });
  }

  it('keeps a freshly opened view clear of the old request after navigation', () => {
    let oldStarted = false;
    let requests = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', request => {
      requests += 1;
      if (requests === 1) {
        oldStarted = true;
        request.alias = 'leftFiles';
        request.reply({ delay: 1000, body: filesBody('left-view.xml') });
      } else {
        request.alias = 'freshFiles';
        request.reply({ body: filesBody('fresh-view.xml') });
      }
    });
    cy.get('.clear-filters-btn').click();
    cy.wrap(null).should(() => { expect(oldStarted).to.equal(true); });
    cy.window().then(win => { win.location.hash = '/'; });
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@freshFiles');
    cy.get('coding-box-test-files mat-row').should('contain.text', 'fresh-view.xml');
    cy.wait('@leftFiles');
    cy.get('coding-box-test-files mat-row').should('contain.text', 'fresh-view.xml');
    cy.get('coding-box-test-files').should('not.contain.text', 'left-view.xml');
    cy.get('coding-box-test-files .busy-overlay').should('not.exist');
  });

  it('renders the regex hint when the delayed workspace setting arrives without another interaction', () => {
    cy.intercept('GET', '**/api/workspace/5/settings/enable-regex-search', {
      delay: 1500, body: { value: '{"enabled":true}' }
    }).as('delayedRegex');
    cy.visit('/');
    cy.wait('@authData');
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.get('coding-box-search-filter input').focus().type('[');
    cy.get('coding-box-search-filter .regex-filter-error').should('not.exist');
    cy.wait('@delayedRegex');
    cy.get('coding-box-search-filter .regex-filter-error').should('be.visible');
    cy.get('coding-box-search-filter input').should('have.value', '[');
  });

  for (const token of [false, true]) {
    it(`renders delayed Content Pool settings with application token=${token}`, () => {
      let started = false;
      cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', request => {
        started = true;
        request.reply({ delay: 700, body: {
          enabled: true, baseUrl: 'https://synthetic.example', hasApplicationToken: token
        } });
      }).as('poolSettings');
      cy.visit('/');
      cy.wait('@authData');
      cy.get('coding-box-home').should('be.visible');
      cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
      cy.wait('@files');
      cy.wrap(null).should(() => { expect(started).to.equal(true); });
      cy.get('coding-box-test-files').should('not.contain.text', 'ACP aus Content Pool');
      cy.wait('@poolSettings');
      cy.get('coding-box-test-files').contains('button', 'ACP aus Content Pool')
        .should(token ? 'be.enabled' : 'be.disabled');
      cy.get('coding-box-test-files').contains('button', 'Auswahl zu Content Pool').should('be.disabled');
      cy.get('coding-box-test-files mat-row mat-checkbox input').check();
      cy.get('coding-box-test-files').contains('button', 'Auswahl zu Content Pool')
        .should(token ? 'be.enabled' : 'be.disabled');
    });
  }

  it('loads fresh Content Pool configuration after an HTTP error and reopening', () => {
    let requests = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', request => {
      requests += 1;
      request.reply(requests === 1 ? { delay: 150, statusCode: 500 } : {
        delay: 150, body: { enabled: true, baseUrl: 'https://synthetic.example', hasApplicationToken: true }
      });
    }).as('poolRetry');
    cy.visit('/');
    cy.wait('@authData');
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.wait('@poolRetry').its('response.statusCode').should('equal', 500);
    cy.get('coding-box-error-message-display .other-error').should('be.visible');
    cy.get('coding-box-test-files').should('not.contain.text', 'ACP aus Content Pool');
    cy.window().then(win => { win.location.hash = '/'; });
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.wait('@poolRetry').its('response.statusCode').should('equal', 200);
    cy.get('coding-box-test-files').contains('button', 'ACP aus Content Pool').should('be.enabled');
    cy.then(() => { expect(requests).to.equal(2); });
  });

  it('cancels Content Pool configuration before an old HTTP error can affect the reopened view', () => {
    let started = false;
    let requests = 0;
    cy.intercept('GET', '**/api/admin/workspace/5/content-pool/config', request => {
      requests += 1;
      if (requests === 1) {
        started = true;
        request.alias = 'oldPoolConfig';
        request.reply({ delay: 1200, statusCode: 500 });
      } else {
        request.alias = 'freshPoolConfig';
        request.reply({ body: { enabled: false, baseUrl: '', hasApplicationToken: false } });
      }
    });
    cy.visit('/');
    cy.wait('@authData');
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.wrap(null).should(() => { expect(started).to.equal(true); });
    cy.window().then(win => { win.location.hash = '/'; });
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.wait('@freshPoolConfig');
    cy.wait('@oldPoolConfig');
    cy.get('coding-box-error-message-display .other-error').should('not.exist');
    cy.get('coding-box-test-files').should('not.contain.text', 'ACP aus Content Pool');
    cy.get('mat-snack-bar-container').should('not.exist');
    cy.get('coding-box-test-files .busy-overlay').should('not.exist');
  });

  for (const order of ['old-first', 'new-first', 'old-error']) {
    it(`refreshes a pending search when delayed settings enable regex with ${order} responses`, () => {
      let literalStarted = false;
      cy.intercept('GET', '**/api/workspace/5/settings/enable-regex-search', {
        delay: 1500, body: { value: '{"enabled":true}' }
      }).as('switchRegex');
      cy.intercept('GET', '**/api/admin/workspace/5/files?*', request => {
        const params = new URL(request.url).searchParams;
        if (!params.get('searchText')) {
          request.alias = 'initialModeFiles';
          request.reply({ body: filesBody('initial-file.xml') });
        } else if (params.get('regexSearch') === 'true') {
          expect(params.get('searchText')).to.equal('unit.*');
          request.alias = 'regexModeFiles';
          request.reply({ delay: order === 'new-first' ? 150 : 1000, body: filesBody('regex-mode-file.xml') });
        } else {
          literalStarted = true;
          request.alias = 'literalModeFiles';
          request.reply(order === 'old-error' ? { delay: 1500, statusCode: 500 } : {
            delay: order === 'new-first' ? 2500 : 1500, body: filesBody('literal-mode-file.xml')
          });
        }
      });
      cy.visit('/');
      cy.wait('@authData');
      cy.get('coding-box-home').should('be.visible');
      cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
      cy.wait('@initialModeFiles');
      cy.get('coding-box-search-filter input').focus().type('unit.*');
      cy.wrap(null).should(() => { expect(literalStarted).to.equal(true); });
      cy.wait('@switchRegex');
      if (order !== 'new-first') {
        cy.wait('@literalModeFiles');
        cy.get('coding-box-test-files .busy-overlay').should('be.visible');
      }
      cy.wait('@regexModeFiles');
      if (order === 'new-first') cy.wait('@literalModeFiles');
      cy.get('coding-box-test-files mat-row').should('contain.text', 'regex-mode-file.xml');
      cy.get('coding-box-test-files').should('not.contain.text', 'literal-mode-file.xml');
      cy.get('coding-box-test-files .busy-overlay').should('not.exist');
      cy.get('mat-snack-bar-container').should('not.exist');
    });
  }

  for (const first of ['files', 'validation']) {
    it(`keeps list and validation loading independent when ${first} finishes first`, () => {
      let releaseFiles: (() => void) | undefined;
      let releaseRegex: (() => void) | undefined;
      let releaseTask: (() => void) | undefined;
      let tasks = 0;
      cy.intercept('GET', '**/api/workspace/5/settings/enable-regex-search', request => (
        new Cypress.Promise<void>(resolve => {
          releaseRegex = () => {
            request.reply({ body: { value: '{"enabled":true}' } });
            resolve();
          };
        })
      )).as('overlapRegex');
      cy.intercept('GET', '**/api/admin/workspace/5/files?*', request => {
        const params = new URL(request.url).searchParams;
        if (params.get('regexSearch') === 'true') {
          request.alias = 'overlapRegexFiles';
          return new Cypress.Promise<void>(resolve => {
            releaseFiles = () => {
              request.reply({ body: filesBody('validation-overlap-file.xml') });
              resolve();
            };
          });
        }
        request.alias = 'overlapLiteralFiles';
        request.reply({ body: filesBody('validation-overlap-file.xml') });
      });
      cy.intercept('POST', '**/api/admin/workspace/5/validation-tasks?type=testFiles', request => (
        new Cypress.Promise<void>(resolve => {
          tasks += 1;
          releaseTask = () => {
            request.reply({ body: { id: 901, status: 'completed', progress: 100 } });
            resolve();
          };
        })
      )).as('overlapTask');
      cy.intercept('GET', '**/api/admin/workspace/5/settings', {
        body: { ignoredUnits: [], ignoredBooklets: [], ignoredTestlets: [] }
      });
      cy.intercept('GET', '**/api/admin/workspace/5/validation-tasks/901/results', {
        body: { testTakersFound: true, validationResults: [] }
      }).as('overlapResults');
      cy.visit('/');
      cy.wait('@authData');
      cy.get('coding-box-home').should('be.visible');
      cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
      cy.wait('@overlapLiteralFiles');
      cy.get('coding-box-search-filter input').focus().type('unit.*');
      cy.wait('@overlapLiteralFiles');
      cy.get('coding-box-test-files').contains('button', 'Validieren').click();
      cy.wrap(null).should(() => {
        expect(releaseTask).to.be.a('function');
        expect(releaseRegex).to.be.a('function');
      });
      cy.get('.validation-busy-card').should('be.visible');
      cy.then(() => { releaseRegex?.(); });
      cy.wait('@overlapRegex');
      cy.wrap(null).should(() => { expect(releaseFiles).to.be.a('function'); });
      if (first === 'files') {
        cy.then(() => { releaseFiles?.(); });
        cy.wait('@overlapRegexFiles');
      }
      cy.get('.validation-busy-card').should('be.visible');
      cy.get('coding-box-test-files').contains('button', 'Validieren').should('be.disabled');
      cy.then(() => { expect(tasks).to.equal(1); releaseTask?.(); });
      cy.wait('@overlapTask');
      cy.wait('@overlapResults');
      cy.get('coding-box-files-validation-dialog').should('be.visible');
      if (first === 'validation') {
        cy.get('coding-box-test-files .busy-overlay').should('exist');
        cy.then(() => { releaseFiles?.(); });
        cy.wait('@overlapRegexFiles');
      }
      cy.get('coding-box-test-files .busy-overlay').should('not.exist');
    });
  }
});
