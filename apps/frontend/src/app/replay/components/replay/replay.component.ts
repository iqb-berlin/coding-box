/* eslint-disable  @typescript-eslint/no-explicit-any */
import {
  Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule } from '@angular/forms';
import { NgIf } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute, Params } from '@angular/router';
import {
  combineLatest, firstValueFrom, Observable, of, Subject, Subscription, switchMap
} from 'rxjs';
import * as xml2js from 'xml2js';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { UnitPlayerComponent } from '../unit-player/unit-player.component';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { ResponseDto } from '../../../../../../../api-dto/responses/response-dto';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FilesDto } from '../../../../../../../api-dto/files/files.dto';

@Component({
  selector: 'coding-box-replay',
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, ReactiveFormsModule, NgIf, TranslateModule, UnitPlayerComponent, SpinnerComponent],
  templateUrl: './replay.component.html',
  styleUrl: './replay.component.scss'
})
export class ReplayComponent implements OnInit, OnDestroy, OnChanges {
  player: string = '';
  unitDef: string = '';
  isLoaded: Subject<boolean> = new Subject<boolean>();
  page: string | undefined;
  responses: ResponseDto | undefined = undefined;
  private testPerson: string = '';
  private unitId: string = '';
  private authToken: string = '';
  private errorSnackbarRef: MatSnackBarRef<TextOnlySnackBar> | null = null;
  private pageErrorSnackbarRef: MatSnackBarRef<TextOnlySnackBar> | null = null;
  private lastPlayer: { id: string, data: string } = { id: '', data: '' };
  private lastUnitDef: { id: string, data: string } = { id: '', data: '' };
  private lastUnit: { id: string, data: string } = { id: '', data: '' };
  private routerSubscription: Subscription | null = null;
  @Input() testPersonInput: string | undefined;
  @Input() unitIdInput: string | undefined;
  constructor(private backendService:BackendService,
              private appService:AppService,
              private route:ActivatedRoute,
              private errorSnackBar: MatSnackBar,
              private pageErrorSnackBar: MatSnackBar) {
  }

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

