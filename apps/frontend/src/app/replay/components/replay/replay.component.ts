import {
  Component, ElementRef, OnChanges, OnDestroy, OnInit, SimpleChanges, ViewChild, HostListener, inject,
  input
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Params } from '@angular/router';
import {
  firstValueFrom, of, Subject, Subscription, catchError
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
import { scrollToElementByAlias, highlightAspectSectionWithAnchor } from '../../utils/dom-utils';
import { UnitsReplay, UnitsReplayUnit } from '../../services/units-replay.service';
import { UnitsReplayComponent } from '../units-replay/units-replay.component';
import { CodeSelectorComponent } from '../../../coding/components/code-selector/code-selector.component';
import { CodingJobCommentDialogComponent } from '../../../coding/components/coding-job-comment-dialog/coding-job-comment-dialog.component';
import { NavigateCodingCasesDialogComponent, NavigateCodingCasesDialogData } from '../navigate-coding-cases-dialog/navigate-coding-cases-dialog.component';
import { ReplayCodingService } from '../../services/replay-coding.service';
import { base64ToUtf8 } from '../../../shared/utils/common-utils';
import { CodingJobBackendService } from '../../../coding/services/coding-job-backend.service';
import { hasManualInstruction } from '../../../coding/utils/manual-coding.util';
import { CodingJob } from '../../../coding/models/coding-job.model';

interface AssignedCodingJobWorkspace {
  id: number;
  name: string;
}

interface CodingJobUnitApi {
  responseId: number;
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  variableAnchor: string;
  variablePage: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
}

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

interface ReplayCodingServiceSnapshot {
  codingScheme: ReplayCodingService['codingScheme'];
  currentVariableId: string;
  codingJobId: number | null;
  selectedCodes: ReplayCodingService['selectedCodes'];
  openUnitKeys: ReplayCodingService['openUnitKeys'];
  notes: ReplayCodingService['notes'];
  codingJobComment: string;
  isPausingJob: boolean;
  isCodingJobCompleted: boolean;
  isCodingJobPaused: boolean;
  isSubmittingJob: boolean;
  isResumingJob: boolean;
  isCodingJobFinalized: boolean;
  isCompletedJobReview: boolean;
  isReviewMode: boolean;
  hasSaveError: boolean;
  lastSaveError: string | null;
  currentCodingJobStatus: string | null;
  showScore: boolean;
  allowComments: boolean;
  suppressGeneralInstructions: boolean;
}

interface ReplayCodingJobSwitchSnapshot {
  authToken: string;
  workspaceId: number;
  isCodingMode: boolean;
  isBookletReplayMode: boolean;
  isReviewMode: boolean;
  unitsData: UnitsReplay | null;
  loadedCodingJobUnitsKey: string | null;
  codingProgressLoadedForJobKey: string | null;
  activeStatusUpdatedForJobKey: string | null;
  selectedCodingJobKey: string;
  totalUnits: number;
  currentUnitIndex: number;
  testPerson: string;
  unitId: string;
  player: string;
  unitDef: string;
  page: string | undefined;
  anchor: string | undefined;
  responses: unknown | undefined;
  serverTimings: ReplayServerTimings | null;
  successStoredForCurrentReplay: boolean;
  reloadKey: number;
  codingService: ReplayCodingServiceSnapshot;
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
    MatSelectModule,
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
  private errorSnackBar = inject(MatSnackBar);
  private pageErrorSnackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private translateService = inject(TranslateService);
  codingService = inject(ReplayCodingService);
  private codingJobBackendService = inject(CodingJobBackendService);

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
  isBookletReplayMode: boolean = false; // for replays without coding features
  isReviewMode: boolean = false;
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
  protected assignedCodingJobs: CodingJob[] = [];
  protected selectedCodingJobKey: string = '';
  protected isLoadingAssignedCodingJobs = false;
  protected isSwitchingCodingJob = false;
  protected hasAssignedCodingJobsLoadError = false;
  private assignedCodingJobsLoaded = false;
  private assignedCodingJobsReloadRequested = false;
  private authDataSubscription: Subscription | null = null;
  private codingJobWorkspaceNames = new Map<number, string>();
  @ViewChild(UnitPlayerComponent) unitPlayerComponent: UnitPlayerComponent | undefined;
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
  private watermarkElement: ElementRef<HTMLElement> | null = null;
  private watermarkObserver: ResizeObserver | null = null;
  private watermarkCheckPending: boolean = false;
  private anchorHighlightTimeout: ReturnType<typeof setTimeout> | null = null;
  private anchorHighlightRunId = 0;
  private unitPayloadRunId = 0;
  private readonly ANCHOR_HIGHLIGHT_RETRY_DELAY_MS = 100;
  private readonly ANCHOR_HIGHLIGHT_MAX_ATTEMPTS = 40;

  // Resize handle state
  codePanelWidth: number = 350;
  isResizing: boolean = false;
  private resizeStartX: number = 0;
  private resizeStartWidth: number = 0;
  private readonly MIN_PANEL_WIDTH = 250;
  private readonly MAX_PANEL_WIDTH_RATIO = 0.6;

  ngOnInit(): void {
    this.replayStartTime = performance.now();
    this.authDataSubscription = this.appService.authData$.subscribe(() => {
      if (this.canSwitchAssignedCodingJobs()) {
        this.requestAssignedCodingJobsReload().catch(() => undefined);
      }
    });
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

  subscribeRouter(): void {
    this.routerSubscription = this.route.params
      ?.subscribe(async params => {
        this.routeStartTime = performance.now();
        this.resetSnackBars();
        this.resetUnitData();
        this.authToken = await this.getAuthToken();
        this.codingService.setAuthToken(this.authToken);
        let workspace: string | undefined;
        try {
          const decoded: JwtPayload & { workspace: string } = jwtDecode(this.authToken);
          workspace = decoded?.workspace;
        } catch (error) {
          workspace = undefined;
        }
        this.workspaceId = Number(workspace);

        const queryParams = await firstValueFrom(this.route.queryParams);
        this.isReviewMode = queryParams.mode === 'coding-review';
        this.codingService.isReviewMode = this.isReviewMode;
        this.isCodingMode = queryParams.mode === 'coding' || this.isReviewMode;
        this.isBookletReplayMode = queryParams.mode === 'booklet-view' || queryParams.mode === 'booklet';
        this.originResponseId = queryParams.originResponseId ? Number(queryParams.originResponseId) : null;
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
                      variablePage: item.variablePage
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
            this.isReviewMode = this.isReviewMode || this.unitsData.name.includes(' - Review: ');
            this.codingService.isReviewMode = this.isReviewMode;
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
                const jobKey = this.getCodingJobKeyFromIds(this.workspaceId, jobId);
                this.selectedCodingJobKey = jobKey;
                if (this.codingProgressLoadedForJobKey !== jobKey) {
                  await this.codingService.loadSavedCodingProgress(this.workspaceId, jobId);
                  this.codingProgressLoadedForJobKey = jobKey;
                }
                if (!this.isReviewMode &&
                  !this.codingService.isCompletedJobReview &&
                  !this.codingService.isCodingJobFinalized &&
                  this.activeStatusUpdatedForJobKey !== jobKey) {
                  this.codingService.updateCodingJobStatus(this.workspaceId, jobId, 'active');
                  this.activeStatusUpdatedForJobKey = jobKey;
                }
                if (!this.codingService.isCompletedJobReview) {
                  this.codingService.checkCodingJobCompletion(this.unitsData);
                }
                if (this.canSwitchAssignedCodingJobs()) {
                  this.requestAssignedCodingJobsReload().catch(() => undefined);
                }
              }
            }
          }
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

          if (this.isPrintMode && params.unitId) {
            this.unitId = params.unitId;
            await this.loadAndApplyUnitData(Number(workspace), this.authToken);
          } else if (Object.keys(params).length >= 3 && Object.keys(params).length <= 4) {
            this.setUnitParams(params);
            if (this.authToken) {
              if (workspace) {
                await this.loadAndApplyUnitData(Number(workspace), this.authToken);
              }
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
        await this.loadAndApplyUnitData(this.appService.selectedWorkspaceId, this.authToken);
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
    }).subscribe({
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

        const query = hashParams.toString();
        url.hash = query ? `${hashPath}?${query}` : hashPath;
      }

      url.searchParams.delete('auth');
      url.searchParams.delete('unitsData');

      return url.toString();
    } catch (error) {
      return window.location.href.split('?')[0];
    }
  }

  private getWorkspaceIdFromToken(): number | null {
    const candidateTokens = [this.authToken, localStorage.getItem('id_token')]
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
    if (this.isSwitchingCodingJob) return;
    await this.applyUnitChanged(unit);
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
    if (this.authToken) {
      let workspace: string | undefined;
      try {
        const decoded: JwtPayload & { workspace: string } = jwtDecode(this.authToken);
        workspace = decoded?.workspace;
      } catch (error) {
        workspace = undefined;
      }
      if (workspace) {
        isCurrentUnitPayload = await this.loadAndApplyUnitData(Number(workspace), this.authToken);
      }
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
    this.codingService.resetCodingData();
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.authDataSubscription?.unsubscribe();
    this.routerSubscription = null;
    this.authDataSubscription = null;
    this.cancelPendingAnchorHighlight();
    this.resetSnackBars();
    this.watermarkObserver?.disconnect();
    this.watermarkObserver = null;
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

    this.codingService.saveNotes(
      this.workspaceId,
      this.testPerson,
      this.unitId,
      this.codingService.currentVariableId,
      notes
    ).catch(() => undefined);
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
    return this.isSwitchingCodingJob ||
      this.isReviewMode ||
      this.codingService.isCompletedJobReview ||
      this.codingService.isCodingJobFinalized;
  }

  hasCodingJobPanelContent(): boolean {
    return this.hasCodingJobSwitchStatus() || this.hasCodingSchemeForCurrentVariable();
  }

  hasCodingJobSwitchStatus(): boolean {
    return this.canSwitchAssignedCodingJobs() && (this.assignedCodingJobs.length > 1 ||
      this.isLoadingAssignedCodingJobs ||
      this.hasAssignedCodingJobsLoadError);
  }

  hasCodingSchemeForCurrentVariable(): boolean {
    return !!this.codingService.codingScheme && !!this.codingService.currentVariableId;
  }

  canSwitchAssignedCodingJobs(): boolean {
    return this.isCodingMode && !this.isReviewMode;
  }

  isCodingJobSwitchDisabled(): boolean {
    return !this.canSwitchAssignedCodingJobs() ||
      this.isLoadingAssignedCodingJobs ||
      this.isSwitchingCodingJob ||
      this.codingService.hasSaveError;
  }

  getCodingJobOptionKey(job: CodingJob): string {
    return this.getCodingJobKeyFromIds(job.workspace_id, job.id);
  }

  getCodingJobOptionMeta(job: CodingJob): string {
    const workspaceName = this.codingJobWorkspaceNames.get(job.workspace_id) || `Arbeitsbereich ${job.workspace_id}`;
    return `${workspaceName} · ${this.getCodingJobStatusText(job.status)} · ${this.getCodingJobProgressText(job)}`;
  }

  async onCodingJobSelectionChange(jobKey: string): Promise<void> {
    await this.switchToAssignedCodingJob(jobKey);
  }

  async retryLoadAssignedCodingJobs(): Promise<void> {
    await this.requestAssignedCodingJobsReload();
  }

  private async requestAssignedCodingJobsReload(): Promise<void> {
    this.assignedCodingJobsLoaded = false;
    if (this.isLoadingAssignedCodingJobs) {
      this.assignedCodingJobsReloadRequested = true;
      return;
    }

    await this.loadAssignedCodingJobs();
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
      !this.isSwitchingCodingJob &&
      !this.isReviewMode &&
      !this.codingService.isCompletedJobReview &&
      !this.codingService.isCodingJobFinalized
    ) {
      this.codingService.pauseCodingJob(this.workspaceId, this.codingService.codingJobId);
    }
  }

  resumeCodingJob(): void {
    if (this.codingService.codingJobId && !this.isReviewMode) {
      this.codingService.resumeCodingJob(this.workspaceId, this.codingService.codingJobId);
    }
  }

  async submitCodingJob(): Promise<void> {
    if (this.isReviewMode) return;

    if (this.codingService.codingJobId) {
      if (this.codingService.hasSaveError) {
        await this.codingService.submitCodingJob(this.workspaceId, this.codingService.codingJobId);
        return;
      }
      await this.codingService.saveAllCodingProgress(this.workspaceId, this.codingService.codingJobId);
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
    if (!this.unitsData || this.isSwitchingCodingJob) return;

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

    if (this.isSwitchingCodingJob && ['Enter', 'ArrowRight', 'ArrowLeft'].includes(keyboardEvent.key)) {
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
          const variableCoding = this.codingService.codingScheme.variableCodings.find(
            (v: any) => v.alias === this.codingService.currentVariableId || v.id === this.codingService.currentVariableId
          );
          if (variableCoding) {
            const code = variableCoding.codes.find((c: any) => c.id === codeId && hasManualInstruction(c));
            if (code) {
              this.onCodeSelected({
                variableId: this.codingService.currentVariableId,
                code: code
              });
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

  private async loadAssignedCodingJobs(): Promise<void> {
    if (!this.canSwitchAssignedCodingJobs() || this.isLoadingAssignedCodingJobs || this.assignedCodingJobsLoaded) {
      return;
    }

    const workspaces = this.getAssignedCodingJobWorkspaces();
    if (workspaces.length === 0) {
      return;
    }

    this.isLoadingAssignedCodingJobs = true;
    this.hasAssignedCodingJobsLoadError = false;
    let hasLoadError = false;
    try {
      const jobLists = await Promise.all(workspaces.map(async workspace => {
        this.codingJobWorkspaceNames.set(workspace.id, workspace.name);
        try {
          const response = await firstValueFrom(this.codingJobBackendService.getCodingJobs(
            workspace.id,
            undefined,
            undefined,
            { assignedTo: 'me' }
          ));
          return (response.data || []).map(job => ({
            ...job,
            workspace_id: job.workspace_id || workspace.id
          }));
        } catch (error) {
          hasLoadError = true;
          return [];
        }
      }));

      this.assignedCodingJobs = this.sortAssignedCodingJobs(this.uniqueCodingJobs(
        jobLists.flat().filter(job => job.status !== 'review')
      ));
      this.selectedCodingJobKey = this.getActiveCodingJobKey();
      this.hasAssignedCodingJobsLoadError = hasLoadError;
      this.assignedCodingJobsLoaded = !hasLoadError;
    } finally {
      this.isLoadingAssignedCodingJobs = false;
      if (this.assignedCodingJobsReloadRequested) {
        this.assignedCodingJobsReloadRequested = false;
        this.assignedCodingJobsLoaded = false;
        await this.loadAssignedCodingJobs();
      }
    }
  }

  private getAssignedCodingJobWorkspaces(): AssignedCodingJobWorkspace[] {
    const authWorkspaces = this.appService.authData?.workspaces || [];
    const workspaces = authWorkspaces
      .filter(workspace => Number.isInteger(workspace.id) && workspace.id > 0)
      .map(workspace => ({
        id: workspace.id,
        name: workspace.name || `Arbeitsbereich ${workspace.id}`
      }));

    if (workspaces.length > 0) {
      return workspaces;
    }

    if (this.workspaceId) {
      return [{ id: this.workspaceId, name: `Arbeitsbereich ${this.workspaceId}` }];
    }

    return [];
  }

  private uniqueCodingJobs(jobs: CodingJob[]): CodingJob[] {
    const byKey = new Map<string, CodingJob>();
    jobs.forEach(job => {
      byKey.set(this.getCodingJobOptionKey(job), job);
    });
    return Array.from(byKey.values());
  }

  private sortAssignedCodingJobs(jobs: CodingJob[]): CodingJob[] {
    const statusPriority = new Map<string, number>([
      ['active', 0],
      ['open', 1],
      ['paused', 2],
      ['pending', 3],
      ['completed', 4],
      ['results_applied', 5]
    ]);

    return [...jobs].sort((a, b) => {
      const priorityA = statusPriority.get(a.status) ?? 99;
      const priorityB = statusPriority.get(b.status) ?? 99;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return this.getDateTime(b.updated_at) - this.getDateTime(a.updated_at);
    });
  }

  private getDateTime(value: Date | string | undefined): number {
    return value ? new Date(value).getTime() || 0 : 0;
  }

  private getActiveCodingJobKey(): string {
    if (!this.workspaceId || !this.codingService.codingJobId) {
      return '';
    }
    return this.getCodingJobKeyFromIds(this.workspaceId, this.codingService.codingJobId);
  }

  private getCodingJobKeyFromIds(workspaceId: number, jobId: number): string {
    return `${workspaceId}:${jobId}`;
  }

  private getCodingJobStatusText(status: string): string {
    const statusKey = `coding.my-coding-jobs.job-status-${status.replace(/_/g, '-')}`;
    const translated = this.translateService.instant(statusKey);
    return translated === statusKey ? status : translated;
  }

  private getCodingJobProgressText(job: CodingJob): string {
    if (!job.totalUnits) {
      return this.translateService.instant('coding.my-coding-jobs.no-tasks');
    }
    return `${job.progress || 0}% (${job.codedUnits || 0}/${job.totalUnits})`;
  }

  private async switchToAssignedCodingJob(jobKey: string): Promise<void> {
    const currentJobKey = this.getActiveCodingJobKey();
    if (!this.canSwitchAssignedCodingJobs()) {
      this.selectedCodingJobKey = currentJobKey;
      return;
    }

    if (!jobKey || jobKey === currentJobKey) {
      this.selectedCodingJobKey = currentJobKey;
      return;
    }

    if (this.codingService.hasSaveError) {
      this.selectedCodingJobKey = currentJobKey;
      this.errorSnackBar.open(
        this.translateService.instant('replay.job-switcher.save-error'),
        this.translateService.instant('close'),
        { duration: 4000, panelClass: ['snackbar-error'] }
      );
      return;
    }

    const targetJob = this.assignedCodingJobs.find(job => this.getCodingJobOptionKey(job) === jobKey);
    if (!targetJob) {
      this.selectedCodingJobKey = currentJobKey;
      return;
    }

    this.isSwitchingCodingJob = true;
    let didActivateTargetJob = false;
    let switchSnapshot: ReplayCodingJobSwitchSnapshot | null = null;
    try {
      const targetAuthToken = await this.getReplayAuthTokenForWorkspace(targetJob.workspace_id);
      const onlyOpen = targetJob.status === 'open';
      const apiUnits = await firstValueFrom(
        this.codingJobBackendService.getCodingJobUnits(
          targetJob.workspace_id,
          targetJob.id,
          targetAuthToken,
          onlyOpen
        )
      );

      if (!apiUnits || apiUnits.length === 0) {
        this.selectedCodingJobKey = currentJobKey;
        this.errorSnackBar.open(
          this.translateService.instant('replay.job-switcher.no-units'),
          this.translateService.instant('close'),
          { duration: 3000 }
        );
        return;
      }

      await this.saveCurrentCodingJobBeforeSwitch();
      const nextUnitsData = this.createUnitsReplayFromCodingJob(targetJob, apiUnits);
      switchSnapshot = this.captureCodingJobSwitchSnapshot();
      await this.activateCodingJob(targetJob, nextUnitsData, targetAuthToken, onlyOpen);
      didActivateTargetJob = true;
      this.updateReplayUrlForCodingJob(targetJob, nextUnitsData.units[0], targetAuthToken, onlyOpen);
      this.errorSnackBar.open(
        this.translateService.instant('replay.job-switcher.switched', { name: targetJob.name }),
        this.translateService.instant('close'),
        { duration: 2000 }
      );
    } catch (error) {
      if (!didActivateTargetJob && switchSnapshot) {
        this.restoreCodingJobSwitchSnapshot(switchSnapshot);
      }
      this.selectedCodingJobKey = didActivateTargetJob ? this.getActiveCodingJobKey() : currentJobKey;
      this.errorSnackBar.open(
        this.translateService.instant('replay.job-switcher.switch-error'),
        this.translateService.instant('close'),
        { duration: 4000, panelClass: ['snackbar-error'] }
      );
    } finally {
      this.isSwitchingCodingJob = false;
    }
  }

  private captureCodingJobSwitchSnapshot(): ReplayCodingJobSwitchSnapshot {
    return {
      authToken: this.authToken,
      workspaceId: this.workspaceId,
      isCodingMode: this.isCodingMode,
      isBookletReplayMode: this.isBookletReplayMode,
      isReviewMode: this.isReviewMode,
      unitsData: this.unitsData,
      loadedCodingJobUnitsKey: this.loadedCodingJobUnitsKey,
      codingProgressLoadedForJobKey: this.codingProgressLoadedForJobKey,
      activeStatusUpdatedForJobKey: this.activeStatusUpdatedForJobKey,
      selectedCodingJobKey: this.selectedCodingJobKey,
      totalUnits: this.totalUnits,
      currentUnitIndex: this.currentUnitIndex,
      testPerson: this.testPerson,
      unitId: this.unitId,
      player: this.player,
      unitDef: this.unitDef,
      page: this.page,
      anchor: this.anchor,
      responses: this.responses,
      serverTimings: this.serverTimings,
      successStoredForCurrentReplay: this.successStoredForCurrentReplay,
      reloadKey: this.reloadKey,
      codingService: {
        codingScheme: this.codingService.codingScheme,
        currentVariableId: this.codingService.currentVariableId,
        codingJobId: this.codingService.codingJobId,
        selectedCodes: new Map(this.codingService.selectedCodes),
        openUnitKeys: new Set(this.codingService.openUnitKeys),
        notes: new Map(this.codingService.notes),
        codingJobComment: this.codingService.codingJobComment,
        isPausingJob: this.codingService.isPausingJob,
        isCodingJobCompleted: this.codingService.isCodingJobCompleted,
        isCodingJobPaused: this.codingService.isCodingJobPaused,
        isSubmittingJob: this.codingService.isSubmittingJob,
        isResumingJob: this.codingService.isResumingJob,
        isCodingJobFinalized: this.codingService.isCodingJobFinalized,
        isCompletedJobReview: this.codingService.isCompletedJobReview,
        isReviewMode: this.codingService.isReviewMode,
        hasSaveError: this.codingService.hasSaveError,
        lastSaveError: this.codingService.lastSaveError,
        currentCodingJobStatus: this.codingService.currentCodingJobStatus,
        showScore: this.codingService.showScore,
        allowComments: this.codingService.allowComments,
        suppressGeneralInstructions: this.codingService.suppressGeneralInstructions
      }
    };
  }

  private restoreCodingJobSwitchSnapshot(snapshot: ReplayCodingJobSwitchSnapshot): void {
    this.invalidateUnitPayloadRequests();
    this.cancelPendingAnchorHighlight();
    this.authToken = snapshot.authToken;
    this.workspaceId = snapshot.workspaceId;
    this.isCodingMode = snapshot.isCodingMode;
    this.isBookletReplayMode = snapshot.isBookletReplayMode;
    this.isReviewMode = snapshot.isReviewMode;
    this.unitsData = snapshot.unitsData;
    this.loadedCodingJobUnitsKey = snapshot.loadedCodingJobUnitsKey;
    this.codingProgressLoadedForJobKey = snapshot.codingProgressLoadedForJobKey;
    this.activeStatusUpdatedForJobKey = snapshot.activeStatusUpdatedForJobKey;
    this.selectedCodingJobKey = snapshot.selectedCodingJobKey;
    this.totalUnits = snapshot.totalUnits;
    this.currentUnitIndex = snapshot.currentUnitIndex;
    this.testPerson = snapshot.testPerson;
    this.unitId = snapshot.unitId;
    this.player = snapshot.player;
    this.unitDef = snapshot.unitDef;
    this.page = snapshot.page;
    this.anchor = snapshot.anchor;
    this.responses = snapshot.responses;
    this.serverTimings = snapshot.serverTimings;
    this.successStoredForCurrentReplay = snapshot.successStoredForCurrentReplay;
    this.reloadKey = snapshot.reloadKey;
    this.restoreCodingServiceSnapshot(snapshot.codingService);
  }

  private restoreCodingServiceSnapshot(snapshot: ReplayCodingServiceSnapshot): void {
    this.codingService.codingScheme = snapshot.codingScheme;
    this.codingService.currentVariableId = snapshot.currentVariableId;
    this.codingService.codingJobId = snapshot.codingJobId;
    this.codingService.selectedCodes = new Map(snapshot.selectedCodes);
    this.codingService.openUnitKeys = new Set(snapshot.openUnitKeys);
    this.codingService.notes = new Map(snapshot.notes);
    this.codingService.codingJobComment = snapshot.codingJobComment;
    this.codingService.isPausingJob = snapshot.isPausingJob;
    this.codingService.isCodingJobCompleted = snapshot.isCodingJobCompleted;
    this.codingService.isCodingJobPaused = snapshot.isCodingJobPaused;
    this.codingService.isSubmittingJob = snapshot.isSubmittingJob;
    this.codingService.isResumingJob = snapshot.isResumingJob;
    this.codingService.isCodingJobFinalized = snapshot.isCodingJobFinalized;
    this.codingService.isCompletedJobReview = snapshot.isCompletedJobReview;
    this.codingService.isReviewMode = snapshot.isReviewMode;
    this.codingService.hasSaveError = snapshot.hasSaveError;
    this.codingService.lastSaveError = snapshot.lastSaveError;
    this.codingService.currentCodingJobStatus = snapshot.currentCodingJobStatus;
    this.codingService.showScore = snapshot.showScore;
    this.codingService.allowComments = snapshot.allowComments;
    this.codingService.suppressGeneralInstructions = snapshot.suppressGeneralInstructions;
    this.codingService.setAuthToken(this.authToken);
  }

  private async getReplayAuthTokenForWorkspace(workspaceId: number): Promise<string> {
    if (workspaceId === this.workspaceId && this.authToken) {
      return this.authToken;
    }

    const token = await firstValueFrom(this.appService.createOwnToken(workspaceId, 1));
    if (!token) {
      throw new Error('TokenError');
    }
    return token;
  }

  private async saveCurrentCodingJobBeforeSwitch(): Promise<void> {
    if (
      !this.codingService.codingJobId ||
      !this.workspaceId ||
      this.isReviewMode ||
      this.codingService.isCompletedJobReview ||
      this.codingService.isCodingJobFinalized
    ) {
      return;
    }

    await this.codingService.flushPendingRowMutations();
    if (this.codingService.hasSaveError) {
      throw new Error('SaveError');
    }
    await this.codingService.saveAllCodingProgress(this.workspaceId, this.codingService.codingJobId);
  }

  private async activateCodingJob(
    job: CodingJob,
    unitsData: UnitsReplay,
    authToken: string,
    onlyOpen: boolean
  ): Promise<void> {
    const jobKey = this.getCodingJobOptionKey(job);
    this.resetReplayPayloadForCodingJobSwitch();
    this.authToken = authToken;
    this.codingService.setAuthToken(authToken);
    this.workspaceId = job.workspace_id;
    this.isCodingMode = true;
    this.isBookletReplayMode = false;
    this.isReviewMode = false;
    this.codingService.isReviewMode = false;
    this.unitsData = unitsData;
    this.loadedCodingJobUnitsKey = this.getCodingJobUnitsCacheKey(job.workspace_id, job.id, onlyOpen);
    this.totalUnits = unitsData.units.length;
    this.currentUnitIndex = 0;
    this.codingService.codingJobId = job.id;
    this.selectedCodingJobKey = jobKey;
    this.codingService.setCodingJobMetadata(job);

    await this.codingService.loadSavedCodingProgress(job.workspace_id, job.id);
    this.codingProgressLoadedForJobKey = jobKey;

    await this.applyUnitChanged(unitsData.units[0]);

    if (!this.codingService.isCompletedJobReview &&
      !this.codingService.isCodingJobFinalized &&
      this.activeStatusUpdatedForJobKey !== jobKey) {
      try {
        await this.codingService.updateCodingJobStatus(job.workspace_id, job.id, 'active');
        this.activeStatusUpdatedForJobKey = jobKey;
      } catch (error) {
        // The replay can continue even if the status marker could not be refreshed.
      }
    }

    if (!this.codingService.isCompletedJobReview) {
      this.codingService.checkCodingJobCompletion(this.unitsData);
    }
  }

  private resetReplayPayloadForCodingJobSwitch(): void {
    this.invalidateUnitPayloadRequests();
    this.cancelPendingAnchorHighlight();
    this.unitId = '';
    this.player = '';
    this.unitDef = '';
    this.page = undefined;
    this.anchor = undefined;
    this.responses = undefined;
    this.serverTimings = null;
    this.successStoredForCurrentReplay = false;
    this.unitsData = null;
    this.loadedCodingJobUnitsKey = null;
    this.codingProgressLoadedForJobKey = null;
    this.activeStatusUpdatedForJobKey = null;
    this.totalUnits = 0;
    this.currentUnitIndex = 0;
    this.codingService.resetCodingData();
  }

  private createUnitsReplayFromCodingJob(job: CodingJob, apiUnits: CodingJobUnitApi[]): UnitsReplay {
    return {
      id: job.id,
      name: job.name || `Coding-Job: ${job.id}`,
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
        variablePage: item.variablePage
      })),
      currentUnitIndex: 0
    };
  }

  private getCodingJobUnitsCacheKey(workspaceId: number, jobId: number, onlyOpen: boolean): string {
    return `${workspaceId}:${jobId}:${onlyOpen}`;
  }

  private updateReplayUrlForCodingJob(
    job: CodingJob,
    unit: UnitsReplayUnit,
    authToken: string,
    onlyOpen: boolean
  ): void {
    const unitAny = unit as UnitsReplayUnit & { variablePage?: string };
    const hashPath = [
      '#/replay',
      encodeURIComponent(unit.testPerson || this.testPerson),
      encodeURIComponent(unit.name),
      encodeURIComponent(unitAny.variablePage || '0'),
      encodeURIComponent(unit.variableAnchor || unit.variableId || '0')
    ].join('/');
    const queryParams = new URLSearchParams({
      auth: authToken,
      mode: 'coding',
      codingJobId: String(job.id),
      workspaceId: String(job.workspace_id)
    });
    if (onlyOpen) {
      queryParams.set('onlyOpen', 'true');
    }

    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${window.location.search}${hashPath}?${queryParams.toString()}`
    );
  }
}
