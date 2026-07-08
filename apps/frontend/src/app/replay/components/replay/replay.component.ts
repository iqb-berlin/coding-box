import {
  Component, ElementRef, OnChanges, OnDestroy, OnInit, SimpleChanges, ViewChild, HostListener, inject,
  input
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Params, Router } from '@angular/router';
import {
  firstValueFrom, of, Subject, Subscription, catchError, debounceTime
} from 'rxjs';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { UnitPlayerComponent } from '../unit-player/unit-player.component';
import { FileService } from '../../../shared/services/file/file.service';
import {
  ReplayBackendService,
  ReplayClientTimings,
  ReplayServerTimings
} from '../../services/replay-backend.service';
import { AppService } from '../../../core/services/app.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FilesDto } from '../../../../../../../api-dto/files/files.dto';
import { ErrorMessages } from '../../models/error-messages.model';
import { validateToken, isTestperson } from '../../utils/token-utils';
import {
  scrollToElementByAlias,
  highlightAspectSectionWithAnchor,
  highlightBundleVariableMarkers
} from '../../utils/dom-utils';
import { ReviewCodeSelection, UnitsReplay, UnitsReplayUnit } from '../../services/units-replay.service';
import { UnitsReplayComponent } from '../units-replay/units-replay.component';
import { CodeSelectorComponent } from '../../../coding/components/code-selector/code-selector.component';
import { CodingJobCommentDialogComponent } from '../../../coding/components/coding-job-comment-dialog/coding-job-comment-dialog.component';
import { NavigateCodingCasesDialogComponent, NavigateCodingCasesDialogData } from '../navigate-coding-cases-dialog/navigate-coding-cases-dialog.component';
import { ReplayCodingRecoverySnapshot, ReplayCodingService, SavedCode } from '../../services/replay-coding.service';
import { base64ToUtf8 } from '../../../shared/utils/common-utils';
import { CodingJobBackendService } from '../../../coding/services/coding-job-backend.service';
import { hasManualInstruction } from '../../../coding/utils/manual-coding.util';
import { findVariableCodingByPublicId } from '../../../coding/utils/coding-scheme.util';
import {
  CODING_JOB_WORKSPACE_TOKEN_SCOPES,
  REPLAY_WORKSPACE_TOKEN_SCOPES,
  WorkspaceTokenScope
} from '../../../core/services/auth-session.config';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';

interface ReplayUnitPayload {
  unitDef: FilesDto[];
  response: {
    responses: {
      id: string;
      content: string;
    }[];
  };
  player: FilesDto[];
  vocs: FilesDto[];
  serverTimings?: ReplayServerTimings;
}

interface PendingReplayNotesCommit {
  variableId: string;
  notes: string;
}

type ReplayRecoveryMode = 'coding' | 'coding-decision';

interface ReplayRecoveryDraft {
  workspaceId: number;
  codingJobId: number | null;
  mode?: ReplayRecoveryMode;
  currentUnitIndex: number;
  testPerson: string;
  unitId: string;
  page?: string;
  anchor?: string;
  originResponseId: number | null;
  coding: ReplayCodingRecoverySnapshot;
}