  private subscribeRouter(): void {
    this.routerSubscription = this.route.params
      .subscribe(async params => {
        this.resetSnackBars();
        this.resetUnitData();
        try {
          if (Object.keys(params).length === 3) {
            this.authToken = await this.getAuthToken();
            this.setUnitParams(params);
            if (this.authToken) {
              const decoded: JwtPayload & { workspace: string } = jwtDecode(this.authToken);
              const workspace = decoded?.workspace;
              if (workspace) {
                const unitData = await this.getUnitData(Number(workspace), this.authToken);
                this.setUnitProperties(unitData);
              }
            } else {
              ReplayComponent.throwError('QueryError');
            }
          } else if (this.testPersonInput && this.unitIdInput) {
            this.setTestPerson(this.testPersonInput);
            this.unitId = this.unitIdInput.toUpperCase();
          } else if (Object.keys(params).length !== 3) {
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

  private setUnitParams(params: Params): void {
    const {
      page, testPerson, unitId
    } = params;
    this.page = page;
    this.unitId = unitId;
    this.setTestPerson(testPerson);
  }

  private setTestPerson(testPerson: string): void {
    if (!ReplayComponent.isTestperson(testPerson)) {
      ReplayComponent.throwError('TestPersonError');
    } else {
      this.testPerson = testPerson;
    }
  }

  private static isTestperson(testperson: string): boolean {
    if (testperson.split('@').length !== 3) return false;
    const reg = /^.+(@.+){2}$/;
    return reg.test(testperson);
  }

  private static hasResponses(response: ResponseDto): boolean {
    return !!response;
  }

  private checkUnitId(unitFile: FilesDto[]): void {
    if (!unitFile || !unitFile[0]) {
      ReplayComponent.throwError('UnitIdError');
    } else {
      this.cacheUnitData(unitFile[0]);
    }
  }

  // TODO: show unit if testperson changes and unit is already loaded
  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/dot-notation
    if (typeof changes['unitIdInput']?.currentValue === 'undefined') {
      this.resetUnitData();
      this.resetSnackBars();
      return Promise.resolve();
    }
    // eslint-disable-next-line @typescript-eslint/dot-notation
    if (changes['unitIdInput'].currentValue === changes['unitIdInput'].previousValue) return Promise.resolve();
    this.resetUnitData();
    this.resetSnackBars();
    const { unitIdInput } = changes;
    try {
      this.unitId = unitIdInput.currentValue;
      this.setTestPerson(this.testPersonInput || '');
      const unitData = await this.getUnitData(this.appService.selectedWorkspaceId);
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
    if (ReplayComponent.hasResponses(unitData.response[0])) {
      this.responses = unitData.response[0];
    } else {
      ReplayComponent.throwError('ResponsesError');
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

  private static getNormalizedPlayerId(name: string): string {
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
    if (this.lastUnitDef.id && this.lastUnitDef.data && this.lastUnitDef.id === this.unitId) {
      return of([{
        data: this.lastUnitDef.data,
        file_id: `${this.lastUnitDef.id}.VOUD`
      }]);
    }
    return this.backendService.getUnitDef(workspace, this.unitId, authToken);
  }

  private getResponses(workspace: number, authToken?:string): Observable<ResponseDto[]> {
    return this.backendService
      .getResponses(workspace, this.testPerson, this.unitId, authToken);
  }

  private getUnit(workspace: number, authToken?:string): Observable<FilesDto[]> {
    if (this.lastUnit.id && this.lastUnit.data && this.lastUnit.id === this.unitId) {
      return of([{
        data: this.lastUnit.data,
        file_id: this.lastUnit.id
      }]);
    }
    return this.backendService.getUnit(workspace, this.testPerson, this.unitId, authToken);
  }

  private getPlayer(
    workspace: number, player: string, authToken?:string
  ): Observable<FilesDto[]> {
    if (this.lastPlayer.id && this.lastPlayer.data && this.lastPlayer.id === player) {
      return of([{ data: this.lastPlayer.data, file_id: this.lastPlayer.id }]);
    }
    return this.backendService.getPlayer(
      workspace,
      player.replace('@', '-'),
      authToken);
  }

  private async getUnitData(workspace: number, authToken?:string) {
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
    this.setIsLoaded();
    return { unitDef: unitData[0], response: unitData[1], player: unitData[2] };
  }

  private catchError(error: HttpErrorResponse): void {
    if (error.message === 'QueryError') {
      this.openErrorSnackBar('Kein Authorisierungs-Token angegeben', 'Schließen');
    } else if (error.message === 'ParamsError') {
      this.openErrorSnackBar('Ungültige Anzahl an Parametern in der URL vorhanden', 'Schließen');
    } else if (error.status === 401) {
      this.openErrorSnackBar('Authentisierungs-Token ist ungültig', 'Schließen');
    } else if (error.message === 'UnitIdError') {
      this.openErrorSnackBar('Unbekannte Unit-ID', 'Schließen');
    } else if (error.message === 'TestPersonError') {
      this.openErrorSnackBar('Ungültige ID für Testperson', 'Schließen');
    } else if (error.message === 'PlayerError') {
      this.openErrorSnackBar('Ungültiger Player-Name', 'Schließen');
    } else if (error.message === 'ResponsesError') {
      this.openErrorSnackBar(
        `Keine Antworten für Aufgabe "${this.unitId}" von Testperson "${this.testPerson}" gefunden`,
        'Schließen'
      );
    } else {
      this.openErrorSnackBar('Unbekannter Fehler', 'Schließen');
    }
  }

  checkPageError(pageError: 'notInList' | 'notCurrent' | null): void {
    if (pageError === 'notInList') {
      this.openPageErrorSnackBar(`Keine valide Seite mit ID "${this.page}" gefunden`, 'Schließen');
    } else if (pageError === 'notCurrent') {
      this.openPageErrorSnackBar(`Seite mit ID "${this.page}" kann nicht ausgewählt werden`, 'Schließen');
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

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.routerSubscription = null;
    this.resetSnackBars();
  }
}
