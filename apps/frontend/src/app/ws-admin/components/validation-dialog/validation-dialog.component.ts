import {
  Component, Inject, inject, ViewChild, AfterViewInit, OnInit, OnDestroy
} from '@angular/core';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  MatPaginator, MatPaginatorModule, MatPaginatorIntl, PageEvent
} from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { ValidationTaskStateService, ValidationBatchState, ValidationResult } from '../../../services/validation-task-state.service';
import { ValidationService } from '../../../services/validation.service';
import { ValidationTaskRunnerService } from '../../../services/validation-task-runner.service';
import { ValidationBatchRunnerService } from '../../../services/validation-batch-runner.service';
import { InvalidVariableDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import { TestTakersValidationDto, MissingPersonDto } from '../../../../../../../api-dto/files/testtakers-validation.dto';
import { DuplicateResponsesResultDto } from '../../../../../../../api-dto/files/duplicate-response.dto';
import { DuplicateResponseSelectionDto } from '../../../models/duplicate-response-selection.dto';
import { ContentDialogComponent } from '../../../shared/dialogs/content-dialog/content-dialog.component';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';

@Component({
  selector: 'coding-box-validation-dialog',
  templateUrl: './validation-dialog.component.html',
  standalone: true,
  providers: [
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }
  ],
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    FormsModule,
    ReactiveFormsModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatExpansionModule,
    MatSnackBarModule,
    MatPaginatorModule,
    MatIconModule
  ],
  styles: [`
    .actions-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }

    .mat-spinner {
      display: inline-block;
      margin-right: 8px;
      vertical-align: middle;
    }

    table {
      width: 100%;
    }

    .validation-result {
      display: flex;
      align-items: center;
      margin: 10px 0;
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: 500;
    }

    .validation-success {
      background-color: rgba(76, 175, 80, 0.1);
      color: #4CAF50;
      border: 1px solid #4CAF50;
    }

    .validation-error {
      background-color: rgba(244, 67, 54, 0.1);
      color: #F44336;
      border: 1px solid #F44336;
    }

    .validation-running {
      background-color: rgba(33, 150, 243, 0.1);
      color: #2196F3;
      border: 1px solid #2196F3;
    }

    .validation-not-run {
      background-color: rgba(158, 158, 158, 0.1);
      color: #9E9E9E;
      border: 1px solid #9E9E9E;
    }

    .validation-result mat-icon {
      margin-right: 8px;
    }

    .info-banner {
      display: flex;
      align-items: flex-start;
      margin: 0 0 16px 0;
      padding: 8px 16px;
      border-radius: 4px;
      background-color: rgba(33, 150, 243, 0.1);
      color: #2196F3;
      border: 1px solid #2196F3;
    }

    .info-banner span {
      flex: 1 1 auto;
      min-width: 0;
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.35;
    }

    .info-banner mat-icon {
      flex: 0 0 auto;
      width: 24px;
      height: 24px;
      line-height: 24px;
      margin-right: 8px;
    }

    .loading-container {
      display: flex;
      align-items: center;
      margin: 10px 0;
    }

    .loading-text {
      margin-left: 8px;
    }

    .validation-panel-header {
      padding: 6px 10px;
      border-radius: 6px;
      border-left: 3px solid transparent;
    }

    .validation-panel-header.validation-running {
      background-color: rgba(33, 150, 243, 0.04);
      border-left-color: #2196F3;
    }

    .validation-panel-header.validation-success {
      background-color: rgba(76, 175, 80, 0.04);
      border-left-color: #4CAF50;
    }

    .validation-panel-header.validation-error {
      background-color: rgba(244, 67, 54, 0.04);
      border-left-color: #F44336;
    }

    .validation-panel-header.validation-not-run {
      background-color: rgba(158, 158, 158, 0.03);
      border-left-color: #9E9E9E;
    }

    .validation-badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 500;
      line-height: 18px;
      border: 1px solid rgba(0, 0, 0, 0.08);
    }

    .validation-badge.validation-running {
      background-color: rgba(33, 150, 243, 0.06);
      color: #0D47A1;
    }

    .validation-badge.validation-success {
      background-color: rgba(76, 175, 80, 0.06);
      color: #1B5E20;
    }

    .validation-badge.validation-error {
      background-color: rgba(244, 67, 54, 0.06);
      color: #B71C1C;
    }

    .validation-badge.validation-not-run {
      background-color: rgba(158, 158, 158, 0.06);
      color: #616161;
    }

    .validation-details {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 6px 2px 2px 2px;
    }

    .validation-details-intro {
      margin: 0;
      opacity: 0.9;
    }

    .validation-guidance {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    @media (max-width: 900px) {
      .validation-guidance {
        grid-template-columns: 1fr;
      }
    }

    .validation-guidance .info-banner {
      margin: 0;
    }

    .validation-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .duplicate-response-table {
      width: 100%;
      border-collapse: collapse;
    }

    .duplicate-response-table th,
    .duplicate-response-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #e0e0e0;
      vertical-align: top;
      word-break: break-word;
    }

    .duplicate-row-selected {
      background-color: rgba(33, 150, 243, 0.08);
    }

    .duplicate-cell-conflict {
      background-color: rgba(244, 67, 54, 0.10);
    }

    .duplicate-cell-selected {
      outline: 1px solid rgba(33, 150, 243, 0.35);
    }
  `]
})
export class ValidationDialogComponent implements AfterViewInit, OnInit, OnDestroy {
  @ViewChild('variablePaginator') variablePaginator!: MatPaginator;
  @ViewChild('variableTypePaginator') variableTypePaginator!: MatPaginator;
  @ViewChild('statusVariablePaginator') statusVariablePaginator!: MatPaginator;
  @ViewChild('groupResponsesPaginator') groupResponsesPaginator!: MatPaginator;

  firstStepCompleted = true;
  backendService = inject(BackendService);
  appService = inject(AppService);
  validationTaskStateService = inject(ValidationTaskStateService);
  validationService = inject(ValidationService);
  validationTaskRunnerService = inject(ValidationTaskRunnerService);
  validationBatchRunnerService = inject(ValidationBatchRunnerService);

  private subscriptions: Subscription[] = [];

  private isClosing = false;

  private lastBatchState: ValidationBatchState | null = null;

  private variableValidationTask: ValidationTaskDto | null = null;
  private variableTypeValidationTask: ValidationTaskDto | null = null;
  private responseStatusValidationTask: ValidationTaskDto | null = null;
  private testTakersValidationTask: ValidationTaskDto | null = null;
  private groupResponsesValidationTask: ValidationTaskDto | null = null;
  private duplicateResponsesValidationTask: ValidationTaskDto | null = null;

  invalidVariables: InvalidVariableDto[] = [];
  totalInvalidVariables: number = 0;
  currentVariablePage: number = 1;
  variablePageSize: number = 10;

  invalidTypeVariables: InvalidVariableDto[] = [];
  totalInvalidTypeVariables: number = 0;
  currentTypeVariablePage: number = 1;
  typeVariablePageSize: number = 10;

  invalidStatusVariables: InvalidVariableDto[] = [];
  totalInvalidStatusVariables: number = 0;
  currentStatusVariablePage: number = 1;
  statusVariablePageSize: number = 10;

  groupResponsesResult: {
    testTakersFound: boolean;
    groupsWithResponses: { group: string; hasResponse: boolean }[];
    allGroupsHaveResponses: boolean;
  } | null = null;

  isGroupResponsesValidationRunning: boolean = false;

  groupResponsesValidationWasRun: boolean = false;

  expandedGroupResponsesPanel: boolean = false;

  paginatedGroupResponses = new MatTableDataSource<{ group: string; hasResponse: boolean }>([]);

  currentGroupResponsesPage: number = 1;
  groupResponsesPageSize: number = 10;
  totalGroupResponses: number = 0;

  testTakersValidationResult: TestTakersValidationDto | null = null;
  isTestTakersValidationRunning: boolean = false;
  testTakersValidationWasRun: boolean = false;
  expandedMissingPersonsPanel: boolean = false;
  paginatedMissingPersons = new MatTableDataSource<MissingPersonDto>([]);

  isVariableValidationRunning: boolean = false;
  isVariableTypeValidationRunning: boolean = false;
  isResponseStatusValidationRunning: boolean = false;
  isDuplicateResponsesValidationRunning: boolean = false;

  validateVariablesWasRun: boolean = false;
  validateVariableTypesWasRun: boolean = false;
  validateResponseStatusWasRun: boolean = false;
  validateDuplicateResponsesWasRun: boolean = false;
  isDeletingResponses: boolean = false;
  isResolvingDuplicateResponses: boolean = false;
  expandedPanel: boolean = false;
  expandedTypePanel: boolean = false;
  expandedStatusPanel: boolean = false;
  expandedDuplicateResponsesPanel: boolean = false;
  selectedResponses: Set<number> = new Set<number>();
  selectedTypeResponses: Set<number> = new Set<number>();
  selectedStatusResponses: Set<number> = new Set<number>();
  duplicateResponseSelections: Map<string, number> = new Map<string, number>();
  duplicateResponseTouchedKeys: Set<string> = new Set<string>();

  pageSizeOptions = [25, 50, 100, 200];

  paginatedVariables = new MatTableDataSource<InvalidVariableDto>([]);
  paginatedTypeVariables = new MatTableDataSource<InvalidVariableDto>([]);
  paginatedStatusVariables = new MatTableDataSource<InvalidVariableDto>([]);

  duplicateResponses: DuplicateResponseSelectionDto[] = [];
  duplicateResponsesResult: DuplicateResponsesResultDto | null = null;
  totalDuplicateResponses: number = 0;
  paginatedDuplicateResponses: DuplicateResponseSelectionDto[] = [];
  duplicateResponsesPageSize: number = 10;
  currentDuplicateResponsesPage: number = 1;

  private buildDuplicateKey(duplicate: { unitId: number; variableId: string; subform: string; testTakerLogin: string }): string {
    const unitId = String(duplicate.unitId);
    const variableId = encodeURIComponent(duplicate.variableId || '');
    const subform = encodeURIComponent(duplicate.subform || '');
    const login = encodeURIComponent(duplicate.testTakerLogin || '');
    return `${unitId}|${variableId}|${subform}|${login}`;
  }

  private hasDifferentDuplicateValues(duplicate: DuplicateResponseSelectionDto): boolean {
    const values = new Set((duplicate.duplicates || []).map(d => String(d.value ?? '')));
    return values.size > 1;
  }

