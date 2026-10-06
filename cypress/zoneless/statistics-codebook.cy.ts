describe('Zoneless replay statistics and codebook export', () => {
  let unexpectedRequests: string[];
  let dateLabels: Map<HTMLCanvasElement, Map<string, { left: number; right: number }>>;
  let renderedText: Map<HTMLCanvasElement, Set<string>>;
  let animatedHeights: Map<HTMLCanvasElement, Set<number>>;
  let animationsExpected: boolean;
  const fullUnitName = 'UNIT with a long complete name ä';

  function expectDrawnChart(canvas: HTMLCanvasElement): void {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let barPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] === 100 && pixels[index + 1] === 124 && pixels[index + 2] === 138 && pixels[index + 3] > 0) barPixels++;
    }
    expect(barPixels, 'Painted first bar').to.be.greaterThan(30);
  }

  function captureChartDrawing(win: Window & typeof globalThis): void {
    animationsExpected = !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const prototype = win.CanvasRenderingContext2D.prototype;
    const clearRect = prototype.clearRect;
    prototype.clearRect = function (x: number, y: number, width: number, height: number): void {
      if (this.canvas.width > 0 && this.canvas.height > 0) {
        const pixels = this.getImageData(Math.floor(this.canvas.width / 2), 0, 1, this.canvas.height).data;
        let paintedHeight = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] === 100 && pixels[index + 1] === 124 && pixels[index + 2] === 138 && pixels[index + 3] > 0) paintedHeight++;
        }
        if (paintedHeight > 0) {
          if (!animatedHeights.has(this.canvas)) animatedHeights.set(this.canvas, new Set());
          animatedHeights.get(this.canvas)!.add(paintedHeight);
        }
      }
      clearRect.call(this, x, y, width, height);
    };
    const fillText = prototype.fillText;
    prototype.fillText = function (text: string, x: number, y: number, maxWidth?: number): void {
      if (!renderedText.has(this.canvas)) renderedText.set(this.canvas, new Set());
      renderedText.get(this.canvas)!.add(String(text));
      if (/^2026-09-\d{2}$/.test(String(text))) {
        const transform = this.getTransform();
        const origin = transform.e + transform.a * x + transform.c * y;
        const width = this.measureText(text).width * transform.a;
        const left = this.textAlign === 'center' ? origin - width / 2 : origin;
        if (!dateLabels.has(this.canvas)) dateLabels.set(this.canvas, new Map());
        dateLabels.get(this.canvas)!.set(text, { left, right: left + width });
      }
      if (maxWidth === undefined) fillText.call(this, text, x, y);
      else fillText.call(this, text, x, y, maxWidth);
    };
  }

  beforeEach(() => {
    unexpectedRequests = [];
    dateLabels = new Map();
    renderedText = new Map();
    animatedHeights = new Map();
    cy.intercept('**/api/**', request => {
      unexpectedRequests.push(`${request.method} ${request.url}`);
      request.reply({ statusCode: 501, body: { message: 'Missing test fixture' } });
    });
    cy.mockKeycloakAuthentication();
    cy.stubWorkspace({ workspaceId: 5 });
    cy.intercept('GET', '**/api/workspace/5/settings/*', { body: { value: '{"enabled":false}' } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/reset-version/active', { body: { hasActiveJob: false } });
    cy.intercept('GET', '**/api/admin/workspace/5/coding/readiness?*', { body: null });
  });

  afterEach(() => {
    cy.window().should('not.have.property', 'Zone');
    cy.then(() => { expect(unexpectedRequests).to.deep.equal([]); });
  });

  it('renders replay statistics after the delayed final response without another click', () => {
    cy.viewport(1280, 900);
    cy.intercept('GET', '**/api/admin/workspace/token-policy', { body: { scopes: {} } });
    cy.intercept('GET', '**/api/admin/workspace/5/journal*', { body: { data: [], total: 0, page: 1, limit: 20 } });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/sources?*', {
      delay: 300, body: { internal: 3, external: 1, total: 4 }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/frequency?*', { body: { [fullUnitName]: 4 } });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/distribution/day?*', { body: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`2026-09-${String(index + 1).padStart(2, '0')}`, 4])) });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/distribution/hour?*', { body: { 12: 4 } });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/duration?*', {
      body: { min: 1000, max: 3000, average: 2000, distribution: { '1000-3000': 4 }, unitAverages: Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`UNIT-${index}`, 2000])) }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/errors?*', {
      body: { successRate: 75, totalReplays: 4, successfulReplays: 3, failedReplays: 1, commonErrors: [] }
    });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/failures/unit?*', { body: { UNIT: 1 } });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/failures/day?*', { body: { '2026-10-02': 1 } });
    cy.intercept('GET', '**/api/admin/workspace/5/replay-statistics/failures/hour?*', {
      delay: 800, body: { 12: 1 }
    }).as('finalStatistics');
    cy.on('window:before:load', captureChartDrawing);
    cy.visit('/');
    cy.wait('@authData');
    cy.window().then(win => { win.location.hash = '/workspace-admin/5/settings'; });
    cy.get('coding-box-ws-settings .replay-statistics-actions button').click();
    cy.get('coding-box-replay-statistics-dialog mat-spinner').should('be.visible');
    cy.wait('@finalStatistics');
    cy.get('coding-box-replay-statistics-dialog mat-spinner').should('not.exist');
    cy.get('coding-box-replay-statistics-dialog .source-summary .stat-value')
      .then(values => { expect([...values].map(value => value.textContent?.trim())).to.deep.equal(['4', '3', '1']); });
    cy.get('coding-box-replay-statistics-dialog').as('statisticsDialog');
    cy.get('@statisticsDialog').find('coding-box-vertical-bar-chart canvas')
      .should('have.length', 1).and('have.attr', 'role', 'img')
      .should(canvas => { expectDrawnChart(canvas[0] as HTMLCanvasElement); });
    cy.get('@statisticsDialog').find('summary').scrollIntoView().click().should('have.focus');
    cy.get('@statisticsDialog').find('details').should('have.attr', 'open');
    cy.press(Cypress.Keyboard.Keys.SPACE);
    cy.get('@statisticsDialog').find('details').should('not.have.attr', 'open');
    cy.press(Cypress.Keyboard.Keys.SPACE);
    cy.get('@statisticsDialog').find('details').should('have.attr', 'open');
    cy.get('@statisticsDialog').find('tbody tr').should('have.length', 1).and('contain.text', fullUnitName).and('contain.text', '4');
    cy.press(Cypress.Keyboard.Keys.SPACE);
    cy.get('@statisticsDialog').find('details').should('not.have.attr', 'open');
    cy.get('@statisticsDialog').find('canvas').scrollIntoView().should(canvas => {
      const element = canvas[0] as HTMLCanvasElement;
      const pixel = element.getContext('2d')!.getImageData(Math.floor(element.width / 2), Math.floor(element.height / 2), 1, 1).data;
      expect([...pixel].slice(0, 3)).to.deep.equal([100, 124, 138]);
    }).then(canvas => {
      const bounds = canvas[0].getBoundingClientRect();
      cy.wrap(canvas).trigger('mousemove', { clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 });
    });
    cy.get('@statisticsDialog').find('canvas').should(canvas => {
      expect([...renderedText.get(canvas[0] as HTMLCanvasElement)!]).to.include(fullUnitName);
    });
    cy.get('@statisticsDialog').find('canvas').should(canvas => {
      if (animationsExpected) expect(animatedHeights.get(canvas[0] as HTMLCanvasElement)?.size, 'Intermediate animation frames').to.be.greaterThan(1);
    });
    cy.screenshot('chartjs-replay-frequency', { capture: 'viewport' });
    for (const tabIndex of [1, 2, 3, 5, 6, 7]) {
      cy.get('@statisticsDialog').find('[role="tab"]').eq(tabIndex).click({ force: true });
      if (tabIndex === 1) {
        cy.get('@statisticsDialog').find('.mat-mdc-tab-body-active .charts-row').should(row => {
          expect(row[0].scrollWidth).to.be.at.most(row[0].clientWidth + 1);
        });
        cy.get('@statisticsDialog').find('.mat-mdc-tab-body-active .chart-scroll').eq(1).should(chart => {
          expect(chart[0].scrollWidth).to.be.greaterThan(chart[0].clientWidth);
        });
      }
      cy.get('@statisticsDialog').find('.mat-mdc-tab-body-active coding-box-vertical-bar-chart tbody tr')
        .should('have.length', tabIndex === 1 ? 26 : tabIndex === 2 ? 30 : 1);
      cy.get('@statisticsDialog').find('.mat-mdc-tab-body-active coding-box-vertical-bar-chart canvas')
        .should('have.length', tabIndex === 1 ? 2 : 1).each(canvas => {
          cy.wrap(canvas).scrollIntoView().should('be.visible').should(elements => {
            expectDrawnChart(elements[0] as HTMLCanvasElement);
          });
        });
    }
    cy.get('@statisticsDialog').find('.mat-mdc-tab-body-active coding-box-vertical-bar-chart canvas')
      .should(canvas => { expect(canvas[0].getBoundingClientRect().width).to.be.greaterThan(800); })
      .then(canvas => {
        const originalWidth = canvas[0].getBoundingClientRect().width;
        cy.viewport(800, 600);
        cy.get('@statisticsDialog').find('.mat-mdc-tab-body-active coding-box-vertical-bar-chart canvas').should(resized => {
          expect(resized[0].getBoundingClientRect().width).to.be.lessThan(originalWidth);
        });
      });
    cy.get('@statisticsDialog').find('[role="tab"]').eq(2).click({ force: true });
    cy.get('@statisticsDialog').find('.mat-mdc-tab-body-active canvas').scrollIntoView().should(canvas => {
      const boxes = [...(dateLabels.get(canvas[0] as HTMLCanvasElement)?.values() || [])].sort((a, b) => a.left - b.left);
      expect(boxes.length, 'Drawn date labels').to.be.greaterThan(2);
      for (let index = 1; index < boxes.length; index++) {
        expect(boxes[index - 1].right, 'Date labels stay separate').to.be.at.most(boxes[index].left);
      }
    });
    cy.get('@statisticsDialog').find('.mat-mdc-tab-body-active canvas').should(canvas => {
      expectDrawnChart(canvas[0] as HTMLCanvasElement);
    });
    cy.get('@statisticsDialog').find('.mat-mdc-tab-body-active .mat-mdc-tab-body-content').scrollTo('bottom');
    cy.screenshot('chartjs-replay-30-days', { capture: 'viewport' });
    cy.viewport(1280, 900);
    cy.get('@statisticsDialog').find('[role="tab"]').eq(0).click({ force: true });
    cy.get('@statisticsDialog').find('.mat-mdc-tab-body-active canvas').scrollIntoView().should('be.visible')
      .should(canvas => { expectDrawnChart(canvas[0] as HTMLCanvasElement); });
    cy.get('@statisticsDialog').find('mat-dialog-actions button').click();
    cy.get('coding-box-replay-statistics-dialog').should('not.exist');
    cy.get('coding-box-ws-settings .replay-statistics-actions button').click();
    cy.get('coding-box-replay-statistics-dialog canvas').should('have.length', 1)
      .should(canvas => { expectDrawnChart(canvas[0] as HTMLCanvasElement); });
  });

  for (const outcome of ['completed', 'failed']) {
    it(`renders delayed codebook progress and the ${outcome} status`, () => {
      let releaseUnits!: () => void;
      const unitsGate = new Promise<void>(resolve => { releaseUnits = resolve; });
      cy.intercept('GET', '**/api/admin/workspace/5/coding/job-definitions', { body: [] });
      cy.intercept('GET', '**/api/admin/workspace/5/variable-bundle?*', { body: { data: [], total: 0 } });
      cy.intercept('GET', '**/api/admin/workspace/5/coding/missings-profiles', { body: [] });
      cy.intercept('GET', '**/api/admin/workspace/5/files/units-with-file-ids', async request => {
        await unitsGate;
        request.reply({ body: [{ id: 1, unitId: 'UNIT', fileName: 'UNIT.vocs', data: '{}' }] });
      }).as('units');
      cy.intercept('POST', '**/api/admin/workspace/5/coding/codebook/job', request => {
        expect(request.body.unitList).to.deep.equal([1]);
        expect(request.body.contentOptions.hasGeneralInstructions).to.equal(false);
        request.reply({ delay: 300, body: { jobId: 'job-1', message: 'Started' } });
      }).as('startCodebook');
      let finish = false;
      cy.intercept('GET', '**/api/admin/workspace/5/coding/codebook/job/job-1', request => {
        if (finish) request.alias = 'terminalCodebookProgress';
        request.reply({ delay: 400, body: finish ? {
          status: outcome, progress: 100, error: outcome === 'failed' ? 'Codebook failed' : undefined
        } : { status: 'processing', progress: 64 } });
      }).as('codebookProgress');
      cy.intercept('GET', '**/api/admin/workspace/5/coding/codebook/job/job-1/download', {
        headers: { 'Content-Type': 'application/octet-stream' }, body: 'Synthetic codebook output'
      }).as('download');
      cy.visit('/');
      cy.wait('@authData');
      cy.window().then(win => { win.location.hash = '/workspace-admin/5/coding/management'; });
      cy.get('coding-box-coding-management .action-buttons-toolbar button').contains('Codebook').click();
      cy.get('coding-box-export-coding-book').as('dialog');
      cy.get('@dialog').find('mat-spinner').should('be.visible');
      cy.then(() => { releaseUnits(); });
      cy.wait('@units');
      cy.get('@dialog').find('mat-spinner').should('not.exist');
      cy.get('@dialog').find('.select-all-container input').check();
      cy.get('@dialog').find('.options-grid mat-checkbox').eq(1).find('input').uncheck();
      cy.get('@dialog').find('button[type="submit"]').click();
      cy.wait('@startCodebook');
      cy.get('@dialog').find('button[type="submit"]').should('be.disabled');
      cy.wait('@codebookProgress');
      cy.get('@dialog').find('.progress-percentage').should('contain.text', '64%');
      cy.then(() => { finish = true; });
      cy.wait('@terminalCodebookProgress').its('response.body.status').should('eq', outcome);
      cy.get('@dialog').find(`.progress-container.${outcome}`).should('be.visible');
      cy.get('@dialog').find('button[type="submit"]').should('not.be.disabled');
      if (outcome === 'completed') {
        cy.wait('@download');
      } else {
        cy.get('@dialog').find('.progress-container.failed').should('contain.text', 'Codebook failed');
        cy.get('@dialog').find('.progress-container.failed button').click();
        cy.get('@dialog').find('.codebook-progress-section').should('not.exist');
      }
    });
  }
});