@Component({
  providers: [ReplayCodingService],
  selector: 'coding-box-replay',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
    ReactiveFormsModule,
    TranslateModule,
    UnitPlayerComponent,
    SpinnerComponent,
    FormsModule,
    UnitsReplayComponent,
    CodeSelectorComponent
  ],
  templateUrl: './replay.component.html',
  styleUrl: './replay.component.scss'
})
export class ReplayComponent implements OnInit, OnDestroy, OnChanges {
  private fileService = inject(FileService);
  private replayBackendService = inject(ReplayBackendService);
  private appService = inject(AppService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private errorSnackBar = inject(MatSnackBar);
  private pageErrorSnackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private translateService = inject(TranslateService);
  codingService = inject(ReplayCodingService);
  private codingJobBackendService = inject(CodingJobBackendService);
  private sessionRecoveryService = inject(SessionRecoveryService);

  player: string = '';
  unitDef: string = '';
  isLoaded: Subject<boolean> = new Subject<boolean>();
  page: string | undefined;
  anchor: string | undefined;
  /* eslint-disable  @typescript-eslint/no-explicit-any */
  responses: any | undefined = undefined;
  isPrintMode: boolean = false;
  testPerson: string = '';
  unitId: string = '';
  isCodingMode: boolean = false;
  isCodingDecisionMode: boolean = false;
  isBookletReplayMode: boolean = false; // for replays without coding features
  isReviewMode: boolean = false;
  isCodingIssueReviewMode: boolean = false;
  currentUnitIndex: number = 0;
  totalUnits: number = 0;
  isWatermarkTruncated: boolean = false;
  private authToken: string = '';
  private errorSnackbarRef: MatSnackBarRef<TextOnlySnackBar> | null = null;
  private pageErrorSnackbarRef: MatSnackBarRef<TextOnlySnackBar> | null = null;
  private routerSubscription: Subscription | null = null;
  readonly testPersonInput = input<string>();
  readonly unitIdInput = input<string>();
  protected unitsData: UnitsReplay | null = null;
  private loadedCodingJobUnitsKey: string | null = null;
  private codingProgressLoadedForJobKey: string | null = null;
  private activeStatusUpdatedForJobKey: string | null = null;
  private authBootstrapSubscription: Subscription | null = null;
  private sessionRecoverySubscription: Subscription | null = null;
  private replayNotesCommitSubscription: Subscription | null = null;
  private unregisterRecoveryProvider: (() => void) | null = null;
  private readonly replayNotesCommitSubject = new Subject<PendingReplayNotesCommit>();
  private replayReAuthenticationPending = false;
  private replayTokenRefreshRunning = false;
  private replayRecoveryRestorePromise: Promise<void> | null = null;
  @ViewChild(UnitPlayerComponent) unitPlayerComponent: UnitPlayerComponent | undefined;
  @ViewChild(CodeSelectorComponent) codeSelectorComponent: CodeSelectorComponent | undefined;
  @ViewChild('watermark')
  set watermarkRef(ref: ElementRef<HTMLElement> | undefined) {
    this.watermarkElement = ref ?? null;
    this.setupWatermarkObserver();
  }

  private replayStartTime: number = 0; // Track when replay viewing starts
  private routeStartTime: number = 0;
  private loadStartTime: number = 0;
  private payloadRequestStartTime: number = 0;
  private payloadResponseTime: number = 0;
  private playerReadyTime: number = 0;
  private serverTimings: ReplayServerTimings | null = null;
  private successStoredForCurrentReplay: boolean = false;
  protected reloadKey: number = 0;
  workspaceId: number = 0;
  originResponseId: number | null = null;
  protected reviewCodeSelections: ReviewCodeSelection[] = [];
  private watermarkElement: ElementRef<HTMLElement> | null = null;
  private watermarkObserver: ResizeObserver | null = null;
  private watermarkCheckPending: boolean = false;
  private anchorHighlightTimeout: ReturnType<typeof setTimeout> | null = null;
  private anchorHighlightRunId = 0;
  private unitPayloadRunId = 0;
  private readonly ANCHOR_HIGHLIGHT_RETRY_DELAY_MS = 100;
  private readonly ANCHOR_HIGHLIGHT_MAX_ATTEMPTS = 40;
  private readonly REPLAY_NOTES_COMMIT_DEBOUNCE_MS = 750;
  private readonly REPLAY_NOTES_COMMIT_DEDUPE_MS = 1000;
  private readonly replayRecoveryKey = 'replay-active-coding-state';
  private lastReplayNotesCommitKey: string | null = null;
  private replayNotesCommitDedupeTimeout: ReturnType<typeof setTimeout> | null = null;

  // Resize handle state
  codePanelWidth: number = 350;
  isResizing: boolean = false;
  private resizeStartX: number = 0;
  private resizeStartWidth: number = 0;
  private readonly MIN_PANEL_WIDTH = 250;
  private readonly MAX_PANEL_WIDTH_RATIO = 0.6;

  ngOnInit(): void {
    this.replayStartTime = performance.now();
    this.unregisterRecoveryProvider = this.sessionRecoveryService.registerProvider({
      key: this.replayRecoveryKey,
      capture: () => this.createReplayRecoveryDraft()
    });
    this.authBootstrapSubscription = this.appService.authBootstrapStatus$.subscribe(status => {
      if (status === 'session-expired') {
        this.replayReAuthenticationPending = true;
        return;
      }

      if (status === 'ready' && this.replayReAuthenticationPending) {
        this.replayReAuthenticationPending = false;
        this.restoreReplayAfterReAuthentication().catch(() => undefined);
      }
    });
    this.sessionRecoverySubscription = this.sessionRecoveryService.restore$
      .subscribe(() => this.restoreReplayAfterReAuthentication().catch(() => undefined));
    this.replayNotesCommitSubscription = this.replayNotesCommitSubject
      .pipe(debounceTime(this.REPLAY_NOTES_COMMIT_DEBOUNCE_MS))
      .subscribe(commit => this.sendReplayNotesCommitted(commit.variableId, commit.notes));
    this.subscribeRouter();
  }

  private openErrorSnackBar(message: string, action: string) {
    this.errorSnackbarRef = this.errorSnackBar
      .open(message, action, { panelClass: ['snackbar-error'] });
    this.errorSnackbarRef.afterDismissed().subscribe(() => {
      this.errorSnackbarRef = null;
      this.resetUnitData();
      this.setIsLoaded();
    });
  }

  private openPageErrorSnackBar(message: string, action: string) {
    if (!this.errorSnackbarRef) {
      this.pageErrorSnackbarRef = this.pageErrorSnackBar
        .open(message, action, { panelClass: ['snackbar-error'] });
    }
  }

  private async getAuthToken(): Promise<string> {
    const queryParams = await firstValueFrom(this.route.queryParams);
    const { auth } = queryParams;
    return auth;
  }

  private getWorkspaceIdFromAuthToken(authToken?: string): number {
    if (!authToken) {
      return 0;
    }

    try {
      const decoded: JwtPayload & { workspace?: string | number } = jwtDecode(authToken);
      return Number(decoded?.workspace) || 0;
    } catch (error) {
      return 0;
    }
  }

  private getWorkspaceIdFromQueryParams(queryParams: Params): number {
    return Number(queryParams.workspaceId) || 0;
  }

  private getReplayRequestAuthToken(): string | undefined {
    return this.authToken || undefined;
  }

  private canLoadReplayWithCurrentAuth(workspaceId: number): boolean {
    return Number.isFinite(workspaceId) &&
      workspaceId > 0 &&
      (!!this.authToken || this.appService.hasStoredAuthToken());
  }

  private canRefreshReplayAuthTokenForWorkspace(
    workspaceId: number,
    tokenValidation: ReturnType<typeof validateToken> = this.authToken ?
      validateToken(this.authToken) :
      { isValid: false, errorType: 'token_invalid' }
  ): boolean {
    if (!workspaceId || !this.authToken || !this.appService.hasStoredAuthToken()) {
      return false;
    }

    if (!tokenValidation.isValid && tokenValidation.errorType !== 'token_expired') {
      return false;
    }

    const tokenWorkspaceId = this.getWorkspaceIdFromAuthToken(this.authToken);
    return tokenWorkspaceId === workspaceId;
  }

  private async refreshExpiredReplayAuthToken(workspaceId: number): Promise<void> {
    const tokenValidation: ReturnType<typeof validateToken> = this.authToken ?
      validateToken(this.authToken) :
      { isValid: false, errorType: 'token_invalid' };
    if (tokenValidation.isValid || tokenValidation.errorType !== 'token_expired') {
      return;
    }

    if (!this.canRefreshReplayAuthTokenForWorkspace(workspaceId, tokenValidation)) {
      return;
    }

    await this.refreshReplayAuthTokenForWorkspace(workspaceId);
  }

  private async refreshReplayAuthTokenAfterReAuthentication(): Promise<void> {
    const workspaceId = this.workspaceId || this.getWorkspaceIdFromAuthToken(this.authToken);
    if (!this.canRefreshReplayAuthTokenForWorkspace(workspaceId)) {
      return;
    }

    await this.refreshReplayAuthTokenForWorkspace(workspaceId);
  }

  private async restoreReplayAfterReAuthentication(): Promise<void> {
    if (this.replayRecoveryRestorePromise) {
      await this.replayRecoveryRestorePromise;
      return;
    }

    this.replayRecoveryRestorePromise = (async () => {
      await this.refreshReplayAuthTokenAfterReAuthentication();
      await this.restoreReplayRecoveryDraft();
    })();

    try {
      await this.replayRecoveryRestorePromise;
    } finally {
      this.replayRecoveryRestorePromise = null;
    }
  }

  private async refreshReplayAuthTokenForWorkspace(workspaceId: number): Promise<boolean> {
    if (this.replayTokenRefreshRunning || !this.appService.hasStoredAuthToken()) {
      return false;
    }

    this.replayTokenRefreshRunning = true;
    try {
      const token = await firstValueFrom(this.appService.createOwnToken(
        workspaceId,
        1,
        this.getReplayTokenScopes()
      ));
      if (!token) {
        return false;
      }

      this.authToken = token;
      this.workspaceId = workspaceId;
      this.codingService.setAuthToken(token);
      this.removeReplayAuthTokenFromUrl(token);
      return true;
    } catch (error) {
      return false;
    } finally {
      this.replayTokenRefreshRunning = false;
    }
  }

  private getReplayTokenScopes(): WorkspaceTokenScope[] {
    return this.isCodingTokenContext() ?
      CODING_JOB_WORKSPACE_TOKEN_SCOPES :
      REPLAY_WORKSPACE_TOKEN_SCOPES;
  }

  private isCodingTokenContext(): boolean {
    const [, hashQuery = ''] = window.location.hash.split('?');
    const queryParams = new URLSearchParams(hashQuery);
    const mode = queryParams.get('mode') || '';
    return this.isCodingMode ||
      !!this.codingService.codingJobId ||
      !!queryParams.get('codingJobId') ||
      mode.startsWith('coding');
  }

  private removeReplayAuthTokenFromUrl(authToken: string): void {
    try {
      const url = new URL(window.location.href);
      if (!url.hash) {
        return;
      }

      const [hashPath, hashQuery = ''] = url.hash.split('?');
      const hashParams = new URLSearchParams(hashQuery);
      hashParams.delete('auth');
      const workspaceId = this.workspaceId || this.getWorkspaceIdFromAuthToken(authToken);
      if (workspaceId) {
        hashParams.set('workspaceId', String(workspaceId));
      }
      const query = hashParams.toString();
      url.hash = query ? `${hashPath}?${query}` : hashPath;
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (error) {
      // Keep the refreshed token in memory even if the browser URL cannot be rewritten.
    }
  }

  private deserializeUnitsData(encodedData: string): UnitsReplay | null {
    if (!encodedData) {
      return null;
    }

    try {
      const jsonString = base64ToUtf8(encodedData);
      return JSON.parse(jsonString) as UnitsReplay;
    } catch (error) {
      return null;
    }
  }

  private deserializeReviewCodeSelections(value: unknown): ReviewCodeSelection[] {
    if (typeof value !== 'string' || value.trim() === '') {
      return [];
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map(item => this.normalizeReviewCodeSelection(item))
        .filter((item): item is ReviewCodeSelection => item !== null);
    } catch {
      return [];
    }
  }

  private normalizeReviewCodeSelection(value: unknown): ReviewCodeSelection | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const candidate = value as { code?: unknown; coderNames?: unknown };
    const code = typeof candidate.code === 'number' ? candidate.code : Number(candidate.code);
    const coderNames = Array.isArray(candidate.coderNames) ?
      candidate.coderNames
        .filter((coderName): coderName is string => typeof coderName === 'string' && coderName.trim().length > 0)
        .map(coderName => coderName.trim()) :
      [];

    if (!Number.isFinite(code) || coderNames.length === 0) {
      return null;
    }

    return {
      code,
      coderNames: [...new Set(coderNames)]
    };
  }

  private getBooleanQueryParam(value: unknown): boolean | null {
    if (value === true || value === 'true') {
      return true;
    }

    if (value === false || value === 'false') {
      return false;
    }

    return null;
  }

  subscribeRouter(): void {
    this.routerSubscription = this.route.params
      ?.subscribe(async params => {
        this.routeStartTime = performance.now();
        this.resetSnackBars();
        this.resetUnitData();
        this.authToken = await this.getAuthToken();
        const queryParams = await firstValueFrom(this.route.queryParams);
        let restoredReplayRecovery = false;
        this.workspaceId = this.getWorkspaceIdFromQueryParams(queryParams) ||
          this.getWorkspaceIdFromAuthToken(this.authToken);
        if (this.workspaceId > 0) {
          this.appService.selectedWorkspaceId = this.workspaceId;
        }
        await this.refreshExpiredReplayAuthToken(this.workspaceId);
        this.codingService.setAuthToken(this.authToken);
        const workspace = this.workspaceId ? String(this.workspaceId) : undefined;
        this.isReviewMode = queryParams.mode === 'coding-review';
        this.isCodingIssueReviewMode = queryParams.mode === 'coding-issue-review';
        this.isCodingDecisionMode = queryParams.mode === 'coding-decision';
        this.codingService.isReviewMode = this.isReviewMode;
        this.codingService.isCodingIssueReviewMode = this.isCodingIssueReviewMode;
        this.isCodingMode = queryParams.mode === 'coding' ||
          this.isReviewMode ||
          this.isCodingIssueReviewMode ||
          this.isCodingDecisionMode;
        this.isBookletReplayMode = queryParams.mode === 'booklet-view' || queryParams.mode === 'booklet';
        this.originResponseId = queryParams.originResponseId ? Number(queryParams.originResponseId) : null;
        this.reviewCodeSelections = this.deserializeReviewCodeSelections(queryParams.reviewCodeSelections);
        const showScore = this.getBooleanQueryParam(queryParams.showScore);
        const allowComments = this.getBooleanQueryParam(queryParams.allowComments);
        const suppressGeneralInstructions = this.getBooleanQueryParam(queryParams.suppressGeneralInstructions);
        if (this.isCodingMode || this.isBookletReplayMode) {
          let deserializedUnits = null as UnitsReplay | null;

          if (queryParams.unitsData) {
            deserializedUnits = this.deserializeUnitsData(queryParams.unitsData);
          } else if (queryParams.codingJobId && queryParams.workspaceId) {
            const jobId = Number(queryParams.codingJobId);
            const wsId = Number(queryParams.workspaceId);
            const onlyOpen = queryParams.onlyOpen === 'true';
            const unitsCacheKey = `${wsId}:${jobId}:${onlyOpen}`;
            try {
              if (this.unitsData?.id === jobId && this.loadedCodingJobUnitsKey === unitsCacheKey) {
                deserializedUnits = this.unitsData;
              } else {
                const apiUnits = await firstValueFrom(
                  this.codingJobBackendService.getCodingJobUnits(wsId, jobId, this.authToken, onlyOpen)
                );
                if (apiUnits && apiUnits.length > 0) {
                  deserializedUnits = {
                    id: jobId,
                    name: `Coding-Job: ${jobId}`,
                    units: apiUnits.map((item, idx) => ({
                      id: idx,
                      name: item.unitName,
                      alias: item.unitAlias,
                      bookletId: 0,
                      testPerson: item.personGroup ?
                        `${item.personLogin}@${item.personCode}@${item.personGroup}@${item.bookletName}` :
                        `${item.personLogin}@${item.personCode}@${item.bookletName}`,
                      variableId: item.variableId,
                      variableAnchor: item.variableAnchor,
                      variablePage: item.variablePage,
                      variableBundleId: item.variableBundleId,
                      bundleContext: item.bundleContext
                    })),
                    currentUnitIndex: 0
                  };
                  this.loadedCodingJobUnitsKey = unitsCacheKey;
                }
              }
            } catch (e) {
              // ignore fetch errors — unitsData stays null
            }
          } else if (queryParams.bookletKey) {
            const key = queryParams.bookletKey as string;
            try {
              const stored = localStorage.getItem(key);
              if (stored) {
                deserializedUnits = JSON.parse(stored) as UnitsReplay;
              }
            } catch (e) {
              // ignore parse errors
            }
          }

          if (deserializedUnits) {
            this.unitsData = deserializedUnits;
            // Check if this is a review session (contains " - Review: " in name)
            this.isReviewMode = this.isReviewMode || (
              !this.isCodingIssueReviewMode && this.unitsData.name.includes(' - Review: ')
            );
            this.codingService.isReviewMode = this.isReviewMode;
            this.codingService.isCodingIssueReviewMode = this.isCodingIssueReviewMode;
            this.currentUnitIndex = deserializedUnits.currentUnitIndex;
            this.totalUnits = deserializedUnits.units.length;
            const unitAny = (this.unitsData.units[this.currentUnitIndex] || {}) as unknown as {
              variableAnchor?: string;
              variableId?: string;
              variablePage?: string;
            };
            if (unitAny.variableAnchor) {
              this.anchor = unitAny.variableAnchor;
            }
            if (unitAny.variableId) {
              this.codingService.currentVariableId = unitAny.variableId || '';
            }
            if (unitAny.variablePage) {
              this.page = unitAny.variablePage;
            }

            if (this.isCodingMode) {
              this.codingService.codingJobId = deserializedUnits.id || null;
              if (this.codingService.codingJobId && this.workspaceId) {
                const jobId = this.codingService.codingJobId;
                const jobKey = `${this.workspaceId}:${jobId}`;
                if (this.codingProgressLoadedForJobKey !== jobKey) {
                  await this.codingService.loadSavedCodingProgress(this.workspaceId, jobId);
                  this.codingProgressLoadedForJobKey = jobKey;
                }
                restoredReplayRecovery = await this.restoreReplayRecoveryDraft();
                if (!this.isReviewMode &&
                  !this.isCodingIssueReviewMode &&
                  !this.codingService.isCompletedJobReview &&
                  !this.codingService.isCodingJobFinalized &&
                  this.activeStatusUpdatedForJobKey !== jobKey) {
                  this.codingService.updateCodingJobStatus(this.workspaceId, jobId, 'active');
                  this.activeStatusUpdatedForJobKey = jobKey;
                }
                if (!this.codingService.isCompletedJobReview) {
                  this.codingService.checkCodingJobCompletion(this.unitsData);
                }
              }
            }
          }
        }

        if (suppressGeneralInstructions !== null) {
          this.codingService.suppressGeneralInstructions = suppressGeneralInstructions;
        }
        if (showScore !== null) {
          this.codingService.showScore = showScore;
        }
        if (allowComments !== null) {
          this.codingService.allowComments = allowComments;
        }

        if (this.authToken) {
          const tokenValidation = validateToken(this.authToken);
          if (!tokenValidation.isValid) {
            this.setIsLoaded();
            if (tokenValidation.errorType === 'token_expired') {
              const errorMessage = this.getErrorMessages().tokenExpired;
              this.openErrorSnackBar(errorMessage, 'Schließen');
              this.storeErrorInStatistics(errorMessage);
            } else {
              const errorMessage = this.getErrorMessages().tokenInvalid;
              this.openErrorSnackBar(errorMessage, 'Schließen');
              this.storeErrorInStatistics(errorMessage);
            }
            return;
          }
        }

        try {
          const url = this.route.snapshot.url;
          this.isPrintMode = url.length > 0 && url[0].path === 'print-view';

          const testPersonInput = this.testPersonInput();
          const unitIdInput = this.unitIdInput();
          const replayWorkspaceId = this.workspaceId || Number(workspace);

          if (restoredReplayRecovery && !this.isPrintMode) {
            if (this.canLoadReplayWithCurrentAuth(replayWorkspaceId)) {
              await this.loadAndApplyUnitData(replayWorkspaceId, this.getReplayRequestAuthToken());
            } else {
              this.storeErrorInStatistics('QueryError');
              ReplayComponent.throwError('QueryError');
            }
          } else if (this.isPrintMode && params.unitId) {
            this.unitId = params.unitId;
            if (this.canLoadReplayWithCurrentAuth(Number(workspace))) {
              await this.loadAndApplyUnitData(Number(workspace), this.getReplayRequestAuthToken());
            } else {
              this.storeErrorInStatistics('QueryError');
              ReplayComponent.throwError('QueryError');
            }
          } else if (Object.keys(params).length >= 3 && Object.keys(params).length <= 4) {
            this.setUnitParams(params);
            if (this.canLoadReplayWithCurrentAuth(Number(workspace))) {
              await this.loadAndApplyUnitData(Number(workspace), this.getReplayRequestAuthToken());
            } else {
              this.storeErrorInStatistics('QueryError');
              ReplayComponent.throwError('QueryError');
            }
          } else if (testPersonInput && unitIdInput) {
            this.setTestPerson(testPersonInput);
            this.unitId = unitIdInput;
          } else if (Object.keys(params).length !== 4 && !this.isPrintMode) {
            this.storeErrorInStatistics('ParamsError');
            ReplayComponent.throwError('ParamsError');
          }
        } catch (error) {
          this.setIsLoaded();
          this.catchError(error as HttpErrorResponse);
        }
      });
  }

  private static throwError(message: string): void {
    throw new Error(message);
  }

  private setIsLoaded(): void {
    setTimeout(() => this.isLoaded.next(true));
  }

  setUnitParams(params: Params): void {
    const {
      page, testPerson, unitId, anchor
    } = params;
    this.page = page;
    this.anchor = anchor;
    if (this.isCodingMode && anchor) {
      this.codingService.currentVariableId = anchor;
    }
    this.unitId = unitId;
    this.setTestPerson(testPerson);
  }

  setTestPerson(testPerson: string): void {
    if (!isTestperson(testPerson)) {
      this.storeErrorInStatistics('TestPersonError');
      ReplayComponent.throwError('TestPersonError');
    } else {
      this.testPerson = testPerson;
    }
  }

  get watermarkText(): string {
    if (!this.testPerson || !this.unitId) {
      return '';
    }
    return `${this.testPerson} - ${this.unitId}`;
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/dot-notation
    if (typeof changes['unitIdInput']?.currentValue === 'undefined') {
      this.resetUnitData();
      this.resetSnackBars();
      return Promise.resolve();
    }

    if (changes.unitIdInput) {
      this.resetUnitData();
      this.resetSnackBars();

      if (this.authToken) {
        const tokenValidation = validateToken(this.authToken);
        if (!tokenValidation.isValid) {
          this.setIsLoaded();
          if (tokenValidation.errorType === 'token_expired') {
            const errorMessage = this.getErrorMessages().tokenExpired;
            this.openErrorSnackBar(errorMessage, 'Schließen');
            this.storeErrorInStatistics(errorMessage);
          } else {
            const errorMessage = this.getErrorMessages().tokenInvalid;
            this.openErrorSnackBar(errorMessage, 'Schließen');
            this.storeErrorInStatistics(errorMessage);
          }
          return Promise.resolve();
        }
      }

      const { unitIdInput } = changes;
      try {
        this.routeStartTime = 0;
        this.unitId = unitIdInput.currentValue;
        this.setTestPerson(this.testPersonInput() || '');
        await this.loadAndApplyUnitData(this.appService.selectedWorkspaceId, this.getReplayRequestAuthToken());
      } catch (error) {
        this.setIsLoaded();
        this.catchError(error as HttpErrorResponse);
      }
    }

    return Promise.resolve();
  }

  private setUnitProperties(unitData: ReplayUnitPayload, unitPayloadRunId: number) {
    this.cancelPendingAnchorHighlight();
    this.player = unitData.player[0].data;
    this.unitDef = unitData.unitDef[0].data;
    this.reloadKey += 1;
    this.responses = unitData.response;
    this.serverTimings = unitData.serverTimings ?? null;

    if (this.isCodingMode && unitData.vocs && unitData.vocs[0] && unitData.vocs[0].data) {
      this.codingService.setCodingSchemeFromVocsData(unitData.vocs[0].data);
    } else if (this.isCodingMode && !this.codingService.codingScheme) {
      this.loadCodingSchemeForCodingJob(unitPayloadRunId);
    }
  }

  private nextUnitPayloadRunId(): number {
    this.unitPayloadRunId += 1;
    return this.unitPayloadRunId;
  }

  private invalidateUnitPayloadRequests(): void {
    this.unitPayloadRunId += 1;
  }

  private isCurrentUnitPayloadRun(runId: number): boolean {
    return runId === this.unitPayloadRunId;
  }

  private async loadAndApplyUnitData(workspace: number, authToken?: string): Promise<boolean> {
    const runId = this.nextUnitPayloadRunId();

    try {
      const unitData = await this.getUnitData(workspace, authToken, runId);
      if (!this.isCurrentUnitPayloadRun(runId)) {
        return false;
      }

      this.setUnitProperties(unitData, runId);
      return true;
    } catch (error) {
      if (!this.isCurrentUnitPayloadRun(runId)) {
        return false;
      }
      throw error;
    }
  }

  static getNormalizedPlayerId(name: string): string {
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;
    const matches = name.match(reg);
    if (matches) {
      const rawIdParts = {
        module: matches[1] || '',
        major: parseInt(matches[3], 10) || 0,
        minor: (typeof matches[4] === 'string') ? parseInt(matches[4].substring(1), 10) : 0,
        patch: (typeof matches[5] === 'string') ? parseInt(matches[5].substring(1), 10) : 0
      };
      return `${rawIdParts.module}-${rawIdParts.major}.${rawIdParts.minor}.${rawIdParts.patch}`.toUpperCase();
    }
    ReplayComponent.throwError('PlayerError');
    return '';
  }

  private async getUnitData(
    workspace: number,
    authToken?: string,
    unitPayloadRunId?: number
  ): Promise<ReplayUnitPayload> {
    this.replayStartTime = performance.now();
    this.loadStartTime = this.replayStartTime;
    this.payloadRequestStartTime = this.replayStartTime;
    this.payloadResponseTime = 0;
    this.playerReadyTime = 0;
    this.serverTimings = null;
    this.successStoredForCurrentReplay = false;
    this.isLoaded.next(false);
    const unitData = await firstValueFrom(
      this.replayBackendService.getReplayPayload(
        workspace,
        this.testPerson,
        this.unitId,
        authToken
      )
    );
    if (!unitPayloadRunId || this.isCurrentUnitPayloadRun(unitPayloadRunId)) {
      this.payloadResponseTime = performance.now();
      this.setIsLoaded();
    }
    return {
      unitDef: unitData.unitDef,
      response: unitData.response,
      vocs: unitData.vocs,
      player: unitData.player,
      serverTimings: unitData.serverTimings
    };
  }

  private getErrorMessages(): ErrorMessages {
    return {
      QueryError: 'Kein Authorisierungs-Token angegeben',
      ParamsError: 'Ungültige Anzahl an Parametern in der URL vorhanden',
      401: 'Authentisierungs-Token ist ungültig',
      UnitIdError: 'Unbekannte Unit-ID',
      TestPersonError: 'Ungültige ID für Testperson',
      PlayerError: 'Ungültiger Player-Name',
      ResponsesError: `Fehler beim Laden der Antworten für Aufgabe "${this.unitId}" von Testperson "${this.testPerson}"`,
      notInList: `Keine valide Seite mit der ID "${this.page || ''}" gefunden`,
      notCurrent: `Seite mit der ID "${this.page || ''}" kann nicht ausgewählt werden`,
      tokenExpired: 'Das Authentisierungs-Token ist abgelaufen',
      tokenInvalid: 'Das Authentisierungs-Token ist ungültig',
      unknown: `Unbekannter Fehler für Aufgabe "${this.unitId || ''}" von Testperson "${this.testPerson || ''}"`
    };
  }

  private catchError(error: HttpErrorResponse): void {
    let messageKey: keyof ErrorMessages;

    if (error.status === 401) {
      messageKey = '401' as keyof ErrorMessages;
    } else if (error.status === 404 && this.unitId && this.testPerson) {
      messageKey = 'ResponsesError' as keyof ErrorMessages;
    } else {
      messageKey = error.message as keyof ErrorMessages;
    }

    const message = this.getErrorMessages()[messageKey] || this.getErrorMessages().unknown;
    this.openErrorSnackBar(message, 'Schließen');
    this.storeErrorInStatistics(message);
    this.resetUnitData();
  }

  private storeErrorInStatistics(errorMessage: string): void {
    const duration = this.replayStartTime ? Math.round(performance.now() - this.replayStartTime) : 0;
    this.storeReplayStatistics(false, duration, errorMessage);
  }

  onPlayerReady(): void {
    if (!this.playerReadyTime) {
      this.playerReadyTime = performance.now();
    }
  }

  onResponseVisible(): void {
    this.scheduleAnchorHighlight();

    if (this.successStoredForCurrentReplay) {
      return;
    }
    const now = performance.now();
    const duration = this.replayStartTime ? Math.round(performance.now() - this.replayStartTime) : 0;
    this.storeReplayStatistics(true, duration, undefined, now);
    this.successStoredForCurrentReplay = true;
  }

  private getClientTimings(visibleTime: number = performance.now()): ReplayClientTimings {
    return {
      routeToVisibleMs: this.routeStartTime ? this.getElapsedMs(this.routeStartTime, visibleTime) : null,
      loadToVisibleMs: this.loadStartTime ? this.getElapsedMs(this.loadStartTime, visibleTime) : null,
      routeToPayloadRequestMs: (this.routeStartTime && this.payloadRequestStartTime) ?
        this.getElapsedMs(this.routeStartTime, this.payloadRequestStartTime) :
        null,
      payloadMs: (this.payloadRequestStartTime && this.payloadResponseTime) ?
        this.getElapsedMs(this.payloadRequestStartTime, this.payloadResponseTime) :
        null,
      payloadToVisibleMs: this.payloadResponseTime ?
        this.getElapsedMs(this.payloadResponseTime, visibleTime) :
        null,
      payloadToPlayerReadyMs: (this.payloadResponseTime && this.playerReadyTime) ?
        this.getElapsedMs(this.payloadResponseTime, this.playerReadyTime) :
        null,
      playerReadyToVisibleMs: this.playerReadyTime ?
        this.getElapsedMs(this.playerReadyTime, visibleTime) :
        null
    };
  }

  private getElapsedMs(startTime: number, endTime: number): number {
    return Math.max(0, Math.round(endTime - startTime));
  }

  private storeReplayStatistics(
    success: boolean,
    duration: number,
    errorMessage?: string,
    visibleTime: number = performance.now()
  ): void {
    const workspaceId = this.getWorkspaceIdFromToken();
    if (!workspaceId) return;

    const {
      testPersonLogin,
      testPersonCode,
      bookletId
    } = this.parseTestPersonData();
    const replayUrl = this.getReplayStatisticsUrl();

    this.replayBackendService.storeReplayStatistics(workspaceId, {
      unitId: this.unitId || 'unknown',
      bookletId,
      testPersonLogin,
      testPersonCode,
      durationMilliseconds: Math.max(0, duration),
      replayUrl,
      success,
      errorMessage,
      clientTimings: this.getClientTimings(visibleTime),
      serverTimings: this.serverTimings ?? undefined
    }, this.getReplayRequestAuthToken()).subscribe({
      error: () => undefined
    });
  }

  private getReplayStatisticsUrl(): string {
    try {
      const url = new URL(window.location.href);
      const hashQueryStart = url.hash.indexOf('?');

      if (hashQueryStart >= 0) {
        const hashPath = url.hash.slice(0, hashQueryStart);
        const hashParams = new URLSearchParams(url.hash.slice(hashQueryStart + 1));
        hashParams.delete('auth');
        hashParams.delete('unitsData');
        hashParams.delete('reviewCodeSelections');

        const query = hashParams.toString();
        url.hash = query ? `${hashPath}?${query}` : hashPath;
      }

      url.searchParams.delete('auth');
      url.searchParams.delete('unitsData');
      url.searchParams.delete('reviewCodeSelections');

      return url.toString();
    } catch (error) {
      return window.location.href.split('?')[0];
    }
  }

  private getWorkspaceIdFromToken(): number | null {
    const candidateTokens = [this.authToken]
      .filter((token): token is string => !!token);

    for (const token of candidateTokens) {
      try {
        const decoded: JwtPayload & { workspace: string } = jwtDecode(token);
        const workspaceId = Number(decoded?.workspace);
        if (workspaceId) {
          return workspaceId;
        }
      } catch (error) {
        continue;
      }
    }

    return this.workspaceId || null;
  }

  private parseTestPersonData(): { testPersonLogin: string; testPersonCode: string; bookletId: string } {
    let testPersonLogin = '';
    let testPersonCode = '';
    let bookletId = '';

    if (this.testPerson) {
      const parts = this.testPerson.split('@');
      if (parts.length >= 3) {
        testPersonLogin = parts[0];
        testPersonCode = parts[1];
        bookletId = parts.length === 4 ? parts[3] : parts[2];
      }
    }

    return { testPersonLogin, testPersonCode, bookletId };
  }

  async handleUnitChanged(unit: UnitsReplayUnit): Promise<void> {
    if (this.isCodingInteractionBlockedByReAuthentication()) return;
    if (!this.canLeaveCurrentCodingCase()) return;
    await this.applyUnitChanged(unit);
  }

  private canLeaveCurrentCodingCase(): boolean {
    if (this.isCodingReadOnly()) return true;
    return this.codeSelectorComponent?.canLeaveCurrentUnit() ?? true;
  }

  private async applyUnitChanged(unit: UnitsReplayUnit): Promise<void> {
    if (!unit) return;
    this.cancelPendingAnchorHighlight();
    this.routeStartTime = 0;
    const unitAny = unit as unknown as {
      name: string;
      testPerson?: string;
      variableId?: string;
      variableAnchor?: string;
      variablePage?: string;
    };
    const incomingTestPerson = unitAny.testPerson;

    if (typeof unitAny.variableId === 'string' && unitAny.variableId.length > 0) {
      this.anchor = unitAny.variableAnchor || unitAny.variableId;
      this.codingService.currentVariableId = unitAny.variableId;
    }

    if (typeof unitAny.variablePage === 'string' && unitAny.variablePage.length > 0) {
      this.page = unitAny.variablePage;
    } else if (this.isCodingMode) {
      this.page = '0';
    }

    if (incomingTestPerson && incomingTestPerson !== this.testPerson) {
      this.setTestPerson(incomingTestPerson);
    }
    this.unitId = unit.name;

    let isCurrentUnitPayload = true;
    const workspaceId = this.workspaceId || this.getWorkspaceIdFromAuthToken(this.authToken);
    if (this.canLoadReplayWithCurrentAuth(workspaceId)) {
      isCurrentUnitPayload = await this.loadAndApplyUnitData(workspaceId, this.getReplayRequestAuthToken());
    }

    if (!isCurrentUnitPayload) {
      return;
    }

    if (this.unitsData) {
      const newIndex = this.unitsData.units.findIndex(u => {
        const uAny = u as unknown as { name: string; testPerson?: string; variableId?: string };
        return uAny.name === unitAny.name && (uAny.testPerson ?? '') === (incomingTestPerson ?? '') && uAny.variableId === unitAny.variableId;
      });
      if (newIndex >= 0) {
        this.unitsData = {
          ...this.unitsData,
          currentUnitIndex: newIndex
        };

        this.currentUnitIndex = newIndex + 1;
      }
    }
  }

  checkPageError(pageError: 'notInList' | 'notCurrent' | null): void {
    if (pageError) {
      const errorMessage = this.getErrorMessages()[pageError];
      this.openPageErrorSnackBar(errorMessage, 'Schließen');
      this.storeErrorInStatistics(errorMessage);
    } else if (this.pageErrorSnackbarRef) {
      this.pageErrorSnackBar.dismiss();
      this.pageErrorSnackbarRef = null;
    }
  }

  private resetSnackBars(): void {
    if (this.errorSnackbarRef) this.errorSnackBar.dismiss();
    if (this.pageErrorSnackbarRef) this.pageErrorSnackBar.dismiss();
  }

  private resetUnitData() {
    this.invalidateUnitPayloadRequests();
    this.cancelPendingAnchorHighlight();
    this.unitId = '';
    this.player = '';
    this.unitDef = '';
    this.page = undefined;
    this.responses = undefined;
    this.serverTimings = null;
    this.reviewCodeSelections = [];
    this.codingService.resetCodingData();
  }

  private createReplayRecoveryDraft(): ReplayRecoveryDraft | null {
    if (!this.canUseReplayRecovery()) {
      return null;
    }

    const codingSnapshot = this.codingService.createRecoverySnapshot();
    if (!codingSnapshot) {
      return null;
    }

    return {
      workspaceId: this.workspaceId,
      codingJobId: this.codingService.codingJobId,
      mode: this.getReplayRecoveryMode(),
      currentUnitIndex: this.unitsData?.currentUnitIndex ?? this.currentUnitIndex,
      testPerson: this.testPerson,
      unitId: this.unitId,
      page: this.page,
      anchor: this.anchor,
      originResponseId: this.originResponseId,
      coding: codingSnapshot
    };
  }

  private async restoreReplayRecoveryDraft(): Promise<boolean> {
    if (!this.canUseReplayRecovery()) {
      return false;
    }

    const draft = this.sessionRecoveryService.peekDraft<ReplayRecoveryDraft>(this.replayRecoveryKey);
    if (!draft || !this.isReplayRecoveryDraftForCurrentContext(draft)) {
      return false;
    }

    if (this.unitsData && Number.isInteger(draft.currentUnitIndex)) {
      const restoredIndex = Math.min(
        Math.max(draft.currentUnitIndex, 0),
        Math.max(this.unitsData.units.length - 1, 0)
      );
      this.unitsData = {
        ...this.unitsData,
        currentUnitIndex: restoredIndex
      };
      this.currentUnitIndex = restoredIndex;
    }

    if (draft.testPerson) {
      this.testPerson = draft.testPerson;
    }
    if (draft.unitId) {
      this.unitId = draft.unitId;
    }
    this.page = draft.page ?? this.page;
    this.anchor = draft.anchor ?? this.anchor;

    const restored = this.codingService.restoreRecoverySnapshot(draft.coding);
    if (!restored) {
      return false;
    }

    if (this.isCodingDecisionMode) {
      const notifiedOpener = this.notifyDecisionReplayRecovery(draft);
      if (notifiedOpener) {
        this.sessionRecoveryService.clearDraft(this.replayRecoveryKey);
      }
      return notifiedOpener;
    }

    try {
      const saved = await this.codingService.saveRecoveredCodingState(this.workspaceId, this.unitsData);
      if (!saved) {
        return false;
      }
      this.sessionRecoveryService.clearDraft(this.replayRecoveryKey);
      return true;
    } catch {
      this.sessionRecoveryService.saveDraft(this.replayRecoveryKey, draft);
      return false;
    }
  }

  private isReplayRecoveryDraftForCurrentContext(draft: ReplayRecoveryDraft): boolean {
    if (draft.workspaceId && (!this.workspaceId || draft.workspaceId !== this.workspaceId)) {
      return false;
    }

    const draftMode = draft.mode ?? 'coding';
    if (draftMode !== this.getReplayRecoveryMode()) {
      return false;
    }

    if (draftMode === 'coding-decision') {
      return !!draft.originResponseId &&
        !!this.originResponseId &&
        draft.originResponseId === this.originResponseId;
    }

    const currentJobId = this.codingService.codingJobId || this.unitsData?.id || null;
    return !draft.codingJobId || (!!currentJobId && draft.codingJobId === currentJobId);
  }

  private getReplayRecoveryMode(): ReplayRecoveryMode {
    return this.isCodingDecisionMode ? 'coding-decision' : 'coding';
  }

  private canUseReplayRecovery(): boolean {
    return this.isCodingMode &&
      !this.isReviewMode &&
      !this.isCodingIssueReviewMode;
  }

  private notifyDecisionReplayRecovery(draft: ReplayRecoveryDraft): boolean {
    if (!window.opener || !draft.originResponseId) {
      return false;
    }

    const selectedCodes = this.getEffectiveRecoverySelectedCodes(draft.coding);
    const notesByCompositeKey = new Map(draft.coding.notes || []);
    let notified = false;

    selectedCodes.forEach((selectedCode, compositeKey) => {
      const keyParts = this.parseRecoveryCompositeKey(compositeKey);
      if (!keyParts) {
        return;
      }

      const notes = notesByCompositeKey.get(compositeKey) || '';
      window.opener.postMessage({
        type: 'replayCodeSelected',
        testPerson: keyParts.testPerson,
        unitId: keyParts.unitId,
        variableId: keyParts.variableId,
        code: selectedCode.code ?? String(selectedCode.id),
        score: selectedCode.score ?? null,
        notes,
        responseId: draft.originResponseId
      }, '*');
      notesByCompositeKey.delete(compositeKey);
      notified = true;
    });

    notesByCompositeKey.forEach((notes, compositeKey) => {
      const keyParts = this.parseRecoveryCompositeKey(compositeKey);
      if (!keyParts) {
        return;
      }

      window.opener.postMessage({
        type: 'replayNotesCommitted',
        testPerson: keyParts.testPerson,
        unitId: keyParts.unitId,
        variableId: keyParts.variableId,
        notes,
        responseId: draft.originResponseId
      }, '*');
      notified = true;
    });

    return notified;
  }

  private getEffectiveRecoverySelectedCodes(snapshot: ReplayCodingRecoverySnapshot): Map<string, SavedCode> {
    const selectedCodes = new Map<string, SavedCode>(snapshot.selectedCodes || []);
    (snapshot.pendingSelections || []).forEach(([compositeKey, selectedCode]) => {
      if (selectedCode === null) {
        selectedCodes.delete(compositeKey);
      } else {
        selectedCodes.set(compositeKey, selectedCode);
      }
    });
    return selectedCodes;
  }

  private parseRecoveryCompositeKey(compositeKey: string): { testPerson: string; unitId: string; variableId: string } | null {
    const parts = compositeKey.split('::');
    if (parts.length < 4) {
      return null;
    }

    return {
      testPerson: parts[0],
      unitId: parts[2],
      variableId: parts[3]
    };
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.authBootstrapSubscription?.unsubscribe();
    this.sessionRecoverySubscription?.unsubscribe();
    this.replayNotesCommitSubscription?.unsubscribe();
    this.unregisterRecoveryProvider?.();
    this.routerSubscription = null;
    this.authBootstrapSubscription = null;
    this.sessionRecoverySubscription = null;
    this.replayNotesCommitSubscription = null;
    this.unregisterRecoveryProvider = null;
    this.cancelPendingAnchorHighlight();
    this.resetSnackBars();
    this.watermarkObserver?.disconnect();
    this.watermarkObserver = null;
    this.clearReplayNotesCommitDedupeTimeout();
  }

  private scheduleAnchorHighlight(): void {
    if (!this.anchor) {
      return;
    }

    this.clearAnchorHighlightTimeout();
    this.anchorHighlightRunId += 1;
    const runId = this.anchorHighlightRunId;
    this.tryHighlightAnchor(runId, 1);
  }

  private tryHighlightAnchor(runId: number, attempt: number): void {
    if (runId !== this.anchorHighlightRunId || !this.anchor) {
      return;
    }

    const iframe = this.unitPlayerComponent?.hostingIframe?.nativeElement as HTMLIFrameElement | undefined;
    const highlightedElements = iframe ? highlightAspectSectionWithAnchor(iframe, this.anchor) : [];
    if (iframe) {
      this.highlightCurrentBundleMarkers(iframe);
    }

    if (highlightedElements.length > 0 && iframe) {
      scrollToElementByAlias(iframe, this.anchor);
      return;
    }

    if (attempt >= this.ANCHOR_HIGHLIGHT_MAX_ATTEMPTS) {
      return;
    }

    this.anchorHighlightTimeout = setTimeout(() => {
      this.tryHighlightAnchor(runId, attempt + 1);
    }, this.ANCHOR_HIGHLIGHT_RETRY_DELAY_MS);
  }

  private cancelPendingAnchorHighlight(): void {
    this.clearAnchorHighlightTimeout();
    this.anchorHighlightRunId += 1;
  }

  private clearAnchorHighlightTimeout(): void {
    if (this.anchorHighlightTimeout) {
      clearTimeout(this.anchorHighlightTimeout);
      this.anchorHighlightTimeout = null;
    }
  }

  private getCurrentBundleMarkers(): Array<{ anchor: string; label: string; tooltip: string }> {
    const currentUnit = this.unitsData?.units[this.unitsData.currentUnitIndex];
    const bundleContext = currentUnit?.bundleContext;
    if (!bundleContext || !this.page) {
      return [];
    }

    const label = this.translateService.instant('code-selector.bundle-auto-coded-label');
    const tooltip = this.translateService.instant('code-selector.bundle-auto-coded-tooltip');

    return bundleContext.variables
      .filter(variable => (
        variable.status === 'auto-coded' &&
        variable.unitName === currentUnit.name &&
        variable.variableAnchor &&
        variable.variableAnchor !== this.anchor &&
        variable.variablePage === this.page
      ))
      .map(variable => ({
        anchor: variable.variableAnchor,
        label,
        tooltip
      }));
  }

  private highlightCurrentBundleMarkers(iframe: HTMLIFrameElement): void {
    highlightBundleVariableMarkers(iframe, this.getCurrentBundleMarkers());
  }

  async onCodeSelected(event: { variableId: string; code: any }): Promise<void> {
    if (this.isCodingReadOnly()) return;

    let savedCode: { code?: string; score?: number } | null = null;
    try {
      savedCode = await this.codingService.handleCodeSelected(event, this.testPerson, this.unitId, this.workspaceId, this.unitsData);
    } catch (error) {
      return;
    }

    if (savedCode && window.opener && this.originResponseId) {
      window.opener.postMessage({
        type: 'replayCodeSelected',
        testPerson: this.testPerson,
        unitId: this.unitId,
        variableId: event.variableId,
        code: savedCode.code,
        score: savedCode.score ?? null,
        notes: this.codingService.getNotes(this.testPerson, this.unitId, event.variableId),
        responseId: this.originResponseId
      }, '*');

      this.errorSnackBar.open(
        'Code an Vergleichsliste gesendet',
        'Ok',
        { duration: 2000 }
      );
    }
  }

  getCoderNotes(): string {
    return this.codingService.getNotes(this.testPerson, this.unitId, this.codingService.currentVariableId);
  }

  onNotesChanged(notes: string): void {
    if (this.isCodingReadOnly()) return;

    const variableId = this.codingService.currentVariableId;
    this.codingService.saveNotes(
      this.workspaceId,
      this.testPerson,
      this.unitId,
      variableId,
      notes,
      this.unitsData
    ).catch(() => undefined);
    this.replayNotesCommitSubject.next({ variableId, notes });
  }

  onNotesCommitted(notes: string): void {
    if (this.isCodingReadOnly()) return;

    this.sendReplayNotesCommitted(this.codingService.currentVariableId, notes);
  }

  private sendReplayNotesCommitted(variableId: string, notes: string): void {
    if (!window.opener || !this.originResponseId || !variableId) {
      return;
    }

    const commitKey = JSON.stringify({
      testPerson: this.testPerson,
      unitId: this.unitId,
      variableId,
      notes,
      responseId: this.originResponseId
    });
    if (commitKey === this.lastReplayNotesCommitKey) {
      return;
    }
    this.lastReplayNotesCommitKey = commitKey;
    this.clearReplayNotesCommitDedupeTimeout();
    this.replayNotesCommitDedupeTimeout = setTimeout(() => {
      if (this.lastReplayNotesCommitKey === commitKey) {
        this.lastReplayNotesCommitKey = null;
      }
      this.replayNotesCommitDedupeTimeout = null;
    }, this.REPLAY_NOTES_COMMIT_DEDUPE_MS);

    window.opener.postMessage({
      type: 'replayNotesCommitted',
      testPerson: this.testPerson,
      unitId: this.unitId,
      variableId,
      notes,
      responseId: this.originResponseId
    }, '*');
  }

  private clearReplayNotesCommitDedupeTimeout(): void {
    if (this.replayNotesCommitDedupeTimeout) {
      clearTimeout(this.replayNotesCommitDedupeTimeout);
      this.replayNotesCommitDedupeTimeout = null;
    }
  }

  getCompletedCount(): number {
    return this.codingService.getCompletedCount(this.unitsData);
  }

  getOpenCount(): number {
    return this.codingService.getOpenCount(this.unitsData);
  }

  getProgressPercentage(): number {
    return this.codingService.getProgressPercentage(this.unitsData);
  }

  isCodingReadOnly(): boolean {
    return (!this.isCodingDecisionMode && this.appService.needsReAuthentication) ||
      this.isReviewMode ||
      (this.codingService.isCompletedJobReview && !this.isCodingIssueReviewMode) ||
      this.codingService.isCodingJobFinalized;
  }

  isCodingInteractionBlockedByReAuthentication(): boolean {
    return this.isCodingMode &&
      !this.isReviewMode &&
      !this.isCodingDecisionMode &&
      this.appService.needsReAuthentication;
  }

  isSubmitCodingJobDisabled(): boolean {
    return this.codingService.isSubmittingJob || this.isCodingInteractionBlockedByReAuthentication();
  }

  hasCodingJobPanelContent(): boolean {
    return !!this.codingService.codingScheme && !!this.codingService.currentVariableId;
  }

  getPreSelectedCodeId(variableId: string): number | null {
    return this.codingService.getPreSelectedCodeId(this.testPerson, this.unitId, variableId);
  }

  getPreSelectedCodingIssueOptionId(variableId: string): number | null {
    return this.codingService.getPreSelectedCodingIssueOptionId(this.testPerson, this.unitId, variableId);
  }

  pauseCodingJob(): void {
    if (
      this.codingService.codingJobId &&
      !this.isCodingInteractionBlockedByReAuthentication() &&
      !this.isReviewMode &&
      !this.codingService.isCompletedJobReview &&
      !this.codingService.isCodingJobFinalized
    ) {
      this.codingService.pauseCodingJob(this.workspaceId, this.codingService.codingJobId);
    }
  }

  resumeCodingJob(): void {
    if (this.codingService.codingJobId && !this.isReviewMode && !this.isCodingInteractionBlockedByReAuthentication()) {
      this.codingService.resumeCodingJob(this.workspaceId, this.codingService.codingJobId);
    }
  }

  async submitCodingJob(): Promise<void> {
    if (this.isReviewMode) return;
    if (this.isCodingInteractionBlockedByReAuthentication()) {
      this.errorSnackBar.open(
        this.translateService.instant('replay.reauthentication-required'),
        this.translateService.instant('close'),
        { duration: 4000, panelClass: ['snackbar-error'] }
      );
      return;
    }

    if (this.codingService.codingJobId) {
      if (this.codingService.hasSaveError) {
        await this.codingService.submitCodingJob(this.workspaceId, this.codingService.codingJobId);
        return;
      }
      try {
        await this.codingService.flushPendingRowMutations();
      } catch {
        return;
      }
      if (this.codingService.hasSaveError) {
        await this.codingService.submitCodingJob(this.workspaceId, this.codingService.codingJobId);
        return;
      }
      await this.codingService.submitCodingJob(this.workspaceId, this.codingService.codingJobId);
    }
  }

  dismissCompletionOverlay(): void {
    // Allow users to continue navigating through cases even after job completion
    this.codingService.isCodingJobCompleted = false;
  }

  openCommentDialog(): void {
    if (this.isCodingReadOnly()) return;

    const dialogRef = this.dialog.open(CodingJobCommentDialogComponent, {
      width: '500px',
      data: { comment: this.codingService.codingJobComment }
    });

    dialogRef.afterClosed().subscribe(async (result: string) => {
      if (result !== undefined && result !== this.codingService.codingJobComment) {
        await this.codingService.saveCodingJobComment(this.workspaceId, result);
      }
    });
  }

  openNavigateDialog(): void {
    if (!this.unitsData || this.isCodingInteractionBlockedByReAuthentication()) return;

    const dialogData: NavigateCodingCasesDialogData = {
      unitsData: this.unitsData,
      codingService: this.codingService,
      testPerson: this.testPerson
    };

    const dialogRef = this.dialog.open(NavigateCodingCasesDialogComponent, {
      width: '1200px',
      height: '80vh',
      data: dialogData
    });

    dialogRef.afterClosed().subscribe((selectedUnit: UnitsReplayUnit | undefined) => {
      if (selectedUnit) {
        this.handleUnitChanged(selectedUnit);
      }
    });
  }

  openCodingJobs(): void {
    this.pauseCodingJob();
    if (this.workspaceId) {
      this.router.navigate(['/workspace-admin', this.workspaceId, 'coding', 'my-jobs']);
      return;
    }

    this.router.navigate(['/coding']);
  }

  onKeyDown(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;

    // Ignore if user is typing in an input/textarea
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      if (keyboardEvent.key === 'Enter') {
        activeElement.blur();
        keyboardEvent.preventDefault();
      }
      return;
    }

    if (this.isCodingInteractionBlockedByReAuthentication() &&
      ['Enter', 'ArrowRight', 'ArrowLeft'].includes(keyboardEvent.key)) {
      keyboardEvent.preventDefault();
      return;
    }

    if (this.isCodingMode && this.unitsData) {
      const currentIndex = this.unitsData.currentUnitIndex;
      const currentUnit = this.unitsData.units[currentIndex];
      const currentUnitName = currentUnit?.name || this.unitId;
      const currentVariableId = currentUnit?.variableId || this.codingService.currentVariableId;

      // Check for Enter key - navigate to next unit (existing functionality)
      if (keyboardEvent.key === 'Enter' && currentVariableId) {
        if (this.codingService.hasSaveError) {
          keyboardEvent.preventDefault();
          return;
        }
        const compositeKey = this.codingService.generateCompositeKey(this.testPerson, currentUnitName, currentVariableId);
        const hasSelection = this.codingService.selectedCodes.has(compositeKey);

        if (hasSelection) {
          keyboardEvent.preventDefault();
          const nextIndex = currentIndex + 1;
          if (nextIndex >= 0 && nextIndex < this.unitsData.units.length) {
            this.handleUnitChanged(this.unitsData.units[nextIndex]);
          }
        }
      } else if (keyboardEvent.key === 'ArrowRight') {
        keyboardEvent.preventDefault();
        if (this.codingService.hasSaveError) {
          return;
        }
        const compositeKey = this.codingService.generateCompositeKey(this.testPerson, currentUnitName, currentVariableId);
        const hasSelection = this.codingService.selectedCodes.has(compositeKey);

        if (hasSelection || this.isCodingReadOnly()) {
          const nextIndex = currentIndex + 1;
          if (nextIndex >= 0 && nextIndex < this.unitsData.units.length) {
            this.handleUnitChanged(this.unitsData.units[nextIndex]);
          }
        }
      } else if (keyboardEvent.key === 'ArrowLeft' && currentIndex > 0) {
        keyboardEvent.preventDefault();
        const prevIndex = currentIndex - 1;
        if (prevIndex >= 0) {
          this.handleUnitChanged(this.unitsData.units[prevIndex]);
        }
      } else if (
        ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(keyboardEvent.key) &&
        this.codingService.currentVariableId &&
        !this.isCodingReadOnly()
      ) {
        keyboardEvent.preventDefault();
        const codeId = parseInt(keyboardEvent.key, 10);
        if (this.codingService.codingScheme) {
          const variableCoding = findVariableCodingByPublicId(
            this.codingService.codingScheme,
            this.codingService.currentVariableId
          );
          if (variableCoding) {
            const code = variableCoding.codes.find(c => c.id === codeId && hasManualInstruction(c));
            if (code) {
              this.onCodeSelected({
                variableId: this.codingService.currentVariableId,
                code: code
              });
              this.codeSelectorComponent?.scrollToCode(codeId);
            }
          }
        }
      }
    }
  }

