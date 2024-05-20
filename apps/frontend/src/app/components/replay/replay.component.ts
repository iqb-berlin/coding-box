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
import { UnitPlayerComponent } from '../unit-player/unit-player.component';
import { BackendService } from '../../services/backend.service';

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
    this.responses = unitData.unitDef[0].data;
  }

  async getUnitData() {
    const playerFile = await firstValueFrom(this.backendService.getPlayer(2).pipe(
      catchError(error => {
        throw new Error(error);
      })
    ));
    const unitDefFile = await firstValueFrom(this.backendService.getUnitDef(2, this.unitId).pipe(
      catchError(error => {
        throw new Error(error);
      })
    ));
    const responsesFile = await firstValueFrom(this.backendService.getResponses(2, this.testPerson).pipe(
      catchError(error => {
        throw new Error(error);
      })
    ));

    console.log('playerFile', playerFile);
    // this.player = playerFile[0].data;
    // this.unitDef = unitDefFile[0].data;
    return { player: playerFile, unitDef: unitDefFile, response: responsesFile };
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
