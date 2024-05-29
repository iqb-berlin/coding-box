import { Component, OnDestroy, OnInit } from '@angular/core';
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
export class ReplayComponent implements OnInit, OnDestroy {
  private ngUnsubscribe = new Subject<void>();
  player :string = '';
  unitDef :string = '';
  testPerson:string = '';
  page!:number;
  unitId:string = '';
  responses:string = '';
  constructor(private backendService:BackendService, private route:ActivatedRoute) {
  constructor(private backendService:BackendService,
              private appService:AppService,
              private route:ActivatedRoute) {

  }

  async ngOnInit(): Promise<void> {
    const params = await firstValueFrom(this.route.params);
    const { page, testPerson, unitId } = params;
    this.page = page;
    this.testPerson = testPerson;
    this.unitId = unitId;
    const unitData = await this.getUnitData();
    this.player = unitData.player[0].data;
    this.unitDef = unitData.unitDef[0].data;
    this.responses = unitData.response[0];
  }

  async getUnitData() {
    let player = '';
    const unitDefFile = await firstValueFrom(this.backendService.getUnitDef(2, this.unitId).pipe(
      catchError(error => {
        throw new Error(error);
      })
    ));

    const responsesFile = await firstValueFrom(this.backendService.getResponses(this.appService.selectedWorkspaceId, this.testPerson, this.unitId).pipe(
      catchError(error => {
        throw new Error(error);
      })
    ));
    const unitFile = await firstValueFrom(this.backendService.getUnit(this.appService.selectedWorkspaceId, this.testPerson, this.unitId).pipe(
      catchError(error => {
        throw new Error(error);
      })
    ));
    xml2js.parseString(unitFile[0].data, (err:any, result:any) => {
      player = result.Unit.DefinitionRef[0].$.player;
      console.log(player);
      console.log(result);
    });
    const playerFile = await firstValueFrom(this.backendService.getPlayer(this.appService.selectedWorkspaceId, player.replace('@', '-')).pipe(
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
