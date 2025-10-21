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
import { MatTooltip } from '@angular/material/tooltip';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { WorkspaceAdminService } from '../../services/workspace-admin.service';
import { ImportOptions, Result } from '../../../services/import.service';
import { TestGroupsInfoDto } from '../../../../../../../api-dto/files/test-groups-info.dto';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';

export type WorkspaceAdmin = {
  label: string,
  id: string,
  type: string,
  flags: {
    mode: string
  }
};

export type Testcenter = {
  id:number,
  label:string
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
  uploadData: Result | null = null;
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
      const storedServer = this.workspaceAdminService.getLastServer();
      const storedUrl = this.workspaceAdminService.getLastUrl();
      if (storedServer) {
        this.loginForm.get('testCenter')?.setValue(parseInt(storedServer, 10));
        if (storedUrl) {
          this.loginForm.get('testCenterIndividual')?.setValue(storedUrl);
          this.loginForm.get('testCenterIndividual')?.enable();
        }
      }
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
      this.workspaceAdminService.setLastServer(this.testCenterInstance[0]?.id.toString());
      this.workspaceAdminService.setLastUrl(url);
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
    this.workspaceAdminService.setLastServer('');
    this.workspaceAdminService.setLastUrl('');
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

    // Use stored server and url if available, otherwise fall back to form values
    const server = this.workspaceAdminService.getLastServer() || formValues.testCenter?.toString();
    const url = this.workspaceAdminService.getLastUrl() || formValues.testCenterIndividual;

    this.isUploadingTestResults = true;
    this.backendService
      .importTestcenterGroups(
        this.appService.selectedWorkspaceId,
        formValues.workspace,
        server,
        url,
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
    this.uploadData = null;
    this.showTestGroups = false;
    this.selectedRows = [];

    if (this.data.importType === 'testResults') {
      this.getTestGroups();
    }
  }

  goBackToTestGroups(): void {
    this.uploadData = null;
    this.selectedRows = [];
    this.showTestGroups = true;
  }

  refreshTestGroups(): void {
    const formValues = {
      testCenter: this.loginForm.get('testCenter')?.value,
      workspace: this.importFilesForm.get('workspace')?.value,
      testCenterIndividual: this.loginForm.get('testCenterIndividual')?.value || ''
    };

    const server = this.workspaceAdminService.getLastServer() || formValues.testCenter?.toString();
    const url = this.workspaceAdminService.getLastUrl() || formValues.testCenterIndividual;

    const tempIsUploadingTestResults = this.isUploadingTestResults;
    this.isUploadingTestResults = true;

    this.backendService
      .importTestcenterGroups(
        this.appService.selectedWorkspaceId,
        formValues.workspace,
        server,
        url,
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

  private hasSelectedGroupsWithLogs(): boolean {
    return this.selectedRows.some(group => group.hasBookletLogs);
  }

  private async confirmOverwriteLogs(): Promise<boolean> {
    const groupsWithLogs = this.selectedRows.filter(group => group.hasBookletLogs);

    if (groupsWithLogs.length === 0) {
      return true;
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

    this.uploadData = null;
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
            importedGroups: selectedGroupNames,
            filesPlayer: 0,
            filesUnits: 0,
            filesDefinitions: 0,
            filesCodings: 0,
            filesBooklets: 0,
            filesTestTakers: 0
          };
          this.isUploadingTestFiles = false;
          this.isUploadingTestResults = false;
        }
      });
  }
}
