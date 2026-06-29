const workspaceId = Number(Cypress.env('workspaceId') || 47);
const maxRouteMs = Number(Cypress.env('maxRouteMs') || 5000);
const maxTabMs = Number(Cypress.env('maxTabMs') || 3000);
const maxRapidSwitchMs = Number(Cypress.env('maxRapidSwitchMs') || 12000);
const rapidSwitchRepeats = Number(Cypress.env('rapidSwitchRepeats') || 8);
const maxCriticalRequests = Number(Cypress.env('maxCriticalRequests') || 80);
const networkProfile = String(Cypress.env('networkProfile') || 'none');
const manualLogin = String(Cypress.env('manualLogin') || 'false') === 'true';
const manualLoginTimeoutMs = Number(
  Cypress.env('manualLoginTimeoutMs') || 240000
);

const routes = [
  {
    label: 'Testergebnisse',
    hash: `/#/workspace-admin/${workspaceId}/test-results`,
    selector: 'coding-box-test-results'
  },
  {
    label: 'Kodieruebersicht',
    hash: `/#/workspace-admin/${workspaceId}/coding/management`,
    selector: 'app-coding-management'
  },
  {
    label: 'Manuelle Kodierung',
    hash: `/#/workspace-admin/${workspaceId}/coding/manual`,
    selector: 'coding-box-coding-management-manual'
  }
];

const criticalApiPattern =
  /\/api\/admin\/workspace\/\d+\/(coding\/(freshness|incomplete-variables|response-analysis)|test-results)/;

const networkProfiles: Record<
string,
{ offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number }
> = {
  'slow-4g': {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8
  },
  'slow-3g': {
    offline: false,
    latency: 300,
    downloadThroughput: (750 * 1024) / 8,
    uploadThroughput: (250 * 1024) / 8
  }
};

function assertNoLoadingStatusContradiction() {
  cy.get('body')
    .invoke('text')
    .then((text) => {
      const hasCurrent = text.includes('Kodierstand aktuell');
      const hasLoading =
        text.includes('Zustand wird geprueft') ||
        text.includes('Zustand wird geprüft');
      expect(hasCurrent && hasLoading).to.eq(false);
    });
}

function trackCriticalRequests(alias = 'criticalApi') {
  const calls: string[] = [];
  cy.intercept('**/api/admin/workspace/**', request => {
    if (criticalApiPattern.test(request.url)) {
      calls.push(request.url);
    }
  }).as(alias);
  return calls;
}

function assertCriticalRequestBudget(calls: string[], label: string) {
  cy.then(() => {
    cy.log(`${label}: ${calls.length} critical API requests`);
    expect(calls.length, `${label} critical API request count`)
      .to.be.lessThan(maxCriticalRequests);
  });
}

function emulateNetworkProfile() {
  const profile = networkProfiles[networkProfile];
  if (!profile) return;

  cy.then(() => Cypress.automation('remote:debugger:protocol', {
    command: 'Network.enable'
  }));
  cy.then(() => Cypress.automation('remote:debugger:protocol', {
    command: 'Network.emulateNetworkConditions',
    params: profile
  }));
}

function resetNetworkProfile() {
  if (!networkProfiles[networkProfile]) return;

  cy.then(() => Cypress.automation('remote:debugger:protocol', {
    command: 'Network.emulateNetworkConditions',
    params: {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    }
  }));
}

function waitForManualLoginIfRequested(hash: string, selector: string) {
  if (!manualLogin) {
    return;
  }

  cy.log(
    'Manual login mode: complete Keycloak login in this browser window if prompted.'
  );
  cy.location('href', { timeout: manualLoginTimeoutMs }).should('include', hash);
  cy.get(selector, { timeout: 60000 }).should('exist');
}

