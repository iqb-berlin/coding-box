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
  catchError, firstValueFrom, Subscription
} from 'rxjs';
import * as xml2js from 'xml2js';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { UnitPlayerComponent } from '../unit-player/unit-player.component';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';

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
  page!: string;
  unitId: string = '';
  responses: string = '';
  auth: string = '';
  @Input() testPersonInput: string | undefined;
  @Input() pageInput: string | undefined;
  @Input() unitIdInput: string | undefined;
  private routerSubscription: Subscription | null = null;
  constructor(private backendService:BackendService,
              private appService:AppService,
              private route:ActivatedRoute) {

  }

  ngOnInit(): void {
    this.subscribeRouter();
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.routerSubscription = null;
  }

  private subscribeRouter(): void {
    this.routerSubscription = this.route.params
      .subscribe(async params => {
        const queryParams = await firstValueFrom(this.route.queryParams);
        if (Object.keys(params).length !== 0) {
          const {
            page, testPerson, unitId
          } = params;
          this.page = page;
          this.testPerson = testPerson;
          this.unitId = unitId;
          const { auth } = queryParams;
          this.auth = auth;
          if (auth.length > 0) {
            const decoded :JwtPayload & { workspace:string } = jwtDecode(auth);
            const workspace = decoded?.workspace;
            if (workspace) {
              const unitDataExternal = await this.unitDataExternal(auth, workspace);
              this.player = unitDataExternal.player[0].data;
              this.unitDef = unitDataExternal.unitDef[0].data;
              this.responses = unitDataExternal.response[0];
            }
          }
        } else if (this.testPersonInput && this.unitIdInput) {
          this.page = '1';
          this.testPerson = this.testPersonInput;
          this.unitId = this.unitIdInput.toUpperCase();
        }
      });
  }

  // eslint-disable-next-line consistent-return
  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/dot-notation
    if (typeof changes['unitIdInput']?.currentValue === 'undefined') {
      this.unitId = '';
      this.player = '';
      this.unitDef = '';
      this.responses = '';
      return Promise.resolve();
    }
    // eslint-disable-next-line @typescript-eslint/dot-notation
    if (changes['unitIdInput'].currentValue === changes['unitIdInput'].previousValue) return Promise.resolve();
    const { unitIdInput } = changes;
    this.unitId = unitIdInput.currentValue;
    const unitData = await this.getUnitData();
    this.player = unitData.player[0].data;
    this.unitDef = unitData.unitDef[0].data;
    this.responses = unitData.response[0];
  }

  async getUnitData() {
    let player = '';
    const unitDefFile = await firstValueFrom(
      this.backendService.getUnitDef(this.appService.selectedWorkspaceId, this.unitId)
        .pipe(
          catchError(error => {
            throw new Error(error);
          })
        ));

    const responsesFile = await firstValueFrom(
      this.backendService.getResponses(this.appService.selectedWorkspaceId, this.testPerson, this.unitId)
        .pipe(
          catchError(error => {
            throw new Error(error);
          })
        ));
    const unitFile = await firstValueFrom(
      this.backendService.getUnit(this.appService.selectedWorkspaceId, this.testPerson, this.unitId)
    );
    if (!unitFile || !unitFile[0]) { //  1 pqmz2zse8aux START1
      throw new Error('unitFile not found');
    }

    xml2js.parseString(unitFile[0].data, (err:any, result:any) => {
      player = result?.Unit.DefinitionRef[0].$.player;
    });

    const playerFile = await firstValueFrom(
      this.backendService.getPlayer(
        this.appService.selectedWorkspaceId, ReplayComponent.normalizePlayerId(player))
        .pipe(
          catchError(error => {
            throw new Error(error);
          })
        ));
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

  async unitDataExternal(authToken:string, workspace:string) {
    let player = '';
    const unitDefFile = await firstValueFrom(
      this.backendService.getUnitDefExternal(authToken, Number(workspace), this.unitId)
        .pipe(
          catchError(error => {
            throw new Error(error);
          })
        ));

    const responsesFile = await firstValueFrom(
      this.backendService
        .getResponsesExternal(authToken, Number(workspace), this.testPerson, this.unitId)
        .pipe(
          catchError(error => {
            throw new Error(error);
          })
        ));
    const unitFile = await firstValueFrom(
      this.backendService.getUnitExternal(authToken, Number(workspace), this.testPerson, this.unitId)
        .pipe(
          catchError(error => {
            throw new Error(error);
          })
        ));

    xml2js.parseString(unitFile[0].data, (err:any, result:any) => {
      player = result?.Unit.DefinitionRef[0].$.player;
    });
    const playerFile = await firstValueFrom(
      this.backendService.getPlayerExternal(authToken,
        Number(workspace),
        player.replace('@', '-'))
        .pipe(
          catchError(error => {
            throw new Error(error);
          })
        ));
    return { player: playerFile, unitDef: unitDefFile, response: responsesFile };
  }
}
