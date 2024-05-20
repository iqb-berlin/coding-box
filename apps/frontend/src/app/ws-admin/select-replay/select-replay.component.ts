import { Component, OnInit } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatOption, MatSelect } from '@angular/material/select';
import { Router } from '@angular/router';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { ReactiveFormsModule } from '@angular/forms';
import { MatLabel } from '@angular/material/form-field';
import { BackendService } from '../../services/backend.service';
import { AppService } from '../../services/app.service';

@Component({
  selector: 'coding-box-select-replay',
  templateUrl: './select-replay.component.html',
  styleUrls: ['./select-replay.component.scss'],
  standalone: true,
  imports: [MatLabel, MatAnchor, TranslateModule, MatIcon, MatSelect, MatOption, MatButton, MatFormField, MatRadioButton, MatRadioGroup, ReactiveFormsModule]
})
export class SelectReplayComponent implements OnInit {
  constructor(public appService:AppService,
              public backendService:BackendService,
              private router: Router) {


  }

  testPersons = [];
  testGroups = [];
  units = [];
  selectedTestPerson = '';
  selectedUnit = '';
  selectedPage = '';
  selectedTestGroup = '';

  ngOnInit(): void {
    this.backendService.getTestGroups(1).subscribe(data => {
       this.testGroups = data;
    });
  }

  getTestPersons(testGroup:string): void {
    this.selectedTestGroup = testGroup;
    this.backendService.getTestPersons(1,testGroup).subscribe(data => {
      if (data.length > 0) { this.testPersons = data }
    });
  }

  getUnits(testPerson:string): void {
    this.selectedTestPerson = testPerson;
    this.backendService.getTestpersonUnits(2, testPerson).subscribe(data => {
      this.units = data.map((d:any) => d.unit_id);
    });
  }

  changedUnit(unit:any): void {
    this.selectedUnit = unit;
    console.log('unit', unit);
  }

  replay(): void {
    console.log('replay', this.selectedTestPerson, this.selectedUnit);
    this.selectedUnit = this.selectedUnit.toUpperCase();
    this.router.navigate([`/replay/${this.selectedTestPerson}/${this.selectedUnit}/1`]);
  }
}
