// A small Verona protocol fixture exercises the real replay route, iframe and messages.
const player = `<!doctype html><html><body><main></main><script>
let session;
function show(page) {
  document.body.dataset.page = page;
  parent.postMessage({ type: 'vopStateChangedNotification', sessionId: session,
    playerState: { validPages: ['0', '1'], currentPage: page } }, '*');
}
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'vopStartCommand') {
    session = message.sessionId;
    document.querySelector('main').textContent = JSON.parse(message.unitState.dataParts.answer);
    show(message.playerConfig.startPage || '0');
  }
  if (message.type === 'vopPageNavigationCommand') show(message.target);
});
parent.postMessage({ type: 'vopReadyNotification', apiVersion: '3.0' }, '*');
</script></body></html>`;

function token(expired = false): string {
  const encode = (value: object) => Cypress.Buffer.from(JSON.stringify(value)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'none' })}.${encode({ workspace: 5, exp: expired ? 1 : Math.floor(Date.now() / 1000) + 3600 })}.signature`;
}

const units = [
  { id: 0, name: 'UNIT', testPerson: 'personA@code@booklet', variableId: 'VAR1', variablePage: '0' },
  { id: 1, name: 'UNIT', testPerson: 'personA@code@booklet', variableId: 'VAR2', variablePage: '1' },
  { id: 2, name: 'UNIT', testPerson: 'personB@code@booklet', variableId: 'VAR1', variablePage: '0' }
];
const scheme = {
  version: '3.0',
  variableCodings: ['VAR1', 'VAR2'].map(id => ({
    id, alias: id, label: id, sourceType: 'BASE', codes: [{ id: 1, code: '1', label: 'Correct', manualInstruction: 'Correct answer' }]
  }))
};

describe('Replay responsibilities without Zone.js', () => {
  let assetsRequests: number;
  let responseRequests: number;
  let unexpectedRequests: string[];

  beforeEach(() => {
    unexpectedRequests = [];
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${new URL(request.url).pathname}`);
      request.reply({ statusCode: 501, body: {} });
    });
    assetsRequests = 0;
    responseRequests = 0;
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/admin/workspace/5/token/1*', request => {
      expect(new URL(request.url).searchParams.getAll('scopes')).to.include('replay:read');
      request.reply({ delay: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(token()) });
    }).as('renewToken');
    cy.intercept('POST', '**/replay-statistics', { body: {} });
    cy.intercept('POST', '**/coding-job/*/pause', { body: {} });
    cy.intercept('GET', '**/replay-assets/*', request => {
      assetsRequests += 1;
      request.reply({ delay: 150, body: {
        unitDef: [{ data: '{}' }], player: [{ data: player }],
        vocs: [{ data: JSON.stringify(scheme) }]
      } });
    }).as('assets');
    cy.intercept('GET', '**/replay-response/**', request => {
      responseRequests += 1;
      const person = decodeURIComponent(new URL(request.url).pathname).includes('personB@') ? 'B' : 'A';
      request.reply({ delay: 150, body: { response: { responses: [{ id: 'answer', content: JSON.stringify(`Answer ${person}`) }] } } });
    }).as('response');
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => expect(unexpectedRequests).to.deep.equal([]));
  });

  function frame() {
    return cy.get<HTMLIFrameElement>('coding-box-unit-player iframe').its('0.contentDocument.body').should('not.be.empty');
  }

  function visitBooklet(): void {
    const data = Cypress.Buffer.from(JSON.stringify({ id: 0, name: 'Booklet', units, currentUnitIndex: 0 })).toString('base64');
    cy.visit(`/#/replay/personA@code@booklet/UNIT/0?workspaceId=5&mode=booklet&auth=${token(true)}&unitsData=${encodeURIComponent(data)}`);
    cy.wait('@renewToken');
    cy.wait('@response');
    frame().should('contain.text', 'Answer A').and('have.attr', 'data-page', '0');
  }

  it('renews the token, navigates pages directly and replaces only responses for another person', () => {
    visitBooklet();
    cy.location('hash').should('not.include', 'auth=');
    cy.get('coding-box-units-replay .next-button').click();
    frame().should('have.attr', 'data-page', '1');
    cy.then(() => { expect(assetsRequests).to.equal(1); expect(responseRequests).to.equal(1); });
    cy.get('coding-box-units-replay .next-button').click();
    cy.wait('@response');
    frame().should('contain.text', 'Answer B').and('have.attr', 'data-page', '0');
    cy.then(() => { expect(assetsRequests).to.equal(1); expect(responseRequests).to.equal(2); });
  });

  it('retains the latest route after an abandoned response and supports leaving and reopening replay', () => {
    visitBooklet();
    let release: () => void;
    let oldStarted = false;
    const gate = new Cypress.Promise<void>(resolve => { release = resolve; });
    cy.intercept('GET', '**/replay-response/**/OLD?*', request => {
      oldStarted = true;
      return gate.then(() => request.reply({ body: { response: { responses: [{ id: 'answer', content: '"obsolete"' }] } } }));
    }).as('oldResponse');
    cy.window().then(win => { win.location.hash = `/replay/personA@code@booklet/OLD/0?workspaceId=5&auth=${token()}`; });
    cy.wrap(null).should(() => expect(oldStarted).to.equal(true));
    cy.window().then(win => { win.location.hash = `/replay/personB@code@booklet/UNIT/0?workspaceId=5&auth=${token()}`; });
    cy.wait('@response');
    frame().should('contain.text', 'Answer B');
    cy.then(() => release());
    frame().should('not.contain.text', 'obsolete');
    cy.window().then(win => { win.location.hash = '/'; });
    cy.get('coding-box-replay').should('not.exist');
    cy.window().then(win => { win.location.hash = `/replay/personA@code@booklet/UNIT/0?workspaceId=5&auth=${token()}`; });
    cy.wait('@response');
    frame().should('contain.text', 'Answer A');
  });

  it('restores unsaved coding notes and the selected case before loading the player', () => {
    cy.intercept('GET', '**/coding-job/77/replay-session*', { body: {
      units: units.slice(0, 2).map(unit => ({ unitName: 'UNIT', unitAlias: 'Unit', variableId: unit.variableId,
        variablePage: unit.variablePage, personLogin: 'personA', personCode: 'code', bookletName: 'booklet' })),
      progress: {}, notes: {}, job: { status: 'active', allowComments: true }, serverTimings: {}
    } });
    cy.intercept('PUT', '**/coding-job/77/status', { body: {} });
    cy.intercept('POST', '**/coding-job/77/notes', { delay: 150, body: {} }).as('recoveredNotes');
    const key = 'personA@code@booklet::booklet::UNIT::VAR2';
    cy.visit(`/#/replay/personA@code@booklet/UNIT/0?workspaceId=5&codingJobId=77&mode=coding&auth=${token(true)}`, {
      onBeforeLoad(win) {
        win.sessionStorage.setItem('coding-box-session-recovery:replay-active-coding-state', JSON.stringify({
          key: 'replay-active-coding-state', version: 1, createdAt: Date.now(), expiresAt: Date.now() + 60000,
          data: { workspaceId: 5, codingJobId: 77, mode: 'coding', currentUnitIndex: 1,
            testPerson: 'personA@code@booklet', unitId: 'UNIT', page: '1', originResponseId: null,
            coding: { codingJobId: 77, currentVariableId: 'VAR2', selectedCodes: [], pendingSelections: [],
              openUnitKeys: [], notes: [[key, 'Unsaved recovered note']], codingJobComment: '' } }
        }));
      }
    });
    cy.wait('@renewToken');
    cy.wait('@recoveredNotes').its('request.body').should('include', { variableId: 'VAR2', notes: 'Unsaved recovered note' });
    frame().should('have.attr', 'data-page', '1');
    cy.get('coding-box-code-selector .support-toggle').should('have.attr', 'aria-expanded', 'true');
    cy.get('coding-box-code-selector textarea').should('have.value', 'Unsaved recovered note');
    cy.window().then(win => expect(win.sessionStorage.getItem('coding-box-session-recovery:replay-active-coding-state')).to.equal(null));
  });
});
