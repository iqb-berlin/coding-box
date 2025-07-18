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
  combineLatest, firstValueFrom, Observable, of, Subject, Subscription, switchMap
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
import { scrollToElementByAlias } from '../../utils/dom-utils';

@Component({
  selector: 'coding-box-replay',
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, ReactiveFormsModule, TranslateModule, UnitPlayerComponent, SpinnerComponent, FormsModule],
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
  private authToken: string = '';
  private errorSnackbarRef: MatSnackBarRef<TextOnlySnackBar> | null = null;
  private pageErrorSnackbarRef: MatSnackBarRef<TextOnlySnackBar> | null = null;
  private lastPlayer: { id: string, data: string } = { id: '', data: '' };
  private lastUnitDef: { id: string, data: string } = { id: '', data: '' };
  private lastUnit: { id: string, data: string } = { id: '', data: '' };
  private routerSubscription: Subscription | null = null;
  readonly testPersonInput = input<string>();
  readonly unitIdInput = input<string>();
  @ViewChild(UnitPlayerComponent) unitPlayerComponent: UnitPlayerComponent | undefined;

  ngOnInit(): void {
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

  subscribeRouter(): void {
    this.routerSubscription = this.route.params
      ?.subscribe(async params => {
        this.resetSnackBars();
        this.resetUnitData();
        this.authToken = await this.getAuthToken();

        if (this.authToken) {
          const tokenValidation = validateToken(this.authToken);
          if (!tokenValidation.isValid) {
            this.setIsLoaded();
            if (tokenValidation.errorType === 'token_expired') {
              this.openErrorSnackBar(this.getErrorMessages().tokenExpired, 'Schließen');
            } else {
              this.openErrorSnackBar(this.getErrorMessages().tokenInvalid, 'Schließen');
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
            const decoded: JwtPayload & { workspace: string } = jwtDecode(this.authToken);
            const workspace = decoded?.workspace;
            const unitData = await this.getUnitData(Number(workspace), this.authToken);
            this.setUnitProperties(unitData);
          } else if (Object.keys(params).length >= 3 && Object.keys(params).length <= 4) {
            this.setUnitParams(params);
            if (this.authToken) {
              const decoded: JwtPayload & { workspace: string } = jwtDecode(this.authToken);
              const workspace = decoded?.workspace;
              if (workspace) {
                const unitData = await this.getUnitData(Number(workspace), this.authToken);
                this.setUnitProperties(unitData);
                setTimeout(() => {
                  if (this.unitPlayerComponent?.hostingIframe?.nativeElement) {
                    if (this.anchor) {
                      scrollToElementByAlias(this.unitPlayerComponent.hostingIframe.nativeElement, this.anchor);
                    } else {
                      // When no anchor is provided, scroll to the top of the content
                      // this.scrollToTop();
                    }
                  }
                }, 1000);
              }
            } else {
              ReplayComponent.throwError('QueryError');
            }
          } else if (testPersonInput && unitIdInput) {
            this.setTestPerson(testPersonInput);
            this.unitId = unitIdInput;
          } else if (Object.keys(params).length !== 4 && !this.isPrintMode) {
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
      ReplayComponent.throwError('TestPersonError');
    } else {
      this.testPerson = testPerson;
    }
  }

  private checkUnitId(unitFile: FilesDto[]): void {
    if (!unitFile || !unitFile[0]) {
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
    this.resetUnitData();
    this.resetSnackBars();

    if (this.authToken) {
      const tokenValidation = validateToken(this.authToken);
      if (!tokenValidation.isValid) {
        this.setIsLoaded();
        if (tokenValidation.errorType === 'token_expired') {
          this.openErrorSnackBar(this.getErrorMessages().tokenExpired, 'Schließen');
        } else {
          this.openErrorSnackBar(this.getErrorMessages().tokenInvalid, 'Schließen');
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
    return Promise.resolve();
  }

  private setUnitProperties(
    unitData: { unitDef: FilesDto[], response: ResponseDto[], player: FilesDto[]
    }) {
    this.cachePlayerData(unitData.player[0]);
    this.cacheUnitDefData(unitData.unitDef[0]);
    this.player = unitData.player[0].data;
    this.unitDef = unitData.unitDef[0].data;
    this.responses = unitData.response;
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
    // In print mode, we don't need responses, so return an empty array
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

  private async getUnitData(workspace: number, authToken?:string) {
    const startTime = performance.now();
    this.isLoaded.next(false);
    const unitData = await firstValueFrom(
      combineLatest([
        this.getUnitDef(workspace, authToken),
        this.getResponses(workspace, authToken),
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
    const duration = endTime - startTime;
    logger.log(`Replay-Dauer: ${duration.toFixed(2)}ms`);
    this.setIsLoaded();
    return { unitDef: unitData[0], response: unitData[1], player: unitData[2] };
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
      notInList: `Keine valide Seite mit ID "${this.page}" gefunden`,
      notCurrent: `Seite mit ID "${this.page}" kann nicht ausgewählt werden`,
      tokenExpired: 'Das Authentisierungs-Token ist abgelaufen',
      tokenInvalid: 'Das Authentisierungs-Token ist ungültig',
      unknown: 'Unbekannter Fehler'
    };
  }

  private catchError(error: HttpErrorResponse): void {
    let messageKey: keyof ErrorMessages;

    if (error.status === 401) {
      messageKey = '401' as keyof ErrorMessages;
    } else if (error.status === 404 && this.unitId && this.testPerson) {
      // If it's a 404 error and we have unitId and testPerson, it's likely a ResponsesError
      messageKey = 'ResponsesError' as keyof ErrorMessages;
    } else {
      messageKey = error.message as keyof ErrorMessages;
    }

    const message = this.getErrorMessages()[messageKey] || this.getErrorMessages().unknown;
    this.openErrorSnackBar(message, 'Schließen');
  }

  checkPageError(pageError: 'notInList' | 'notCurrent' | null): void {
    if (pageError) {
      this.openPageErrorSnackBar(this.getErrorMessages()[pageError], 'Schließen');
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
  }

  private scrollToTop(): void {
    try {
      if (this.unitPlayerComponent?.hostingIframe?.nativeElement?.contentWindow) {
        this.unitPlayerComponent.hostingIframe.nativeElement.contentWindow.scrollTo({
          top: 0,
          left: 0,
          behavior: 'smooth'
        });
      }
    } catch (error) {
      console.error('Error scrolling to top:', error);
    }
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.routerSubscription = null;
    this.resetSnackBars();
  }
}
