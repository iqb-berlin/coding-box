import {
  Component, OnChanges, OnDestroy, OnInit, SimpleChanges, ViewChild, HostListener, inject,
  input
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute, Params } from '@angular/router';
import {
  combineLatest, firstValueFrom, Observable, of, Subject, Subscription, switchMap, catchError
} from 'rxjs';
import * as xml2js from 'xml2js';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { logger } from 'nx/src/utils/logger';
import { UnitPlayerComponent } from '../unit-player/unit-player.component';
import { FileService } from '../../../shared/services/file/file.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { FileBackendService } from '../../../shared/services/file/file-backend.service';
import { ReplayBackendService } from '../../services/replay-backend.service';
import { AppService } from '../../../core/services/app.service';
import { ResponseDto } from '../../../../../../../api-dto/responses/response-dto';
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
  private responseService = inject(ResponseService);
  private fileBackendService = inject(FileBackendService);
  private replayBackendService = inject(ReplayBackendService);
  private appService = inject(AppService);
  private route = inject(ActivatedRoute);
  private errorSnackBar = inject(MatSnackBar);
  private pageErrorSnackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  codingService = inject(ReplayCodingService);

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
  currentUnitIndex: number = 0;
  totalUnits: number = 0;
  private authToken: string = '';
  private errorSnackbarRef: MatSnackBarRef<TextOnlySnackBar> | null = null;
  private pageErrorSnackbarRef: MatSnackBarRef<TextOnlySnackBar> | null = null;
  private lastPlayer: { id: string, data: string } = { id: '', data: '' };
  private lastUnitDef: { id: string, data: string } = { id: '', data: '' };
  private lastUnit: { id: string, data: string } = { id: '', data: '' };
  private lastVocs: { id: string, data: string } = { id: '', data: '' };
  private routerSubscription: Subscription | null = null;
  readonly testPersonInput = input<string>();
  readonly unitIdInput = input<string>();
  protected unitsData: UnitsReplay | null = null;
  @ViewChild(UnitPlayerComponent) unitPlayerComponent: UnitPlayerComponent | undefined;
  private replayStartTime: number = 0; // Track when replay viewing starts
  protected reloadKey: number = 0;
  workspaceId: number = 0;

  ngOnInit(): void {
    this.replayStartTime = performance.now();
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
        this.resetSnackBars();
        this.resetUnitData();
        this.authToken = await this.getAuthToken();
        let workspace: string | undefined;
        try {
          const decoded: JwtPayload & { workspace: string } = jwtDecode(this.authToken);
          workspace = decoded?.workspace;
        } catch (error) {
          workspace = undefined;
        }
        this.workspaceId = Number(workspace);

        const queryParams = await firstValueFrom(this.route.queryParams);
        this.isCodingMode = queryParams.mode === 'coding';
        this.isBookletReplayMode = queryParams.mode === 'booklet-view';
        if (this.isCodingMode) {
          let deserializedUnits = null as UnitsReplay | null;

          if (queryParams.unitsData) {
            deserializedUnits = this.deserializeUnitsData(queryParams.unitsData);
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
            this.codingService.codingJobId = deserializedUnits.id || null;
            this.currentUnitIndex = deserializedUnits.currentUnitIndex;
            this.totalUnits = deserializedUnits.units.length;
            const unitAny = (this.unitsData.units[this.currentUnitIndex] || {}) as unknown as { variableAnchor?: string; variableId?: string };
            if (unitAny.variableAnchor) {
              this.anchor = unitAny.variableAnchor;
            }
            if (unitAny.variableId) {
              this.codingService.currentVariableId = unitAny.variableId || '';
            }
            if (this.codingService.codingJobId && this.workspaceId) {
              const jobId = this.codingService.codingJobId;
              this.codingService.updateCodingJobStatus(this.workspaceId, jobId, 'active');
              await this.codingService.loadSavedCodingProgress(this.workspaceId, jobId);
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
            const unitData = await this.getUnitData(Number(workspace), this.authToken);
            this.setUnitProperties(unitData);
          } else if (Object.keys(params).length >= 3 && Object.keys(params).length <= 4) {
            this.setUnitParams(params);
            if (this.authToken) {
              if (workspace) {
                const unitData = await this.getUnitData(Number(workspace), this.authToken);
                this.setUnitProperties(unitData);
                setTimeout(() => {
                  if (this.unitPlayerComponent?.hostingIframe?.nativeElement) {
                    if (this.anchor) {
                      highlightAspectSectionWithAnchor(this.unitPlayerComponent.hostingIframe.nativeElement, this.anchor);
                      scrollToElementByAlias(this.unitPlayerComponent.hostingIframe.nativeElement, this.anchor);
                    }
                  }
                }, 1000);
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

  private checkUnitId(unitFile: FilesDto[]): void {
    if (!unitFile || !unitFile[0]) {
      this.storeErrorInStatistics('UnitIdError');
      ReplayComponent.throwError('UnitIdError');
    } else {
      this.cacheUnitData(unitFile[0]);
    }
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
        this.unitId = unitIdInput.currentValue;
        this.setTestPerson(this.testPersonInput() || '');
        const unitData = await this.getUnitData(this.appService.selectedWorkspaceId, this.authToken);
        this.setUnitProperties(unitData);
      } catch (error) {
        this.setIsLoaded();
        this.catchError(error as HttpErrorResponse);
      }
    }

    return Promise.resolve();
  }

  private setUnitProperties(
    unitData: {
      unitDef: FilesDto[],
      response: ResponseDto[],
      player: FilesDto[],
      vocs: FilesDto[]
    }
  ) {
    this.cachePlayerData(unitData.player[0]);
    this.cacheUnitDefData(unitData.unitDef[0]);
    if (unitData.vocs && unitData.vocs[0]) {
      this.cacheVocsData(unitData.vocs[0]);
    }
    this.player = unitData.player[0].data;
    this.unitDef = unitData.unitDef[0].data;
    this.reloadKey += 1;
    this.responses = unitData.response;

    if (this.isCodingMode && unitData.vocs && unitData.vocs[0] && unitData.vocs[0].data) {
      this.codingService.setCodingSchemeFromVocsData(unitData.vocs[0].data);
    } else if (this.isCodingMode && !this.codingService.codingScheme) {
      this.loadCodingSchemeForCodingJob();
    }
  }

  private cacheUnitData(unit: FilesDto) {
    this.lastUnit.data = unit.data;
    this.lastUnit.id = unit.file_id;
  }

  private cacheUnitDefData(unitDef: FilesDto) {
    this.lastUnitDef.data = unitDef.data;
    const extensionIndex = unitDef.file_id.toUpperCase().lastIndexOf('.VOUD');
    this.lastUnitDef.id = extensionIndex > -1 ?
      unitDef.file_id.substring(0, extensionIndex) :
      unitDef.file_id;
  }

  private cachePlayerData(playerData: FilesDto) {
    this.lastPlayer.data = playerData.data;
    this.lastPlayer.id = playerData.file_id;
  }

  private cacheVocsData(vocsData: FilesDto) {
    this.lastVocs.data = vocsData.data;
    const extensionIndex = vocsData.file_id.toLowerCase().lastIndexOf('.vocs');
    this.lastVocs.id = extensionIndex > -1 ?
      vocsData.file_id.substring(0, extensionIndex) :
      vocsData.file_id;
  }

  static getNormalizedPlayerId(name: string): string {
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;
    const matches = name.match(reg);
    if (matches) {
      const rawIdParts = {
        module: matches[1] || '',
        full: matches[2] || '',
        major: parseInt(matches[3], 10) || 0,
        minor: (typeof matches[4] === 'string') ? parseInt(matches[4].substring(1), 10) : 0,
        patch: (typeof matches[5] === 'string') ? parseInt(matches[5].substring(1), 10) : 0,
        label: (typeof matches[6] === 'string') ? matches[6].substring(1) : ''
      };
      return `${rawIdParts.module}-${rawIdParts.major}.${rawIdParts.minor}.${rawIdParts.patch}`.toUpperCase();
    }
    ReplayComponent.throwError('PlayerError');
    return '';
  }

  private getUnitDef(workspace: number, authToken?: string): Observable<FilesDto[]> {
    if (this.lastUnitDef.id && this.lastUnitDef.data && this.lastUnitDef.id === this.unitId.toUpperCase()) {
      return of([{
        data: this.lastUnitDef.data,
        file_id: `${this.lastUnitDef.id}.VOUD`
      }]);
    }
    return this.fileService.getUnitDef(workspace, this.unitId, authToken);
  }

  private getResponses(workspace: number, authToken?: string): Observable<ResponseDto[]> {
    if (this.isPrintMode) {
      return of([]);
    }
    return this.responseService
      .getResponses(workspace, this.testPerson, this.unitId, authToken);
  }

  private getUnit(workspace: number, authToken?: string): Observable<FilesDto[]> {
    if (this.lastUnit.id && this.lastUnit.data && this.lastUnit.id === this.unitId.toUpperCase()) {
      return of([{
        data: this.lastUnit.data,
        file_id: this.lastUnit.id
      }]);
    }
    return this.fileService.getUnit(workspace, this.unitId, authToken);
  }

  private getVocs(workspace: number): Observable<FilesDto[]> {
    if (this.lastVocs.id && this.lastVocs.data && this.lastVocs.id === this.unitId.toUpperCase()) {
      return of([{
        data: this.lastVocs.data,
        file_id: `${this.lastVocs.id}.vocs`
      }]);
    }
    return this.fileBackendService.getVocs(workspace, this.unitId);
  }

  private getPlayer(
    workspace: number, player: string, authToken?: string
  ): Observable<FilesDto[]> {
    if (this.lastPlayer.id && this.lastPlayer.data && this.lastPlayer.id === player) {
      return of([{ data: this.lastPlayer.data, file_id: this.lastPlayer.id }]);
    }
    return this.fileService.getPlayer(
      workspace,
      player,
      authToken);
  }

  private async getUnitData(
    workspace: number,
    authToken?: string
  ): Promise<{
      unitDef: FilesDto[],
      response: ResponseDto[],
      player: FilesDto[],
      vocs: FilesDto[]
    }> {
    const startTime = performance.now();
    this.isLoaded.next(false);
    const unitData = await firstValueFrom(
      combineLatest([
        this.getUnitDef(workspace, authToken),
        this.getResponses(workspace, authToken).pipe(catchError(() => of([]))),
        this.getVocs(workspace).pipe(catchError(() => of([]))),
        this.getUnit(workspace, authToken)
          .pipe(switchMap(unitFile => {
            this.checkUnitId(unitFile);
            let player = '';
            xml2js.parseString(unitFile[0].data, (err: any, result: any) => {
              player = result?.Unit.DefinitionRef[0].$.player;
            });
            return this.getPlayer(workspace, ReplayComponent.getNormalizedPlayerId(player), authToken);
          }))
      ]));
    const endTime = performance.now();
    const duration = Math.floor(endTime - startTime);
    if (duration) {
      if (duration >= 1) {
        try {
          let testPersonLogin: string | undefined;
          let testPersonCode: string | undefined;
          let bookletId: string | undefined;

          if (this.testPerson) {
            const parts = this.testPerson.split('@');
            if (parts.length >= 3) {
              testPersonLogin = parts[0];
              testPersonCode = parts[1];
              // Support both old format (3 parts: login@code@booklet) and new format (4 parts: login@code@group@booklet)
              bookletId = parts.length === 4 ? parts[3] : parts[2];
            }
          }
          if (authToken) {
            try {
              const decoded: JwtPayload & { workspace: string } = jwtDecode(authToken);
              const workspaceId = Number(decoded?.workspace);
              if (workspaceId) {
                const replayUrl = window.location.href;

                this.replayBackendService.storeReplayStatistics(workspaceId, {
                  unitId: this.unitId,
                  bookletId,
                  testPersonLogin,
                  testPersonCode,
                  durationMilliseconds: duration,
                  replayUrl,
                  success: true
                }).subscribe({
                  next: () => {
                    logger.log(`Replay statistics stored successfully. Duration: ${duration}ms`);
                  },
                  error: error => {
                    logger.error(`Error storing replay statistics: ${error}`);
                  }
                });
              }
            } catch (error) {
              logger.error(`Error decoding auth token: ${error}`);
            }
          }
        } catch (error) {
          logger.error(`Error storing replay statistics: ${error}`);
        }
      }

      this.replayStartTime = performance.now();
    }

    this.setIsLoaded();
    return {
      unitDef: unitData[0],
      response: unitData[1],
      vocs: unitData[2],
      player: unitData[3]
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
  }

  private storeErrorInStatistics(errorMessage: string): void {
    const duration = this.replayStartTime ? Math.round(performance.now() - this.replayStartTime) : 0;
    const authToken = localStorage.getItem('authToken');
    if (!authToken) return;

    try {
      const decoded: JwtPayload & { workspace: string } = jwtDecode(authToken);
      const workspaceId = Number(decoded?.workspace);
      if (!workspaceId) return;

      let testPersonLogin = '';
      let testPersonCode = '';
      let bookletId = '';

      if (this.testPerson) {
        const parts = this.testPerson.split('@');
        if (parts.length >= 3) {
          testPersonLogin = parts[0];
          testPersonCode = parts[1];
          // Support both old format (3 parts: login@code@booklet) and new format (4 parts: login@code@group@booklet)
          bookletId = parts.length === 4 ? parts[3] : parts[2];
        }
      }
      const replayUrl = window.location.href;

      this.replayBackendService.storeReplayStatistics(workspaceId, {
        unitId: this.unitId || 'unknown',
        bookletId,
        testPersonLogin,
        testPersonCode,
        durationMilliseconds: duration,
        replayUrl,
        success: false,
        errorMessage: errorMessage
      }).subscribe({
        next: () => {
          logger.log('Error replay statistics stored successfully.');
        },
        error: error => {
          logger.error(`Error storing replay error statistics: ${error}`);
        }
      });
    } catch (error) {
      logger.error(`Error storing replay error statistics: ${error}`);
    }
  }

  async handleUnitChanged(unit: UnitsReplayUnit): Promise<void> {
    if (!unit) return;
    const unitAny = unit as unknown as { name: string; testPerson?: string; variableId?: string };
    const incomingTestPerson = unitAny.testPerson;

    if (typeof unitAny.variableId === 'string' && unitAny.variableId.length > 0) {
      this.anchor = unitAny.variableId;
      this.codingService.currentVariableId = unitAny.variableId;
    }

    if (incomingTestPerson && incomingTestPerson !== this.testPerson) {
      this.setTestPerson(incomingTestPerson);
    }
    this.unitId = unit.name;

    if (this.authToken) {
      let workspace: string | undefined;
      try {
        const decoded: JwtPayload & { workspace: string } = jwtDecode(this.authToken);
        workspace = decoded?.workspace;
      } catch (error) {
        workspace = undefined;
      }
      if (workspace) {
        this.getUnitData(Number(workspace), this.authToken).then(unitData => {
          this.setUnitProperties(unitData);
          setTimeout(() => {
            if (this.unitPlayerComponent?.hostingIframe?.nativeElement && this.anchor) {
              highlightAspectSectionWithAnchor(this.unitPlayerComponent.hostingIframe.nativeElement, this.anchor);
              scrollToElementByAlias(this.unitPlayerComponent.hostingIframe.nativeElement, this.anchor);
            }
          }, 500);
        });
      }
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
    this.unitId = '';
    this.player = '';
    this.unitDef = '';
    this.page = undefined;
    this.responses = undefined;
    this.codingService.resetCodingData();
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.routerSubscription = null;
    this.resetSnackBars();
  }

  async onCodeSelected(event: { variableId: string; code: any }): Promise<void> {
    await this.codingService.handleCodeSelected(event, this.testPerson, this.unitId, this.workspaceId, this.unitsData);
  }

  getCoderNotes(): string {
    return this.codingService.getNotes(this.testPerson, this.unitId, this.codingService.currentVariableId);
  }

  onNotesChanged(notes: string): void {
    this.codingService.saveNotes(
      this.workspaceId,
      this.testPerson,
      this.unitId,
      this.codingService.currentVariableId,
      notes
    );
  }

  getCompletedCount(): number {
    return this.codingService.getCompletedCount(this.unitsData);
  }

  getOpenCount(): number {
    return this.codingService.getOpenCount();
  }

  getProgressPercentage(): number {
    return this.codingService.getProgressPercentage(this.unitsData);
  }

  getPreSelectedCodeId(variableId: string): number | null {
    return this.codingService.getPreSelectedCodeId(this.testPerson, this.unitId, variableId);
  }

  getPreSelectedCodingIssueOptionId(variableId: string): number | null {
    return this.codingService.getPreSelectedCodingIssueOptionId(this.testPerson, this.unitId, variableId);
  }

  pauseCodingJob(): void {
    if (this.codingService.codingJobId) {
      this.codingService.pauseCodingJob(this.workspaceId, this.codingService.codingJobId);
    }
  }

  resumeCodingJob(): void {
    if (this.codingService.codingJobId) {
      this.codingService.resumeCodingJob(this.workspaceId, this.codingService.codingJobId);
    }
  }

  async submitCodingJob(): Promise<void> {
    if (this.codingService.codingJobId) {
      await this.codingService.saveAllCodingProgress(this.workspaceId, this.codingService.codingJobId);
      this.codingService.submitCodingJob(this.workspaceId, this.codingService.codingJobId);
    }
  }

  dismissCompletionOverlay(): void {
    // Allow users to continue navigating through cases even after job completion
    this.codingService.isCodingJobCompleted = false;
  }

  openCommentDialog(): void {
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
    if (!this.unitsData) return;

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
    if (this.isCodingMode && this.unitsData) {
      // Check for Enter key - navigate to next unit (existing functionality)
      if (keyboardEvent.key === 'Enter' && this.codingService.currentVariableId) {
        const compositeKey = this.codingService.generateCompositeKey(this.testPerson, this.unitId, this.codingService.currentVariableId);
        const hasSelection = this.codingService.selectedCodes.has(compositeKey);

        if (hasSelection) {
          keyboardEvent.preventDefault();
          const currentIndex = this.unitsData.currentUnitIndex;
          const nextIndex = this.codingService.getNextJumpableUnitIndex(this.unitsData, currentIndex);
          if (nextIndex >= 0 && nextIndex < this.unitsData.units.length) {
            this.handleUnitChanged(this.unitsData.units[nextIndex]);
          }
        }
      } else if (keyboardEvent.key === 'ArrowRight') {
        keyboardEvent.preventDefault();
        const compositeKey = this.codingService.generateCompositeKey(this.testPerson, this.unitId, this.codingService.currentVariableId);
        const hasSelection = this.codingService.selectedCodes.has(compositeKey);

        if (hasSelection || this.codingService.isCodingJobFinalized) {
          const currentIndex = this.unitsData.currentUnitIndex;
          const nextIndex = this.codingService.getNextJumpableUnitIndex(this.unitsData, currentIndex);
          if (nextIndex >= 0 && nextIndex < this.unitsData.units.length) {
            this.handleUnitChanged(this.unitsData.units[nextIndex]);
          }
        }
      } else if (keyboardEvent.key === 'ArrowLeft' && this.unitsData.currentUnitIndex > 0) {
        keyboardEvent.preventDefault();
        const prevIndex = this.unitsData.currentUnitIndex - 1;
        if (prevIndex >= 0) {
          this.handleUnitChanged(this.unitsData.units[prevIndex]);
        }
      } else if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(keyboardEvent.key) && this.codingService.currentVariableId) {
        keyboardEvent.preventDefault();
        const codeId = parseInt(keyboardEvent.key, 10);
        if (this.codingService.codingScheme) {
          const variableCoding = this.codingService.codingScheme.variableCodings.find((v: any) => v.alias === this.codingService.currentVariableId);
          if (variableCoding) {
            const code = variableCoding.codes.find((c: any) => c.id === codeId);
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

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(): void {
    if (this.codingService.codingJobId && this.workspaceId && !this.codingService.isCodingJobCompleted) {
      this.codingService.updateCodingJobStatus(this.workspaceId, this.codingService.codingJobId, 'paused');
    }
  }

  private loadCodingSchemeForCodingJob(): void {
    if (!this.unitDef) return;

    const codingSchemeRef = this.extractCodingSchemeRefFromXml(this.unitDef);
    if (codingSchemeRef) {
      this.fileService.getCodingSchemeFile(this.workspaceId, codingSchemeRef)
        .pipe(catchError(() => of(null)))
        .subscribe(fileData => {
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
