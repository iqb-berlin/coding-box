import {
  MatTableDataSource
} from '@angular/material/table';
import {
  ViewChild, Component, OnInit
} from '@angular/core';
import { MatSort } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatAnchor } from '@angular/material/button';
import { SelectionModel } from '@angular/cdk/collections';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { TestGroupsInListDto } from '../../../../../../../api-dto/test-groups/testgroups-in-list.dto';
import { TestResultsComponent } from '../test-results/test-results.component';

@Component({
  selector: 'coding-box-test-groups',
  templateUrl: './test-groups.component.html',
  styleUrls: ['./test-groups.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [FormsModule, TranslateModule, MatProgressSpinner, MatAnchor, MatIcon, TestResultsComponent]
})
export class TestGroupsComponent implements OnInit {
  displayedColumns = ['selectCheckbox', 'test_group', 'created_at'];
  tableSelectionCheckboxes = new SelectionModel<TestGroupsInListDto>(true, []);
  dataSource!: MatTableDataSource<TestGroupsInListDto>;
  isLoading = false;

  @ViewChild(MatSort) sort = new MatSort();
  @ViewChild(MatSort) set matSort(sort: MatSort) {
    if (this.dataSource) {
      this.dataSource.sort = sort;
    }
  }

  constructor(
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar,
    private translateService: TranslateService
  ) {
  }

  ngOnInit(): void {
    this.createTestGroupsList(true);
  }

  deleteTestGroups(): void {
    this.isLoading = true;
    const selectedTestGroups = this.tableSelectionCheckboxes.selected;
    this.backendService.deleteTestGroups(
      this.appService.selectedWorkspaceId,
      selectedTestGroups.map(testGroup => testGroup.test_group))
      .subscribe(respOk => {
        if (respOk) {
          setTimeout(() => this.createTestGroupsList(true));
          this.snackBar.open(
            this.translateService.instant('ws-admin.test-group-deleted'),
            '',
            { duration: 1000 });
          this.isLoading = false;
        } else {
          this.snackBar.open(
            this.translateService.instant('ws-admin.test-group-not-deleted'),
            this.translateService.instant('error'),
            { duration: 1000 });
          this.isLoading = false;
        }
      });
  }

  onFileSelected(targetElement: EventTarget | null) {
    if (targetElement) {
      const inputElement = targetElement as HTMLInputElement;
      if (inputElement.files && inputElement.files.length > 0) {
        this.isLoading = true;
        this.backendService.uploadTestResults(
          this.appService.selectedWorkspaceId,
          inputElement.files
        ).subscribe(() => {
          setTimeout(() => {
            this.createTestGroupsList(true);
          }, 1000);
          this.isLoading = false;
        });
      }
    }
  }

  createCodingTestGroups():void {
    this.isLoading = true;
    const selectedTestGroups = this.tableSelectionCheckboxes.selected;
    this.backendService.createCodingTestGroups(selectedTestGroups).subscribe(() => {
    });
  }

  masterToggle(): void {
    this.isAllSelected() || !this.dataSource ?
      this.tableSelectionCheckboxes.clear() :
      this.dataSource.data.forEach(row => this.tableSelectionCheckboxes.select(row));
  }

  private isAllSelected(): boolean {
    const numSelected = this.tableSelectionCheckboxes.selected.length;
    const numRows = this.dataSource ? this.dataSource.data.length : 0;
    return numSelected === numRows;
  }

  createTestGroupsList(changed:boolean): void {
    this.isLoading = true;
    if (this.appService.workspaceData?.testGroups.length === 0 || changed) {
      this.backendService.getTestGroups(this.appService.selectedWorkspaceId)
        .subscribe(groups => {
          this.dataSource = new MatTableDataSource(groups || []);
          this.appService.workspaceData.testGroups = groups;
          this.isLoading = false;
        });
    } else {
      this.dataSource = new MatTableDataSource(this.appService.workspaceData.testGroups || []);
      this.isLoading = false;
    }
  }
}
