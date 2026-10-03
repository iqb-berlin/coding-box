import { Component, inject } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import {
  MatDialogContent,
  MatDialogActions,
  MatDialogClose,
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogRef
} from '@angular/material/dialog';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import {
  FormsModule,
  ReactiveFormsModule,
  UntypedFormBuilder,
  UntypedFormGroup,
  Validators
} from '@angular/forms';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatIcon } from '@angular/material/icon';
import {
  catchError, exhaustMap, firstValueFrom, interval, of, startWith, Subscription, switchMap
} from 'rxjs';
import { DatePipe } from '@angular/common';
import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatRow,
  MatRowDef,
  MatTable
} from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { ImportService, ImportOptions, Result } from '../../../shared/services/file/import.service';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceAdminService } from '../../services/workspace-admin.service';
import { TestGroupsInfoDto } from '../../../../../../../api-dto/files/test-groups-info.dto';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/dialogs/confirm-dialog.component';
import {
  TestFilesUploadConflictsDialogComponent,
  TestFilesUploadConflictsDialogResult
} from '../test-files/test-files-upload-conflicts-dialog.component';
import { TestFilesUploadResultDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import {
  ImportWorkspaceFilesProgressDto,
  ImportWorkspaceOptionKey
} from '../../../../../../../api-dto/files/import-workspace-progress.dto';
import { TestGroupsLoadProgressDto } from '../../../../../../../api-dto/files/test-groups-load-progress.dto';
import { TestResultsOverwriteMode } from '../../../../../../../api-dto/files/import-options.dto';

export type WorkspaceAdmin = {
  label: string;
  id: string;
  type: string;
  flags: {
    mode: string;
  };
};

export type Testcenter = {
  id: number;
  label: string;
};

export interface ImportFormValues {
  testCenter: number;
  workspace: string;
  testCenterIndividual: string;
  importOptions: ImportOptions;
  responseOverwriteMode: TestResultsOverwriteMode;
}

@Component({
  selector: 'coding-box-test-center-import',
  templateUrl: 'test-center-import.component.html',
  styleUrls: ['./test-center-import.component.scss'],
  imports: [
    MatDialogContent,
    MatLabel,
    MatHint,
    MatDialogActions,
    MatButton,
    MatDialogClose,
    TranslateModule,
    MatFormField,
    ReactiveFormsModule,
    MatInput,
    MatSelect,
    MatOption,
    MatCheckbox,
    MatProgressSpinner,
    MatProgressBar,
    MatIcon,
    FormsModule,
    DatePipe,
    MatTable,
    MatHeaderCellDef,
    MatCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatColumnDef,
    MatHeaderCell,
    MatCell,
    MatHeaderRow,
    MatRow,
    MatTooltip
  ]
})
export class TestCenterImportComponent {
  private userBackendService = inject(UserBackendService);
  private importService = inject(ImportService);
  private dialogRef = inject(MatDialogRef<TestCenterImportComponent>);
  data = inject<{
    importType: string;
  }>(MAT_DIALOG_DATA);

  private workspaceAdminService = inject(WorkspaceAdminService);
  private fb = inject(UntypedFormBuilder);
  private appService = inject(AppService);
  private dialog = inject(MatDialog);
  private translate = inject(TranslateService);

  testCenters: Testcenter[] = [
    {
      id: 1,
      label: 'Testcenter 1'
    },
    {
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
    }
  ];

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
  testGroupsLoadError: string | null = null;
  uploadError: string | null = null;
  authenticated: boolean = false;
  isLoadingTestGroups: boolean = false;
  isUploadingTestFiles: boolean = false;
  isUploadingTestResults: boolean = false;
  uploadData: Result | null = null;
  private firstTestFilesImportData: Result | null = null;
  testCenterInstance: Testcenter[] = [];
  showTestGroups: boolean = false;
  importingTestGroups: string[] = [];
  importProgressPercent: number = 0;
  totalUploadsExpected: number = 0;
  completedUploads: number = 0;
  importRunId: string | null = null;
  uploadProgressDetails: ImportWorkspaceFilesProgressDto | null = null;
  testGroupsLoadProgress: TestGroupsLoadProgressDto | null = null;
  testGroupsLoadElapsedSeconds: number = 0;
  private progressPollingSub?: Subscription;
  private testGroupsProgressPollingSub?: Subscription;
  private testGroupsLoadStartedAt: number | null = null;
  resultStatusUncertain = false;
  isCheckingImportStatus = false;
  isConfirmingImport = false;
  completedGroupNames: string[] = [];
  failedGroupName: string | null = null;
  importElapsedSeconds = 0;
  private retrySelection?: {
    workspaceId: number;
    tcWorkspace: string;
    testCenter: number;
    url: string;
    groups: string[];
  };

  private resultImportState?: {
    formValues: ImportFormValues;
    groups: string[];
    index: number;
    overwriteExistingLogs: boolean;
    workspaceId: number;
    mergedResult: Result | null;
  };

  constructor() {
    this.loginForm = this.fb.group({
      name: this.fb.control('', [Validators.required, Validators.minLength(1)]),
      pw: this.fb.control('', [Validators.required, Validators.minLength(1)]),
      testCenter: this.fb.control('', [Validators.required]),
      testCenterIndividual: this.fb.control({ value: '', disabled: true }, [
        Validators.required
      ])
    });
    this.importFilesForm = this.fb.group({
      workspace: this.fb.control('', [Validators.required]),
      responses: this.fb.control(false),
      definitions: this.fb.control(false),
      units: this.fb.control(false),
      player: this.fb.control(false),
      codings: this.fb.control(false),
      logs: this.fb.control(false),
      responseOverwriteMode: this.fb.control('skip'),
      testTakers: this.fb.control(false),
      booklets: this.fb.control(false),
      metadata: this.fb.control(false)
    });
  }

  selectAllImportOptions(): void {
    let optionControls: string[];

    if (this.data.importType === 'testResults') {
      // For results import, only responses and logs are relevant
      optionControls = ['responses', 'logs'];
    } else {
      // For test files import, only file-related options are relevant
      optionControls = [
        'definitions',
        'units',
        'player',
        'codings',
        'booklets',
        'testTakers',
        'metadata'
      ];
    }

    optionControls.forEach(name => {
      this.importFilesForm.get(name)?.setValue(true);
    });

    this.filesSelectionError = false;
  }

  clearAllImportOptions(): void {
    const optionControls: string[] = [
      'responses',
      'definitions',
      'units',
      'player',
      'codings',
      'logs',
      'testTakers',
      'booklets',
      'metadata'
    ];

    optionControls.forEach(name => {
      this.importFilesForm.get(name)?.setValue(false);
    });
  }

  ngOnInit(): void {
    // Ensure we always start with a clean state when the dialog opens
    this.uploadData = null;
    this.isUploadingTestFiles = false;
    this.isUploadingTestResults = false;
    this.filesSelectionError = false;

    if (this.workspaceAdminService.getAuthToken()) {
      this.authenticated = true;
      this.authToken = this.workspaceAdminService.getAuthToken();
      this.workspaces = this.workspaceAdminService.getClaims();
      this.testCenterInstance =
        this.workspaceAdminService.getlastTestcenterInstance();
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

  ngOnDestroy(): void {
    this.stopUploadProgressPolling();
    this.stopTestGroupsProgressPolling();
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
    return this.testGroups.length > 0 &&
      this.selectedRows.length === this.testGroups.length;
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
    const url: string = this.loginForm.get('testCenterIndividual')?.value;
    this.testCenterInstance = this.testCenters.filter(
      testcenter => testcenter.id === this.loginForm.get('testCenter')?.value
    );
    this.userBackendService
      .authenticate(name, pw, this.testCenterInstance[0]?.id.toString(), url)
      .pipe(
        catchError(() => {
          this.authenticationError = true;
          return of();
        })
      )
      .subscribe((response: { token?: string; claims?: { workspaceAdmin: WorkspaceAdmin[] } }) => {
        if (!response || !response.token || !response.claims) {
          this.authenticationError = true;
          return;
        }
        this.authToken = response.token;
        this.authenticationError = false;
        this.workspaceAdminService.setLastAuthToken(response.token);
        this.workspaceAdminService.setLastServer(
          this.testCenterInstance[0]?.id.toString()
        );
        this.workspaceAdminService.setLastUrl(url);
        this.workspaceAdminService.setClaims(response.claims.workspaceAdmin);
        this.workspaceAdminService.setlastTestcenterInstance(
          this.testCenterInstance
        );
        this.workspaces = response.claims.workspaceAdmin;
        this.authenticated = true;
      });
  }

  logout(): boolean {
    this.retrySelection = undefined;
    this.failedGroupName = null;
    this.completedGroupNames = [];
    this.uploadData = null;
    this.uploadError = null;
    this.resetUploadProgress();
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

  isIndividualTcSelected(value: number): void {
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
      testCenterIndividual:
        this.loginForm.get('testCenterIndividual')?.value || ''
    };

    // Use stored server and url if available, otherwise fall back to form values
    const server =
      this.workspaceAdminService.getLastServer() ||
      formValues.testCenter?.toString();
    const url =
      this.workspaceAdminService.getLastUrl() ||
      formValues.testCenterIndividual;

    const retrySelection = this.retrySelection;
    const restoreSelection = !!retrySelection &&
      retrySelection.workspaceId === this.appService.selectedWorkspaceId &&
      retrySelection.tcWorkspace === formValues.workspace &&
      retrySelection.testCenter === Number(formValues.testCenter) &&
      retrySelection.url === formValues.testCenterIndividual;
    const retryGroupNames = new Set(restoreSelection ? retrySelection.groups : []);
    if (retrySelection && !restoreSelection) {
      this.retrySelection = undefined;
      this.failedGroupName = null;
      this.completedGroupNames = [];
      this.uploadData = null;
      this.resetUploadProgress();
    }

    const importRunId = this.createImportRunId();
    this.isLoadingTestGroups = true;
    this.importProgressPercent = 0;
    this.testGroupsLoadProgress = null;
    this.testGroupsLoadElapsedSeconds = 0;
    this.testGroupsLoadError = null;
    this.uploadError = null;
    this.startTestGroupsProgressPolling(importRunId);
    this.importService
      .importTestcenterGroups(
        this.appService.selectedWorkspaceId,
        formValues.workspace,
        server,
        url,
        this.authToken,
        importRunId
      )
      .subscribe({
        next: (response: TestGroupsInfoDto[]) => {
          this.isLoadingTestGroups = false;
          this.stopTestGroupsProgressPolling();
          this.workspaceAdminService.setTestGroups(response);
          this.testGroups = response;
          this.selectedRows = restoreSelection ?
            response.filter(group => retryGroupNames.has(group.groupName)) : [];
          this.showTestGroups = true;
        },
        error: error => {
          this.isLoadingTestGroups = false;
          this.stopTestGroupsProgressPolling();
          this.testGroups = [];
          this.selectedRows = [];
          this.showTestGroups = false;
          this.testGroupsLoadError = this.getErrorMessage(
            error,
            'Testgruppen konnten nicht abgerufen werden. Bitte Verbindung und Testcenter-Sitzung prüfen.'
          );
        }
      });
  }

  goBackToOptions(): void {
    if (this.retrySelection) {
      this.retrySelection.groups = this.selectedRows.map(group => group.groupName);
    }
    this.showTestGroups = false;
    this.selectedRows = [];
  }

  private hasSelectedGroupsWithLogs(): boolean {
    return this.selectedRows.some(group => group.hasBookletLogs);
  }

  private async confirmOverwriteLogs(): Promise<'overwrite' | 'skip' | 'cancel'> {
    const groupsWithLogs = this.selectedRows.filter(
      group => group.hasBookletLogs
    );

    if (groupsWithLogs.length === 0) {
      return 'overwrite';
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: <ConfirmDialogData>{
        title: 'Vorhandene Logs gefunden',
        content:
          `${groupsWithLogs.length} ausgewählte Testgruppe(n) haben bereits Booklet-Logs in der Datenbank. ` +
          'Möchten Sie die vorhandenen Logs überschreiben oder vorhandene Logs überspringen?',
        confirmButtonLabel: 'Überschreiben',
        alternativeButtonLabel: 'Ohne Überschreiben fortfahren',
        alternativeButtonValue: 'skip',
        cancelButtonLabel: 'Abbrechen',
        showCancel: true
      }
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (result === true) return 'overwrite';
    if (result === 'skip') return 'skip';
    return 'cancel';
  }

  getTestData(): void {
    if (this.isUploadingTestFiles || this.isUploadingTestResults || this.resultStatusUncertain || this.isConfirmingImport) return;
    const formValues = {
      testCenter: this.loginForm.get('testCenter')?.value,
      workspace: this.importFilesForm.get('workspace')?.value,
      testCenterIndividual:
        this.loginForm.get('testCenterIndividual')?.value || '',
      importOptions: {
        definitions: this.importFilesForm.get('definitions')?.value,
        responses: this.importFilesForm.get('responses')?.value,
        units: this.importFilesForm.get('units')?.value,
        player: this.importFilesForm.get('player')?.value,
        codings: this.importFilesForm.get('codings')?.value,
        logs: this.importFilesForm.get('logs')?.value,
        testTakers: this.importFilesForm.get('testTakers')?.value,
        booklets: this.importFilesForm.get('booklets')?.value,
        metadata: this.importFilesForm.get('metadata')?.value
      },
      responseOverwriteMode:
        this.importFilesForm.get('responseOverwriteMode')?.value || 'skip'
    };

    this.uploadData = null;
    this.firstTestFilesImportData = null;
    this.uploadError = null;
    this.completedGroupNames = [];
    this.failedGroupName = null;
    this.retrySelection = undefined;
    this.isUploadingTestFiles = true;
    this.isUploadingTestResults = this.data.importType === 'testResults';
    this.importProgressPercent = 0;
    const selectedGroupNames = this.selectedRows.map(
      group => group.groupName
    );
    this.initializeUploadProgress(selectedGroupNames.length);

    // Store the test group names for display in loading message
    this.importingTestGroups = selectedGroupNames;

    const needsConfirmation =
      formValues.importOptions.logs && this.hasSelectedGroupsWithLogs();

    if (needsConfirmation) {
      this.isConfirmingImport = true;
      this.isUploadingTestFiles = false;
      this.isUploadingTestResults = false;
      this.resetUploadProgress();

      this.confirmOverwriteLogs().then(choice => {
        this.isConfirmingImport = false;
        if (choice === 'cancel') {
          this.resetUploadProgress();
          return;
        }
        if (choice === 'overwrite') {
          this.isUploadingTestFiles = true;
          this.isUploadingTestResults = this.data.importType === 'testResults';
          this.initializeUploadProgress(selectedGroupNames.length);
          this.performImport(formValues, selectedGroupNames, true);
        } else {
          this.isUploadingTestFiles = true;
          this.isUploadingTestResults = this.data.importType === 'testResults';
          this.initializeUploadProgress(selectedGroupNames.length);
          this.performImport(formValues, selectedGroupNames, false);
        }
      });
    } else {
      this.performImport(formValues, selectedGroupNames, true);
    }
  }

  loadingMessage = 'Testresultate werden hochgeladen...';

  readonly optionLabels: Record<ImportWorkspaceOptionKey, string> = {
    definitions: 'Aufgabendefinitionen',
    units: 'Aufgaben (Units-XML)',
    player: 'Player',
    codings: 'Kodierschemata',
    booklets: 'Testhefte',
    testTakers: 'Testteilnehmer',
    metadata: 'Metadaten'
  };

  private performImport(
    formValues: ImportFormValues,
    selectedGroupNames: string[],
    overwriteExistingLogs: boolean,
    overwriteFileIds?: string[],
    responseOverwriteMode: TestResultsOverwriteMode = 'skip'
  ): void {
    const importedResponses = !!formValues.importOptions.responses;
    const importedLogs = !!formValues.importOptions.logs;

    if (importedLogs && importedResponses) {
      this.loadingMessage = `Importiere Antworten und Logs für Testgruppen: ${selectedGroupNames.join(', ')}...`;
    } else if (importedLogs) {
      this.loadingMessage = `Importiere Logs für Testgruppen: ${selectedGroupNames.join(', ')}...`;
    } else if (importedResponses) {
      this.loadingMessage = `Importiere Antworten für Testgruppen: ${selectedGroupNames.join(', ')}...`;
    } else {
      this.loadingMessage = `Importiere Daten für Testgruppen: ${selectedGroupNames.join(', ')}...`;
    }

    if (this.data.importType === 'testResults') {
      this.performTestResultsImportWithProgress(
        formValues,
        selectedGroupNames,
        overwriteExistingLogs
      );
      return;
    }

    this.importRunId = this.createImportRunId();
    this.startUploadProgressPolling(this.importRunId);

    this.importService
      .importWorkspaceFiles(
        this.appService.selectedWorkspaceId,
        formValues.workspace,
        formValues.testCenter.toString(),
        formValues.testCenterIndividual,
        this.authToken,
        formValues.importOptions,
        selectedGroupNames,
        overwriteExistingLogs,
        overwriteFileIds,
        this.importRunId,
        responseOverwriteMode
      )
      .subscribe({
        next: data => {
          this.incrementCompletedUploads();
          // Keep the latest response for non-testFiles flows.
          // For the two-step testFiles flow we store the initial response separately to avoid self-merging.
          this.uploadData = data;
          this.isUploadingTestFiles = false;
          this.isUploadingTestResults = false;
          this.stopUploadProgressPolling();

          if (this.data.importType === 'testResults') {
            // Do not open a nested dialog here; return a payload to the caller.
            // The caller will compute correct before/after/delta stats from workspace overview.
            // Flags are already calculated above
            const resultType: 'logs' | 'responses' = importedResponses ?
              'responses' :
              'logs';

            this.dialogRef.close({
              didImport: true,
              resultType,
              importedResponses,
              importedLogs,
              uploadResult: data
            });
            return;
          }

          if (this.data.importType === 'testFiles') {
            const initialResult = data.testFilesUploadResult;
            const initialConflicts = initialResult?.conflicts || [];

            if (!overwriteFileIds && initialConflicts.length > 0) {
              // Persist the first result before triggering the second (overwrite-only) import.
              this.firstTestFilesImportData = data;

              const ref = this.dialog.open<
              TestFilesUploadConflictsDialogComponent,
              { conflicts: typeof initialConflicts },
              TestFilesUploadConflictsDialogResult
              >(TestFilesUploadConflictsDialogComponent, {
                width: '800px',
                maxWidth: '95vw',
                data: { conflicts: initialConflicts }
              });

              ref.afterClosed().subscribe((choice: TestFilesUploadConflictsDialogResult | undefined) => {
                if (
                  choice?.overwrite === true &&
                  (choice.overwriteFileIds || []).length > 0
                ) {
                  this.isUploadingTestFiles = true;
                  this.performImport(
                    formValues,
                    selectedGroupNames,
                    overwriteExistingLogs,
                    choice.overwriteFileIds
                  );
                } else {
                  // User chose not to overwrite (or selected none): close with initial result.
                  this.dialogRef.close({
                    didImport: true,
                    importType: 'testFiles',
                    result: data
                  });
                }
              });
              return;
            }

            // Second call: overwrite-only import. Merge with previous (stored in uploadData).
            if (overwriteFileIds && this.firstTestFilesImportData) {
              const firstResult = this.firstTestFilesImportData.testFilesUploadResult;
              const secondResult = data.testFilesUploadResult;

              const mergedUploadedFiles = [
                ...(firstResult?.uploadedFiles || []),
                ...(secondResult?.uploadedFiles || [])
              ];

              const mergedFailedFiles = [
                ...(firstResult?.failedFiles || []),
                ...(secondResult?.failedFiles || [])
              ];

              const remainingConflicts = (firstResult?.conflicts || []).filter(
                c => !(overwriteFileIds || []).includes(c.fileId)
              );

              const mergedIssues = [
                ...(firstResult?.issues || []),
                ...(secondResult?.issues || [])
              ];

              const mergedResult: TestFilesUploadResultDto = {
                total: Number(
                  firstResult?.total ??
                  mergedUploadedFiles.length + mergedFailedFiles.length
                ),
                uploaded: mergedUploadedFiles.length,
                failed: mergedFailedFiles.length,
                uploadedFiles: mergedUploadedFiles,
                failedFiles: mergedFailedFiles,
                conflicts: remainingConflicts,
                issues: mergedIssues.length > 0 ? mergedIssues : undefined
              };

              const mergedData = {
                ...(data as unknown as Record<string, unknown>),
                testFilesUploadResult: mergedResult
              };

              this.dialogRef.close({
                didImport: true,
                importType: 'testFiles',
                overwriteSelectedCount: overwriteFileIds.length,
                result: mergedData
              });
              return;
            }

            this.dialogRef.close({
              didImport: true,
              importType: 'testFiles',
              result: data
            });
            return;
          }

          this.selectedRows = [];
        },
        error: error => {
          this.uploadError = this.getErrorMessage(
            error,
            'Testcenter-Import fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.'
          );
          this.isUploadingTestFiles = false;
          this.isUploadingTestResults = false;
          this.stopUploadProgressPolling();
          this.resetUploadProgress();
        }
      });
  }

  private mergeImportResults(base: Result | null, current: Result): Result {
    if (!base) return { ...current };
    return {
      ...current,
      success: (base.success ?? false) && (current.success ?? false),
      testFiles: (base.testFiles || 0) + (current.testFiles || 0),
      responses: (base.responses || 0) + (current.responses || 0),
      logs: (base.logs || 0) + (current.logs || 0),
      // These are workspace totals, not per-group deltas.
      booklets: current.booklets || base.booklets || 0,
      units: current.units || base.units || 0,
      persons: current.persons || base.persons || 0,
      importedGroups: [...new Set([...(base.importedGroups || []), ...(current.importedGroups || [])])],
      issues: [...(base.issues || []), ...(current.issues || [])],
      codingFreshness: current.codingFreshness || base.codingFreshness
    };
  }

  private async performTestResultsImportWithProgress(
    formValues: ImportFormValues,
    selectedGroupNames: string[],
    overwriteExistingLogs: boolean
  ): Promise<void> {
    this.resultImportState = {
      formValues,
      groups: selectedGroupNames,
      index: 0,
      overwriteExistingLogs,
      workspaceId: this.appService.selectedWorkspaceId,
      mergedResult: null
    };
    await this.continueTestResultsImport();
  }

  private async continueTestResultsImport(recoveredResult?: Result): Promise<void> {
    const state = this.resultImportState;
    if (!state) return;
    this.resultStatusUncertain = false;
    this.uploadError = null;
    this.isUploadingTestFiles = true;
    this.isUploadingTestResults = true;
    const { formValues } = state;
    let pendingRecoveredResult = recoveredResult;
    while (state.index < state.groups.length) {
      const groupName = state.groups[state.index];
      this.importProgressPercent = this.uploadProgressPercent;
      this.loadingMessage = `Importiere Testgruppe ${state.index + 1}/${state.groups.length}: ${groupName} (${this.importProgressPercent}%)...`;
      let currentResult = pendingRecoveredResult;
      pendingRecoveredResult = undefined;
      if (!currentResult) {
        this.importRunId = this.createImportRunId();
        this.uploadProgressDetails = null;
        this.startResultImportProgressPolling(state.workspaceId, this.importRunId);
        try {
          currentResult = await firstValueFrom(this.importService.importWorkspaceFiles(
            state.workspaceId, formValues.workspace, formValues.testCenter.toString(), formValues.testCenterIndividual, this.authToken, formValues.importOptions, [groupName], state.overwriteExistingLogs, undefined, this.importRunId, formValues.responseOverwriteMode
          ));
        } catch (error) {
          // A disconnected request does not cancel persistence on the server.
          const progress = await firstValueFrom(this.importService.getImportWorkspaceFilesProgress(state.workspaceId, this.importRunId));
          this.uploadProgressDetails = progress;
          if ((progress?.status === 'completed' || progress?.status === 'failed') && progress.result) {
            currentResult = progress.result;
          } else if (progress?.status !== 'running' &&
            this.importWasRejectedBeforeStart(error)) {
            currentResult = {
              success: false,
              testFiles: 0,
              responses: 0,
              logs: 0,
              booklets: 0,
              units: 0,
              persons: 0,
              importedGroups: [],
              issues: [{ level: 'error', message: this.getErrorMessage(error, this.translate.instant('testcenter-import.not-started')) }]
            };
          } else {
            this.resultStatusUncertain = true;
            this.uploadError = this.getErrorMessage(error, this.translate.instant('testcenter-import.connection-error'));
            this.stopResultImport();
            return;
          }
        }
        this.stopUploadProgressPolling();
      }
      state.mergedResult = this.mergeImportResults(state.mergedResult, currentResult);
      this.uploadData = state.mergedResult;
      if (currentResult.success === false) {
        this.failedGroupName = groupName;
        this.uploadError = currentResult.issues?.filter(issue => issue.level === 'error').map(issue => issue.message).join(' ') ||
          `Import der Testgruppe "${groupName}" wurde nicht vollständig abgeschlossen.`;
        const remainingGroups = new Set(state.groups.slice(state.index));
        this.selectedRows = this.selectedRows.filter(group => remainingGroups.has(group.groupName));
        this.retrySelection = {
          workspaceId: state.workspaceId,
          tcWorkspace: formValues.workspace,
          testCenter: Number(formValues.testCenter),
          url: formValues.testCenterIndividual,
          groups: this.selectedRows.map(group => group.groupName)
        };
        this.resultImportState = undefined;
        this.stopResultImport();
        return;
      }
      this.completedGroupNames.push(groupName);
      this.incrementCompletedUploads();
      state.index += 1;
    }
    this.importProgressPercent = 100;
    this.stopResultImport();
    this.resultImportState = undefined;
    const importedResponses = !!formValues.importOptions.responses;
    this.dialogRef.close({
      didImport: true,
      resultType: importedResponses ? 'responses' : 'logs',
      importedResponses,
      importedLogs: !!formValues.importOptions.logs,
      uploadResult: state.mergedResult
    });
  }

  async checkTestResultsImportStatus(): Promise<void> {
    const state = this.resultImportState;
    if (!state || !this.importRunId || this.isCheckingImportStatus) return;
    this.isCheckingImportStatus = true;
    try {
      const progress = await firstValueFrom(this.importService.getImportWorkspaceFilesProgress(state.workspaceId, this.importRunId));
      this.uploadProgressDetails = progress;
      if ((progress?.status === 'completed' || progress?.status === 'failed') && progress.result) {
        await this.continueTestResultsImport(progress.result);
      }
    } finally {
      this.isCheckingImportStatus = false;
    }
  }

  private stopResultImport(): void {
    this.stopUploadProgressPolling();
    this.isUploadingTestFiles = false;
    this.isUploadingTestResults = false;
  }

  private startResultImportProgressPolling(workspaceId: number, importRunId: string): void {
    this.stopUploadProgressPolling();
    const startedAt = Date.now();
    this.importElapsedSeconds = 0;
    this.progressPollingSub = interval(2000).pipe(
      startWith(0),
      exhaustMap(() => this.importService.getImportWorkspaceFilesProgress(workspaceId, importRunId))
    ).subscribe(progress => {
      this.importElapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      if (progress) this.uploadProgressDetails = progress;
    });
  }

  private getErrorMessage(error: unknown, fallback: string): string {
    const maybeHttpError = error as {
      error?: { message?: string } | string;
      message?: string;
      status?: number;
    };
    const detail =
      (typeof maybeHttpError?.error === 'string' && maybeHttpError.error) ||
      (typeof maybeHttpError?.error === 'object' && maybeHttpError.error?.message) ||
      maybeHttpError?.message ||
      (maybeHttpError?.status ? `HTTP ${maybeHttpError.status}` : '');

    return detail ? `${fallback} (${detail})` : fallback;
  }

  private importWasRejectedBeforeStart(error: unknown): boolean {
    const httpError = error as { status?: number; error?: { importNotStarted?: boolean } };
    return httpError?.error?.importNotStarted === true || httpError?.status === 401 || httpError?.status === 403;
  }

  get uploadProgressPercent(): number {
    if (this.totalUploadsExpected <= 0) return 0;
    return Math.round((this.completedUploads / this.totalUploadsExpected) * 100);
  }

  get testGroupsLoadPercent(): number {
    const totalGroups = this.testGroupsLoadProgress?.totalGroups || 0;
    if (totalGroups <= 0) return 0;
    if (this.testGroupsLoadProgress?.status === 'completed') return 100;
    return Math.round(
      ((this.testGroupsLoadProgress?.processedGroups || 0) / totalGroups) * 100
    );
  }

  get testGroupsLoadMessage(): string {
    if (this.testGroupsLoadProgress?.status === 'unknown') {
      return 'Verbindung zum Testcenter wird hergestellt.';
    }
    return this.testGroupsLoadProgress?.message ||
      'Testgruppen werden vom Testcenter abgerufen.';
  }

  get testGroupsLoadElapsedText(): string {
    if (this.testGroupsLoadElapsedSeconds < 60) {
      return `${this.testGroupsLoadElapsedSeconds} s`;
    }
    const minutes = Math.floor(this.testGroupsLoadElapsedSeconds / 60);
    const seconds = this.testGroupsLoadElapsedSeconds % 60;
    return `${minutes} min ${seconds} s`;
  }

  private initializeUploadProgress(selectedGroupCount: number): void {
    if (this.data.importType === 'testResults') {
      this.totalUploadsExpected = selectedGroupCount;
      this.completedUploads = 0;
      this.uploadProgressDetails = null;
      return;
    }

    this.totalUploadsExpected = 1;
    this.completedUploads = 0;
    this.uploadProgressDetails = null;
  }

  private incrementCompletedUploads(): void {
    if (this.totalUploadsExpected <= 0) return;
    this.completedUploads = Math.min(
      this.completedUploads + 1,
      this.totalUploadsExpected
    );
  }

  private resetUploadProgress(): void {
    this.stopUploadProgressPolling();
    this.totalUploadsExpected = 0;
    this.completedUploads = 0;
    this.importRunId = null;
    this.uploadProgressDetails = null;
  }

  private createImportRunId(): string {
    return `tc-import-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private startTestGroupsProgressPolling(importRunId: string): void {
    this.stopTestGroupsProgressPolling();
    this.testGroupsLoadStartedAt = Date.now();
    this.testGroupsProgressPollingSub = interval(700).pipe(
      startWith(0),
      switchMap(() => this.importService.getTestGroupsLoadProgress(
        this.appService.selectedWorkspaceId,
        importRunId
      ))
    ).subscribe(progress => {
      this.updateTestGroupsLoadElapsedSeconds();
      if (!progress) return;

      this.testGroupsLoadProgress = progress;

      if (progress.status === 'completed' || progress.status === 'failed') {
        this.stopTestGroupsProgressPolling();
      }
    });
  }

  private stopTestGroupsProgressPolling(): void {
    this.testGroupsProgressPollingSub?.unsubscribe();
    this.testGroupsProgressPollingSub = undefined;
  }

  private updateTestGroupsLoadElapsedSeconds(): void {
    if (!this.testGroupsLoadStartedAt) {
      this.testGroupsLoadElapsedSeconds = 0;
      return;
    }

    this.testGroupsLoadElapsedSeconds = Math.floor(
      (Date.now() - this.testGroupsLoadStartedAt) / 1000
    );
  }

  private startUploadProgressPolling(importRunId: string): void {
    this.stopUploadProgressPolling();
    this.progressPollingSub = interval(700).pipe(
      startWith(0),
      switchMap(() => this.importService.getImportWorkspaceFilesProgress(
        this.appService.selectedWorkspaceId,
        importRunId
      ))
    ).subscribe(progress => {
      if (!progress) return;

      this.uploadProgressDetails = progress;
      this.totalUploadsExpected = progress.totalPlanned;
      this.completedUploads = progress.totalUploaded;

      if (progress.status === 'completed' || progress.status === 'failed') {
        this.stopUploadProgressPolling();
      }
    });
  }

  private stopUploadProgressPolling(): void {
    this.progressPollingSub?.unsubscribe();
    this.progressPollingSub = undefined;
  }

  get visibleOptionProgress(): NonNullable<ImportWorkspaceFilesProgressDto['options']> {
    return (this.uploadProgressDetails?.options || []).filter(option => option.planned > 0);
  }
}
