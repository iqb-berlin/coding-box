type ReplayExpected = {
  unitName: string;
  unitAlias: string;
  pages: string[];
  pageAliases: string[];
  anchor: string;
  anchorPage: string;
  personA: ReplayPersonExpectation;
  personB: ReplayPersonExpectation;
  missingUnitError: {
    statusCode: number;
    code: string;
    message: string;
  };
};

type ReplayPersonExpectation = {
  connector: string;
  responseChunkId: string;
  responseVariable: string;
  responseStatus: number;
  responseValue: string;
};

type ReplayResponseVariable = {
  id: string;
  status: number;
  value: string;
};

type ReplaySetup = {
  apiUrl: string;
  baseUrl: string;
  workspaceId: number;
  replayToken: string;
  expected: ReplayExpected;
};

describe('live replay with the embedded Aspect player', () => {
  let setup: ReplaySetup;

  before(() => {
    cy.task('replay:setup', null, { log: false }).then((result) => {
      setup = result as ReplaySetup;
    });
  });

  after(() => {
    cy.task('replay:cleanup', null, { log: false });
    cy.task('replay:cleanup', null, { log: false });
  });

  it('replays two people, two pages, aliases, anchors and the typed negative response', () => {
    visitReplay(setup, setup.expected.personA, setup.expected.pages[0]);
    assertPlayerAlias(setup.expected.pageAliases[0]);

    visitReplay(
      setup,
      setup.expected.personA,
      setup.expected.anchorPage,
      setup.expected.anchor
    );
    assertPlayerValue(
      setup.expected.anchor,
      setup.expected.personA.responseValue
    );
    assertFrameSelector(`[data-element-alias="${setup.expected.anchor}"]`);
    assertFrameSelector('[data-coding-box-anchor-highlight="true"]');

    visitReplay(setup, setup.expected.personA, setup.expected.pages[1]);
    assertPlayerAlias(setup.expected.pageAliases[1]);

    visitReplay(setup, setup.expected.personB, setup.expected.anchorPage);
    assertPlayerValue(
      setup.expected.anchor,
      setup.expected.personB.responseValue
    );

    visitReplay(setup, setup.expected.personA, setup.expected.anchorPage);
    assertPlayerValue(
      setup.expected.anchor,
      setup.expected.personA.responseValue
    );

    cy.request({
      url: replayResponseUrl(
        setup,
        setup.expected.personA,
        setup.expected.unitAlias
      ),
      headers: { authorization: `Bearer ${setup.replayToken}` }
    }).then((response) => {
      expect(response.status).to.equal(200);
      const chunk = response.body.response.responses.find(
        (candidate: { id: string }) =>
          candidate.id === setup.expected.personA.responseChunkId
      );
      expect(chunk).to.exist;
      const responseVariables = JSON.parse(
        chunk.content
      ) as ReplayResponseVariable[];
      expect(responseVariables).to.deep.include({
        id: setup.expected.personA.responseVariable,
        status: setup.expected.personA.responseStatus,
        value: setup.expected.personA.responseValue
      });
    });

    cy.request({
      url: replayResponseUrl(setup, setup.expected.personA, 'UNIT-UNKNOWN'),
      headers: { authorization: `Bearer ${setup.replayToken}` },
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.equal(404);
      expect(response.body).to.include(setup.expected.missingUnitError);
    });

    visitReplay(setup, setup.expected.personA, setup.expected.anchorPage);
    assertPlayerValue(
      setup.expected.anchor,
      setup.expected.personA.responseValue
    );
    cy.intercept('POST', '**/replay-statistics').as('missingUnitStatistics');
    visitReplay(
      setup,
      setup.expected.personA,
      setup.expected.anchorPage,
      undefined,
      'UNIT-UNKNOWN',
      false
    );
    cy.get('coding-box-unit-player').should('not.exist');
    cy.wait('@missingUnitStatistics');

    let personARequestStarted = false;
    let personBRequestStarted = false;
    cy.intercept('GET', '**/replay-response/**', (request) => {
      const requestPath = decodeURIComponent(new URL(request.url).pathname);
      if (
        requestPath.includes(
          `/replay-response/${setup.expected.personA.connector}/`
        )
      ) {
        personARequestStarted = true;
        request.continue((response) => {
          response.setDelay(2000);
        });
        return;
      }
      if (
        requestPath.includes(
          `/replay-response/${setup.expected.personB.connector}/`
        )
      ) {
        personBRequestStarted = true;
        request.continue();
        return;
      }

      request.continue();
    });
    cy.intercept('POST', '**/replay-statistics').as('fastSwitchStatistics');

    navigateReplayInApp(
      setup,
      setup.expected.personA,
      setup.expected.anchorPage
    );
    cy.wrap(null).should(() => {
      expect(personARequestStarted).to.equal(true);
    });
    navigateReplayInApp(setup, setup.expected.personB, setup.expected.pages[1]);
    cy.wrap(null).should(() => {
      expect(personBRequestStarted).to.equal(true);
    });
    assertPlayerAlias(setup.expected.pageAliases[1]);
    cy.wait('@fastSwitchStatistics').then((interception) => {
      expect(interception.request.body).to.include({
        testPersonLogin: setup.expected.personB.connector.split('@')[0],
        testPersonCode: setup.expected.personB.connector.split('@')[1],
        unitId: setup.expected.unitAlias,
        success: true
      });
    });
    cy.get('@fastSwitchStatistics.all').should('have.length', 1);
  });
});

