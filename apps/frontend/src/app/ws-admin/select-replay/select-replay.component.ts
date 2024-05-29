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
import { ReplayComponent } from '../../replay/components/replay/replay.component';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

@Component({
  selector: 'coding-box-select-replay',
  templateUrl: './select-replay.component.html',
  styleUrls: ['./select-replay.component.scss'],
  standalone: true,
  imports: [MatLabel, MatAnchor, TranslateModule, MatIcon, MatSelect, MatOption, MatButton, MatFormField, MatRadioButton, MatRadioGroup, ReactiveFormsModule, ReplayComponent, MatProgressBar, MatProgressSpinner]
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
  isLoading = false;

  ngOnInit(): void {
    this.isLoading = true;
    this.backendService.getTestGroups(this.appService.selectedWorkspaceId).subscribe(groups => {
      this.testGroups = groups.map((g:any) => g.test_group);
      this.isLoading = false;
    });
  }

  getTestPersons(testGroup:string): void {
    this.selectedTestGroup = testGroup;
    this.backendService.getTestPersons(this.appService.selectedWorkspaceId, testGroup).subscribe(data => {
      if (data.length > 0) { this.testPersons = data; }
    });
  }

  getUnits(testPerson:string): void {
    this.selectedTestPerson = testPerson;
    this.backendService.getTestpersonUnits(this.appService.selectedWorkspaceId, testPerson).subscribe(data => {
      this.units = data.map((d:any) => d.unit_id);
    });
  }

  changedUnit(unit:string): void {
    this.selectedUnit = unit;
  }

  replay(): void {
    this.selectedUnit = this.selectedUnit.toUpperCase();
    this.router.navigate([`/replay/${this.selectedTestPerson}/${this.selectedUnit}/1`]);
  }
}
