import {
  Component, OnChanges, OnDestroy, OnInit, SimpleChanges, ViewChild, inject,
  input
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
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
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { ResponseDto } from '../../../../../../../api-dto/responses/response-dto';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FilesDto } from '../../../../../../../api-dto/files/files.dto';
import { ErrorMessages } from '../../models/error-messages.model';
import { validateToken, isTestperson } from '../../utils/token-utils';
import { scrollToElementByAlias, highlightAspectSectionWithAnchor } from '../../utils/dom-utils';
import { UnitsReplay, UnitsReplayUnit } from '../../../services/units-replay.service';
import { UnitsReplayComponent } from '../units-replay/units-replay.component';
import { CodeSelectorComponent, Code, VariableCoding } from '../../../coding/components/code-selector/code-selector.component';

interface SavedCode {
  id: number;
  code: string;
  label: string;
  [key: string]: unknown;
}

@Component({
  selector: 'coding-box-replay',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
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
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private route = inject(ActivatedRoute);
  private errorSnackBar = inject(MatSnackBar);
  private pageErrorSnackBar = inject(MatSnackBar);

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
  isBookletMode: boolean = false;
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
  protected codingScheme: any | null = null;
  protected currentVariableId: string = '';
  workspaceId: number = 0;
  private selectedCodes: Map<string, any> = new Map(); // Track selected codes for each unique testperson-booklet-unit-variable combination
  protected codingJobId: number | null = null;
  protected isPausingJob: boolean = false;
  protected isCodingJobCompleted: boolean = false;
  protected isSubmittingJob: boolean = false;

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
      const jsonString = atob(encodedData);
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
        const decoded: JwtPayload & { workspace: string } = jwtDecode(this.authToken);
        const workspace = decoded?.workspace;
        this.workspaceId = Number(workspace);

        const queryParams = await firstValueFrom(this.route.queryParams);
        this.isBookletMode = queryParams.mode === 'booklet';
        if (this.isBookletMode) {
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
            } finally {
              try { localStorage.removeItem(key); } catch { /* empty */ }
            }
          }

          if (deserializedUnits) {
            this.unitsData = deserializedUnits;
            this.codingJobId = deserializedUnits.id || null;
            this.currentUnitIndex = deserializedUnits.currentUnitIndex;
            this.totalUnits = deserializedUnits.units.length;
            const unitAny = (this.unitsData.units[this.currentUnitIndex] || {}) as unknown as { variableAnchor?: string; variableId?: string };
            if (unitAny.variableAnchor) {
              this.anchor = unitAny.variableAnchor;
            }
            if (unitAny.variableId) {
              this.currentVariableId = unitAny.variableId;
            }
            if (this.codingJobId && this.workspaceId) {
              this.backendService.updateCodingJob(this.workspaceId, this.codingJobId, { status: 'active' }).subscribe({
                next: () => {
                  // Status updated successfully
                },
                error: () => {
                  // Status update failed
                }
              });
              this.loadSavedCodingProgress();
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

    // Set coding scheme for booklet mode from vocs data
    if (this.isBookletMode && unitData.vocs && unitData.vocs[0] && unitData.vocs[0].data) {
      try {
        this.codingScheme = JSON.parse(unitData.vocs[0].data);
      } catch (error) {
        this.codingScheme = null;
      }
    }
  }

  private cacheUnitData(unit: FilesDto) {
    this.lastUnit.data = unit.data;
    this.lastUnit.id = unit.file_id;
  }

  private cacheUnitDefData(unitDef: FilesDto) {
    this.lastUnitDef.data = unitDef.data;
    this.lastUnitDef.id = unitDef.file_id.substring(0, unitDef.file_id.indexOf('.VOUD'));
  }

  private cachePlayerData(playerData: FilesDto) {
    this.lastPlayer.data = playerData.data;
    this.lastPlayer.id = playerData.file_id;
  }

  private cacheVocsData(vocsData: FilesDto) {
    this.lastVocs.data = vocsData.data;
    this.lastVocs.id = vocsData.file_id.substring(0, vocsData.file_id.indexOf('.vocs'));
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
      return `${rawIdParts.module}-${rawIdParts.major}.${rawIdParts.minor}`.toUpperCase();
    }
    ReplayComponent.throwError('PlayerError');
    return '';
  }

  private getUnitDef(workspace: number, authToken?:string): Observable<FilesDto[]> {
    if (this.lastUnitDef.id && this.lastUnitDef.data && this.lastUnitDef.id === this.unitId.toUpperCase()) {
      return of([{
        data: this.lastUnitDef.data,
        file_id: `${this.lastUnitDef.id}.VOUD`
      }]);
    }
    return this.backendService.getUnitDef(workspace, this.unitId, authToken);
  }

  private getResponses(workspace: number, authToken?:string): Observable<ResponseDto[]> {
    if (this.isPrintMode) {
      return of([]);
    }
    return this.backendService
      .getResponses(workspace, this.testPerson, this.unitId, authToken);
  }

  private getUnit(workspace: number, authToken?:string): Observable<FilesDto[]> {
    if (this.lastUnit.id && this.lastUnit.data && this.lastUnit.id === this.unitId.toUpperCase()) {
      return of([{
        data: this.lastUnit.data,
        file_id: this.lastUnit.id
      }]);
    }
    return this.backendService.getUnit(workspace, this.unitId, authToken);
  }

  private getVocs(workspace: number, authToken?:string): Observable<FilesDto[]> {
    if (this.lastVocs.id && this.lastVocs.data && this.lastVocs.id === this.unitId.toUpperCase()) {
      return of([{
        data: this.lastVocs.data,
        file_id: `${this.lastVocs.id}.vocs`
      }]);
    }
    return this.backendService.getVocs(workspace, this.unitId, authToken);
  }

  private getPlayer(
    workspace: number, player: string, authToken?:string
  ): Observable<FilesDto[]> {
    if (this.lastPlayer.id && this.lastPlayer.data && this.lastPlayer.id === player) {
      return of([{ data: this.lastPlayer.data, file_id: this.lastPlayer.id }]);
    }
    return this.backendService.getPlayer(
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
        this.getVocs(workspace, authToken).pipe(catchError(() => of([]))),
        this.getUnit(workspace, authToken)
          .pipe(switchMap(unitFile => {
            this.checkUnitId(unitFile);
            let player = '';
            xml2js.parseString(unitFile[0].data, (err:any, result:any) => {
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
            if (parts.length > 0) {
              testPersonLogin = parts[0];
              testPersonCode = parts[1];
              bookletId = parts[2];
            }
          }
          if (authToken) {
            try {
              const decoded: JwtPayload & { workspace: string } = jwtDecode(authToken);
              const workspaceId = Number(decoded?.workspace);
              if (workspaceId) {
                const replayUrl = window.location.href;

                this.backendService.storeReplayStatistics(workspaceId, {
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
        const parts = this.testPerson.split(':');
        if (parts.length > 0) {
          testPersonLogin = parts[0];
          testPersonCode = parts[1];
          bookletId = parts[2];
        }
      }
      const replayUrl = window.location.href;

      this.backendService.storeReplayStatistics(workspaceId, {
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

  handleUnitChanged(unit: UnitsReplayUnit): void {
    if (!unit) return;

    // Save current partial results before navigating to next unit
    this.saveAllCodingProgress().then(() => {
      const unitAny = unit as unknown as { name: string; testPerson?: string; variableId?: string };
      const incomingTestPerson = unitAny.testPerson;

      if (typeof unitAny.variableId === 'string' && unitAny.variableId.length > 0) {
        this.anchor = unitAny.variableId;
        this.currentVariableId = unitAny.variableId;
      }

      if (incomingTestPerson && incomingTestPerson !== this.testPerson) {
        this.setTestPerson(incomingTestPerson);
      }
      this.unitId = unit.name;

      if (this.authToken) {
        const decoded: JwtPayload & { workspace: string } = jwtDecode(this.authToken);
        const workspace = decoded?.workspace;
        if (workspace) {
          this.getUnitData(Number(workspace), this.authToken).then(unitData => {
            this.setUnitProperties(unitData);
            // After loading new unit data, try to highlight using current anchor
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
    }).catch(() => {
      const unitAny = unit as unknown as { name: string; testPerson?: string; variableId?: string };
      const incomingTestPerson = unitAny.testPerson;

      if (typeof unitAny.variableId === 'string' && unitAny.variableId.length > 0) {
        this.anchor = unitAny.variableId;
        this.currentVariableId = unitAny.variableId;
      }

      if (incomingTestPerson && incomingTestPerson !== this.testPerson) {
        this.setTestPerson(incomingTestPerson);
      }
      this.unitId = unit.name;

      if (this.authToken) {
        const decoded: JwtPayload & { workspace: string } = jwtDecode(this.authToken);
        const workspace = decoded?.workspace;
        if (workspace) {
          this.getUnitData(Number(workspace), this.authToken).then(unitData => {
            this.setUnitProperties(unitData);
            // After loading new unit data, try to highlight using current anchor
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
    });
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
    this.codingScheme = null;
    this.currentVariableId = '';
  }

  private async loadSavedCodingProgress(): Promise<void> {
    if (!this.codingJobId || !this.workspaceId) return;

    try {
      const savedProgress = await firstValueFrom(
        this.backendService.getCodingProgress(this.workspaceId, this.codingJobId)
      ) as { [key: string]: SavedCode };

      Object.keys(savedProgress).forEach(compositeKey => {
        const partialCode = savedProgress[compositeKey];
        if (partialCode?.id) {
          const fullCode = this.findCodeById(partialCode.id);
          this.selectedCodes.set(compositeKey, fullCode || partialCode);
        }
      });

      if (this.unitsData && this.unitsData.units.length > 0) {
        const firstUncodedIndex = this.findFirstUncodedUnitIndex();
        if (firstUncodedIndex >= 0 && firstUncodedIndex !== this.currentUnitIndex) {
          this.navigateToUnitIndex(firstUncodedIndex);
        }
      }
    } catch (error) {
      // Ignore errors when loading saved coding progress
    }
  }

  private findCodeById(codeId: number): any {
    if (!this.codingScheme || typeof this.codingScheme === 'string') {
      return null;
    }

    const variableCoding = this.codingScheme.variableCodings?.find((v: VariableCoding) => v.alias === this.currentVariableId
    );

    if (variableCoding) {
      return variableCoding.codes?.find((c: Code) => c.id === codeId);
    }

    return null;
  }

  private async saveCodingProgress(testPerson: string, unitId: string, variableId: string, selectedCode: any): Promise<void> {
    if (!this.codingJobId || !this.workspaceId) return;

    try {
      const codeToSave = {
        id: selectedCode.id,
        code: selectedCode.code || '',
        label: selectedCode.label || '',
        ...(selectedCode.score !== undefined && { score: selectedCode.score })
      };

      await firstValueFrom(
        this.backendService.saveCodingProgress(this.workspaceId, this.codingJobId, {
          testPerson,
          unitId,
          variableId,
          selectedCode: codeToSave
        })
      );
    } catch (error) {
      // Ignore errors when saving coding progress
    }
  }

  private async saveAllCodingProgress(): Promise<void> {
    if (!this.codingJobId || !this.workspaceId) return;

    const savePromises: Promise<void>[] = [];

    for (const [compositeKey, selectedCode] of this.selectedCodes) {
      const parts = compositeKey.split('::');
      if (parts.length >= 4) {
        const testPerson = parts[0];
        const unitId = parts[2];
        const variableId = parts[3];

        savePromises.push(this.saveCodingProgress(testPerson, unitId, variableId, selectedCode));
      }
    }
    await Promise.allSettled(savePromises);
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.routerSubscription = null;
    this.resetSnackBars();
  }

  onCodeSelected(event: { variableId: string; code: any }): void {
    const compositeKey = this.generateCompositeKey(this.testPerson, this.unitId, event.variableId);
    this.selectedCodes.set(compositeKey, event.code);
    this.checkCodingJobCompletion();
    this.saveCodingProgress(this.testPerson, this.unitId, event.variableId, event.code);
  }

  private generateCompositeKey(testPerson: string, unitId: string, variableId: string): string {
    let bookletId = 'default';
    if (testPerson) {
      const parts = testPerson.split('@');
      if (parts.length >= 3) {
        bookletId = parts[2];
      }
    }

    return `${testPerson}::${bookletId}::${unitId}::${variableId}`;
  }

  private checkCodingJobCompletion(): void {
    if (this.unitsData && this.unitsData.units.length > 0) {
      const totalReplays = this.unitsData.units.length;
      const completedReplays = this.unitsData.units.filter(unit => {
        const unitAny = unit as unknown as { name: string; testPerson?: string; variableId?: string };
        if (unitAny.variableId) {
          const compositeKey = this.generateCompositeKey(
            unitAny.testPerson || this.testPerson,
            unitAny.name || this.unitId,
            unitAny.variableId
          );
          return this.selectedCodes.has(compositeKey);
        }
        return false;
      }).length;

      const progressPercentage = Math.round((completedReplays / totalReplays) * 100);
      if (completedReplays > 0 && completedReplays % Math.ceil(totalReplays / 4) === 0) {
        this.showProgressNotification(progressPercentage, completedReplays, totalReplays);
      }

      // Check if job is complete
      if (completedReplays === totalReplays) {
        this.isCodingJobCompleted = true;
      }
    }
  }

  private showProgressNotification(percentage: number, completed: number, total: number): void {
    this.errorSnackBar.open(
      `Coding Progress: ${completed}/${total} completed (${percentage}%)`,
      'Close',
      { duration: 3000, panelClass: ['snackbar-info'] }
    );
  }

  private showCompletionNotification(): void {
    this.errorSnackBar.open(
      '🎉 Coding job completed! All replays have been coded.',
      'Close',
      { duration: 5000, panelClass: ['snackbar-success'] }
    );
  }

  getCompletedCount(): number {
    if (!this.unitsData) return 0;
    return this.unitsData.units.filter(unit => {
      const unitAny = unit as unknown as { name: string; testPerson?: string; variableId?: string };
      if (unitAny.variableId) {
        const compositeKey = this.generateCompositeKey(
          unitAny.testPerson || this.testPerson,
          unitAny.name || this.unitId,
          unitAny.variableId
        );
        return this.selectedCodes.has(compositeKey);
      }
      return false;
    }).length;
  }

  getProgressPercentage(): number {
    if (!this.unitsData || this.unitsData.units.length === 0) return 0;
    return Math.round((this.getCompletedCount() / this.unitsData.units.length) * 100);
  }

  getPreSelectedCodeId(variableId: string): number | null {
    const compositeKey = this.generateCompositeKey(this.testPerson, this.unitId, variableId);
    const selectedCode = this.selectedCodes.get(compositeKey);
    return selectedCode ? selectedCode.id : null;
  }

  pauseCodingJob(): void {
    if (!this.codingJobId || !this.workspaceId) return;

    this.isPausingJob = true;
    this.errorSnackBar.open('Pausing coding job...', '', { duration: 2000 });

    this.backendService.updateCodingJob(this.workspaceId, this.codingJobId, { status: 'paused' }).subscribe({
      next: () => {
        this.isPausingJob = false;
        this.errorSnackBar.open('Coding job paused successfully', 'Close', {
          duration: 3000,
          panelClass: ['snackbar-success']
        });
      },
      error: () => {
        this.isPausingJob = false;
        this.errorSnackBar.open('Failed to pause coding job', 'Close', {
          duration: 3000,
          panelClass: ['snackbar-error']
        });
      }
    });
  }

  submitCodingJob(): void {
    if (!this.codingJobId || !this.workspaceId) return;

    this.isSubmittingJob = true;
    this.errorSnackBar.open('Submitting coding job...', '', { duration: 2000 });

    this.backendService.updateCodingJob(this.workspaceId, this.codingJobId, { status: 'finished' }).subscribe({
      next: () => {
        this.isSubmittingJob = false;
        this.errorSnackBar.open('Coding job submitted successfully', 'Close', {
          duration: 3000,
          panelClass: ['snackbar-success']
        });
        window.close();
      },
      error: () => {
        this.isSubmittingJob = false;
        this.errorSnackBar.open('Failed to submit coding job', 'Close', {
          duration: 3000,
          panelClass: ['snackbar-error']
        });
      }
    });
  }

  private findFirstUncodedUnitIndex(): number {
    if (!this.unitsData) return -1;

    for (let i = 0; i < this.unitsData.units.length; i++) {
      const unit = this.unitsData.units[i];
      const unitAny = unit as unknown as { name: string; testPerson?: string; variableId?: string };

      if (unitAny.variableId) {
        const compositeKey = this.generateCompositeKey(
          unitAny.testPerson || this.testPerson,
          unitAny.name,
          unitAny.variableId
        );

        if (!this.selectedCodes.has(compositeKey)) {
          return i;
        }
      }
    }

    // If all units are coded, return -1
    return -1;
  }

  private navigateToUnitIndex(index: number): void {
    if (!this.unitsData || index < 0 || index >= this.unitsData.units.length) return;

    const targetUnit = this.unitsData.units[index];
    if (targetUnit) {
      this.handleUnitChanged(targetUnit);
    }
  }

  private navigateToNextUnit(): void {
    if (!this.unitsData || !this.isBookletMode) return;

    const nextIndex = this.currentUnitIndex;
    if (nextIndex < this.unitsData.units.length) {
      const nextUnit = this.unitsData.units[nextIndex];
      if (nextUnit) {
        this.handleUnitChanged(nextUnit);
      }
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.isBookletMode && this.unitsData) {
      if (this.currentVariableId) {
        const compositeKey = this.generateCompositeKey(this.testPerson, this.unitId, this.currentVariableId);
        const hasSelection = this.selectedCodes.has(compositeKey);

        if (hasSelection) {
          event.preventDefault();
          this.navigateToNextUnit();
        }
      }
    }
  }
}