function visitReplay(
  setup: ReplaySetup,
  person: ReplayPersonExpectation,
  page: string,
  anchor?: string,
  unitId = setup.expected.unitAlias,
  waitForPlayer = true
) {
  const routeParts = [
    'replay',
    encodeURIComponent(person.connector),
    encodeURIComponent(unitId),
    encodeURIComponent(page),
    anchor ? encodeURIComponent(anchor) : undefined
  ].filter(Boolean);
  cy.visit(
    `/#/${routeParts.join('/')}?auth=${encodeURIComponent(setup.replayToken)}`,
    {
      log: false
    }
  );

  if (waitForPlayer) {
    assertFrameSelector('[data-element-alias]');
  }
}

function navigateReplayInApp(
  setup: ReplaySetup,
  person: ReplayPersonExpectation,
  page: string
) {
  const hash = replayHash(setup, person, page);
  cy.window().then((window) => {
    window.location.hash = hash;
  });
}

function replayHash(
  setup: ReplaySetup,
  person: ReplayPersonExpectation,
  page: string
) {
  return (
    `#/replay/${encodeURIComponent(person.connector)}/` +
    `${encodeURIComponent(setup.expected.unitAlias)}/${encodeURIComponent(page)}` +
    `?auth=${encodeURIComponent(setup.replayToken)}`
  );
}

function assertPlayerValue(alias: string, expectedValue: string) {
  assertFrameBody((body) => {
    const responseContainer = body.querySelector(
      `[data-element-alias="${alias}"]`
    );
    expect(responseContainer, `response container for alias ${alias}`).not.to.be
      .null;

    const choiceInputs = Array.from(
      responseContainer?.querySelectorAll<HTMLInputElement>(
        'input[type="radio"], input[type="checkbox"]'
      ) ?? []
    );
    if (choiceInputs.length > 0) {
      const selectedInput = choiceInputs.find((input) => input.checked);
      expect(selectedInput, `selected choice for alias ${alias}`).not.to.be
        .undefined;
      const selectedIndex = choiceInputs.indexOf(
        selectedInput as HTMLInputElement
      );
      const replayValue = /^\d+$/.test(expectedValue)
        ? String(selectedIndex + 1)
        : selectedInput?.value;
      expect(replayValue).to.equal(expectedValue);
      return;
    }

    const responseElement = responseContainer?.querySelector(
      'input, textarea, [contenteditable="true"]'
    ) as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;

    expect(responseElement, `response element for alias ${alias}`).not.to.be
      .null;
    const replayValue =
      responseElement && 'value' in responseElement
        ? String(responseElement.value)
        : responseElement?.textContent;
    expect(replayValue).to.equal(expectedValue);
  });
}

function assertPlayerAlias(alias: string) {
  assertFrameBody((body) => {
    const element = body.querySelector(`[data-element-alias="${alias}"]`);
    expect(element, `element with alias ${alias}`).not.to.be.null;
    expect(Cypress.dom.isVisible(element as HTMLElement)).to.equal(true);
  });
}

function assertFrameSelector(selector: string) {
  assertFrameBody((body) => {
    expect(body.querySelector(selector), `frame selector ${selector}`).not.to.be
      .null;
  });
}

function assertFrameBody(assertion: (body: HTMLElement) => void) {
  cy.get('coding-box-unit-player iframe.unitHost', { timeout: 60_000 }).should(
    ($iframe) => {
      const body = ($iframe[0] as HTMLIFrameElement).contentDocument?.body;
      expect(body, 'embedded player body').not.to.be.undefined;
      expect(
        body?.childElementCount,
        'embedded player content'
      ).to.be.greaterThan(0);
      assertion(body as HTMLElement);
    }
  );
}

function replayResponseUrl(
  setup: ReplaySetup,
  person: ReplayPersonExpectation,
  unitId: string
) {
  return (
    `${setup.apiUrl}/api/admin/workspace/${setup.workspaceId}/replay-response/` +
    `${encodeURIComponent(person.connector)}/${encodeURIComponent(unitId)}`
  );
}