  private hasDifferentDuplicateStatuses(duplicate: DuplicateResponseSelectionDto): boolean {
    const statuses = new Set((duplicate.duplicates || []).map(d => String(d.status ?? '')));
    return statuses.size > 1;
  }

  getSelectedDuplicateResponseId(duplicate: DuplicateResponseSelectionDto): number | undefined {
    return this.duplicateResponseSelections.get(duplicate.key);
  }

  isDuplicateRowSelected(duplicate: DuplicateResponseSelectionDto, responseId: number): boolean {
    return this.getSelectedDuplicateResponseId(duplicate) === responseId;
  }

  isDuplicateValueConflicting(duplicate: DuplicateResponseSelectionDto, responseId: number): boolean {
    if (!this.hasDifferentDuplicateValues(duplicate)) {
      return false;
    }
    const selectedId = this.getSelectedDuplicateResponseId(duplicate);
    if (!selectedId) {
      // No baseline selected yet -> mark value column as conflicting for all rows
      return true;
    }
    const selected = (duplicate.duplicates || []).find(d => d.responseId === selectedId);
    const current = (duplicate.duplicates || []).find(d => d.responseId === responseId);
    return String(current?.value ?? '') !== String(selected?.value ?? '');
  }

  isDuplicateStatusConflicting(duplicate: DuplicateResponseSelectionDto, responseId: number): boolean {
    if (!this.hasDifferentDuplicateStatuses(duplicate)) {
      return false;
    }
    const selectedId = this.getSelectedDuplicateResponseId(duplicate);
    if (!selectedId) {
      // No baseline selected yet -> mark status column as conflicting for all rows
      return true;
    }
    const selected = (duplicate.duplicates || []).find(d => d.responseId === selectedId);
    const current = (duplicate.duplicates || []).find(d => d.responseId === responseId);
    return String(current?.status ?? '') !== String(selected?.status ?? '');
  }

  getDuplicateConflictLabel(duplicate: DuplicateResponseSelectionDto): string {
    const parts: string[] = [];
    if (this.hasDifferentDuplicateValues(duplicate)) {
      parts.push('Wert');
    }
    if (this.hasDifferentDuplicateStatuses(duplicate)) {
      parts.push('Status');
    }
    if (parts.length === 0) {
      return 'Duplikate sind identisch';
    }
    return `Unterschiede: ${parts.join(', ')}`;
  }

  isDuplicateGroupTouched(duplicate: DuplicateResponseSelectionDto): boolean {
    return this.duplicateResponseTouchedKeys.has(duplicate.key);
  }

  markDuplicateGroupTouched(duplicate: DuplicateResponseSelectionDto): void {
    this.duplicateResponseTouchedKeys.add(duplicate.key);
  }

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: unknown,
    private dialogRef: MatDialogRef<ValidationDialogComponent>,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.checkForExistingTasks();
    this.loadPreviousValidationResults();

    const workspaceId = this.appService.selectedWorkspaceId;

    const sub1 = this.validationTaskStateService.observeValidationResults(workspaceId)
      .subscribe(results => {
        this.applyInMemoryResults(results);
      });
    this.subscriptions.push(sub1);

    const sub2 = this.validationTaskStateService.observeTaskIds(workspaceId)
      .subscribe(taskIds => {
        this.isVariableValidationRunning = Boolean(taskIds.variables);
        this.isVariableTypeValidationRunning = Boolean(taskIds.variableTypes);
        this.isResponseStatusValidationRunning = Boolean(taskIds.responseStatus);
        this.isTestTakersValidationRunning = Boolean(taskIds.testTakers);
        this.isGroupResponsesValidationRunning = Boolean(taskIds.groupResponses);
        this.isDuplicateResponsesValidationRunning = Boolean(taskIds.duplicateResponses);
      });
    this.subscriptions.push(sub2);

    const sub3 = this.validationTaskStateService.observeBatchState(workspaceId)
      .subscribe(state => {
        const previous = this.lastBatchState?.status;
        this.lastBatchState = state;
        if (previous !== 'completed' && state.status === 'completed') {
          this.snackBar.open('Alle Prüfungen abgeschlossen. Bitte Ergebnisse prüfen.', 'OK', { duration: 4000 });
        }
        if (previous !== 'failed' && state.status === 'failed') {
          this.snackBar.open(`Validierungsbatch fehlgeschlagen: ${state.error || 'Unbekannter Fehler'}`, 'OK', { duration: 6000 });
        }
      });
    this.subscriptions.push(sub3);