  @HostListener('window:beforeunload')
  onBeforeUnload(): void {
    if (
      this.codingService.codingJobId &&
      this.workspaceId &&
      !this.codingService.isCodingJobCompleted &&
      !this.codingService.isCompletedJobReview &&
      !this.codingService.isCodingJobFinalized &&
      !this.isCodingInteractionBlockedByReAuthentication() &&
      !this.isReviewMode
    ) {
      this.codingService.pauseCodingJobOnUnload(this.workspaceId, this.codingService.codingJobId);
    }
  }

  // --- Resize handle ---
  onResizeStart(event: MouseEvent): void {
    event.preventDefault();
    this.isResizing = true;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.codePanelWidth;
  }

  @HostListener('document:mousemove', ['$event'])
  onResizeMove(event: MouseEvent): void {
    if (!this.isResizing) return;
    const dx = this.resizeStartX - event.clientX; // dragging left = wider panel
    const maxWidth = window.innerWidth * this.MAX_PANEL_WIDTH_RATIO;
    this.codePanelWidth = Math.min(maxWidth, Math.max(this.MIN_PANEL_WIDTH, this.resizeStartWidth + dx));
    this.scheduleWatermarkCheck();
  }

  @HostListener('document:mouseup')
  onResizeEnd(): void {
    this.isResizing = false;
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.scheduleWatermarkCheck();
  }

