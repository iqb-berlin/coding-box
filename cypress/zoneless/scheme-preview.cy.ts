const scheme = { variableCodings: [], version: '3.0' };
const schemers = [
  { id: 28, filename: 'iqb-schemer@2.8.1.html', file_id: 'IQB-SCHEMER-2.8.1', created_at: '2026-07-23' },
  { id: 25, filename: 'iqb-schemer@2.5.0.html', file_id: 'IQB-SCHEMER-2.5.0', created_at: '2026-05-08' }
];
const schemerHtml = `<html lang="de"><body><script>
window.addEventListener('message', event => {
  if (event.data.type === 'vosStartCommand') {
    document.body.textContent = 'Schemer 2.5.0: ' + event.data.codingSchemeType;
  }
});
window.parent.postMessage({type: 'vosReadyNotification'}, '*');
</script></body></html>`;

describe('VOCS preview without Zone.js', () => {
  let missingReference: boolean;
  let failDownload: boolean;
  let unexpectedRequests: string[];
  let releaseSchemerList: () => void;

  beforeEach(() => {
    missingReference = false;
    failDownload = false;
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
      const response = {
        body: {
          data: isSchemer ? (missingReference ? [schemers[0]] : schemers) :
            [{ id: 41, filename: 'DLB004.vocs', file_type: 'Resource', file_size: '1024' }],
          total: isSchemer ? 2 : 1, page: 1, limit: 100, fileTypes: ['Resource', 'Schemer']
        }
      };
      if (isSchemer) return schemerListGate.then(() => { request.reply(response); });
      request.reply(response);
      return undefined;
    }).as('files');
    cy.intercept('GET', '**/api/admin/workspace/5/files/41/download', {
      body: { filename: 'DLB004.vocs', base64Data: btoa(JSON.stringify(scheme)), mimeType: 'application/json' }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/unit/DLB004/info', {
      delay: 300,
      body: { codingSchemeRef: { content: 'DLB004.vocs', schemer: 'iqb-schemer@2.5', schemeType: 'iqb@3.0' } }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/files/variable-info/DLB004.vocs', { body: [] });
    cy.intercept('GET', '**/api/admin/workspace/5/files/25/download', request => {
      request.reply(failDownload ? { delay: 300, statusCode: 500, body: {} } : {
        delay: 300, body: { filename: 'iqb-schemer@2.5.0.html', base64Data: btoa(schemerHtml), mimeType: 'text/html' }
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
    cy.get('app-scheme-editor-dialog mat-spinner').should('be.visible');
    cy.then(() => { releaseSchemerList(); });
  }

  it('opens the referenced 2.5.0 after delayed responses and passes the XML scheme type to the iframe', () => {
    openPreview();
    cy.wait('@schemerDownload');
    cy.get('app-scheme-editor-dialog mat-spinner').should('not.exist');
    cy.get('app-scheme-editor-dialog pre.raw-json').should('not.exist');
    cy.get<HTMLIFrameElement>('app-scheme-editor-dialog iframe').should('be.visible').should($iframe => {
      expect($iframe[0].contentDocument?.body.textContent).to.contain('Schemer 2.5.0: iqb@3.0');
    });
  });

  it('explains an unavailable 2.5 reference instead of using the newer 2.8 Schemer', () => {
    missingReference = true;
    openPreview();
    cy.get('app-scheme-editor-dialog [role="alert"]').should('contain.text', 'iqb-schemer@2.5');
    cy.get('app-scheme-editor-dialog pre.raw-json').should('contain.text', 'variableCodings');
    cy.get('app-scheme-editor-dialog iframe').should('not.exist');
    cy.get('app-scheme-editor-dialog mat-spinner').should('not.exist');
  });

  it('ends loading with a readable explanation after a failed Schemer download', () => {
    failDownload = true;
    openPreview();
    cy.wait('@schemerDownload');
    cy.get('app-scheme-editor-dialog [role="alert"]').should('contain.text', 'Herunterladen');
    cy.get('app-scheme-editor-dialog mat-spinner').should('not.exist');
    cy.get('app-scheme-editor-dialog pre.raw-json').should('contain.text', 'variableCodings');
  });
});
