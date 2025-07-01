import { Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import {
  MatDialogContent, MatDialogActions, MatDialogClose,
  MAT_DIALOG_DATA, MatDialog
} from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import {
  FormsModule,
  ReactiveFormsModule, UntypedFormBuilder, UntypedFormGroup, Validators
} from '@angular/forms';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { catchError, firstValueFrom, of } from 'rxjs';
import { DatePipe } from '@angular/common';
import {
  MatCell,
  MatCellDef, MatColumnDef, MatHeaderCell, MatHeaderCellDef, MatHeaderRow, MatHeaderRowDef, MatRow, MatRowDef, MatTable
} from '@angular/material/table';
// eslint-disable-next-line import/no-cycle
import { MatTooltip } from '@angular/material/tooltip';
// eslint-disable-next-line import/no-cycle
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { WorkspaceAdminService } from '../../services/workspace-admin.service';
import { TestGroupsInfoDto } from '../../../../../../../api-dto/files/test-groups-info.dto';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';

export type ServerResponse = {
  token: string,
  displayName: string,
  customTexts: unknown,
  flags: [],
  claims: {
    workspaceAdmin: WorkspaceAdmin[],
  },
  groupToken: null,
  access: {
    workspaceAdmin: string[],
  }
};

export type WorkspaceAdmin = {
  label: string,
  id: string,
  type: string,
  flags: {
    mode: string
  }
};

export type ImportOptions = {
  responses:string,
  definitions:string,
  units:string,
  player:string,
  codings:string,
  logs:string,
  testTakers:string,
  booklets:string
};

export type Testcenter = {
  id:number,
  label:string
};

export type Result = {
  success: boolean,
  testFiles: number,
  responses: number,
  logs: number,
  booklets: number,
  units: number,
  persons: number,
  importedGroups: string[]
};

export interface ImportFormValues {
  testCenter: number;
  workspace: string;
  testCenterIndividual: string;
  importOptions: ImportOptions;
}

@Component({
  selector: 'coding-box-test-center-import',
  templateUrl: 'test-center-import.component.html',
  styleUrls: ['./test-center-import.component.scss'],
  imports: [MatDialogContent, MatLabel, MatDialogActions, MatButton, MatDialogClose, TranslateModule, MatFormField, ReactiveFormsModule, MatInput, MatSelect, MatOption, MatCheckbox, MatProgressSpinner, MatIcon, FormsModule, DatePipe, MatTable, MatHeaderCellDef, MatCellDef, MatHeaderRowDef, MatRowDef, MatColumnDef, MatHeaderCell, MatCell, MatHeaderRow, MatRow, MatTooltip]
})

export class TestCenterImportComponent {
  private backendService = inject(BackendService);
  data = inject<{
    importType: string;
  }>(MAT_DIALOG_DATA);

  private workspaceAdminService = inject(WorkspaceAdminService);
  private fb = inject(UntypedFormBuilder);
  private appService = inject(AppService);
  private dialog = inject(MatDialog);

  testCenters: Testcenter[] = [{
    id: 1,
    label: 'Testcenter 1'
  }, {
    id: 2,
    label: 'Testcenter 2'
  },
  {
    id: 3,
    label: 'Testcenter 3'
  },
  {
    id: 4,
    label: 'Testcenter 4'
  },
  {
    id: 5,
    label: 'Testcenter 5'
  }];

  authToken: string = '';
  displayedColumns: string[] = [
    'select',
    'groupName',
    'groupLabel',
    'status',
    'bookletsStarted',
    'numUnitsMin',
    'numUnitsMax',
    'numUnitsAvg',
    'numUnitsTotal'
  ];

  selectedRows: TestGroupsInfoDto[] = [];
  testGroups: TestGroupsInfoDto[] = [];
  workspaces: WorkspaceAdmin[] = [];
  loginForm: UntypedFormGroup;
  importFilesForm: UntypedFormGroup;
  authenticationError: boolean = false;
  filesSelectionError: boolean = false;
  authenticated: boolean = false;
  isUploadingTestFiles: boolean = false;
  isUploadingTestResults: boolean = false;
  uploadData!: Result;
  testCenterInstance: Testcenter[] = [];
  showTestGroups: boolean = false;
  constructor() {
    this.loginForm = this.fb.group({
      name: this.fb.control('', [Validators.required, Validators.minLength(1)]),
      pw: this.fb.control('', [Validators.required, Validators.minLength(1)]),
      testCenter: this.fb.control('', [Validators.required]),
      testCenterIndividual: this.fb.control({ value: '', disabled: true }, [Validators.required])

    });
    this.importFilesForm = this.fb.group({
      workspace: this.fb.control('', [Validators.required]),
      responses: this.fb.control(false),
      definitions: this.fb.control(false),
      units: this.fb.control(false),
      player: this.fb.control(false),
      codings: this.fb.control(false),
      logs: this.fb.control(false),
      testTakers: this.fb.control(false),
      booklets: this.fb.control(false)
    });
  }

  ngOnInit(): void {
    if (this.workspaceAdminService.getAuthToken()) {
      this.authenticated = true;
      this.authToken = this.workspaceAdminService.getAuthToken();
      this.workspaces = this.workspaceAdminService.getClaims();
      this.testCenterInstance = this.workspaceAdminService.getlastTestcenterInstance();
      this.testGroups = this.workspaceAdminService.getTestGroups();
    }
  }

  toggleRow(group: TestGroupsInfoDto): void {
    const index = this.selectedRows.indexOf(group);
    if (index === -1) {
      this.selectedRows.push(group);
    } else {
      this.selectedRows.splice(index, 1);
    }
  }

  isAllSelected(): boolean {
    return this.selectedRows.length === this.testGroups.length;
  }

  toggleAllRows(event: { checked: boolean }): void {
    if (event.checked) {
      this.selectedRows = [...this.testGroups];
    } else {
      this.selectedRows = [];
    }
  }

  authenticate(): void {
    const name = this.loginForm.get('name')?.value;
    const pw = this.loginForm.get('pw')?.value;
    const url:string = this.loginForm.get('testCenterIndividual')?.value;
    this.testCenterInstance = this.testCenters.filter(
      testcenter => testcenter.id === this.loginForm.get('testCenter')?.value);
    this.backendService.authenticate(name, pw, this.testCenterInstance[0]?.id.toString(), url).pipe(
      catchError(() => {
        this.authenticationError = true;
        return of();
      })).subscribe(response => {
      if (!response) {
        this.authenticationError = true;
        return;
      }
      this.authToken = response.token;
      this.authenticationError = false;
      this.workspaceAdminService.setLastAuthToken(response.token);
      this.workspaceAdminService.setClaims(response.claims.workspaceAdmin);
      this.workspaceAdminService.setlastTestcenterInstance(this.testCenterInstance);
      this.workspaces = response.claims.workspaceAdmin;
      this.authenticated = true;
    });
  }

  logout(): boolean {
    this.authenticated = false;
    this.authToken = '';
    this.workspaceAdminService.setLastAuthToken('');
    this.workspaceAdminService.setClaims([]);
    this.workspaceAdminService.setlastTestcenterInstance([]);
    this.workspaces = [];
    return true;
  }

  isIndividualTcSelected(value:number): void {
    if (value !== 6) {
      this.loginForm.get('testCenterIndividual')?.disable();
    } else {
      this.loginForm.get('testCenterIndividual')?.enable();
    }
  }

  getTestGroups(): void {
    const formValues = {
      testCenter: this.loginForm.get('testCenter')?.value,
      workspace: this.importFilesForm.get('workspace')?.value,
      testCenterIndividual: this.loginForm.get('testCenterIndividual')?.value || ''

    };
    this.isUploadingTestResults = true;
    this.backendService
      .importTestcenterGroups(
        this.appService.selectedWorkspaceId,
        formValues.workspace,
        formValues.testCenter,
        formValues.testCenterIndividual,
        this.authToken
      )
      .subscribe(response => {
        this.isUploadingTestResults = false;
        this.workspaceAdminService.setTestGroups(response);
        this.testGroups = response;
        this.showTestGroups = true;
      });
  }

  goBackToOptions(): void {
    this.showTestGroups = false;
    this.selectedRows = [];
  }

  startNewImport(): void {
    this.uploadData = {} as Result;
    this.showTestGroups = false;
    this.selectedRows = [];

    if (this.data.importType === 'testResults') {
      this.getTestGroups();
    }
  }

  goBackToTestGroups(): void {
    this.uploadData = {} as Result;
    this.selectedRows = [];
    this.showTestGroups = true;
  }

  /**
   * Refreshes the test groups list to update status after import
   */
  refreshTestGroups(): void {
    const formValues = {
      testCenter: this.loginForm.get('testCenter')?.value,
      workspace: this.importFilesForm.get('workspace')?.value,
      testCenterIndividual: this.loginForm.get('testCenterIndividual')?.value || ''
    };

    const tempIsUploadingTestResults = this.isUploadingTestResults;
    this.isUploadingTestResults = true;

    this.backendService
      .importTestcenterGroups(
        this.appService.selectedWorkspaceId,
        formValues.workspace,
        formValues.testCenter,
        formValues.testCenterIndividual,
        this.authToken
      )
      .subscribe({
        next: response => {
          this.isUploadingTestResults = tempIsUploadingTestResults;
          this.workspaceAdminService.setTestGroups(response);
          this.testGroups = response;
        },
        error: () => {
          this.isUploadingTestResults = tempIsUploadingTestResults;
        }
      });
  }

  /**
   * Check if any selected groups have logs
   * @returns True if any selected group has logs
   */
  private hasSelectedGroupsWithLogs(): boolean {
    return this.selectedRows.some(group => group.hasBookletLogs);
  }

  /**
   * Show confirmation dialog for overwriting logs
   * @returns Promise that resolves to true if user confirms, false otherwise
   */
  private async confirmOverwriteLogs(): Promise<boolean> {
    // Count groups with logs
    const groupsWithLogs = this.selectedRows.filter(group => group.hasBookletLogs);

    if (groupsWithLogs.length === 0) {
      return true; // No confirmation needed
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: <ConfirmDialogData>{
        title: 'Logs überschreiben',
        content: `${groupsWithLogs.length} ausgewählte Testgruppe(n) haben bereits Booklet-Logs in der Datenbank. ` +
                'Möchten Sie die vorhandenen Logs überschreiben?',
        confirmButtonLabel: 'Überschreiben',
        showCancel: true
      }
    });

    return firstValueFrom(dialogRef.afterClosed());
  }

  getTestData(): void {
    const formValues = {
      testCenter: this.loginForm.get('testCenter')?.value,
      workspace: this.importFilesForm.get('workspace')?.value,
      testCenterIndividual: this.loginForm.get('testCenterIndividual')?.value || '',
      importOptions: {
        definitions: this.importFilesForm.get('definitions')?.value,
        responses: this.importFilesForm.get('responses')?.value,
        units: this.importFilesForm.get('units')?.value,
        player: this.importFilesForm.get('player')?.value,
        codings: this.importFilesForm.get('codings')?.value,
        logs: this.importFilesForm.get('logs')?.value,
        testTakers: this.importFilesForm.get('testTakers')?.value,
        booklets: this.importFilesForm.get('booklets')?.value
      }
    };

    this.uploadData = {} as Result;
    this.isUploadingTestFiles = true;
    this.isUploadingTestResults = this.data.importType === 'testResults';
    const selectedGroupNames = this.selectedRows.map(group => group.groupName);

    const needsConfirmation = formValues.importOptions.logs && this.hasSelectedGroupsWithLogs();

    if (needsConfirmation) {
      this.isUploadingTestFiles = false;
      this.isUploadingTestResults = false;

      this.confirmOverwriteLogs().then(confirmed => {
        if (confirmed) {
          this.isUploadingTestFiles = true;
          this.isUploadingTestResults = this.data.importType === 'testResults';
          this.performImport(formValues, selectedGroupNames, true);
        } else {
          this.isUploadingTestFiles = true;
          this.isUploadingTestResults = this.data.importType === 'testResults';
          this.performImport(formValues, selectedGroupNames, false);
        }
      });
    } else {
      this.performImport(formValues, selectedGroupNames, true);
    }
  }

  /**
   * Perform the actual import
   * @param formValues The form values
   * @param selectedGroupNames The selected group names
   * @param overwriteExistingLogs Whether to overwrite existing logs
   */
  private performImport(
    formValues: ImportFormValues,
    selectedGroupNames: string[],
    overwriteExistingLogs: boolean
  ): void {
    this.backendService
      .importWorkspaceFiles(
        this.appService.selectedWorkspaceId,
        formValues.workspace,
        formValues.testCenter.toString(),
        formValues.testCenterIndividual,
        this.authToken,
        formValues.importOptions,
        selectedGroupNames,
        overwriteExistingLogs
      )
      .subscribe({
        next: data => {
          this.uploadData = data;
          this.isUploadingTestFiles = false;
          this.isUploadingTestResults = false;

          if (this.data.importType === 'testResults') {
            this.refreshTestGroups();
          }

          this.selectedRows = [];
        },
        error: () => {
          this.uploadData = {
            success: false,
            testFiles: 0,
            responses: 0,
            logs: 0,
            booklets: 0,
            units: 0,
            persons: 0,
            importedGroups: selectedGroupNames
          };
          this.isUploadingTestFiles = false;
          this.isUploadingTestResults = false;
        }
      });
  }
}
