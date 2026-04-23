import * as fs from 'fs';
import * as path from 'path';
import { Browser, chromium, Page } from 'playwright';
import {
  ReplayBrowserCandidate,
  ReplayHealthBrowserOptions,
  ReplayHealthCheckResult
} from './replay-health.types';
import {
  buildBrowserReplayUrl,
  compressDiagnostics,
  sanitizeArtifactName
} from './replay-health.browser.utils';

const REPLAY_CONTAINER_SELECTOR = '.replay-container';
const ERROR_SNACKBAR_SELECTOR = '.mat-mdc-snack-bar-container.snackbar-error, mat-snack-bar-container.snackbar-error, .snackbar-error';

type BrowserOutcome = {
  currentUrl: string;
  replayStatus: string | null;
  replayErrorMessage: string | null;
  snackbarMessage: string | null;
  redirectedToHome: boolean;
  redirectErrorCode: string | null;
};

export class ReplayHealthBrowserRunner {
  constructor(private readonly options: ReplayHealthBrowserOptions) {
  }

  async run(
    workspaceId: number,
    candidates: ReplayBrowserCandidate[],
    authToken: string
  ): Promise<ReplayHealthCheckResult[]> {
    if (candidates.length === 0) {
      return [];
    }

    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({ headless: this.options.headless });
    } catch (error) {
      throw new Error(
        'Playwright Chromium could not be started. Run "npx playwright install chromium" and try again.'
      );
    }

    const results: ReplayHealthCheckResult[] = new Array(candidates.length);
    let nextIndex = 0;
    const workerCount = Math.min(this.options.concurrency, candidates.length);

    try {
      await Promise.all(Array.from({ length: workerCount }, async () => {
        let index = nextIndex;
        nextIndex += 1;

        while (index < candidates.length) {
          const currentIndex = index;
          index = nextIndex;
          nextIndex += 1;

          results[currentIndex] = await this.checkCandidate(
            browser as Browser,
            workspaceId,
            candidates[currentIndex],
            authToken
          );
        }
      }));
    } finally {
      await browser.close();
    }

