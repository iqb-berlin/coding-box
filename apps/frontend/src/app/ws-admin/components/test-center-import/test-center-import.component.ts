import {
  Component, DestroyRef, inject, signal, ChangeDetectionStrategy, OnInit, OnDestroy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MatIcon } from '@angular/material/icon';
import {
  catchError, exhaustMap, firstValueFrom, interval, of, startWith, Subscription, switchMap
} from 'rxjs';
import { TestCenterLoginStepComponent } from './test-center-login-step.component';
import { TestCenterOptionsStepComponent } from './test-center-options-step.component';
import { TestCenterGroupsStepComponent } from './test-center-groups-step.component';
import { TestCenterImportProgressComponent, TestCenterImportProgressView } from './test-center-import-progress.component';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { ImportService, ImportOptions, Result } from '../../../shared/services/file/import.service';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceAdmin, Testcenter } from '../../../shared/models/test-center-authentication.model';
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
import {
  clearTestCenterImportOptions, createTestCenterImportForm, createTestCenterLoginForm,
  selectTestCenterImportOptions, updateIndividualTestCenterControl
} from './test-center-import-form';

export interface ImportFormValues {
  testCenter: number;
  workspace: string;
  testCenterIndividual: string;
  importOptions: ImportOptions;
  responseOverwriteMode: TestResultsOverwriteMode;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-test-center-import',
  templateUrl: 'test-center-import.component.html',
  styleUrls: ['./test-center-import.component.scss'],
  imports: [
    TestCenterImportProgressComponent,
    TestCenterGroupsStepComponent,
    TestCenterOptionsStepComponent,
    TestCenterLoginStepComponent,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatDialogClose,
    TranslateModule,
    MatIcon]
})
export class TestCenterImportComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private userBackendService = inject(UserBackendService);
  private importService = inject(ImportService);
  private dialogRef = inject(MatDialogRef<TestCenterImportComponent>);
  protected data = inject<{
    importType: string;
  }>(MAT_DIALOG_DATA);

  private workspaceAdminService = inject(WorkspaceAdminService);
  private appService = inject(AppService);
  private dialog = inject(MatDialog);
  private translate = inject(TranslateService);

  protected testCenters: Testcenter[] = [
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

  private authenticationRequestId = 0;
  private testGroupsRequestId = 0;
  authToken: string = '';
  protected displayedColumns: string[] = [
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
  readonly testGroups = signal<TestGroupsInfoDto[]>([]);
  readonly workspaces = signal<WorkspaceAdmin[]>([]);
  readonly loginForm = createTestCenterLoginForm();
  readonly importFilesForm = createTestCenterImportForm();

  readonly authenticationError = signal<boolean>(false);
  protected readonly filesSelectionError = signal<boolean>(false);
  protected readonly testGroupsLoadError = signal<string | null>(null);
  protected readonly uploadError = signal<string | null>(null);
  readonly authenticated = signal<boolean>(false);
  readonly isLoadingTestGroups = signal<boolean>(false);
  protected readonly isUploadingTestFiles = signal<boolean>(false);
  readonly isUploadingTestResults = signal<boolean>(false);
  readonly uploadData = signal<Result | null>(null);
  private firstTestFilesImportData: Result | null = null;
  private resultImportOptions: Pick<ImportOptions, 'responses' | 'logs'> | null = null;
  readonly testCenterInstance = signal<Testcenter[]>([]);
  readonly showTestGroups = signal<boolean>(false);
  readonly importingTestGroups = signal<string[]>([]);
  protected readonly importProgressPercent = signal<number>(0);
  protected readonly totalUploadsExpected = signal<number>(0);
  protected readonly completedUploads = signal<number>(0);
  importRunId: string | null = null;
  protected readonly uploadProgressDetails = signal<ImportWorkspaceFilesProgressDto | null>(null);
  protected readonly testGroupsLoadProgress = signal<TestGroupsLoadProgressDto | null>(null);
  protected readonly testGroupsLoadElapsedSeconds = signal<number>(0);
  private progressPollingSub?: Subscription;
  private testGroupsProgressPollingSub?: Subscription;
  private testGroupsLoadStartedAt: number | null = null;
  readonly resultStatusUncertain = signal(false);
  readonly isCheckingImportStatus = signal(false);
  readonly isConfirmingImport = signal(false);
  readonly completedGroupNames = signal<string[]>([]);
  readonly failedGroupName = signal<string | null>(null);
  readonly importElapsedSeconds = signal(0);
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

  protected selectAllImportOptions(): void {
    selectTestCenterImportOptions(this.importFilesForm, this.data.importType);
    this.filesSelectionError.set(false);
  }

  protected clearAllImportOptions(): void {
    clearTestCenterImportOptions(this.importFilesForm);
  }

  protected get importProgressView(): TestCenterImportProgressView {
    return {
      loadingGroups: this.isLoadingTestGroups(),
      uploadingResults: this.isUploadingTestResults(),
      uploadingFiles: this.isUploadingTestFiles(),
      groupsProgress: this.testGroupsLoadProgress(),
      groupsElapsedSeconds: this.testGroupsLoadElapsedSeconds(),
      groupsMessage: this.testGroupsLoadMessage,
      groupsPercent: this.testGroupsLoadPercent,
      groupsElapsedText: this.testGroupsLoadElapsedText,
      progress: this.uploadProgressDetails(),
      total: this.totalUploadsExpected(),
      completed: this.completedUploads(),
      uploadPercent: this.uploadProgressPercent,
      importPercent: this.importProgressPercent(),
      message: this.loadingMessage(),
      elapsedSeconds: this.importElapsedSeconds(),
      failedGroup: this.failedGroupName(),
      uncertain: this.resultStatusUncertain(),
      completedGroups: this.completedGroupNames(),
      importingGroups: this.importingTestGroups(),
      responsesSaved: this.uploadData()?.completedSteps?.includes('responses') ?? false,
      checkingStatus: this.isCheckingImportStatus(),
      runId: this.importRunId,
      options: this.visibleOptionProgress,
      optionLabels: this.optionLabels
    };
  }

  ngOnInit(): void {
    // Ensure we always start with a clean state when the dialog opens
    this.uploadData.set(null);
    this.isUploadingTestFiles.set(false);
    this.isUploadingTestResults.set(false);
    this.filesSelectionError.set(false);

    if (this.workspaceAdminService.getAuthToken()) {
      this.authenticated.set(true);
      this.authToken = this.workspaceAdminService.getAuthToken();
      this.workspaces.set(this.workspaceAdminService.getClaims());
      this.testCenterInstance.set(this.workspaceAdminService.getlastTestcenterInstance());
      this.testGroups.set(this.workspaceAdminService.getTestGroups());
      const storedServer = this.workspaceAdminService.getLastServer();
      const storedUrl = this.workspaceAdminService.getLastUrl();
      if (storedServer) {
        this.loginForm.controls.testCenter.setValue(parseInt(storedServer, 10));
        if (storedUrl) {
          this.loginForm.controls.testCenterIndividual.setValue(storedUrl);
          this.loginForm.controls.testCenterIndividual.enable();
        }
      }
    }
  }

  ngOnDestroy(): void {
    this.resultImportState = undefined;
    this.stopUploadProgressPolling();
    this.stopTestGroupsProgressPolling();
  }

  toggleRow(group: TestGroupsInfoDto): void {
    const index = this.selectedRows.indexOf(group);
    this.selectedRows = index === -1 ? [...this.selectedRows, group] : this.selectedRows.filter(row => row !== group);
  }

  protected isAllSelected(): boolean {
    return this.testGroups().length > 0 &&
      this.selectedRows.length === this.testGroups().length;
  }

  toggleAllRows(event: { checked: boolean }): void {
    if (event.checked) {
      this.selectedRows = [...this.testGroups()];
    } else {
      this.selectedRows = [];
    }
  }

  authenticate(): void {
    const {
      name, pw, testCenter, testCenterIndividual: url
    } = this.loginForm.getRawValue();
    if (this.loginForm.invalid || testCenter === '') {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.authenticationRequestId += 1;
    const requestId = this.authenticationRequestId;
    this.testCenterInstance.set(this.testCenters.filter(
      testcenter => testcenter.id === testCenter
    ));
    // The backend selects a custom URL only when no numbered server is sent.
    const server = testCenter === 6 ? '' : testCenter.toString();
    this.userBackendService
      .authenticate(name, pw, server, url)
      .pipe(
        catchError(() => {
          if (requestId === this.authenticationRequestId) this.authenticationError.set(true);
          return of();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response: { token?: string; claims?: { workspaceAdmin: WorkspaceAdmin[] } }) => {
        if (requestId !== this.authenticationRequestId) return;
        if (!response || !response.token || !response.claims) {
          this.authenticationError.set(true);
          return;
        }
        this.authToken = response.token;
        this.authenticationError.set(false);
        this.workspaceAdminService.setLastAuthToken(response.token);
        this.workspaceAdminService.setLastServer(
          testCenter.toString()
        );
        this.workspaceAdminService.setLastUrl(url);
        this.workspaceAdminService.setClaims(response.claims.workspaceAdmin);
        this.workspaceAdminService.setlastTestcenterInstance(
          this.testCenterInstance()
        );
        this.workspaces.set(response.claims.workspaceAdmin);
        this.authenticated.set(true);
      });
  }

  logout(): boolean {
    this.authenticationRequestId += 1;
    this.testGroupsRequestId += 1;
    this.stopTestGroupsProgressPolling();
    this.isLoadingTestGroups.set(false);
    this.showTestGroups.set(false);
    this.testGroups.set([]);
    this.selectedRows = [];
    this.retrySelection = undefined;
    this.failedGroupName.set(null);
    this.completedGroupNames.set([]);
    this.uploadData.set(null);
    this.uploadError.set(null);
    this.resetUploadProgress();
    this.authenticated.set(false);
    this.authToken = '';
    this.workspaceAdminService.setLastAuthToken('');
    this.workspaceAdminService.setLastServer('');
    this.workspaceAdminService.setLastUrl('');
    this.workspaceAdminService.setClaims([]);
    this.workspaceAdminService.setlastTestcenterInstance([]);
    this.workspaces.set([]);
    return true;
  }

  isIndividualTcSelected(value: number): void {
    updateIndividualTestCenterControl(this.loginForm, value);
  }

  getTestGroups(): void {
    this.testGroupsRequestId += 1;
    const requestId = this.testGroupsRequestId;
    const workspaceId = this.appService.selectedWorkspaceId;
    const authToken = this.authToken;
    const formValues = {
      testCenter: this.loginForm.controls.testCenter.value,
      workspace: this.importFilesForm.controls.workspace.value,
      testCenterIndividual:
        this.loginForm.controls.testCenterIndividual.value || ''
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
    const isCurrentRequest = () => requestId === this.testGroupsRequestId &&
      workspaceId === this.appService.selectedWorkspaceId && authToken === this.authToken &&
      formValues.workspace === this.importFilesForm.controls.workspace.value &&
      formValues.testCenter === this.loginForm.controls.testCenter.value &&
      formValues.testCenterIndividual === this.loginForm.controls.testCenterIndividual.value;
    const discardObsoleteRequest = () => {
      if (requestId !== this.testGroupsRequestId) return;
      this.isLoadingTestGroups.set(false);
      this.stopTestGroupsProgressPolling();
    };
    if (retrySelection && !restoreSelection) {
      this.retrySelection = undefined;
      this.failedGroupName.set(null);
      this.completedGroupNames.set([]);
      this.uploadData.set(null);
      this.resetUploadProgress();
    }

    const importRunId = this.createImportRunId();
    this.isLoadingTestGroups.set(true);
    this.testGroups.set([]);
    this.selectedRows = [];
    this.showTestGroups.set(false);
    this.importProgressPercent.set(0);
    this.testGroupsLoadProgress.set(null);
    this.testGroupsLoadElapsedSeconds.set(0);
    this.testGroupsLoadError.set(null);
    this.uploadError.set(null);
    this.startTestGroupsProgressPolling(importRunId, workspaceId);
    this.importService
      .importTestcenterGroups(
        workspaceId,
        formValues.workspace,
        server,
        url,
        authToken,
        importRunId
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: TestGroupsInfoDto[]) => {
          if (!isCurrentRequest()) {
            discardObsoleteRequest();
            return;
          }
          this.isLoadingTestGroups.set(false);
          this.stopTestGroupsProgressPolling();
          this.workspaceAdminService.setTestGroups(response);
          this.testGroups.set(response);
          this.selectedRows = restoreSelection ? response.filter(group => retryGroupNames.has(group.groupName)) : [];
          this.showTestGroups.set(true);
        },
        error: error => {
          if (!isCurrentRequest()) {
            discardObsoleteRequest();
            return;
          }
          this.isLoadingTestGroups.set(false);
          this.stopTestGroupsProgressPolling();
          this.testGroups.set([]);
          this.selectedRows = [];
          this.showTestGroups.set(false);
          this.testGroupsLoadError.set(this.getErrorMessage(
            error,
            'Testgruppen konnten nicht abgerufen werden. Bitte Verbindung und Testcenter-Sitzung prüfen.'
          ));
        }
      });
  }

  protected goBackToOptions(): void {
    if (this.retrySelection) {
      this.retrySelection.groups = this.selectedRows.map(group => group.groupName);
    }
    this.showTestGroups.set(false);
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

    const result = await firstValueFrom(
      dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)),
      { defaultValue: false }
    );
    if (result === true) return 'overwrite';
    if (result === 'skip') return 'skip';
    return 'cancel';
  }

  getTestData(): void {
    if (this.isLoadingTestGroups() || this.isUploadingTestFiles() || this.isUploadingTestResults() || this.resultStatusUncertain() || this.isConfirmingImport()) return;
    const { testCenter, testCenterIndividual } = this.loginForm.getRawValue();
    if (testCenter === '') return;
    const { workspace, responseOverwriteMode, ...importOptions } = this.importFilesForm.getRawValue();
    const formValues: ImportFormValues = {
      testCenter,
      workspace,
      testCenterIndividual,
      importOptions,
      responseOverwriteMode
    };

    this.uploadData.set(null);
    this.firstTestFilesImportData = null;
    this.uploadError.set(null);
    this.completedGroupNames.set([]);
    this.failedGroupName.set(null);
    this.retrySelection = undefined;
    this.isUploadingTestFiles.set(true);
    this.isUploadingTestResults.set(this.data.importType === 'testResults');
    this.importProgressPercent.set(0);
    const selectedGroupNames = this.selectedRows.map(
      group => group.groupName
    );
    this.initializeUploadProgress(selectedGroupNames.length);

    // Store the test group names for display in loading message
    this.importingTestGroups.set(selectedGroupNames);

    const needsConfirmation =
      formValues.importOptions.logs && this.hasSelectedGroupsWithLogs();

    if (needsConfirmation) {
      this.isConfirmingImport.set(true);
      this.isUploadingTestFiles.set(false);
      this.isUploadingTestResults.set(false);
      this.resetUploadProgress();

      this.confirmOverwriteLogs().then(choice => {
        this.isConfirmingImport.set(false);
        if (this.destroyRef.destroyed) return;
        if (choice === 'cancel') {
          this.resetUploadProgress();
          return;
        }
        if (choice === 'overwrite') {
          this.isUploadingTestFiles.set(true);
          this.isUploadingTestResults.set(this.data.importType === 'testResults');
          this.initializeUploadProgress(selectedGroupNames.length);
          this.performImport(formValues, selectedGroupNames, true);
        } else {
          this.isUploadingTestFiles.set(true);
          this.isUploadingTestResults.set(this.data.importType === 'testResults');
          this.initializeUploadProgress(selectedGroupNames.length);
          this.performImport(formValues, selectedGroupNames, false);
        }
      });
    } else {
      this.performImport(formValues, selectedGroupNames, true);
    }
  }

  protected readonly loadingMessage = signal('Testresultate werden hochgeladen...');

  protected readonly optionLabels: Record<ImportWorkspaceOptionKey, string> = {
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
      this.loadingMessage.set(`Importiere Antworten und Logs für Testgruppen: ${selectedGroupNames.join(', ')}...`);
    } else if (importedLogs) {
      this.loadingMessage.set(`Importiere Logs für Testgruppen: ${selectedGroupNames.join(', ')}...`);
    } else if (importedResponses) {
      this.loadingMessage.set(`Importiere Antworten für Testgruppen: ${selectedGroupNames.join(', ')}...`);
    } else {
      this.loadingMessage.set(`Importiere Daten für Testgruppen: ${selectedGroupNames.join(', ')}...`);
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
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => {
          this.incrementCompletedUploads();
          // Keep the latest response for non-testFiles flows.
          // For the two-step testFiles flow we store the initial response separately to avoid self-merging.
          this.uploadData.set(data);
          this.isUploadingTestFiles.set(false);
          this.isUploadingTestResults.set(false);
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

              ref.afterClosed().pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe((choice: TestFilesUploadConflictsDialogResult | undefined) => {
                  if (
                    choice?.overwrite === true &&
                    (choice.overwriteFileIds || []).length > 0
                  ) {
                    this.isUploadingTestFiles.set(true);
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
          this.uploadError.set(this.getErrorMessage(
            error,
            'Testcenter-Import fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.'
          ));
          this.isUploadingTestFiles.set(false);
          this.isUploadingTestResults.set(false);
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
    this.resultImportOptions = { ...formValues.importOptions };
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
    if (!state || this.destroyRef.destroyed) return;
    this.resultStatusUncertain.set(false);
    this.uploadError.set(null);
    this.isUploadingTestFiles.set(true);
    this.isUploadingTestResults.set(true);
    const { formValues } = state;
    let pendingRecoveredResult = recoveredResult;
    while (state.index < state.groups.length) {
      const groupName = state.groups[state.index];
      this.importProgressPercent.set(this.uploadProgressPercent);
      this.loadingMessage.set(`Importiere Testgruppe ${state.index + 1}/${state.groups.length}: ${groupName} (${this.importProgressPercent()}%)...`);
      let currentResult = pendingRecoveredResult;
      pendingRecoveredResult = undefined;
      if (!currentResult) {
        this.importRunId = this.createImportRunId();
        this.uploadProgressDetails.set(null);
        this.startResultImportProgressPolling(state.workspaceId, this.importRunId);
        try {
          currentResult = await firstValueFrom(this.importService.importWorkspaceFiles(
            state.workspaceId, formValues.workspace, formValues.testCenter.toString(), formValues.testCenterIndividual, this.authToken, formValues.importOptions, [groupName], state.overwriteExistingLogs, undefined, this.importRunId, formValues.responseOverwriteMode
          ).pipe(takeUntilDestroyed(this.destroyRef)), { defaultValue: undefined });
          if (this.destroyRef.destroyed) return;
        } catch (error) {
          if (this.destroyRef.destroyed) return;
          // A disconnected request does not cancel persistence on the server.
          const progress = await firstValueFrom(this.importService.getImportWorkspaceFilesProgress(state.workspaceId, this.importRunId)
            .pipe(takeUntilDestroyed(this.destroyRef)), { defaultValue: null });
          if (this.destroyRef.destroyed) return;
          this.uploadProgressDetails.set(progress);
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
            this.resultStatusUncertain.set(true);
            this.uploadError.set(this.getErrorMessage(error, this.translate.instant('testcenter-import.connection-error')));
            this.stopResultImport();
            return;
          }
        }
        this.stopUploadProgressPolling();
      }
      if (!currentResult) return;
      state.mergedResult = this.mergeImportResults(state.mergedResult, currentResult);
      this.uploadData.set(state.mergedResult);
      if (currentResult.success === false) {
        this.failedGroupName.set(groupName);
        this.uploadError.set(currentResult.issues?.filter(issue => issue.level === 'error').map(issue => issue.message).join(' ') ||
          `Import der Testgruppe "${groupName}" wurde nicht vollständig abgeschlossen.`);
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
      this.completedGroupNames.update(groups => [...groups, groupName]);
      this.incrementCompletedUploads();
      state.index += 1;
    }
    this.importProgressPercent.set(100);
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
    if (!state || !this.importRunId || this.isCheckingImportStatus()) return;
    this.isCheckingImportStatus.set(true);
    try {
      const progress = await firstValueFrom(this.importService.getImportWorkspaceFilesProgress(state.workspaceId, this.importRunId)
        .pipe(takeUntilDestroyed(this.destroyRef)), { defaultValue: null });
      if (this.destroyRef.destroyed) return;
      this.uploadProgressDetails.set(progress);
      if ((progress?.status === 'completed' || progress?.status === 'failed') && progress.result) {
        await this.continueTestResultsImport(progress.result);
      }
    } finally {
      this.isCheckingImportStatus.set(false);
    }
  }

  private stopResultImport(): void {
    this.stopUploadProgressPolling();
    this.isUploadingTestFiles.set(false);
    this.isUploadingTestResults.set(false);
  }

  private startResultImportProgressPolling(workspaceId: number, importRunId: string): void {
    this.stopUploadProgressPolling();
    const startedAt = Date.now();
    this.importElapsedSeconds.set(0);
    this.progressPollingSub = interval(2000).pipe(
      startWith(0),
      exhaustMap(() => this.importService.getImportWorkspaceFilesProgress(workspaceId, importRunId)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(progress => {
      this.importElapsedSeconds.set(Math.floor((Date.now() - startedAt) / 1000));
      if (progress) this.uploadProgressDetails.set(progress);
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

  protected get dialogCloseResult(): unknown {
    if (this.data.importType !== 'testResults') return true;
    if (this.resultStatusUncertain()) return { didImport: false };
    const uploadResult = this.uploadData();
    if (!uploadResult) return false;
    const importedResponses = !!this.resultImportOptions?.responses;
    return {
      didImport: true,
      resultType: importedResponses ? 'responses' : 'logs',
      importedResponses,
      importedLogs: !!this.resultImportOptions?.logs,
      uploadResult
    };
  }

  protected get uploadProgressPercent(): number {
    if (this.totalUploadsExpected() <= 0) return 0;
    return Math.round((this.completedUploads() / this.totalUploadsExpected()) * 100);
  }

  get testGroupsLoadPercent(): number {
    const totalGroups = this.testGroupsLoadProgress()?.totalGroups || 0;
    if (totalGroups <= 0) return 0;
    if (this.testGroupsLoadProgress()?.status === 'completed') return 100;
    return Math.round(
      ((this.testGroupsLoadProgress()?.processedGroups || 0) / totalGroups) * 100
    );
  }

  get testGroupsLoadMessage(): string {
    if (this.testGroupsLoadProgress()?.status === 'unknown') {
      return 'Verbindung zum Testcenter wird hergestellt.';
    }
    return this.testGroupsLoadProgress()?.message ||
      'Testgruppen werden vom Testcenter abgerufen.';
  }

  protected get testGroupsLoadElapsedText(): string {
    if (this.testGroupsLoadElapsedSeconds() < 60) {
      return `${this.testGroupsLoadElapsedSeconds()} s`;
    }
    const minutes = Math.floor(this.testGroupsLoadElapsedSeconds() / 60);
    const seconds = this.testGroupsLoadElapsedSeconds() % 60;
    return `${minutes} min ${seconds} s`;
  }

  private initializeUploadProgress(selectedGroupCount: number): void {
    if (this.data.importType === 'testResults') {
      this.totalUploadsExpected.set(selectedGroupCount);
      this.completedUploads.set(0);
      this.uploadProgressDetails.set(null);
      return;
    }

    this.totalUploadsExpected.set(1);
    this.completedUploads.set(0);
    this.uploadProgressDetails.set(null);
  }

  private incrementCompletedUploads(): void {
    if (this.totalUploadsExpected() <= 0) return;
    this.completedUploads.set(Math.min(
      this.completedUploads() + 1,
      this.totalUploadsExpected()
    ));
  }

  private resetUploadProgress(): void {
    this.stopUploadProgressPolling();
    this.totalUploadsExpected.set(0);
    this.completedUploads.set(0);
    this.importRunId = null;
    this.uploadProgressDetails.set(null);
  }

  private createImportRunId(): string {
    return `tc-import-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private startTestGroupsProgressPolling(importRunId: string, workspaceId: number): void {
    this.stopTestGroupsProgressPolling();
    this.testGroupsLoadStartedAt = Date.now();
    this.testGroupsProgressPollingSub = interval(700).pipe(
      startWith(0),
      switchMap(() => this.importService.getTestGroupsLoadProgress(
        workspaceId,
        importRunId
      )),
      takeUntilDestroyed(this.destroyRef)
    )
      .subscribe(progress => {
        this.updateTestGroupsLoadElapsedSeconds();
        if (!progress) return;

        this.testGroupsLoadProgress.set(progress);

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
      this.testGroupsLoadElapsedSeconds.set(0);
      return;
    }

    this.testGroupsLoadElapsedSeconds.set(Math.floor(
      (Date.now() - this.testGroupsLoadStartedAt) / 1000
    ));
  }

  private startUploadProgressPolling(importRunId: string): void {
    this.stopUploadProgressPolling();
    this.progressPollingSub = interval(700).pipe(
      startWith(0),
      switchMap(() => this.importService.getImportWorkspaceFilesProgress(
        this.appService.selectedWorkspaceId,
        importRunId
      )),
      takeUntilDestroyed(this.destroyRef)
    )
      .subscribe(progress => {
        if (!progress) return;

        this.uploadProgressDetails.set(progress);
        this.totalUploadsExpected.set(progress.totalPlanned);
        this.completedUploads.set(progress.totalUploaded);

        if (progress.status === 'completed' || progress.status === 'failed') {
          this.stopUploadProgressPolling();
        }
      });
  }

  private stopUploadProgressPolling(): void {
    this.progressPollingSub?.unsubscribe();
    this.progressPollingSub = undefined;
  }

  protected get visibleOptionProgress(): NonNullable<ImportWorkspaceFilesProgressDto['options']> {
    return (this.uploadProgressDetails()?.options || []).filter(option => option.planned > 0);
  }
}
