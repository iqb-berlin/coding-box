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
  catchError, firstValueFrom, Subject
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
  private ngUnsubscribe = new Subject<void>();
  player :string = '';
  unitDef :string = '';
  testPerson:string = '';
  page!:string;
  unitId:string = '';
  responses:string = '';
  auth:string = '';
  @Input() testPersonInput!: string;
  @Input() pageInput!: string;
  @Input() unitIdInput!: string;
  constructor(private backendService:BackendService,
              private appService:AppService,
              private route:ActivatedRoute) {

  }

  async ngOnInit(): Promise<void> {
    const params = await firstValueFrom(this.route.params);
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
          this.player = unitDataExternal.player[1].data;
          this.unitDef = unitDataExternal.unitDef[1].data;
          this.responses = unitDataExternal.response[0];
        }
      }
    } else {
      this.page = '1';
      this.testPerson = this.testPersonInput;
      this.unitId = this.unitIdInput.toUpperCase();
    }
    if (this.auth.length === 0) {
      const unitData = await this.getUnitData();
      this.player = unitData.player[1].data;
      this.unitDef = unitData.unitDef[1].data;
      this.responses = unitData.response[0];
    }
  }

  async ngOnChanges(changes: SimpleChanges) {
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
        .pipe(
          catchError(error => {
            throw new Error(error);
          })
        ));

    xml2js.parseString(unitFile[0].data, (err:any, result:any) => {
      player = result?.Unit.DefinitionRef[0].$.player;
    });
    const playerFile = await firstValueFrom(
      this.backendService.getPlayer(
        this.appService.selectedWorkspaceId, player.replace('@', '-'))
        .pipe(
          catchError(error => {
            throw new Error(error);
          })
        ));
    return { player: playerFile, unitDef: unitDefFile, response: responsesFile };
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

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
