import { Component, OnInit } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatOption, MatSelect } from '@angular/material/select';
import { Router } from '@angular/router';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { ReactiveFormsModule } from '@angular/forms';
import { MatLabel } from '@angular/material/form-field';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { BackendService } from '../../services/backend.service';
import { AppService } from '../../services/app.service';
import { ReplayComponent } from '../../replay/components/replay/replay.component';

export type TestGroups = {
  test_group: string;
};
export type UnitIds = {
  unit_id: string;
};

@Component({
  selector: 'coding-box-select-replay',
  templateUrl: './select-replay.component.html',
  styleUrls: ['./select-replay.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatLabel, MatAnchor, TranslateModule, MatIcon, MatSelect, MatOption, MatButton, MatFormField, MatRadioButton, MatRadioGroup, ReactiveFormsModule, ReplayComponent, MatProgressBar, MatProgressSpinner]
})
export class SelectReplayComponent implements OnInit {
  constructor(public appService:AppService,
              public backendService:BackendService,
              private router: Router) {

  }

  testPersons:string[] = [];
  testGroups :string[] = [];
  units :string[] = [];
  selectedTestPerson = '';
  selectedUnit = '';
  // selectedPage = '';
  selectedTestGroup = '';
  isLoading = false;

  ngOnInit(): void {
    this.isLoading = true;
    if (this.appService.workspaceData?.testGroups.length === 0) {
      this.backendService.getTestGroups(this.appService.selectedWorkspaceId)
        .subscribe((groups:TestGroups[]) => {
          this.appService.workspaceData.testGroups = groups;
          this.testGroups = groups.map(g => g.test_group);
          this.isLoading = false;
        });
    } else {
      this.testGroups = this.appService.workspaceData.testGroups
        .map((g: TestGroups) => g.test_group);
      this.isLoading = false;
    }
  }

  getTestPersons(testGroup:string): void {
    this.selectedTestGroup = testGroup;
    this.backendService.getTestPersons(this.appService.selectedWorkspaceId, testGroup).subscribe(data => {
      if (data.length > 0) { this.testPersons = data as string[]; }
    });
  }

  getUnits(testPerson:string): void {
    this.units = [];
    this.selectedTestPerson = testPerson;
    // const formerSelectedUnit = this.selectedUnit;
    // this.selectedUnit = '';
    this.backendService.getTestPersonUnits(this.appService.selectedWorkspaceId, testPerson).subscribe(data => {
      this.units = data.map(({ unit_id }:UnitIds) => unit_id);
      // this.selectedUnit ? this.changedUnit(formerSelectedUnit) : '';
    });
  }

  changedUnit(unit:string): void {
    this.selectedUnit = unit.toUpperCase();
  }

  async replay(): Promise<void> {
    this.selectedUnit = this.selectedUnit.toUpperCase();
    this.backendService
      .createToken(this.appService.selectedWorkspaceId, this.appService.userProfile.id || '', 1)
      .subscribe(token => {
        const queryParams = {
          auth: token
        };
        const url = this.router
          .serializeUrl(
            this.router.createUrlTree(
              [`replay/${this.selectedTestPerson}/${this.selectedUnit}/1`],
              { queryParams: queryParams })
          );
        window.open(`#/${url}`, '_blank');
      });
  }
}