function measureRoute(label: string, hash: string, selector: string) {
  let startedAt = 0;
  if (manualLogin) {
    cy.visit(hash);
    waitForManualLoginIfRequested(hash, selector);
  }

  cy.then(() => {
    startedAt = Date.now();
  });
  cy.visit(hash);
  cy.location('hash', { timeout: 20000 }).should('include', hash.slice(1));
  cy.get(selector, { timeout: 20000 }).should('exist');
  cy.then(() => {
    const durationMs = Date.now() - startedAt;
    cy.log(`${label}: ${durationMs} ms`);
    expect(durationMs, `${label} route duration`).to.be.lessThan(maxRouteMs);
  });
  assertNoLoadingStatusContradiction();
}

describe('Manual coding performance smoke', { testIsolation: false }, () => {
  afterEach(() => {
    resetNetworkProfile();
  });

  it('opens the critical workspace UI routes within the smoke threshold', () => {
    emulateNetworkProfile();
    routes.forEach((route) => {
      measureRoute(route.label, route.hash, route.selector);
    });
  });

  it('switches visible manual coding tabs without stale loading status', () => {
    emulateNetworkProfile();
    cy.visit(`/#/workspace-admin/${workspaceId}/coding/manual`);
    waitForManualLoginIfRequested(
      `/#/workspace-admin/${workspaceId}/coding/manual`,
      'coding-box-coding-management-manual'
    );
    cy.get('coding-box-coding-management-manual', { timeout: 20000 }).should(
      'exist'
    );

    cy.get('.manual-coding-tabs .mat-mdc-tab').each((tab) => {
      const label = tab.text().trim().replace(/\s+/g, ' ') || 'tab';
      const startedAt = Date.now();
      cy.wrap(tab).click();
      cy.get('coding-box-coding-management-manual').should('exist');
      cy.wait(250);
      cy.then(() => {
        const durationMs = Date.now() - startedAt;
        cy.log(`${label}: ${durationMs} ms`);
        expect(durationMs, `${label} tab duration`).to.be.lessThan(maxTabMs);
      });
      assertNoLoadingStatusContradiction();
    });
  });

  it('keeps rapid route changes bounded and avoids excessive critical requests', () => {
    emulateNetworkProfile();
    const criticalCalls = trackCriticalRequests('rapidRouteCriticalApi');
    const startedAt = Date.now();

    Cypress._.times(rapidSwitchRepeats, () => {
      routes.forEach((route) => {
        cy.visit(route.hash);
        cy.get(route.selector, { timeout: 20000 }).should('exist');
        assertNoLoadingStatusContradiction();
      });
    });

    cy.then(() => {
      const durationMs = Date.now() - startedAt;
      cy.log(`rapid route switches: ${durationMs} ms`);
      expect(durationMs, 'rapid route switch duration')
        .to.be.lessThan(maxRapidSwitchMs);
    });
    assertCriticalRequestBudget(criticalCalls, 'rapid route switches');
  });

  it('keeps rapid manual tab switches bounded and avoids excessive critical requests', () => {
    emulateNetworkProfile();
    const criticalCalls = trackCriticalRequests('rapidManualTabCriticalApi');
    const startedAt = Date.now();

    cy.visit(`/#/workspace-admin/${workspaceId}/coding/manual`);
    waitForManualLoginIfRequested(
      `/#/workspace-admin/${workspaceId}/coding/manual`,
      'coding-box-coding-management-manual'
    );
    cy.get('coding-box-coding-management-manual', { timeout: 20000 }).should(
      'exist'
    );
    cy.get('.manual-coding-tabs .mat-mdc-tab')
      .then(tabs => {
        const tabCount = tabs.length;
        Cypress._.times(rapidSwitchRepeats, repeat => {
          const index = repeat % tabCount;
          cy.get('.manual-coding-tabs .mat-mdc-tab').eq(index).click();
          cy.get('coding-box-coding-management-manual').should('exist');
          assertNoLoadingStatusContradiction();
        });
      });

    cy.then(() => {
      const durationMs = Date.now() - startedAt;
      cy.log(`rapid manual tab switches: ${durationMs} ms`);
      expect(durationMs, 'rapid manual tab switch duration')
        .to.be.lessThan(maxRapidSwitchMs);
    });
    assertCriticalRequestBudget(criticalCalls, 'rapid manual tab switches');
  });
});