  private setupWatermarkObserver(): void {
    this.watermarkObserver?.disconnect();
    this.watermarkObserver = null;

    const element = this.watermarkElement?.nativeElement;
    if (!element) {
      this.isWatermarkTruncated = false;
      return;
    }

    this.scheduleWatermarkCheck();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.watermarkObserver = new ResizeObserver(() => {
      this.scheduleWatermarkCheck();
    });
    this.watermarkObserver.observe(element);
  }

  private scheduleWatermarkCheck(): void {
    if (this.watermarkCheckPending) return;
    this.watermarkCheckPending = true;
    const runCheck = () => {
      this.watermarkCheckPending = false;
      this.updateWatermarkTruncation();
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(runCheck);
    } else {
      setTimeout(runCheck, 0);
    }
  }

  private updateWatermarkTruncation(): void {
    const element = this.watermarkElement?.nativeElement;
    if (!element) {
      this.isWatermarkTruncated = false;
      return;
    }

    const isTruncated = element.scrollWidth > element.clientWidth + 1;
    if (this.isWatermarkTruncated !== isTruncated) {
      this.isWatermarkTruncated = isTruncated;
    }
  }

  private loadCodingSchemeForCodingJob(unitPayloadRunId: number): void {
    if (!this.unitDef) return;

    const codingSchemeRef = this.extractCodingSchemeRefFromXml(this.unitDef);
    if (codingSchemeRef) {
      const workspaceId = this.workspaceId;
      const unitId = this.unitId;
      const testPerson = this.testPerson;
      this.fileService.getCodingSchemeFile(workspaceId, codingSchemeRef)
        .pipe(catchError(() => of(null)))
        .subscribe(fileData => {
          if (!this.isCurrentUnitPayloadRun(unitPayloadRunId) ||
            workspaceId !== this.workspaceId ||
            unitId !== this.unitId ||
            testPerson !== this.testPerson) {
            return;
          }
          if (fileData && fileData.base64Data) {
            this.codingService.setCodingSchemeFromVocsData(fileData.base64Data);
          }
        });
    }
  }

  private extractCodingSchemeRefFromXml(xmlContent: string): string | null {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
      const codingSchemeRefElement = xmlDoc.querySelector('CodingSchemeRef');

      if (codingSchemeRefElement && codingSchemeRefElement.textContent) {
        return codingSchemeRefElement.textContent.trim();
      }
    } catch (error) {
      // Ignore parsing errors
    }

    return null;
  }
}