    const autoStart = (this.data as { autoStart?: boolean } | null)?.autoStart;
    if (autoStart) {
      this.startAllValidations();
    }
  }

  ngAfterViewInit(): void {
    this.paginatedVariables.paginator = this.variablePaginator;
    this.paginatedTypeVariables.paginator = this.variableTypePaginator;
    this.paginatedStatusVariables.paginator = this.statusVariablePaginator;
    this.paginatedGroupResponses.paginator = this.groupResponsesPaginator;
  }

  ngOnDestroy(): void {
    if (this.isClosing) {
      this.storeRunningTasks();
      this.subscriptions.forEach(sub => sub.unsubscribe());
    } else {
      this.subscriptions.forEach(sub => sub.unsubscribe());
    }
  }

  private checkForExistingTasks(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    const taskIds = this.validationTaskStateService.getAllTaskIds(workspaceId);

    if (taskIds.variables) {
      this.loadExistingTask('variables', taskIds.variables);
    }

    if (taskIds.variableTypes) {
      this.loadExistingTask('variableTypes', taskIds.variableTypes);
    }

    if (taskIds.responseStatus) {
      this.loadExistingTask('responseStatus', taskIds.responseStatus);
    }

    if (taskIds.testTakers) {
      this.loadExistingTask('testTakers', taskIds.testTakers);
    }

    if (taskIds.groupResponses) {
      this.loadExistingTask('groupResponses', taskIds.groupResponses);
    }

    if (taskIds.duplicateResponses) {
      this.loadExistingTask('duplicateResponses', taskIds.duplicateResponses);
    }
  }

  private loadExistingTask(
    type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses',
    taskId: number
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    switch (type) {
      case 'variables':
        this.isVariableValidationRunning = true;
        break;
      case 'variableTypes':
        this.isVariableTypeValidationRunning = true;
        break;
      case 'responseStatus':
        this.isResponseStatusValidationRunning = true;
        break;
      case 'testTakers':
        this.isTestTakersValidationRunning = true;
        break;
      case 'groupResponses':
        this.isGroupResponsesValidationRunning = true;
        break;
      case 'duplicateResponses':
        this.isDuplicateResponsesValidationRunning = true;
        break;
      default:
        break;
    }

    const subscription = this.backendService.getValidationTask(workspaceId, taskId)
      .subscribe({
        next: task => {
          switch (type) {
            case 'variables':
              this.variableValidationTask = task;
              break;
            case 'variableTypes':
              this.variableTypeValidationTask = task;
              break;
            case 'responseStatus':
              this.responseStatusValidationTask = task;
              break;
            case 'testTakers':
              this.testTakersValidationTask = task;
              break;
            case 'groupResponses':
              this.groupResponsesValidationTask = task;
              break;
            case 'duplicateResponses':
              this.duplicateResponsesValidationTask = task;
              break;
            default:
              break;
          }

          if (task.status === 'pending' || task.status === 'processing') {
            this.pollExistingTask(type, taskId);
          } else if (task.status === 'completed') {
            this.loadTaskResults(type, taskId);
          } else if (task.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${task.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.validationTaskStateService.removeTaskId(workspaceId, type);

            switch (type) {
              case 'variables':
                this.isVariableValidationRunning = false;
                break;
              case 'variableTypes':
                this.isVariableTypeValidationRunning = false;
                break;
              case 'responseStatus':
                this.isResponseStatusValidationRunning = false;
                break;
              case 'testTakers':
                this.isTestTakersValidationRunning = false;
                break;
              case 'groupResponses':
                this.isGroupResponsesValidationRunning = false;
                break;
              case 'duplicateResponses':
                this.isDuplicateResponsesValidationRunning = false;
                break;
              default:
                break;
            }
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.validationTaskStateService.removeTaskId(workspaceId, type);

          switch (type) {
            case 'variables':
              this.isVariableValidationRunning = false;
              break;
            case 'variableTypes':
              this.isVariableTypeValidationRunning = false;
              break;
            case 'responseStatus':
              this.isResponseStatusValidationRunning = false;
              break;
            case 'testTakers':
              this.isTestTakersValidationRunning = false;
              break;
            case 'groupResponses':
              this.isGroupResponsesValidationRunning = false;
              break;
            case 'duplicateResponses':
              this.isDuplicateResponsesValidationRunning = false;
              break;
            default:
              break;
          }
        }
      });

    this.subscriptions.push(subscription);
  }

  private pollExistingTask(
    type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses',
    taskId: number
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    const pollSubscription = this.backendService.pollValidationTask(
      workspaceId,
      taskId
    ).subscribe({
      next: updatedTask => {
        if (updatedTask.status === 'completed') {
          this.loadTaskResults(type, taskId);
        } else if (updatedTask.status === 'failed') {
          this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
          this.validationTaskStateService.removeTaskId(workspaceId, type);

          switch (type) {
            case 'variables':
              this.isVariableValidationRunning = false;
              break;
            case 'variableTypes':
              this.isVariableTypeValidationRunning = false;
              break;
            case 'responseStatus':
              this.isResponseStatusValidationRunning = false;
              break;
            case 'testTakers':
              this.isTestTakersValidationRunning = false;
              break;
            case 'groupResponses':
              this.isGroupResponsesValidationRunning = false;
              break;
            case 'duplicateResponses':
              this.isDuplicateResponsesValidationRunning = false;
              break;
            default:
              break;
          }
        }
      },
      error: () => {
        this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
        this.validationTaskStateService.removeTaskId(workspaceId, type);

        switch (type) {
          case 'variables':
            this.isVariableValidationRunning = false;
            break;
          case 'variableTypes':
            this.isVariableTypeValidationRunning = false;
            break;
          case 'responseStatus':
            this.isResponseStatusValidationRunning = false;
            break;
          case 'testTakers':
            this.isTestTakersValidationRunning = false;
            break;
          case 'groupResponses':
            this.isGroupResponsesValidationRunning = false;
            break;
          case 'duplicateResponses':
            this.isDuplicateResponsesValidationRunning = false;
            break;
          default:
            break;
        }
      }
    });

    this.subscriptions.push(pollSubscription);
  }

  private loadTaskResults(
    type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses',
    taskId: number
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    const subscription = this.backendService.getValidationResults(
      workspaceId,
      taskId
    ).subscribe({
      next: result => {
        interface PaginatedResult {
          data: InvalidVariableDto[];
          total: number;
          page: number;
          limit: number;
        }

        interface GroupResponsesResult {
          testTakersFound: boolean;
          groupsWithResponses: { group: string; hasResponse: boolean }[];
          allGroupsHaveResponses: boolean;
          total: number;
          page: number;
          limit: number;
        }

        switch (type) {
          case 'variables': {
            const typedResult = result as PaginatedResult;
            this.invalidVariables = typedResult.data;
            this.totalInvalidVariables = typedResult.total;
            this.currentVariablePage = typedResult.page;
            this.variablePageSize = typedResult.limit;
            this.updatePaginatedVariables();
            this.isVariableValidationRunning = false;
            this.validateVariablesWasRun = true;
            this.saveValidationResult(type);
            break;
          }

          case 'variableTypes': {
            const typedResult = result as PaginatedResult;
            this.invalidTypeVariables = typedResult.data;
            this.totalInvalidTypeVariables = typedResult.total;
            this.currentTypeVariablePage = typedResult.page;
            this.typeVariablePageSize = typedResult.limit;
            this.updatePaginatedTypeVariables();
            this.isVariableTypeValidationRunning = false;
            this.validateVariableTypesWasRun = true;
            this.saveValidationResult(type);
            break;
          }

          case 'responseStatus': {
            const typedResult = result as PaginatedResult;
            this.invalidStatusVariables = typedResult.data;
            this.totalInvalidStatusVariables = typedResult.total;
            this.currentStatusVariablePage = typedResult.page;
            this.statusVariablePageSize = typedResult.limit;
            this.updatePaginatedStatusVariables();
            this.isResponseStatusValidationRunning = false;
            this.validateResponseStatusWasRun = true;
            this.saveValidationResult(type);
            break;
          }

          case 'testTakers': {
            this.testTakersValidationResult = result as TestTakersValidationDto;
            this.updatePaginatedMissingPersons();
            this.isTestTakersValidationRunning = false;
            this.testTakersValidationWasRun = true;
            this.saveValidationResult(type);
            break;
          }

          case 'groupResponses': {
            const typedResult = result as GroupResponsesResult;
            this.groupResponsesResult = typedResult;
            this.totalGroupResponses = typedResult.total;
            this.updatePaginatedGroupResponses();
            this.isGroupResponsesValidationRunning = false;
            this.groupResponsesValidationWasRun = true;

            this.saveValidationResult(type);
            break;
          }

          case 'duplicateResponses': {
            const typedResult = result as DuplicateResponsesResultDto;
            this.duplicateResponsesResult = typedResult;
            this.duplicateResponses = (typedResult.data || []).map(duplicate => ({
              ...duplicate,
              key: this.buildDuplicateKey(duplicate)
            }));
            this.totalDuplicateResponses = typedResult.total;
            this.updatePaginatedDuplicateResponses();
            this.isDuplicateResponsesValidationRunning = false;
            this.validateDuplicateResponsesWasRun = true;
            this.saveValidationResult(type);
            break;
          }

          default:
            break;
        }

        this.validationTaskStateService.removeTaskId(workspaceId, type);
      },
      error: () => {
        this.snackBar.open('Fehler beim Abrufen der Validierungsergebnisse', 'Schließen', { duration: 5000 });
        this.validationTaskStateService.removeTaskId(workspaceId, type);

        switch (type) {
          case 'variables':
            this.isVariableValidationRunning = false;
            break;
          case 'variableTypes':
            this.isVariableTypeValidationRunning = false;
            break;
          case 'responseStatus':
            this.isResponseStatusValidationRunning = false;
            break;
          case 'testTakers':
            this.isTestTakersValidationRunning = false;
            break;
          case 'groupResponses':
            this.isGroupResponsesValidationRunning = false;
            break;
          case 'duplicateResponses':
            this.isDuplicateResponsesValidationRunning = false;
            break;
          default:
            break;
        }
      }
    });

    this.subscriptions.push(subscription);
  }

  private storeRunningTasks(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (this.variableValidationTask && (this.variableValidationTask.status === 'pending' || this.variableValidationTask.status === 'processing')) {
      this.validationTaskStateService.setTaskId(workspaceId, 'variables', this.variableValidationTask.id);
    }

    if (this.variableTypeValidationTask && (this.variableTypeValidationTask.status === 'pending' || this.variableTypeValidationTask.status === 'processing')) {
      this.validationTaskStateService.setTaskId(workspaceId, 'variableTypes', this.variableTypeValidationTask.id);
    }

    if (this.responseStatusValidationTask && (this.responseStatusValidationTask.status === 'pending' || this.responseStatusValidationTask.status === 'processing')) {
      this.validationTaskStateService.setTaskId(workspaceId, 'responseStatus', this.responseStatusValidationTask.id);
    }

    if (this.testTakersValidationTask && (this.testTakersValidationTask.status === 'pending' || this.testTakersValidationTask.status === 'processing')) {
      this.validationTaskStateService.setTaskId(workspaceId, 'testTakers', this.testTakersValidationTask.id);
    }

    if (this.groupResponsesValidationTask && (this.groupResponsesValidationTask.status === 'pending' || this.groupResponsesValidationTask.status === 'processing')) {
      this.validationTaskStateService.setTaskId(workspaceId, 'groupResponses', this.groupResponsesValidationTask.id);
    }

    if (this.duplicateResponsesValidationTask && (this.duplicateResponsesValidationTask.status === 'pending' || this.duplicateResponsesValidationTask.status === 'processing')) {
      this.validationTaskStateService.setTaskId(workspaceId, 'duplicateResponses', this.duplicateResponsesValidationTask.id);
    }
  }

  startAllValidations(): void {
    this.validationBatchRunnerService.startBatch(this.appService.selectedWorkspaceId);
  }

  private applyInMemoryResults(results: Record<string, ValidationResult>): void {
    if (results.variables) {
      this.processVariablesResult(results.variables, true);
    }
    if (results.variableTypes) {
      this.processVariableTypesResult(results.variableTypes, true);
    }
    if (results.responseStatus) {
      this.processResponseStatusResult(results.responseStatus, true);
    }
    if (results.testTakers) {
      this.processTestTakersResult(results.testTakers, true);
    }
    if (results.groupResponses) {
      this.processGroupResponsesResult(results.groupResponses, true);
    }
    if (results.duplicateResponses) {
      this.processDuplicateResponsesResult(results.duplicateResponses, true);
    }
  }

  updatePaginatedVariables(): void {
    this.paginatedVariables.data = this.invalidVariables;
  }

  updatePaginatedMissingPersons(): void {
    if (this.testTakersValidationResult) {
      this.paginatedMissingPersons.data = this.testTakersValidationResult.missingPersons;
    }
  }

  updatePaginatedGroupResponses(): void {
    if (this.groupResponsesResult) {
      this.paginatedGroupResponses.data = this.groupResponsesResult.groupsWithResponses;
    }
  }

  onGroupResponsesPageChange(event: PageEvent): void {
    this.currentGroupResponsesPage = event.pageIndex + 1;
    this.groupResponsesPageSize = event.pageSize;
    this.isGroupResponsesValidationRunning = true;
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runTask<{
      testTakersFound: boolean;
      groupsWithResponses: { group: string; hasResponse: boolean }[];
      allGroupsHaveResponses: boolean;
      total: number;
      page: number;
      limit: number;
    }>(
      this.appService.selectedWorkspaceId,
      'groupResponses',
      { page: this.currentGroupResponsesPage, limit: this.groupResponsesPageSize }
    ).subscribe({
      next: ({ createdTask, result }) => {
        this.groupResponsesValidationTask = createdTask;
        this.groupResponsesResult = result;
        this.totalGroupResponses = result.total;
        this.updatePaginatedGroupResponses();
        this.isGroupResponsesValidationRunning = false;
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
        this.isGroupResponsesValidationRunning = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  validateTestTakers(): void {
    this.isTestTakersValidationRunning = true;
    this.testTakersValidationResult = null;
    this.testTakersValidationWasRun = false;
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    const subscription = this.validationTaskRunnerService.runTask<TestTakersValidationDto>(
      this.appService.selectedWorkspaceId,
      'testTakers'
    ).subscribe({
      next: ({ createdTask, result }) => {
        this.testTakersValidationTask = createdTask;
        this.testTakersValidationResult = result;

        const hasErrors = !result.testTakersFound || result.missingPersons.length > 0;

        const validationResult: ValidationResult = {
          status: hasErrors ? 'failed' : 'success',
          timestamp: Date.now(),
          details: {
            testTakersFound: result.testTakersFound,
            missingPersonsCount: result.missingPersons.length,
            hasErrors: hasErrors
          }
        };

        this.validationTaskStateService.setValidationResult(
          this.appService.selectedWorkspaceId,
          'testTakers',
          validationResult
        );

        this.updatePaginatedMissingPersons();
        this.isTestTakersValidationRunning = false;
        this.testTakersValidationWasRun = true;
        this.saveValidationResult('testTakers');
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
        this.isTestTakersValidationRunning = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  toggleMissingPersonsExpansion(): void {
    this.expandedMissingPersonsPanel = !this.expandedMissingPersonsPanel;
  }

  toggleGroupResponsesExpansion(): void {
    this.expandedGroupResponsesPanel = !this.expandedGroupResponsesPanel;
  }

  toggleDuplicateResponsesExpansion(): void {
    this.expandedDuplicateResponsesPanel = !this.expandedDuplicateResponsesPanel;
  }

  validateGroupResponses(): void {
    this.isGroupResponsesValidationRunning = true;
    this.groupResponsesResult = null;
    this.groupResponsesValidationWasRun = false;
    this.currentGroupResponsesPage = 1;
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runTask<{
      testTakersFound: boolean;
      groupsWithResponses: { group: string; hasResponse: boolean }[];
      allGroupsHaveResponses: boolean;
      total: number;
      page: number;
      limit: number;
    }>(
      this.appService.selectedWorkspaceId,
      'groupResponses',
      { page: this.currentGroupResponsesPage, limit: this.groupResponsesPageSize }
    ).subscribe({
      next: ({ createdTask, result }) => {
        this.groupResponsesValidationTask = createdTask;

        const hasErrors = !result.testTakersFound || !result.allGroupsHaveResponses;
        const validationResult: ValidationResult = {
          status: hasErrors ? 'failed' : 'success',
          timestamp: Date.now(),
          details: {
            testTakersFound: result.testTakersFound,
            allGroupsHaveResponses: result.allGroupsHaveResponses,
            hasErrors: hasErrors
          }
        };
        this.validationTaskStateService.setValidationResult(
          this.appService.selectedWorkspaceId,
          'groupResponses',
          validationResult
        );

        this.groupResponsesResult = result;
        this.totalGroupResponses = result.total;
        this.updatePaginatedGroupResponses();
        this.isGroupResponsesValidationRunning = false;
        this.groupResponsesValidationWasRun = true;
        this.saveValidationResult('groupResponses');
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
        this.isGroupResponsesValidationRunning = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  validateDuplicateResponses(): void {
    this.isDuplicateResponsesValidationRunning = true;
    this.duplicateResponses = [];
    this.duplicateResponsesResult = null;
    this.totalDuplicateResponses = 0;
    this.validateDuplicateResponsesWasRun = false;
    this.currentDuplicateResponsesPage = 1;
    this.duplicateResponseSelections.clear();
    this.duplicateResponseTouchedKeys.clear();
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    const subscription = this.validationTaskRunnerService.runTask<DuplicateResponsesResultDto>(
      this.appService.selectedWorkspaceId,
      'duplicateResponses',
      { page: this.currentDuplicateResponsesPage, limit: this.duplicateResponsesPageSize }
    ).subscribe({
      next: ({ result }) => {
        const hasErrors = result.total > 0;
        const validationResult: ValidationResult = {
          status: hasErrors ? 'failed' : 'success',
          timestamp: Date.now(),
          details: {
            total: result.total,
            hasErrors: hasErrors
          }
        };

        this.validationTaskStateService.setValidationResult(
          this.appService.selectedWorkspaceId,
          'duplicateResponses',
          validationResult
        );

        this.duplicateResponses = result.data.map(duplicate => ({
          ...duplicate,
          key: this.buildDuplicateKey(duplicate)
        }));

        this.totalDuplicateResponses = result.total;
        this.duplicateResponsesResult = result;
        this.updatePaginatedDuplicateResponses();
        this.isDuplicateResponsesValidationRunning = false;
        this.validateDuplicateResponsesWasRun = true;
        this.saveValidationResult('duplicateResponses');
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
        this.isDuplicateResponsesValidationRunning = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  updatePaginatedTypeVariables(): void {
    this.paginatedTypeVariables.data = this.invalidTypeVariables;
  }

  updatePaginatedStatusVariables(): void {
    this.paginatedStatusVariables.data = this.invalidStatusVariables;
  }

  updatePaginatedDuplicateResponses(): void {
    this.paginatedDuplicateResponses = this.duplicateResponses.slice(
      (this.currentDuplicateResponsesPage - 1) * this.duplicateResponsesPageSize,
      this.currentDuplicateResponsesPage * this.duplicateResponsesPageSize
    );
  }

  isSelectedDuplicateResponse(duplicate: DuplicateResponseSelectionDto, responseId: number): boolean {
    return this.duplicateResponseSelections.get(duplicate.key) === responseId;
  }

  selectDuplicateResponse(duplicate: DuplicateResponseSelectionDto, responseId: number): void {
    this.duplicateResponseSelections.set(duplicate.key, responseId);
    this.markDuplicateGroupTouched(duplicate);
  }

  hasSelectedDuplicateResponses(): boolean {
    return this.getSelectedDuplicateResponsesCount() > 0;
  }

  getSelectedDuplicateResponsesCount(): number {
    return this.duplicateResponseTouchedKeys.size;
  }

  resolveDuplicateGroup(duplicate: DuplicateResponseSelectionDto): void {
    const selected = this.duplicateResponseSelections.get(duplicate.key);
    if (!selected) {
      this.snackBar.open('Bitte zuerst eine Antwort auswählen.', 'OK', { duration: 3000 });
      return;
    }

    this.isResolvingDuplicateResponses = true;
    const request = { resolutionMap: { [duplicate.key]: selected } };

    this.validationService.resolveDuplicateResponses(this.appService.selectedWorkspaceId, request)
      .subscribe({
        next: result => {
          if (result.success) {
            this.snackBar.open(
              `${result.resolvedCount} doppelte Antworten wurden erfolgreich aufgelöst.`,
              'OK',
              { duration: 3000 }
            );
            this.validateDuplicateResponses();
          } else {
            this.snackBar.open('Fehler beim Auflösen der doppelten Antworten.', 'Fehler', { duration: 3000 });
          }
          this.isResolvingDuplicateResponses = false;
        },
        error: () => {
          this.snackBar.open('Fehler beim Auflösen der doppelten Antworten.', 'Fehler', { duration: 3000 });
          this.isResolvingDuplicateResponses = false;
        }
      });
  }

  selectSuggestedDuplicateResponse(duplicate: DuplicateResponseSelectionDto): void {
    if (!duplicate?.duplicates?.length) {
      return;
    }

    const rankStatus = (s: string): number => {
      // Prefer real values over not reached/unset.
      switch (String(s || '')) {
        case 'VALUE_CHANGED':
          return 5;
        case 'DISPLAYED':
          return 4;
        case 'PARTLY_DISPLAYED':
          return 3;
        case 'NOT_REACHED':
          return 2;
        case 'UNSET':
          return 1;
        default:
          return 0;
      }
    };

    const scored = duplicate.duplicates
      .map(d => ({
        responseId: d.responseId,
        score: rankStatus(d.status) + (String(d.value ?? '').trim() !== '' ? 1 : 0)
      }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0]?.responseId;
    if (best) {
      this.duplicateResponseSelections.set(duplicate.key, best);
      this.markDuplicateGroupTouched(duplicate);
    }
  }

  onDuplicateResponsesPageChange(event: PageEvent): void {
    this.currentDuplicateResponsesPage = event.pageIndex + 1;
    this.duplicateResponsesPageSize = event.pageSize;
    this.isDuplicateResponsesValidationRunning = true;
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runTask<DuplicateResponsesResultDto>(
      this.appService.selectedWorkspaceId,
      'duplicateResponses',
      { page: this.currentDuplicateResponsesPage, limit: this.duplicateResponsesPageSize }
    ).subscribe({
      next: ({ result }) => {
        this.duplicateResponses = result.data.map(duplicate => ({
          ...duplicate,
          key: this.buildDuplicateKey(duplicate)
        }));

        this.totalDuplicateResponses = result.total;
        this.duplicateResponsesResult = result;
        this.updatePaginatedDuplicateResponses();
        this.isDuplicateResponsesValidationRunning = false;
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
        this.isDuplicateResponsesValidationRunning = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  resolveDuplicateResponses(): void {
    if (this.isResolvingDuplicateResponses || !this.hasSelectedDuplicateResponses()) {
      return;
    }

    this.isResolvingDuplicateResponses = true;
    const responseIdsToKeep: Record<string, number> = {};
    this.duplicateResponseTouchedKeys.forEach(key => {
      const responseId = this.duplicateResponseSelections.get(key);
      if (responseId) {
        responseIdsToKeep[key] = responseId;
      }
    });

    const request = {
      resolutionMap: responseIdsToKeep
    };

    this.validationService.resolveDuplicateResponses(this.appService.selectedWorkspaceId, request)
      .subscribe({
        next: result => {
          if (result.success) {
            this.snackBar.open(
              `${result.resolvedCount} doppelte Antworten wurden erfolgreich aufgelöst.`,
              'OK',
              { duration: 3000 }
            );

            // Refresh the duplicate responses list
            this.validateDuplicateResponses();
          } else {
            this.snackBar.open(
              'Fehler beim Auflösen der doppelten Antworten.',
              'Fehler',
              { duration: 3000 }
            );
          }
          this.isResolvingDuplicateResponses = false;
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Auflösen der doppelten Antworten.',
            'Fehler',
            { duration: 3000 }
          );
          this.isResolvingDuplicateResponses = false;
        }
      });
  }

  resolveAllDuplicateResponses(): void {
    if (this.isResolvingDuplicateResponses || this.duplicateResponses.length === 0) {
      return;
    }
    this.isResolvingDuplicateResponses = true;
    const subscription = this.validationTaskRunnerService.runDeleteAllResponsesTask(
      this.appService.selectedWorkspaceId,
      'duplicateResponses'
    ).subscribe({
      next: ({ result }) => {
        this.snackBar.open(
          `${result.deletedCount} doppelte Antworten wurden automatisch aufgelöst.`,
          'OK',
          { duration: 3000 }
        );

        this.validateDuplicateResponses();
        this.isResolvingDuplicateResponses = false;
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(
          `Fehler beim Auflösen der doppelten Antworten: ${message}`,
          'Fehler',
          { duration: 3000 }
        );
        this.isResolvingDuplicateResponses = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  validateVariables(): void {
    this.isVariableValidationRunning = true;
    this.invalidVariables = [];
    this.totalInvalidVariables = 0;
    this.validateVariablesWasRun = false;
    this.selectedResponses.clear();

    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runTask<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }>(
      this.appService.selectedWorkspaceId,
      'variables',
      { page: this.currentVariablePage, limit: this.variablePageSize }
    ).subscribe({
      next: ({ createdTask, result }) => {
        this.variableValidationTask = createdTask;

        const hasErrors = result.total > 0;
        const validationResult: ValidationResult = {
          status: hasErrors ? 'failed' : 'success',
          timestamp: Date.now(),
          details: {
            total: result.total,
            hasErrors: hasErrors
          }
        };
        this.validationTaskStateService.setValidationResult(
          this.appService.selectedWorkspaceId,
          'variables',
          validationResult
        );

        this.invalidVariables = result.data;
        this.totalInvalidVariables = result.total;
        this.currentVariablePage = result.page;
        this.variablePageSize = result.limit;
        this.updatePaginatedVariables();
        this.isVariableValidationRunning = false;
        this.validateVariablesWasRun = true;
        this.saveValidationResult('variables');
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
        this.isVariableValidationRunning = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  onVariablePageChange(event: PageEvent): void {
    this.currentVariablePage = event.pageIndex + 1;
    this.variablePageSize = event.pageSize;
    this.isVariableValidationRunning = true;
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runTask<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }>(
      this.appService.selectedWorkspaceId,
      'variables',
      { page: this.currentVariablePage, limit: this.variablePageSize }
    ).subscribe({
      next: ({ createdTask, result }) => {
        this.variableValidationTask = createdTask;
        this.invalidVariables = result.data;
        this.totalInvalidVariables = result.total;
        this.currentVariablePage = result.page;
        this.variablePageSize = result.limit;
        this.updatePaginatedVariables();
        this.isVariableValidationRunning = false;
        this.validateVariablesWasRun = true;
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
        this.isVariableValidationRunning = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  toggleResponseSelection(responseId: number | undefined): void {
    if (responseId === undefined) return;

    if (this.selectedResponses.has(responseId)) {
      this.selectedResponses.delete(responseId);
    } else {
      this.selectedResponses.add(responseId);
    }
  }

  isResponseSelected(responseId: number | undefined): boolean {
    return responseId !== undefined && this.selectedResponses.has(responseId);
  }

  selectAllResponses(): void {
    this.invalidVariables.forEach(variable => {
      if (variable.responseId !== undefined) {
        this.selectedResponses.add(variable.responseId);
      }
    });
  }

  deselectAllResponses(): void {
    this.selectedResponses.clear();
  }

  deleteSelectedResponses(): void {
    if (this.selectedResponses.size === 0) {
      this.snackBar.open('Keine Antworten ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }
    this.isDeletingResponses = true;
    const responseIds = Array.from(this.selectedResponses);
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runDeleteResponsesTask(
      this.appService.selectedWorkspaceId,
      responseIds
    ).subscribe({
      next: ({ result }) => {
        this.isDeletingResponses = false;
        this.snackBar.open(`${result.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

        this.isVariableValidationRunning = true;
        const refreshSubscription = this.validationTaskRunnerService.runTask<{
          data: InvalidVariableDto[];
          total: number;
          page: number;
          limit: number;
        }>(
          this.appService.selectedWorkspaceId,
          'variables',
          { page: this.currentVariablePage, limit: this.variablePageSize }
        ).subscribe({
          next: ({ createdTask, result: refreshResult }) => {
            this.variableValidationTask = createdTask;
            this.invalidVariables = refreshResult.data;
            this.totalInvalidVariables = refreshResult.total;
            this.currentVariablePage = refreshResult.page;
            this.variablePageSize = refreshResult.limit;
            this.updatePaginatedVariables();
            this.isVariableValidationRunning = false;
            this.validateVariablesWasRun = true;
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
            this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
            this.isVariableValidationRunning = false;
          }
        });

        this.subscriptions.push(refreshSubscription);
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.isDeletingResponses = false;
        this.snackBar.open(`Löschen fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
      }
    });

    this.subscriptions.push(subscription);
    this.selectedResponses.clear();
  }

  deleteAllResponses(): void {
    if (this.totalInvalidVariables === 0) {
      this.snackBar.open('Keine ungültigen Variablen vorhanden', 'Schließen', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(ContentDialogComponent, {
      width: '400px',
      data: {
        title: 'Alle Einträge löschen',
        content: `Wirklich alle ${this.totalInvalidVariables} ungültigen Variablen löschen?`,
        isJson: false,
        isXml: false,
        showDeleteButton: true
      }
    });

    dialogRef.afterClosed().subscribe(deleteFromDb => {
      if (deleteFromDb) {
        this.isDeletingResponses = true;
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];
        const subscription = this.validationTaskRunnerService.runDeleteAllResponsesTask(
          this.appService.selectedWorkspaceId,
          'variables'
        ).subscribe({
          next: ({ result }) => {
            this.isDeletingResponses = false;
            this.snackBar.open(`${result.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

            this.isVariableValidationRunning = true;
            const refreshSubscription = this.validationTaskRunnerService.runTask<{
              data: InvalidVariableDto[];
              total: number;
              page: number;
              limit: number;
            }>(
              this.appService.selectedWorkspaceId,
              'variables',
              { page: this.currentVariablePage, limit: this.variablePageSize }
            ).subscribe({
              next: ({ createdTask, result: refreshResult }) => {
                this.variableValidationTask = createdTask;
                this.invalidVariables = refreshResult.data;
                this.totalInvalidVariables = refreshResult.total;
                this.currentVariablePage = refreshResult.page;
                this.variablePageSize = refreshResult.limit;
                this.updatePaginatedVariables();
                this.isVariableValidationRunning = false;
                this.validateVariablesWasRun = true;
              },
              error: (err: unknown) => {
                const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
                this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
                this.isVariableValidationRunning = false;
              }
            });

            this.subscriptions.push(refreshSubscription);
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
            this.isDeletingResponses = false;
            this.snackBar.open(`Löschen fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
          }
        });

        this.subscriptions.push(subscription);
      }
    });
  }

  toggleExpansion(): void {
    this.expandedPanel = !this.expandedPanel;
  }

  validateVariableTypes(): void {
    this.isVariableTypeValidationRunning = true;
    this.invalidTypeVariables = [];
    this.totalInvalidTypeVariables = 0;
    this.validateVariableTypesWasRun = false;
    this.selectedTypeResponses.clear();
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runTask<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }>(
      this.appService.selectedWorkspaceId,
      'variableTypes',
      { page: this.currentTypeVariablePage, limit: this.typeVariablePageSize }
    ).subscribe({
      next: ({ createdTask, result }) => {
        this.variableTypeValidationTask = createdTask;
        const hasErrors = result.total > 0;
        const validationResult: ValidationResult = {
          status: hasErrors ? 'failed' : 'success',
          timestamp: Date.now(),
          details: {
            total: result.total,
            hasErrors: hasErrors
          }
        };

        this.validationTaskStateService.setValidationResult(
          this.appService.selectedWorkspaceId,
          'variableTypes',
          validationResult
        );

        this.invalidTypeVariables = result.data;
        this.totalInvalidTypeVariables = result.total;
        this.currentTypeVariablePage = result.page;
        this.typeVariablePageSize = result.limit;
        this.updatePaginatedTypeVariables();
        this.isVariableTypeValidationRunning = false;
        this.validateVariableTypesWasRun = true;
        this.saveValidationResult('variableTypes');
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
        this.isVariableTypeValidationRunning = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  validateResponseStatus(): void {
    this.isResponseStatusValidationRunning = true;
    this.invalidStatusVariables = [];
    this.totalInvalidStatusVariables = 0;
    this.validateResponseStatusWasRun = false;
    this.selectedStatusResponses.clear();
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runTask<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }>(
      this.appService.selectedWorkspaceId,
      'responseStatus',
      { page: this.currentStatusVariablePage, limit: this.statusVariablePageSize }
    ).subscribe({
      next: ({ createdTask, result }) => {
        this.responseStatusValidationTask = createdTask;
        const hasErrors = result.total > 0;
        const validationResult: ValidationResult = {
          status: hasErrors ? 'failed' : 'success',
          timestamp: Date.now(),
          details: {
            total: result.total,
            hasErrors: hasErrors
          }
        };
        this.validationTaskStateService.setValidationResult(
          this.appService.selectedWorkspaceId,
          'responseStatus',
          validationResult
        );

        this.invalidStatusVariables = result.data;
        this.totalInvalidStatusVariables = result.total;
        this.currentStatusVariablePage = result.page;
        this.statusVariablePageSize = result.limit;
        this.updatePaginatedStatusVariables();
        this.isResponseStatusValidationRunning = false;
        this.validateResponseStatusWasRun = true;
        this.saveValidationResult('responseStatus');
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
        this.isResponseStatusValidationRunning = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  onTypeVariablePageChange(event: PageEvent): void {
    this.currentTypeVariablePage = event.pageIndex + 1;
    this.typeVariablePageSize = event.pageSize;
    this.isVariableTypeValidationRunning = true;
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runTask<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }>(
      this.appService.selectedWorkspaceId,
      'variableTypes',
      { page: this.currentTypeVariablePage, limit: this.typeVariablePageSize }
    ).subscribe({
      next: ({ createdTask, result }) => {
        this.variableTypeValidationTask = createdTask;
        this.invalidTypeVariables = result.data;
        this.totalInvalidTypeVariables = result.total;
        this.currentTypeVariablePage = result.page;
        this.typeVariablePageSize = result.limit;
        this.updatePaginatedTypeVariables();
        this.isVariableTypeValidationRunning = false;
        this.validateVariableTypesWasRun = true;
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
        this.isVariableTypeValidationRunning = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  onStatusVariablePageChange(event: PageEvent): void {
    this.currentStatusVariablePage = event.pageIndex + 1;
    this.statusVariablePageSize = event.pageSize;
    this.isResponseStatusValidationRunning = true;
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runTask<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }>(
      this.appService.selectedWorkspaceId,
      'responseStatus',
      { page: this.currentStatusVariablePage, limit: this.statusVariablePageSize }
    ).subscribe({
      next: ({ createdTask, result }) => {
        this.responseStatusValidationTask = createdTask;
        this.invalidStatusVariables = result.data;
        this.totalInvalidStatusVariables = result.total;
        this.currentStatusVariablePage = result.page;
        this.statusVariablePageSize = result.limit;
        this.updatePaginatedStatusVariables();
        this.isResponseStatusValidationRunning = false;
        this.validateResponseStatusWasRun = true;
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
        this.isResponseStatusValidationRunning = false;
      }
    });

    this.subscriptions.push(subscription);
  }

  toggleTypeResponseSelection(responseId: number | undefined): void {
    if (responseId === undefined) return;

    if (this.selectedTypeResponses.has(responseId)) {
      this.selectedTypeResponses.delete(responseId);
    } else {
      this.selectedTypeResponses.add(responseId);
    }
  }

  isTypeResponseSelected(responseId: number | undefined): boolean {
    return responseId !== undefined && this.selectedTypeResponses.has(responseId);
  }

  selectAllTypeResponses(): void {
    this.invalidTypeVariables.forEach(variable => {
      if (variable.responseId !== undefined) {
        this.selectedTypeResponses.add(variable.responseId);
      }
    });
  }

  deselectAllTypeResponses(): void {
    this.selectedTypeResponses.clear();
  }

  deleteSelectedTypeResponses(): void {
    if (this.selectedTypeResponses.size === 0) {
      this.snackBar.open('Keine Antworten ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }
    this.isDeletingResponses = true;
    const responseIds = Array.from(this.selectedTypeResponses);
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runDeleteResponsesTask(
      this.appService.selectedWorkspaceId,
      responseIds
    ).subscribe({
      next: ({ result }) => {
        this.isDeletingResponses = false;
        this.snackBar.open(`${result.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

        this.isVariableTypeValidationRunning = true;
        const refreshSubscription = this.validationTaskRunnerService.runTask<{
          data: InvalidVariableDto[];
          total: number;
          page: number;
          limit: number;
        }>(
          this.appService.selectedWorkspaceId,
          'variableTypes',
          { page: this.currentTypeVariablePage, limit: this.typeVariablePageSize }
        ).subscribe({
          next: ({ createdTask, result: refreshResult }) => {
            this.variableTypeValidationTask = createdTask;
            this.invalidTypeVariables = refreshResult.data;
            this.totalInvalidTypeVariables = refreshResult.total;
            this.currentTypeVariablePage = refreshResult.page;
            this.typeVariablePageSize = refreshResult.limit;
            this.updatePaginatedTypeVariables();
            this.isVariableTypeValidationRunning = false;
            this.validateVariableTypesWasRun = true;
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
            this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
            this.isVariableTypeValidationRunning = false;
          }
        });

        this.subscriptions.push(refreshSubscription);
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.isDeletingResponses = false;
        this.snackBar.open(`Löschen fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
      }
    });

    this.subscriptions.push(subscription);
    this.selectedTypeResponses.clear();
  }

  deleteAllTypeResponses(): void {
    if (this.totalInvalidTypeVariables === 0) {
      this.snackBar.open('Keine ungültigen Variablentypen vorhanden', 'Schließen', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(ContentDialogComponent, {
      width: '400px',
      data: {
        title: 'Alle Einträge löschen',
        content: `Wirklich alle ${this.totalInvalidTypeVariables} ungültigen Variablentypen löschen?`,
        isJson: false,
        isXml: false,
        showDeleteButton: true
      }
    });

    dialogRef.afterClosed().subscribe(deleteFromDb => {
      if (deleteFromDb) {
        this.isDeletingResponses = true;
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];
        const subscription = this.validationTaskRunnerService.runDeleteAllResponsesTask(
          this.appService.selectedWorkspaceId,
          'variableTypes'
        ).subscribe({
          next: ({ result }) => {
            this.isDeletingResponses = false;
            this.snackBar.open(`${result.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

            this.isVariableTypeValidationRunning = true;
            const refreshSubscription = this.validationTaskRunnerService.runTask<{
              data: InvalidVariableDto[];
              total: number;
              page: number;
              limit: number;
            }>(
              this.appService.selectedWorkspaceId,
              'variableTypes',
              { page: this.currentTypeVariablePage, limit: this.typeVariablePageSize }
            ).subscribe({
              next: ({ createdTask, result: refreshResult }) => {
                this.variableTypeValidationTask = createdTask;
                this.invalidTypeVariables = refreshResult.data;
                this.totalInvalidTypeVariables = refreshResult.total;
                this.currentTypeVariablePage = refreshResult.page;
                this.typeVariablePageSize = refreshResult.limit;
                this.updatePaginatedTypeVariables();
                this.isVariableTypeValidationRunning = false;
                this.validateVariableTypesWasRun = true;
              },
              error: (err: unknown) => {
                const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
                this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
                this.isVariableTypeValidationRunning = false;
              }
            });

            this.subscriptions.push(refreshSubscription);
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
            this.isDeletingResponses = false;
            this.snackBar.open(`Löschen fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
          }
        });

        this.subscriptions.push(subscription);
      }
    });
  }

  toggleStatusResponseSelection(responseId: number | undefined): void {
    if (responseId === undefined) return;

    if (this.selectedStatusResponses.has(responseId)) {
      this.selectedStatusResponses.delete(responseId);
    } else {
      this.selectedStatusResponses.add(responseId);
    }
  }

  isStatusResponseSelected(responseId: number | undefined): boolean {
    return responseId !== undefined && this.selectedStatusResponses.has(responseId);
  }

  selectAllStatusResponses(): void {
    this.invalidStatusVariables.forEach(variable => {
      if (variable.responseId !== undefined) {
        this.selectedStatusResponses.add(variable.responseId);
      }
    });
  }

  deselectAllStatusResponses(): void {
    this.selectedStatusResponses.clear();
  }

  deleteSelectedStatusResponses(): void {
    if (this.selectedStatusResponses.size === 0) {
      this.snackBar.open('Keine Antworten ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }

    this.isDeletingResponses = true;
    const responseIds = Array.from(this.selectedStatusResponses);
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    const subscription = this.validationTaskRunnerService.runDeleteResponsesTask(
      this.appService.selectedWorkspaceId,
      responseIds
    ).subscribe({
      next: ({ result }) => {
        this.isDeletingResponses = false;
        this.snackBar.open(`${result.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

        this.isResponseStatusValidationRunning = true;
        const refreshSubscription = this.validationTaskRunnerService.runTask<{
          data: InvalidVariableDto[];
          total: number;
          page: number;
          limit: number;
        }>(
          this.appService.selectedWorkspaceId,
          'responseStatus',
          { page: this.currentStatusVariablePage, limit: this.statusVariablePageSize }
        ).subscribe({
          next: ({ createdTask, result: refreshResult }) => {
            this.responseStatusValidationTask = createdTask;
            this.invalidStatusVariables = refreshResult.data;
            this.totalInvalidStatusVariables = refreshResult.total;
            this.currentStatusVariablePage = refreshResult.page;
            this.statusVariablePageSize = refreshResult.limit;
            this.updatePaginatedStatusVariables();
            this.isResponseStatusValidationRunning = false;
            this.validateResponseStatusWasRun = true;
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
            this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
            this.isResponseStatusValidationRunning = false;
          }
        });

        this.subscriptions.push(refreshSubscription);
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.isDeletingResponses = false;
        this.snackBar.open(`Löschen fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
      }
    });

    this.subscriptions.push(subscription);
    this.selectedStatusResponses.clear();
  }

  deleteAllStatusResponses(): void {
    if (this.totalInvalidStatusVariables === 0) {
      this.snackBar.open('Keine ungültigen Antwortstatus vorhanden', 'Schließen', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(ContentDialogComponent, {
      width: '400px',
      data: {
        title: 'Alle Einträge löschen',
        content: `Wirklich alle ${this.totalInvalidStatusVariables} ungültigen Antwortstatus löschen?`,
        isJson: false,
        isXml: false,
        showDeleteButton: true
      }
    });

    dialogRef.afterClosed().subscribe(deleteFromDb => {
      if (deleteFromDb) {
        this.isDeletingResponses = true;
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];
        const subscription = this.validationTaskRunnerService.runDeleteAllResponsesTask(
          this.appService.selectedWorkspaceId,
          'responseStatus'
        ).subscribe({
          next: ({ result }) => {
            this.isDeletingResponses = false;
            this.snackBar.open(`${result.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

            this.isResponseStatusValidationRunning = true;
            const refreshSubscription = this.validationTaskRunnerService.runTask<{
              data: InvalidVariableDto[];
              total: number;
              page: number;
              limit: number;
            }>(
              this.appService.selectedWorkspaceId,
              'responseStatus',
              { page: this.currentStatusVariablePage, limit: this.statusVariablePageSize }
            ).subscribe({
              next: ({ createdTask, result: refreshResult }) => {
                this.responseStatusValidationTask = createdTask;
                this.invalidStatusVariables = refreshResult.data;
                this.totalInvalidStatusVariables = refreshResult.total;
                this.currentStatusVariablePage = refreshResult.page;
                this.statusVariablePageSize = refreshResult.limit;
                this.updatePaginatedStatusVariables();
                this.isResponseStatusValidationRunning = false;
                this.validateResponseStatusWasRun = true;
              },
              error: (err: unknown) => {
                const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
                this.snackBar.open(`Validierung fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
                this.isResponseStatusValidationRunning = false;
              }
            });

            this.subscriptions.push(refreshSubscription);
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
            this.isDeletingResponses = false;
            this.snackBar.open(`Löschen fehlgeschlagen: ${message}`, 'Schließen', { duration: 5000 });
          }
        });

        this.subscriptions.push(subscription);
      }
    });
  }

  toggleTypeExpansion(): void {
    this.expandedTypePanel = !this.expandedTypePanel;
  }

  toggleStatusExpansion(): void {
    this.expandedStatusPanel = !this.expandedStatusPanel;
  }

  isAnyValidationRunning(): boolean {
    return this.isVariableValidationRunning ||
           this.isVariableTypeValidationRunning ||
           this.isResponseStatusValidationRunning ||
           this.isTestTakersValidationRunning ||
           this.isGroupResponsesValidationRunning ||
           this.isDuplicateResponsesValidationRunning;
  }

  hasValidationFailed(type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses'): boolean {
    switch (type) {
      case 'variables':
        return this.validateVariablesWasRun && this.totalInvalidVariables > 0;
      case 'variableTypes':
        return this.validateVariableTypesWasRun && this.totalInvalidTypeVariables > 0;
      case 'responseStatus':
        return this.validateResponseStatusWasRun && this.totalInvalidStatusVariables > 0;
      case 'testTakers':
        return this.testTakersValidationWasRun &&
               this.testTakersValidationResult !== null &&
               (
                 !this.testTakersValidationResult.testTakersFound ||
                 this.testTakersValidationResult.missingPersons.length > 0
               );
      case 'groupResponses':
        return this.groupResponsesValidationWasRun &&
               this.groupResponsesResult !== null &&
               (
                 !this.groupResponsesResult.testTakersFound ||
                 !this.groupResponsesResult.allGroupsHaveResponses
               );
      case 'duplicateResponses':
        return this.validateDuplicateResponsesWasRun && this.totalDuplicateResponses > 0;
      default:
        return false;
    }
  }

  hasValidationSucceeded(type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses'): boolean {
    switch (type) {
      case 'variables':
        return this.validateVariablesWasRun && this.totalInvalidVariables === 0;
      case 'variableTypes':
        return this.validateVariableTypesWasRun && this.totalInvalidTypeVariables === 0;
      case 'responseStatus':
        return this.validateResponseStatusWasRun && this.totalInvalidStatusVariables === 0;
      case 'testTakers':
        return this.testTakersValidationWasRun &&
               this.testTakersValidationResult !== null &&
               this.testTakersValidationResult.testTakersFound &&
               this.testTakersValidationResult.missingPersons.length === 0;
      case 'groupResponses':
        return this.groupResponsesValidationWasRun &&
               this.groupResponsesResult !== null &&
               this.groupResponsesResult.testTakersFound &&
               this.groupResponsesResult.allGroupsHaveResponses;
      case 'duplicateResponses':
        return this.validateDuplicateResponsesWasRun && this.totalDuplicateResponses === 0;
      default:
        return false;
    }
  }

  getOverallIssuesCount(): number {
    let total = 0;

    if (this.hasValidationFailed('variables')) {
      total += this.totalInvalidVariables;
    }

    if (this.hasValidationFailed('variableTypes')) {
      total += this.totalInvalidTypeVariables;
    }

    if (this.hasValidationFailed('responseStatus')) {
      total += this.totalInvalidStatusVariables;
    }

    if (this.hasValidationFailed('testTakers')) {
      total += this.testTakersValidationResult?.missingPersons?.length ?? 0;
    }

    if (this.hasValidationFailed('groupResponses')) {
      total += (this.groupResponsesResult?.groupsWithResponses ?? []).filter((g: { group: string; hasResponse: boolean }) => !g.hasResponse).length;
    }

    if (this.hasValidationFailed('duplicateResponses')) {
      total += this.totalDuplicateResponses;
    }

    return total;
  }

  getOverallStatus(): 'running' | 'failed' | 'success' | 'not-run' {
    if (this.isAnyValidationRunning()) {
      return 'running';
    }

    const anyRun =
      this.validateVariablesWasRun ||
      this.validateVariableTypesWasRun ||
      this.validateResponseStatusWasRun ||
      this.testTakersValidationWasRun ||
      this.groupResponsesValidationWasRun ||
      this.validateDuplicateResponsesWasRun;

    if (!anyRun) {
      return 'not-run';
    }

    if (
      this.hasValidationFailed('variables') ||
      this.hasValidationFailed('variableTypes') ||
      this.hasValidationFailed('responseStatus') ||
      this.hasValidationFailed('testTakers') ||
      this.hasValidationFailed('groupResponses') ||
      this.hasValidationFailed('duplicateResponses')
    ) {
      return 'failed';
    }

    return 'success';
  }

  getOverallHeadline(): string {
    const status = this.getOverallStatus();
    switch (status) {
      case 'running':
        return 'Validierung läuft';
      case 'failed':
        return 'Validierung: Handlungsbedarf';
      case 'success':
        return 'Validierung: Alles in Ordnung';
      case 'not-run':
      default:
        return 'Validierung: Noch nicht gestartet';
    }
  }

  getOverallSubline(): string {
    const status = this.getOverallStatus();
    const issues = this.getOverallIssuesCount();

    switch (status) {
      case 'running':
        return 'Bitte warten – Ergebnisse erscheinen automatisch.';
      case 'failed':
        return issues > 0 ? `${issues} Auffälligkeiten gefunden. Details unten.` : 'Auffälligkeiten gefunden. Details unten.';
      case 'success':
        return 'Keine Auffälligkeiten gefunden.';
      case 'not-run':
      default:
        return 'Starten Sie unten die gewünschten Prüfungen.';
    }
  }

  getRecommendedNextStep(): string {
    if (this.isAnyValidationRunning()) {
      return 'Sie können den Dialog schließen – die Prüfungen laufen im Hintergrund weiter.';
    }

    if (!this.testTakersValidationWasRun) {
      return 'Empfehlung: Starten Sie zuerst „Testpersonen“ – viele Folgeprüfungen hängen davon ab.';
    }

    if (!this.validateVariablesWasRun) {
      return 'Empfehlung: Prüfen Sie danach „Variablen definiert“.';
    }

    if (!this.validateVariableTypesWasRun) {
      return 'Empfehlung: Prüfen Sie als Nächstes „Variablentypen“.';
    }

    if (!this.validateResponseStatusWasRun) {
      return 'Empfehlung: Prüfen Sie anschließend „Antwortstatus“.';
    }

    if (!this.validateDuplicateResponsesWasRun) {
      return 'Empfehlung: Prüfen Sie zuletzt „Doppelte Antworten“.';
    }

    return 'Tipp: Bei Auffälligkeiten können Sie unten direkt bereinigen oder gezielt einzelne Fälle prüfen.';
  }

  getValidationWhyText(type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses'): string {
    switch (type) {
      case 'testTakers':
        return 'Ohne passende Testpersonen-Zuordnung können Antworten nicht eindeutig einer Person/Gruppe zugeordnet werden.';
      case 'variables':
        return 'Antworten auf nicht definierte Variablen sind i.d.R. Tippfehler oder veraltete Item-Versionen und verfälschen Auswertungen.';
      case 'variableTypes':
        return 'Wenn der Datentyp nicht passt (z.B. Text statt Zahl), können Scoring/Filter und Exporte fehlschlagen.';
      case 'responseStatus':
        return 'Ungültige Statuswerte können verhindern, dass Antworten korrekt als erreicht/gesetzt interpretiert werden.';
      case 'duplicateResponses':
        return 'Doppelte Antworten führen zu Mehrdeutigkeiten (welche Antwort zählt?) und machen Statistiken/Exports inkonsistent.';
      case 'groupResponses':
        return 'Wenn Gruppen keine Antworten haben, ist die Stichprobe ggf. unvollständig oder die Zuordnung zu Gruppen fehlerhaft.';
      default:
        return '';
    }
  }

  getValidationFixHint(type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses'): string {
    switch (type) {
      case 'testTakers':
        return 'Prüfen Sie die TestTakers-XML (Login/Code/Gruppe/Booklet) und importieren Sie fehlende Testpersonen oder korrigieren Sie Schreibweisen.';
      case 'variables':
        return 'Öffnen Sie die Unit.xml über den Dateinamen-Link und prüfen Sie, ob die Variable existiert. Danach: Daten bereinigen (löschen) oder Definitionen aktualisieren.';
      case 'variableTypes':
        return 'Prüfen Sie erwarteten Typ und Fehlergrund. Häufig hilft eine Korrektur in der Unit.xml oder das Bereinigen einzelner falscher Werte.';
      case 'responseStatus':
        return 'Vergleichen Sie Statuswerte mit der Definition in der Unit.xml. Bereinigen Sie ungültige Antworten oder passen Sie die Definition an.';
      case 'duplicateResponses':
        return 'Wählen Sie pro Duplikat die „gültige“ Antwort aus (oder „Vorschlag übernehmen“) und lösen Sie anschließend auf.';
      case 'groupResponses':
        return 'Prüfen Sie Gruppen/Booklets der Testpersonen sowie den Import der Antworten. Oft fehlen Daten für eine Gruppe oder die Gruppenzuordnung ist inkonsistent.';
      default:
        return '';
    }
  }

  getValidationStatus(type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses'): 'running' | 'failed' | 'success' | 'not-run' {
    switch (type) {
      case 'variables':
        if (this.isVariableValidationRunning) return 'running';
        if (this.hasValidationFailed('variables')) return 'failed';
        if (this.hasValidationSucceeded('variables')) return 'success';
        return 'not-run';
      case 'variableTypes':
        if (this.isVariableTypeValidationRunning) return 'running';
        if (this.hasValidationFailed('variableTypes')) return 'failed';
        if (this.hasValidationSucceeded('variableTypes')) return 'success';
        return 'not-run';
      case 'responseStatus':
        if (this.isResponseStatusValidationRunning) return 'running';
        if (this.hasValidationFailed('responseStatus')) return 'failed';
        if (this.hasValidationSucceeded('responseStatus')) return 'success';
        return 'not-run';
      case 'testTakers':
        if (this.isTestTakersValidationRunning) return 'running';
        if (this.hasValidationFailed('testTakers')) return 'failed';
        if (this.hasValidationSucceeded('testTakers')) return 'success';
        return 'not-run';
      case 'groupResponses':
        if (this.isGroupResponsesValidationRunning) return 'running';
        if (this.hasValidationFailed('groupResponses')) return 'failed';
        if (this.hasValidationSucceeded('groupResponses')) return 'success';
        return 'not-run';
      case 'duplicateResponses':
        if (this.isDuplicateResponsesValidationRunning) return 'running';
        if (this.hasValidationFailed('duplicateResponses')) return 'failed';
        if (this.hasValidationSucceeded('duplicateResponses')) return 'success';
        return 'not-run';
      default:
        return 'not-run';
    }
  }

  getValidationLabel(type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses'): string {
    switch (type) {
      case 'variables':
        return 'Variable definiert';
      case 'variableTypes':
        return 'Variable ist gültig';
      case 'responseStatus':
        return 'Status ist gültig';
      case 'testTakers':
        return 'Testperson definiert';
      case 'groupResponses':
        return 'Antworten für alle Gruppen';
      case 'duplicateResponses':
        return 'Doppelte Antworten';
      default:
        return '';
    }
  }

  private saveValidationResult(type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses'): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    const status = this.getValidationStatus(type);
    if (status === 'success' || status === 'failed') {
      const validationResult = {
        status: status as 'success' | 'failed',
        timestamp: Date.now(),
        details: this.getValidationDetails(type)
      };
      this.validationTaskStateService.setValidationResult(workspaceId, type, validationResult);
    }
  }

  private getValidationDetails(type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses'): unknown {
    switch (type) {
      case 'variables':
        return {
          total: this.totalInvalidVariables,
          hasErrors: this.totalInvalidVariables > 0
        };
      case 'variableTypes':
        return {
          total: this.totalInvalidTypeVariables,
          hasErrors: this.totalInvalidTypeVariables > 0
        };
      case 'responseStatus':
        return {
          total: this.totalInvalidStatusVariables,
          hasErrors: this.totalInvalidStatusVariables > 0
        };
      case 'testTakers':
        if (!this.testTakersValidationResult) return { hasErrors: false };
        return {
          testTakersFound: this.testTakersValidationResult.testTakersFound,
          missingPersonsCount: this.testTakersValidationResult.missingPersons.length,
          hasErrors: !this.testTakersValidationResult.testTakersFound ||
                    this.testTakersValidationResult.missingPersons.length > 0
        };
      case 'groupResponses':
        if (!this.groupResponsesResult) return { hasErrors: false };
        return {
          testTakersFound: this.groupResponsesResult.testTakersFound,
          allGroupsHaveResponses: this.groupResponsesResult.allGroupsHaveResponses,
          hasErrors: !this.groupResponsesResult.testTakersFound ||
                    !this.groupResponsesResult.allGroupsHaveResponses
        };
      case 'duplicateResponses':
        return {
          total: this.totalDuplicateResponses,
          hasErrors: this.totalDuplicateResponses > 0
        };
      default:
        return {};
    }
  }

  private loadPreviousValidationResults(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    const inMemoryResults = this.validationTaskStateService.getAllValidationResults(workspaceId);
    if (inMemoryResults.variables) {
      this.processVariablesResult(inMemoryResults.variables, true);
    }

    if (inMemoryResults.variableTypes) {
      this.processVariableTypesResult(inMemoryResults.variableTypes, true);
    }

    if (inMemoryResults.responseStatus) {
      this.processResponseStatusResult(inMemoryResults.responseStatus, true);
    }

    if (inMemoryResults.testTakers) {
      this.processTestTakersResult(inMemoryResults.testTakers, true);
    }

    if (inMemoryResults.groupResponses) {
      this.processGroupResponsesResult(inMemoryResults.groupResponses, true);
    }

    if (inMemoryResults.duplicateResponses) {
      this.processDuplicateResponsesResult(inMemoryResults.duplicateResponses, true);
    }

    const subscription = this.validationService.getLastValidationResults(workspaceId)
      .subscribe({
        next: results => {
          if (results.variables) {
            const { task, result } = results.variables;
            let status: 'success' | 'failed' | 'not-run' = 'not-run';
            if (task.status === 'completed') {
              status = task.error ? 'failed' : 'success';
            }
            const validationResult: ValidationResult = {
              status,
              timestamp: new Date(task.created_at).getTime(),
              details: result
            };
            this.processVariablesResult(validationResult, false);
            this.validationTaskStateService.setValidationResult(workspaceId, 'variables', validationResult);
          }

          if (results.variableTypes) {
            const { task, result } = results.variableTypes;
            let status: 'success' | 'failed' | 'not-run' = 'not-run';
            if (task.status === 'completed') {
              status = task.error ? 'failed' : 'success';
            }
            const validationResult: ValidationResult = {
              status,
              timestamp: new Date(task.created_at).getTime(),
              details: result
            };
            this.processVariableTypesResult(validationResult, false);
            this.validationTaskStateService.setValidationResult(workspaceId, 'variableTypes', validationResult);
          }

          if (results.responseStatus) {
            const { task, result } = results.responseStatus;
            let status: 'success' | 'failed' | 'not-run' = 'not-run';
            if (task.status === 'completed') {
              status = task.error ? 'failed' : 'success';
            }
            const validationResult: ValidationResult = {
              status,
              timestamp: new Date(task.created_at).getTime(),
              details: result
            };
            this.processResponseStatusResult(validationResult, false);
            this.validationTaskStateService.setValidationResult(workspaceId, 'responseStatus', validationResult);
          }

          if (results.testTakers) {
            const { task, result } = results.testTakers;
            let status: 'success' | 'failed' | 'not-run' = 'not-run';
            if (task.status === 'completed') {
              status = task.error ? 'failed' : 'success';
            }
            const validationResult: ValidationResult = {
              status,
              timestamp: new Date(task.created_at).getTime(),
              details: result
            };
            this.processTestTakersResult(validationResult, false);
            this.validationTaskStateService.setValidationResult(workspaceId, 'testTakers', validationResult);
          }

          if (results.groupResponses) {
            const { task, result } = results.groupResponses;
            let status: 'success' | 'failed' | 'not-run' = 'not-run';
            if (task.status === 'completed') {
              status = task.error ? 'failed' : 'success';
            }
            const validationResult: ValidationResult = {
              status,
              timestamp: new Date(task.created_at).getTime(),
              details: result
            };
            this.processGroupResponsesResult(validationResult, false);
            this.validationTaskStateService.setValidationResult(workspaceId, 'groupResponses', validationResult);
          }

          if (results.duplicateResponses) {
            const { task, result } = results.duplicateResponses;
            let status: 'success' | 'failed' | 'not-run' = 'not-run';
            if (task.status === 'completed') {
              status = task.error ? 'failed' : 'success';
            }
            const validationResult: ValidationResult = {
              status,
              timestamp: new Date(task.created_at).getTime(),
              details: result
            };
            this.processDuplicateResponsesResult(validationResult, false);
            this.validationTaskStateService.setValidationResult(workspaceId, 'duplicateResponses', validationResult);
          }
        },
        error: () => {
        }
      });

    this.subscriptions.push(subscription);
  }

  private processVariablesResult(result: ValidationResult, fromCurrentSession: boolean = false): void {
    this.validateVariablesWasRun = this.validateVariablesWasRun || fromCurrentSession;

    if (result.details) {
      const details = result.details as { total?: number; data?: InvalidVariableDto[]; page?: number; limit?: number };
      if (typeof details.total === 'number') {
        this.totalInvalidVariables = Number(details.total);
      } else if (result.status === 'success') {
        this.totalInvalidVariables = 0;
      }

      if (typeof details.page === 'number') {
        this.currentVariablePage = details.page;
      }
      if (typeof details.limit === 'number') {
        this.variablePageSize = details.limit;
      }

      if (Array.isArray(details.data)) {
        this.invalidVariables = details.data;
        this.updatePaginatedVariables();
        return;
      }
    }

    if (result.status === 'success') {
      this.totalInvalidVariables = 0;
      this.invalidVariables = [];
      this.updatePaginatedVariables();
    }
  }

  private processVariableTypesResult(result: ValidationResult, fromCurrentSession: boolean = false): void {
    this.validateVariableTypesWasRun = this.validateVariableTypesWasRun || fromCurrentSession;

    if (result.details) {
      const details = result.details as { total?: number; data?: InvalidVariableDto[]; page?: number; limit?: number };
      if (typeof details.total === 'number') {
        this.totalInvalidTypeVariables = Number(details.total);
      } else if (result.status === 'success') {
        this.totalInvalidTypeVariables = 0;
      }

      if (typeof details.page === 'number') {
        this.currentTypeVariablePage = details.page;
      }
      if (typeof details.limit === 'number') {
        this.typeVariablePageSize = details.limit;
      }

      if (Array.isArray(details.data)) {
        this.invalidTypeVariables = details.data;
        this.updatePaginatedTypeVariables();
        return;
      }
    }

    if (result.status === 'success') {
      this.totalInvalidTypeVariables = 0;
      this.invalidTypeVariables = [];
      this.updatePaginatedTypeVariables();
    }
  }

  private processResponseStatusResult(result: ValidationResult, fromCurrentSession: boolean = false): void {
    this.validateResponseStatusWasRun = this.validateResponseStatusWasRun || fromCurrentSession;

    if (result.details) {
      const details = result.details as { total?: number; data?: InvalidVariableDto[]; page?: number; limit?: number };
      if (typeof details.total === 'number') {
        this.totalInvalidStatusVariables = Number(details.total);
      } else if (result.status === 'success') {
        this.totalInvalidStatusVariables = 0;
      }

      if (typeof details.page === 'number') {
        this.currentStatusVariablePage = details.page;
      }
      if (typeof details.limit === 'number') {
        this.statusVariablePageSize = details.limit;
      }

      if (Array.isArray(details.data)) {
        this.invalidStatusVariables = details.data;
        this.updatePaginatedStatusVariables();
        return;
      }
    }

    if (result.status === 'success') {
      this.totalInvalidStatusVariables = 0;
      this.invalidStatusVariables = [];
      this.updatePaginatedStatusVariables();
    }
  }

  private processTestTakersResult(result: ValidationResult, fromCurrentSession: boolean = false): void {
    this.testTakersValidationWasRun = this.testTakersValidationWasRun || fromCurrentSession;

    if (result.details) {
      const details = result.details as TestTakersValidationDto;
      if (typeof details?.testTakersFound === 'boolean') {
        this.testTakersValidationResult = details;
        this.updatePaginatedMissingPersons();
        return;
      }
    }

    if (result.status === 'success') {
      this.testTakersValidationResult = {
        testTakersFound: true,
        totalGroups: 0,
        totalLogins: 0,
        totalBookletCodes: 0,
        missingPersons: []
      };
      this.updatePaginatedMissingPersons();
    }
  }

  private processGroupResponsesResult(result: ValidationResult, fromCurrentSession: boolean = false): void {
    this.groupResponsesValidationWasRun = this.groupResponsesValidationWasRun || fromCurrentSession;

    if (result.details) {
      const details = result.details as {
        testTakersFound?: boolean;
        groupsWithResponses?: { group: string; hasResponse: boolean }[];
        allGroupsHaveResponses?: boolean;
        total?: number;
        page?: number;
        limit?: number;
      };
      if (typeof details?.testTakersFound === 'boolean') {
        this.groupResponsesResult = {
          testTakersFound: Boolean(details.testTakersFound),
          groupsWithResponses: Array.isArray(details.groupsWithResponses) ? details.groupsWithResponses : [],
          allGroupsHaveResponses: Boolean(details.allGroupsHaveResponses)
        };
        if (typeof details.total === 'number') {
          this.totalGroupResponses = Number(details.total);
        }
        if (typeof details.page === 'number') {
          this.currentGroupResponsesPage = details.page;
        }
        if (typeof details.limit === 'number') {
          this.groupResponsesPageSize = details.limit;
        }
        this.updatePaginatedGroupResponses();
        return;
      }
    }

    if (result.status === 'success') {
      this.groupResponsesResult = {
        testTakersFound: true,
        groupsWithResponses: [],
        allGroupsHaveResponses: true
      };
      this.updatePaginatedGroupResponses();
    }
  }

  private processDuplicateResponsesResult(result: ValidationResult, fromCurrentSession: boolean = false): void {
    this.validateDuplicateResponsesWasRun = this.validateDuplicateResponsesWasRun || fromCurrentSession;

    if (result.details) {
      const details = result.details as DuplicateResponsesResultDto;
      if (typeof details?.total === 'number') {
        this.totalDuplicateResponses = details.total;
        this.duplicateResponsesResult = details;
        this.duplicateResponses = (details.data || []).map(duplicate => ({
          ...duplicate,
          key: this.buildDuplicateKey(duplicate)
        }));
        this.updatePaginatedDuplicateResponses();
        return;
      }
    }

    if (result.status === 'success') {
      this.totalDuplicateResponses = 0;
      this.duplicateResponses = [];
      this.updatePaginatedDuplicateResponses();
    }
  }

  closeWithResults(): void {
    this.isClosing = true;

    this.storeRunningTasks();

    this.dialogRef.close({
      invalidVariables: this.invalidVariables,
      totalInvalidVariables: this.totalInvalidVariables,
      invalidTypeVariables: this.invalidTypeVariables,
      totalInvalidTypeVariables: this.totalInvalidTypeVariables,
      invalidStatusVariables: this.invalidStatusVariables,
      totalInvalidStatusVariables: this.totalInvalidStatusVariables
    });
  }

  showUnitXml(unitName: string): void {
    this.backendService.getUnitContentXml(this.appService.selectedWorkspaceId, unitName)
      .subscribe(xmlContent => {
        if (xmlContent) {
          this.dialog.open(ContentDialogComponent, {
            width: '80%',
            data: {
              title: `Unit XML: ${unitName}`,
              content: xmlContent,
              isXml: true
            }
          });
        } else {
          this.snackBar.open(`Keine XML-Daten für Unit ${unitName} gefunden`, 'Schließen', { duration: 3000 });
        }
      });
  }
}
