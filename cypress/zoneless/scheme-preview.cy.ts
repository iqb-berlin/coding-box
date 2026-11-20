const schemers = [
  {
    id: 28, filename: 'iqb-schemer@2.8.1.html', file_id: 'IQB-SCHEMER-2.8.1',
    schemerVersion: '2.8.1', created_at: '2026-05-08'
  },
  {
    id: 25, filename: 'iqb-schemer@2.5.0.html', file_id: 'IQB-SCHEMER-2.5.0',
    schemerVersion: '2.5.0', created_at: '2026-07-23'
  },
  {
    id: 29, filename: 'schemer-next.html', file_id: 'IQB-SCHEMER-2.9.0',
    schemerVersion: '2.9.0-beta.3', created_at: '2026-06-11'
  },
  {
    id: 15, filename: 'iqb-schemer@1.5.0.html', file_id: 'IQB-SCHEMER-1.5.0',
    schemerVersion: '1.5.0', created_at: '2026-04-10'
  }
];

function schemerHtml(moduleVersion: string, returnedVersion?: string): string {
  const changedScheme = JSON.stringify({
    variableCodings: [{ id: 'VAR_01', sourceType: 'BASE', codes: [], label: 'updated' }],
    version: returnedVersion
  });
  return `<html lang="de"><body><script>
window.addEventListener('message', event => {
  if (event.data.type === 'vosStartCommand') {
    document.body.textContent = 'Schemer ${moduleVersion}: ' + event.data.codingSchemeType;
    const edit = document.createElement('button');
    edit.textContent = 'Schema ändern';
    edit.onclick = () => window.parent.postMessage({
      type: 'vosSchemeChangedNotification', sessionId: event.data.sessionId,
      codingScheme: ${JSON.stringify(changedScheme)},
      codingSchemeType: ${JSON.stringify(moduleVersion === '1.5.0' ? 'iqb@1.2' : undefined)}
    }, '*');
    document.body.append(edit);
  }
});
window.parent.postMessage({type: 'vosReadyNotification'}, '*');
</script></body></html>`;
}

