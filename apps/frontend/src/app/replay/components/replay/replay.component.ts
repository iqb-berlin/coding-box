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
import { firstValueFrom, Subscription } from 'rxjs';
import * as xml2js from 'xml2js';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { UnitPlayerComponent } from '../unit-player/unit-player.component';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { ResponseDto } from '../../../../../../../api-dto/responses/response-dto';

@Component({
  selector: 'coding-box-replay',
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, ReactiveFormsModule, NgIf, TranslateModule, UnitPlayerComponent],
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
    snackbarRef.afterDismissed().subscribe(() => this.reset());
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
                const unitDataExternal = await this.unitDataExternal(auth, workspace);
                this.player = unitDataExternal.player[0].data;
                this.unitDef = unitDataExternal.unitDef[0].data;
                this.responses = unitDataExternal.response[0];
                this.responsesError = !ReplayComponent.hasResponses(this.responses);
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

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/dot-notation
    if (typeof changes['unitIdInput']?.currentValue === 'undefined') {
      this.unitId = '';
      this.player = '';
      this.unitDef = '';
      this.unitId = '';
      this.page = undefined;
      this.responses = undefined;
      return Promise.resolve();
    }
    // eslint-disable-next-line @typescript-eslint/dot-notation
    if (changes['unitIdInput'].currentValue === changes['unitIdInput'].previousValue) return Promise.resolve();
    const { unitIdInput } = changes;
    this.unitId = unitIdInput.currentValue;
    const unitData = await this.getUnitData(); // TODO: Replace with unitDataExternal
    this.player = unitData.player[0].data;
    this.unitDef = unitData.unitDef[0].data;
    this.responses = unitData.response[0];
    return Promise.resolve();
  }

  async getUnitData() {
    let player = '';
    const unitDefFile = await firstValueFrom(
      this.backendService.getUnitDef(this.appService.selectedWorkspaceId, this.unitId));

    const responsesFile = await firstValueFrom(
      this.backendService.getResponses(this.appService.selectedWorkspaceId, this.testPerson, this.unitId));

    const unitFile = await firstValueFrom(
      this.backendService.getUnit(this.appService.selectedWorkspaceId, this.testPerson, this.unitId)
    );

    ReplayComponent.checkUnitId(unitFile);

    xml2js.parseString(unitFile[0].data, (err:any, result:any) => {
      player = result?.Unit.DefinitionRef[0].$.player;
    });

    const playerFile = await firstValueFrom(
      this.backendService.getPlayer(
        this.appService.selectedWorkspaceId, ReplayComponent.normalizePlayerId(player)));

    return { player: playerFile, unitDef: unitDefFile, response: responsesFile };
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

  private async getUnitDefFile(authToken:string, workspace:string): Promise<{ data: string }[]> {
    let unitDefFile = [{ data: '' }];
    try {
      unitDefFile = await firstValueFrom(
        this.backendService.getUnitDefExternal(authToken, Number(workspace), this.unitId));
    } catch (error) {
      this.setHttpError(error as HttpErrorResponse);
    }
    return unitDefFile;
  }

  private async getResponsesFile(authToken:string, workspace:string): Promise<ResponseDto[]> {
    let responsesFile: ResponseDto[] = [];
    try {
      responsesFile = await firstValueFrom(
        this.backendService
          .getResponsesExternal(authToken, Number(workspace), this.testPerson, this.unitId));
    } catch (error) {
      this.setHttpError(error as HttpErrorResponse);
    }
    return responsesFile;
  }

  private async getUnitFile(authToken:string, workspace:string): Promise<{ data: string }[]> {
    let unitFile = [{ data: '' }];
    try {
      unitFile = await firstValueFrom(
        this.backendService.getUnitExternal(authToken, Number(workspace), this.testPerson, this.unitId));
    } catch (error) {
      this.setHttpError(error as HttpErrorResponse);
    }
    return unitFile;
  }

  private async getPlayerFile(authToken:string, workspace:string, player: string): Promise<{ data: string }[]> {
    let playerFile = [{ data: '' }];
    try {
      playerFile = await firstValueFrom(
        this.backendService.getPlayerExternal(authToken,
          Number(workspace),
          player.replace('@', '-'))
      );
    } catch (error) {
      this.setHttpError(error as HttpErrorResponse);
    }
    return playerFile;
  }

  async unitDataExternal(authToken:string, workspace:string) {
    let player = '';
    const unitDefFile = await this.getUnitDefFile(authToken, workspace);
    const responsesFile = await this.getResponsesFile(authToken, workspace);
    const unitFile = await this.getUnitFile(authToken, workspace);

    ReplayComponent.checkUnitId(unitFile);

    xml2js.parseString(unitFile[0].data, (err:any, result:any) => {
      player = result?.Unit.DefinitionRef[0].$.player;
    });

    const playerFile = await this.getPlayerFile(authToken, workspace, player);
    return { player: playerFile, unitDef: unitDefFile, response: responsesFile };
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
