import {
  ChangeDetectorRef,
  Component, OnInit, ViewChild
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatOption, MatSelect } from '@angular/material/select';
import { Router } from '@angular/router';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatLabel } from '@angular/material/form-field';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { ReplayComponent } from '../../../replay/components/replay/replay.component';

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
  imports: [MatLabel, MatAnchor, TranslateModule, MatIcon, MatSelect, MatOption, MatButton,
    MatFormField, MatRadioButton, MatRadioGroup, ReactiveFormsModule, ReplayComponent,
    MatProgressBar, MatProgressSpinner, FormsModule]
})
export class SelectReplayComponent implements OnInit {
  constructor(public appService:AppService,
              public backendService:BackendService,
              private router: Router,
              private changeDetectorRef: ChangeDetectorRef) {
  }

  @ViewChild('replayComponent') replayComponent!: ReplayComponent;
  testPersons:string[] = [];
  testGroups :string[] = [];
  units :string[] = [];
  selectedTestPerson = '';
  selectedUnit = '';
  selectedTestGroup = '';
  isLoading = false;
  page = 0;

  ngOnInit(): void {
    this.page = this.replayComponent?.responses?.unit_state?.CURRENT_PAGE_ID;
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

  private resetSelectedUnit(): void {
    this.selectedUnit = '';
    this.changeDetectorRef.detectChanges();
  }

  getTestPersons(testGroup:string): void {
    this.resetSelectedUnit();
    this.backendService.getTestPersons(this.appService.selectedWorkspaceId, testGroup).subscribe(data => {
      if (data.length > 0) { this.testPersons = data as string[]; }
    });
  }

  getUnits(testPerson:string): void {
    this.resetSelectedUnit();
    this.backendService.getResponsesUnitIds(this.appService.selectedWorkspaceId, testPerson)
      .subscribe(data => {
        this.units = data.map(({ unit_id }:UnitIds) => unit_id);
      });
  }

  async replay(): Promise<void> {
    this.backendService
      .createToken(this.appService.selectedWorkspaceId, this.appService.userProfile.id || '', 1)
      .subscribe(token => {
        const queryParams = {
          auth: token
        };
        const page = this.replayComponent.responses?.unit_state?.CURRENT_PAGE_ID;
        const url = this.router
          .serializeUrl(
            this.router.createUrlTree(
              [`replay/${this.selectedTestPerson}/${this.selectedUnit}/${page}`],
              { queryParams: queryParams })
          );
        window.open(`#/${url}`, '_blank');
      });
  }
}