    return results;
  }

  private async checkCandidate(
    browser: Browser,
    workspaceId: number,
    candidate: ReplayBrowserCandidate,
    authToken: string
  ): Promise<ReplayHealthCheckResult> {
    const timingsMs: Record<string, number> = {};
    const diagnostics: string[] = [];
    const browserUrl = buildBrowserReplayUrl(
      this.options.baseUrl,
      candidate.replayUrl,
      authToken
    );
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 }
    });

    page.on('console', message => {
      if (message.type() === 'error') {
        diagnostics.push(`console: ${message.text()}`);
      }
    });
    page.on('pageerror', error => {
      diagnostics.push(`pageerror: ${error.message}`);
    });
    page.on('requestfailed', request => {
      const failure = request.failure();
      diagnostics.push(
        `requestfailed: ${request.method()} ${request.url()} ${failure?.errorText || ''}`.trim()
      );
    });

    try {
      const navigationStartedAt = Date.now();
      await page.goto(browserUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.options.timeoutMs
      });
      timingsMs.browserNavigateMs = Date.now() - navigationStartedAt;

      try {
        await page.waitForFunction(
          ({
            replayContainerSelector,
            snackbarSelector
          }) => {
            const replayContainer = document.querySelector(replayContainerSelector);
            const replayStatus = replayContainer?.getAttribute('data-replay-status');
            const redirectedToHome =
              window.location.href.includes('#/home') ||
              window.location.pathname.endsWith('/home');
            const hasSnackbar = !!document.querySelector(snackbarSelector);

            return redirectedToHome ||
              hasSnackbar ||
              replayStatus === 'ready' ||
              replayStatus === 'error';
          },
          {
            replayContainerSelector: REPLAY_CONTAINER_SELECTOR,
            snackbarSelector: ERROR_SNACKBAR_SELECTOR
          },
          { timeout: this.options.timeoutMs }
        );
      } catch {
        // The final state is derived below so we can return richer diagnostics on timeouts.
      }

      const outcome = await this.readOutcome(page);
      timingsMs.browserObserveMs =
        Math.max(0, Date.now() - navigationStartedAt - (timingsMs.browserNavigateMs || 0));

      if (outcome.redirectedToHome) {
        return this.failureResult(
          workspaceId,
          candidate,
          'browserRedirect',
          outcome.redirectErrorCode ?
            `Replay was redirected to home with error "${outcome.redirectErrorCode}".` :
            'Replay was redirected away from the replay route.',
          timingsMs,
          browserUrl,
          outcome.currentUrl,
          diagnostics,
          await this.captureFailureScreenshot(page, candidate)
        );
      }

      if (outcome.snackbarMessage) {
        return this.failureResult(
          workspaceId,
          candidate,
          'browserSnackbar',
          outcome.snackbarMessage,
          timingsMs,
          browserUrl,
          outcome.currentUrl,
          diagnostics,
          await this.captureFailureScreenshot(page, candidate)
        );
      }

      if (outcome.replayStatus === 'error') {
        return this.failureResult(
          workspaceId,
          candidate,
          'browserRender',
          outcome.replayErrorMessage || 'Replay reported an error state before rendering.',
          timingsMs,
          browserUrl,
          outcome.currentUrl,
          diagnostics,
          await this.captureFailureScreenshot(page, candidate)
        );
      }

      if (outcome.replayStatus === 'ready') {
        return {
          ok: true,
          phase: 'browser',
          stage: 'browserRender',
          workspaceId,
          testPerson: candidate.testPerson,
          unitId: candidate.unitId,
          replayUrl: candidate.replayUrl,
          responseIds: [candidate.responseId],
          occurrenceCount: 1,
          page: candidate.page,
          anchors: [candidate.anchor],
          timingsMs,
          browserUrl,
          redirectUrl: outcome.currentUrl
        };
      }

      return this.failureResult(
        workspaceId,
        candidate,
        'browserRender',
        `Replay did not reach a ready state within ${this.options.timeoutMs}ms.`,
        timingsMs,
        browserUrl,
        outcome.currentUrl,
        diagnostics,
        await this.captureFailureScreenshot(page, candidate)
      );
    } catch (error) {
      return this.failureResult(
        workspaceId,
        candidate,
        'browserNavigate',
        error instanceof Error ? error.message : String(error),
        timingsMs,
        browserUrl,
        page.url(),
        diagnostics,
        await this.captureFailureScreenshot(page, candidate)
      );
    } finally {
      await page.close();
    }
  }

  private async readOutcome(page: Page): Promise<BrowserOutcome> {
    return page.evaluate(
      ({
        replayContainerSelector,
        snackbarSelector
      }) => {
        const replayContainer = document.querySelector(replayContainerSelector);
        const replayStatus = replayContainer?.getAttribute('data-replay-status') || null;
        const replayErrorMessage = replayContainer?.getAttribute('data-replay-error') || null;
        const snackbar =
          document.querySelector(snackbarSelector) as HTMLElement | null;
        const snackbarMessage = snackbar?.innerText?.trim() || null;
        const currentUrl = window.location.href;
        const redirectedToHome =
          currentUrl.includes('#/home') || window.location.pathname.endsWith('/home');

        let redirectErrorCode: string | null = null;
        if (redirectedToHome) {
          const hash = window.location.hash.startsWith('#') ?
            window.location.hash.substring(1) :
            window.location.hash;
          const hashQuery = hash.includes('?') ? hash.split('?')[1] : '';
          redirectErrorCode = new URLSearchParams(hashQuery).get('error');
        }

        return {
          currentUrl,
          replayStatus,
          replayErrorMessage,
          snackbarMessage,
          redirectedToHome,
          redirectErrorCode
        };
      },
      {
        replayContainerSelector: REPLAY_CONTAINER_SELECTOR,
        snackbarSelector: ERROR_SNACKBAR_SELECTOR
      }
    );
  }

  private async captureFailureScreenshot(
    page: Page,
    candidate: ReplayBrowserCandidate
  ): Promise<string | undefined> {
    if (!this.options.screenshotDir) {
      return undefined;
    }

    const directoryPath = path.resolve(process.cwd(), this.options.screenshotDir);
    fs.mkdirSync(directoryPath, { recursive: true });
    const fileName = sanitizeArtifactName(
      `${candidate.testPerson}_${candidate.unitId}_${candidate.page}_${candidate.anchor}_${candidate.responseId}`
    );
    const screenshotPath = path.join(directoryPath, `${fileName}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  }

  private failureResult(
    workspaceId: number,
    candidate: ReplayBrowserCandidate,
    stage: 'browserNavigate' | 'browserRedirect' | 'browserSnackbar' | 'browserRender',
    message: string,
    timingsMs: Record<string, number>,
    browserUrl: string,
    redirectUrl: string,
    diagnostics: string[],
    screenshotPath?: string
  ): ReplayHealthCheckResult {
    return {
      ok: false,
      phase: 'browser',
      stage,
      workspaceId,
      testPerson: candidate.testPerson,
      unitId: candidate.unitId,
      replayUrl: candidate.replayUrl,
      responseIds: [candidate.responseId],
      occurrenceCount: 1,
      page: candidate.page,
      anchors: [candidate.anchor],
      message,
      timingsMs,
      browserUrl,
      redirectUrl,
      screenshotPath,
      diagnostics: compressDiagnostics(diagnostics)
    };
  }
}
