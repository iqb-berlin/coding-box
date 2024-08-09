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
import { ActivatedRoute } from '@angular/router';
import {
  combineLatest, firstValueFrom, Observable, of, Subject, Subscription, switchMap
} from 'rxjs';
import * as xml2js from 'xml2js';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { UnitPlayerComponent } from '../unit-player/unit-player.component';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { ResponseDto } from '../../../../../../../api-dto/responses/response-dto';
import { SpinnerComponent } from '../spinner/spinner.component';

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
  testPerson: string = '';
  page: string | undefined;
  unitId: string = '';
  responses: ResponseDto | undefined = undefined;
  auth: string = '';
  testPersonError = false;
  responsesError = false;
  unitIdError = false;
  authError = false;
  unknownError = false;
  lastPlayer: { id: string, data: string } = { id: '', data: '' };
  lastUnitDef: { id: string, data: string } = { id: '', data: '' };
  isLoaded: Subject<boolean> = new Subject<boolean>();
  @Input() testPersonInput: string | undefined;
  @Input() unitIdInput: string | undefined;
  private routerSubscription: Subscription | null = null;
  constructor(private backendService:BackendService,
              private appService:AppService,
              private route:ActivatedRoute,
              private snackBar: MatSnackBar) {
  }

  ngOnInit(): void {
    this.subscribeRouter();
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.routerSubscription = null;
  }

  checkErrors(): void {
    if (this.authError) {
      this.openSnackBar('Authentisierungproblem: Zugriffs-Token ungültig', 'Schließen');
    } else if (this.unitIdError) {
      this.openSnackBar('Unbekannte Unit-Id', 'Schließen');
    } else if (this.testPersonError) {
      this.openSnackBar('Ungültige Id für Testperson', 'Schließen');
    } else if (this.responsesError) {
      this.openSnackBar(
        `Keine Antworten für Aufgabe "${this.unitId}" von Testperson "${this.testPerson}" gefunden`,
        'Schließen'
      );
    } else if (this.unknownError) {
      this.openSnackBar('Unbekannter Fehler', 'Schließen');
    }
  }

  openSnackBar(message: string, action: string) {
    const snackbarRef = this.snackBar
      .open(message, action, { panelClass: ['snackbar-error'] });
    snackbarRef.afterDismissed().subscribe(() => {
      this.reset();
      this.isLoaded.next(true);
    });
  }

  private subscribeRouter(): void {
    this.routerSubscription = this.route.params
      .subscribe(async params => {
        this.snackBar.dismiss();
        this.reset();
        const queryParams = await firstValueFrom(this.route.queryParams);
        if (Object.keys(params).length !== 0) {
          const {
            page, testPerson, unitId
          } = params;
          this.page = page;
          this.testPerson = testPerson;
          this.testPersonError = !ReplayComponent.isTestperson(testPerson);
          this.unitId = unitId;
          const { auth } = queryParams;
          this.auth = auth;
          if (auth.length > 0) {
            let workspace = '';
            try {
              const decoded: JwtPayload & { workspace: string } = jwtDecode(auth);
              workspace = decoded?.workspace;
            } catch (error) {
              this.authError = true;
            }
            if (workspace) {
              try {
                const unitData = await this.getUnitData(Number(workspace), auth);
                this.responsesError = !ReplayComponent.hasResponses(unitData.response[0]);
                this.setUnitProperties(unitData);
              } catch (error) {
                this.unitIdError = true;
              }
            }
            this.checkErrors();
          }
        } else if (this.testPersonInput && this.unitIdInput) {
          this.testPerson = this.testPersonInput;
          this.unitId = this.unitIdInput.toUpperCase();
        }
      });
  }

  private static isTestperson(testperson: string): boolean {
    const reg = /^.+(@.+){2}$/;
    return reg.test(testperson);
  }

  private static hasResponses(response: ResponseDto): boolean {
    return !!response;
  }

  private static checkUnitId(unitFile: { data: string }[]): void {
    if (!unitFile || !unitFile[0]) {
      throw new Error('unitFile not found');
    }
  }

  // TODO: show unit if testperson changes and unit is already loaded
  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/dot-notation
    if (typeof changes['unitIdInput']?.currentValue === 'undefined') {
      this.reset();
      return Promise.resolve();
    }
    // eslint-disable-next-line @typescript-eslint/dot-notation
    if (changes['unitIdInput'].currentValue === changes['unitIdInput'].previousValue) return Promise.resolve();
    this.reset();
    const { unitIdInput } = changes;
    this.unitId = unitIdInput.currentValue;
    this.testPerson = this.testPersonInput || '';
    const unitData = await this.getUnitData(this.appService.selectedWorkspaceId);
    this.setUnitProperties(unitData);
    return Promise.resolve();
  }

  private setUnitProperties(
    unitData: { unitDef: {
      data: string, file_id: string }[],
    response: ResponseDto[],
    player: { data: string, file_id: string }[]
    }) {
    this.cachePlayerData(unitData.player[0]);
    this.cacheUnitDefData(unitData.unitDef[0]);
    this.player = unitData.player[0].data;
    this.unitDef = unitData.unitDef[0].data;
    this.responses = unitData.response[0];
  }

  private cacheUnitDefData(unitDef: { data: string, file_id: string }) {
    this.lastUnitDef.data = unitDef.data;
    this.lastUnitDef.id = unitDef.file_id.substring(0, unitDef.file_id.indexOf('.VOUD'));
  }

  private cachePlayerData(playerData: { data: string, file_id: string }) {
    this.lastPlayer.data = playerData.data;
    this.lastPlayer.id = playerData.file_id;
  }

  private static normalizePlayerId(name: string): string {
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
    throw new Error('Invalid player name');
  }

  private getUnitDef(workspace: number, authToken?:string): Observable<{ data: string, file_id: string }[]> {
    if (this.lastUnitDef.id && this.lastUnitDef.data && this.lastUnitDef.id === this.unitId) {
      return of([{
        data: this.lastUnitDef.data,
        file_id: `${this.lastUnitDef.id}.VOUD`
      }]);
    }
    try {
      return this.backendService.getUnitDef(workspace, this.unitId, authToken);
    } catch (error) {
      this.setHttpError(error as HttpErrorResponse);
    }
    return of([{ data: '', file_id: '' }]);
  }

  private getResponses(workspace: number, authToken?:string): Observable<ResponseDto[]> {
    try {
      return this.backendService
        .getResponses(workspace, this.testPerson, this.unitId, authToken);
    } catch (error) {
      this.setHttpError(error as HttpErrorResponse);
    }
    return of([]);
  }

  private getUnit(workspace: number, authToken?:string): Observable<{ data: string, file_id: string }[]> {
    try {
      return this.backendService.getUnit(workspace, this.testPerson, this.unitId, authToken);
    } catch (error) {
      this.setHttpError(error as HttpErrorResponse);
    }
    return of([{ data: '', file_id: '' }]);
  }

  private getPlayer(
    workspace: number, player: string, authToken?:string
  ): Observable<{ data: string, file_id: string }[]> {
    if (this.lastPlayer.id && this.lastPlayer.data && this.lastPlayer.id === player) {
      return of([{ data: this.lastPlayer.data, file_id: this.lastPlayer.id }]);
    }
    try {
      return this.backendService.getPlayer(
        workspace,
        player.replace('@', '-'),
        authToken);
    } catch (error) {
      this.setHttpError(error as HttpErrorResponse);
    }
    return of([{ data: '', file_id: '' }]);
  }

  private async getUnitData(workspace: number, authToken?:string) {
    this.isLoaded.next(false);
    const unitData = await firstValueFrom(
      combineLatest([
        this.getUnitDef(workspace, authToken),
        this.getResponses(workspace, authToken),
        this.getUnit(workspace, authToken)
          .pipe(switchMap(unitFile => {
            ReplayComponent.checkUnitId(unitFile);
            let player = '';
            xml2js.parseString(unitFile[0].data, (err:any, result:any) => {
              player = result?.Unit.DefinitionRef[0].$.player;
            });
            return this.getPlayer(workspace, ReplayComponent.normalizePlayerId(player), authToken);
          }))
      ]));
    this.isLoaded.next(true);
    return { unitDef: unitData[0], response: unitData[1], player: unitData[2] };
  }

  private setHttpError(error: HttpErrorResponse): void {
    if (error.status === 401) {
      this.authError = true;
    } else {
      this.unknownError = true;
    }
  }

  private reset() {
    this.testPersonError = false;
    this.responsesError = false;
    this.unitIdError = false;
    this.authError = false;
    this.unknownError = false;
    this.unitId = '';
    this.player = '';
    this.unitDef = '';
    this.page = undefined;
    this.responses = undefined;
  }
}