describe('VOCS preview without Zone.js', () => {
  let missingReference: boolean;
  let failDownload: boolean;
  let schemerReference: { schemer: string; schemeType: string } | undefined;
  let originalVersion: string | undefined;
  let returnedVersion: string | undefined;
  let unexpectedRequests: string[];
  let releaseSchemerList: () => void;

  beforeEach(() => {
    missingReference = false;
    failDownload = false;
    schemerReference = { schemer: 'iqb-schemer@2.5', schemeType: 'iqb@3.0' };
    originalVersion = '3.0';
    returnedVersion = '3.0';
    unexpectedRequests = [];
    const schemerListGate = new Cypress.Promise<void>(resolve => { releaseSchemerList = resolve; });
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
    cy.intercept('GET', '**/api/admin/workspace/5/files?*', request => {
      const isSchemer = new URL(request.url).searchParams.get('fileType') === 'Schemer';
      const data = isSchemer ? (missingReference ? [schemers[0]] : schemers) :
        [{ id: 41, filename: 'DLB004.vocs', file_type: 'Resource', file_size: '1024' }];
      const response = {
        body: {
          data, total: data.length, page: 1, limit: 100, fileTypes: ['Resource', 'Schemer']
        }
      };
      if (isSchemer) return schemerListGate.then(() => { request.reply(response); });
      request.reply(response);
      return undefined;
    }).as('files');
    cy.intercept('GET', '**/api/admin/workspace/5/files/41/download', request => {
      const scheme = { variableCodings: [], version: originalVersion };
      request.reply({ body: { filename: 'DLB004.vocs', base64Data: btoa(JSON.stringify(scheme)), mimeType: 'application/json' } });
    });
    cy.intercept('GET', '**/api/admin/workspace/5/unit/DLB004/info', request => {
      request.reply({
        delay: 300,
        body: schemerReference ? { codingSchemeRef: { content: 'DLB004.vocs', ...schemerReference } } : {}
      });
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files/variable-info/DLB004.vocs', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/files/+(15|25|28|29)/download', request => {
      const fileId = Number(new URL(request.url).pathname.split('/').at(-2));
      const { filename, schemerVersion } = schemers.find(item => item.id === fileId)!;
      request.reply(failDownload ? { delay: 300, statusCode: 500, body: {} } : {
        delay: 300, body: { filename,
          base64Data: Cypress.Buffer.from(schemerHtml(schemerVersion, returnedVersion), 'utf8').toString('base64'), mimeType: 'text/html' }
      });
    }).as('schemerDownload');
    cy.visit('/');
    cy.wait('@authData');
    cy.get('coding-box-home').should('be.visible');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/test-files'; });
    cy.wait('@files');
    cy.get('coding-box-test-files mat-row').should('contain.text', 'DLB004.vocs');
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  function openPreview(): void {
    cy.contains('mat-row', 'DLB004.vocs').find('button').click();
    cy.get('coding-box-scheme-editor-dialog mat-spinner').should('be.visible');
    cy.then(() => { releaseSchemerList(); });
  }

  function getSchemerBody(expectedText = 'Schemer 2.5.0: iqb@3.0') {
    cy.wait('@schemerDownload');
    return cy.get<HTMLIFrameElement>('coding-box-scheme-editor-dialog iframe')
      .should('be.visible')
      .its('0.contentDocument.body', { timeout: 10000 })
      .should('contain.text', expectedText)
      .then(cy.wrap);
  }

  it('opens the referenced 2.5.0 after delayed responses and passes the VOCS scheme type to the iframe', () => {
    openPreview();
    getSchemerBody().should('contain.text', 'Schema ändern');
    cy.get('coding-box-scheme-editor-dialog mat-spinner').should('not.exist');
    cy.get('coding-box-scheme-editor-dialog pre.raw-json').should('not.exist');
  });

  it('without a reference selects the highest stable version even with a renamed beta', () => {
    schemerReference = undefined;
    openPreview();
    getSchemerBody('Schemer 2.8.1: iqb@3.0').should('contain.text', 'Schema ändern');
  });

  it('saves an unversioned legacy scheme when the referenced Schemer explicitly reports its format', () => {
    originalVersion = undefined;
    returnedVersion = undefined;
    schemerReference = { schemer: 'iqb-schemer@1.5', schemeType: 'iqb@1.2' };
    cy.intercept('POST', '**/api/admin/workspace/5/upload?*', {
      body: { total: 1, uploaded: 1, failed: 0, conflicts: [], issues: [] }
    }).as('saveLegacyScheme');

    openPreview();
    getSchemerBody('Schemer 1.5.0: iqb@1.2').contains('button', 'Schema ändern').click();
    cy.contains('coding-box-scheme-editor-dialog button', 'Speichern').should('be.enabled').click();
    cy.wait('@saveLegacyScheme');
    cy.get('coding-box-scheme-editor-dialog').should('not.exist');
  });

  it('blocks saving a downgrade returned by the referenced Schemer', () => {
    originalVersion = '3.4';
    returnedVersion = '3.3';
    cy.intercept('POST', '**/api/admin/workspace/5/upload?*', { statusCode: 500 }).as('saveScheme');

    openPreview();
    getSchemerBody('Schemer 2.5.0: iqb@3.4').contains('button', 'Schema ändern').click();
    cy.contains('coding-box-scheme-editor-dialog button', 'Speichern').should('be.disabled');
    cy.get('coding-box-scheme-editor-dialog [role="alert"]').should('be.visible')
      .and('contain.text', 'VOCS-Datenversion 3.4')
      .and('contain.text', 'Version 3.3')
      .and('contain.text', 'Aktualisieren Sie den Schemer')
      .and('contain.text', 'iqb-schemer@2.5');
    cy.get('@saveScheme.all').should('have.length', 0);
  });

  it('explains an unavailable 2.5 reference instead of using the newer 2.8 Schemer', () => {
    missingReference = true;
    openPreview();
    cy.get('coding-box-scheme-editor-dialog [role="alert"]').should('contain.text', 'iqb-schemer@2.5');
    cy.get('coding-box-scheme-editor-dialog pre.raw-json').should('contain.text', 'variableCodings');
    cy.get('coding-box-scheme-editor-dialog iframe').should('not.exist');
    cy.get('coding-box-scheme-editor-dialog mat-spinner').should('not.exist');
  });

  it('navigates through the coding status snackbar after saving closes the editor', () => {
    cy.intercept('POST', '**/api/admin/workspace/5/upload?*', {
      body: { total: 1, uploaded: 1, failed: 0, conflicts: [], issues: [] }
    }).as('saveScheme');
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/active', {
      body: { hasActiveJob: false }
    });
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/coding/readiness' }, { body: null });
    cy.intercept('POST', '**/api/admin/workspace/5/coding/statistics/job?*', {
      body: { jobId: '', message: 'Use cached statistics' }
    }).as('refreshStatistics');
    cy.intercept({ method: 'GET', pathname: '/api/admin/workspace/5/coding/statistics' }, {
      body: { totalResponses: 0, statusCounts: {} }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/applied-results-overview', {
      body: {
        totalIncompleteResponses: 0, appliedResponses: 0, remainingResponses: 0, completionPercentage: 100,
        rawTotalIncompleteResponses: 0, rawAppliedResponses: 0, rawCompletionPercentage: 100,
        aggregationActive: false, aggregationThreshold: null, aggregatedDuplicateCases: 0
      }
    });
    openPreview();
    getSchemerBody().contains('button', 'Schema ändern').click();
    cy.contains('coding-box-scheme-editor-dialog button', 'Speichern').should('not.be.disabled').click();
    cy.wait('@saveScheme');
    cy.get('coding-box-scheme-editor-dialog').should('not.exist');
    cy.contains('mat-snack-bar-container button', 'Kodierstand prüfen').click();
    cy.location('hash').should('contain', '/workspace-admin/5/coding/management?refreshCodingFreshness=1');
    cy.wait('@refreshStatistics');
    cy.get('coding-box-coding-management .action-buttons-toolbar').should('be.visible');
  });

  it('ends loading with a readable explanation after a failed Schemer download', () => {
    failDownload = true;
    openPreview();
    cy.wait('@schemerDownload');
    cy.get('coding-box-scheme-editor-dialog [role="alert"]').should('contain.text', 'Herunterladen');
    cy.get('coding-box-scheme-editor-dialog mat-spinner').should('not.exist');
    cy.get('coding-box-scheme-editor-dialog pre.raw-json').should('contain.text', 'variableCodings');
  });
});
