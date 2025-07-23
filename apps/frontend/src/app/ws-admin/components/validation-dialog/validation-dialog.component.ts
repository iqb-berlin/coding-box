import {
  Component, Inject, inject, ViewChild, AfterViewInit, OnInit, OnDestroy
} from '@angular/core';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef
} from '@angular/material/dialog';
import { MatStepperModule } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatPaginator, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { ValidationTaskStateService, ValidationResult } from '../../../services/validation-task-state.service';
import { ValidationService } from '../../../services/validation.service';
import { InvalidVariableDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import { TestTakersValidationDto, MissingPersonDto } from '../../../../../../../api-dto/files/testtakers-validation.dto';
import { DuplicateResponsesResultDto } from '../../../../../../../api-dto/files/duplicate-response.dto';
import { DuplicateResponseSelectionDto } from '../../../models/duplicate-response-selection.dto';
import { ContentDialogComponent } from '../../../shared/dialogs/content-dialog/content-dialog.component';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

@Component({
  selector: 'coding-box-validation-dialog',
  templateUrl: './validation-dialog.component.html',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatStepperModule,
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
      align-items: center;
      margin: 0 0 16px 0;
      padding: 8px 16px;
      border-radius: 4px;
      background-color: rgba(33, 150, 243, 0.1);
      color: #2196F3;
      border: 1px solid #2196F3;
    }

    .info-banner mat-icon {
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

    .validation-summary {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
      padding: 16px;
      border-radius: 4px;
      background-color: #f5f5f5;
      border: 1px solid #e0e0e0;
    }

    .validation-summary-title {
      font-size: 16px;
      font-weight: 500;
      margin-bottom: 8px;
    }

    .validation-summary-item {
      display: flex;
      align-items: center;
      padding: 8px;
      border-radius: 4px;
      font-weight: 500;
    }

    .validation-summary-item mat-icon {
      margin-right: 8px;
    }

    .validation-summary-item-label {
      flex: 1;
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

  // Subscriptions
  private subscriptions: Subscription[] = [];

  // Flag to indicate if we're closing the dialog
  private isClosing = false;

  // Validation tasks
  private variableValidationTask: ValidationTaskDto | null = null;
  private variableTypeValidationTask: ValidationTaskDto | null = null;
  private responseStatusValidationTask: ValidationTaskDto | null = null;
  private testTakersValidationTask: ValidationTaskDto | null = null;
  private groupResponsesValidationTask: ValidationTaskDto | null = null;

  // Variable validation properties
  invalidVariables: InvalidVariableDto[] = [];
  totalInvalidVariables: number = 0;
  currentVariablePage: number = 1;
  variablePageSize: number = 10;

  // Variable type validation properties
  invalidTypeVariables: InvalidVariableDto[] = [];
  totalInvalidTypeVariables: number = 0;
  currentTypeVariablePage: number = 1;
  typeVariablePageSize: number = 10;

  // Response status validation properties
  invalidStatusVariables: InvalidVariableDto[] = [];
  totalInvalidStatusVariables: number = 0;
  currentStatusVariablePage: number = 1;
  statusVariablePageSize: number = 10;

  // Group responses validation properties
  groupResponsesResult: {
    testTakersFound: boolean;
    groupsWithResponses: { group: string; hasResponse: boolean }[];
    allGroupsHaveResponses: boolean;
  } | null = null;

  isGroupResponsesValidationRunning: boolean = false;

  groupResponsesValidationWasRun: boolean = false;

  expandedGroupResponsesPanel: boolean = false;

  paginatedGroupResponses = new MatTableDataSource<{ group: string; hasResponse: boolean }>([]);

  // Group responses pagination properties
  currentGroupResponsesPage: number = 1;
  groupResponsesPageSize: number = 10;
  totalGroupResponses: number = 0;

  // TestTakers validation properties
  testTakersValidationResult: TestTakersValidationDto | null = null;
  isTestTakersValidationRunning: boolean = false;
  testTakersValidationWasRun: boolean = false;
  expandedMissingPersonsPanel: boolean = false;
  paginatedMissingPersons = new MatTableDataSource<MissingPersonDto>([]);

  // Validation running flags
  isVariableValidationRunning: boolean = false;
  isVariableTypeValidationRunning: boolean = false;
  isResponseStatusValidationRunning: boolean = false;
  isDuplicateResponsesValidationRunning: boolean = false;

  // Validation was run flags
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
  duplicateResponseSelections: Map<string, number> = new Map<string, number>(); // Maps duplicate key to selected response ID

  pageSizeOptions = [25, 50, 100, 200];

  paginatedVariables = new MatTableDataSource<InvalidVariableDto>([]);
  paginatedTypeVariables = new MatTableDataSource<InvalidVariableDto>([]);
  paginatedStatusVariables = new MatTableDataSource<InvalidVariableDto>([]);

  // Duplicate responses validation properties
  duplicateResponses: DuplicateResponseSelectionDto[] = [];
  duplicateResponsesResult: DuplicateResponsesResultDto | null = null;
  totalDuplicateResponses: number = 0;
  paginatedDuplicateResponses: DuplicateResponseSelectionDto[] = [];
  duplicateResponsesPageSize: number = 10;
  currentDuplicateResponsesPage: number = 1;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: unknown,
    private dialogRef: MatDialogRef<ValidationDialogComponent>,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    // Check for existing validation tasks
    this.checkForExistingTasks();

    // Load previous validation results
    this.loadPreviousValidationResults();
  }

  ngAfterViewInit(): void {
    // Set up paginators after view is initialized
    this.paginatedVariables.paginator = this.variablePaginator;
    this.paginatedTypeVariables.paginator = this.variableTypePaginator;
    this.paginatedStatusVariables.paginator = this.statusVariablePaginator;
    this.paginatedGroupResponses.paginator = this.groupResponsesPaginator;
  }

  ngOnDestroy(): void {
    // If we're closing the dialog, don't cancel running tasks
    if (this.isClosing) {
      // Store running task IDs in the service
      this.storeRunningTasks();

      // Only unsubscribe from subscriptions, don't cancel tasks
      this.subscriptions.forEach(sub => sub.unsubscribe());
    } else {
      // Clean up subscriptions to prevent memory leaks
      this.subscriptions.forEach(sub => sub.unsubscribe());
    }
  }

  /**
   * Check for existing validation tasks and load them if they exist
   */
  private checkForExistingTasks(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    const taskIds = this.validationTaskStateService.getAllTaskIds(workspaceId);

    // Check for each type of validation task
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
  }

  /**
   * Load an existing validation task
   * @param type The type of validation task
   * @param taskId The task ID
   */
  private loadExistingTask(
    type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses',
    taskId: number
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    // Set the appropriate task object
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
      default:
        // No action needed for unknown types
        break;
    }

    // Get the task status
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
            default:
              break;
          }

          // If the task is still running, poll for updates
          if (task.status === 'pending' || task.status === 'processing') {
            this.pollExistingTask(type, taskId);
          } else if (task.status === 'completed') {
            // If the task is completed, get the results
            this.loadTaskResults(type, taskId);
          } else if (task.status === 'failed') {
            // If the task failed, show an error message
            this.snackBar.open(`Validierung fehlgeschlagen: ${task.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.validationTaskStateService.removeTaskId(workspaceId, type);

            // Reset the running flag
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
              default:
                break;
            }
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.validationTaskStateService.removeTaskId(workspaceId, type);

          // Reset the running flag
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
            default:
              break;
          }
        }
      });

    this.subscriptions.push(subscription);
  }

  /**
   * Poll for updates on an existing validation task
   * @param type The type of validation task
   * @param taskId The task ID
   */
  private pollExistingTask(
    type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses',
    taskId: number
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    const pollSubscription = this.backendService.pollValidationTask(
      workspaceId,
      taskId
    ).subscribe({
      next: updatedTask => {
        // If task is completed, get the results
        if (updatedTask.status === 'completed') {
          this.loadTaskResults(type, taskId);
        } else if (updatedTask.status === 'failed') {
          this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
          this.validationTaskStateService.removeTaskId(workspaceId, type);

          // Reset the running flag
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
            default:
              break;
          }
        }
      },
      error: () => {
        this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
        this.validationTaskStateService.removeTaskId(workspaceId, type);

        // Reset the running flag
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
          default:
            break;
        }
      }
    });

    this.subscriptions.push(pollSubscription);
  }

  /**
   * Load the results of a validation task
   * @param type The type of validation task
   * @param taskId The task ID
   */
  private loadTaskResults(
    type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses',
    taskId: number
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    const subscription = this.backendService.getValidationResults(
      workspaceId,
      taskId
    ).subscribe({
      next: result => {
        // Define result type interfaces outside of switch
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

        // Process results based on type
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

            // Save validation result to the service
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

            // Save validation result to the service
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

            // Save validation result to the service
            this.saveValidationResult(type);
            break;
          }

          case 'testTakers': {
            this.testTakersValidationResult = result as TestTakersValidationDto;
            this.updatePaginatedMissingPersons();
            this.isTestTakersValidationRunning = false;
            this.testTakersValidationWasRun = true;

            // Save validation result to the service
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

            // Save validation result to the service
            this.saveValidationResult(type);
            break;
          }

          default:
            break;
        }

        // Remove the task ID from the service since we've loaded the results
        this.validationTaskStateService.removeTaskId(workspaceId, type);
      },
      error: () => {
        this.snackBar.open('Fehler beim Abrufen der Validierungsergebnisse', 'Schließen', { duration: 5000 });
        this.validationTaskStateService.removeTaskId(workspaceId, type);

        // Reset the running flag
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
          default:
            // No action needed for unknown types
            break;
        }
      }
    });

    this.subscriptions.push(subscription);
  }

  /**
   * Store running tasks in the service
   */
  private storeRunningTasks(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    // Store each running task
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
      // totalGroupResponses is now set from the server response
    }
  }

  onGroupResponsesPageChange(event: PageEvent): void {
    this.currentGroupResponsesPage = event.pageIndex + 1;
    this.groupResponsesPageSize = event.pageSize;

    // Reload data from server with new pagination parameters using background task
    this.isGroupResponsesValidationRunning = true;

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background validation task
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'groupResponses',
      this.currentGroupResponsesPage,
      this.groupResponsesPageSize
    ).subscribe(task => {
      this.groupResponsesValidationTask = task;

      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              // Type the result
              const typedResult = result as {
                testTakersFound: boolean;
                groupsWithResponses: { group: string; hasResponse: boolean }[];
                allGroupsHaveResponses: boolean;
                total: number;
                page: number;
                limit: number;
              };

              this.groupResponsesResult = typedResult;
              this.totalGroupResponses = typedResult.total;
              this.updatePaginatedGroupResponses();
              this.isGroupResponsesValidationRunning = false;
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.isGroupResponsesValidationRunning = false;
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.isGroupResponsesValidationRunning = false;
        }
      });

      this.subscriptions.push(pollSubscription);
    });

    this.subscriptions.push(subscription);
  }

  validateTestTakers(): void {
    this.isTestTakersValidationRunning = true;
    this.testTakersValidationResult = null;
    this.testTakersValidationWasRun = false;

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background validation task
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'testTakers'
    ).subscribe(task => {
      this.testTakersValidationTask = task;

      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // Update progress if available
          if (updatedTask.progress) {
            // Could show progress here if needed
          }

          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              // Type the result as TestTakersValidationDto
              this.testTakersValidationResult = result as TestTakersValidationDto;

              // Check if the result indicates errors
              const hasErrors =
                !this.testTakersValidationResult.testTakersFound ||
                this.testTakersValidationResult.missingPersons.length > 0;

              // Create a validation result with the appropriate status
              const validationResult: ValidationResult = {
                status: hasErrors ? 'failed' : 'success',
                timestamp: Date.now(),
                details: {
                  testTakersFound: this.testTakersValidationResult.testTakersFound,
                  missingPersonsCount: this.testTakersValidationResult.missingPersons.length,
                  hasErrors: hasErrors
                }
              };

              // Store the result in the validation task state service
              this.validationTaskStateService.setValidationResult(
                this.appService.selectedWorkspaceId,
                'testTakers',
                validationResult
              );

              this.updatePaginatedMissingPersons();
              this.isTestTakersValidationRunning = false;
              this.testTakersValidationWasRun = true;

              this.saveValidationResult('testTakers');
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.isTestTakersValidationRunning = false;
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.isTestTakersValidationRunning = false;
        }
      });

      this.subscriptions.push(pollSubscription);
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

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background validation task
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'groupResponses',
      this.currentGroupResponsesPage,
      this.groupResponsesPageSize
    ).subscribe(task => {
      this.groupResponsesValidationTask = task;

      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // Update progress if available
          if (updatedTask.progress) {
            // Could show progress here if needed
          }

          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              // Type the result
              const typedResult = result as {
                testTakersFound: boolean;
                groupsWithResponses: { group: string; hasResponse: boolean }[];
                allGroupsHaveResponses: boolean;
                total: number;
                page: number;
                limit: number;
              };

              // Check if the result indicates errors
              const hasErrors =
                !typedResult.testTakersFound || !typedResult.allGroupsHaveResponses;

              // Create a validation result with the appropriate status
              const validationResult: ValidationResult = {
                status: hasErrors ? 'failed' : 'success',
                timestamp: Date.now(),
                details: {
                  testTakersFound: typedResult.testTakersFound,
                  allGroupsHaveResponses: typedResult.allGroupsHaveResponses,
                  hasErrors: hasErrors
                }
              };

              // Store the result in the validation task state service
              this.validationTaskStateService.setValidationResult(
                this.appService.selectedWorkspaceId,
                'groupResponses',
                validationResult
              );

              this.groupResponsesResult = typedResult;
              this.totalGroupResponses = typedResult.total;
              this.updatePaginatedGroupResponses();
              this.isGroupResponsesValidationRunning = false;
              this.groupResponsesValidationWasRun = true;

              // Save the validation result to the service
              this.saveValidationResult('groupResponses');
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.isGroupResponsesValidationRunning = false;
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.isGroupResponsesValidationRunning = false;
        }
      });

      this.subscriptions.push(pollSubscription);
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

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background validation task
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'duplicateResponses',
      this.currentDuplicateResponsesPage,
      this.duplicateResponsesPageSize
    ).subscribe(task => {
      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // Update progress if available
          if (updatedTask.progress) {
            // Could show progress here if needed
          }

          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              // Type the result as DuplicateResponsesResultDto
              const typedResult = result as DuplicateResponsesResultDto;

              // Check if the result indicates errors (duplicate responses found)
              const hasErrors = typedResult.total > 0;

              // Create a validation result with the appropriate status
              const validationResult: ValidationResult = {
                status: hasErrors ? 'failed' : 'success',
                timestamp: Date.now(),
                details: {
                  total: typedResult.total,
                  hasErrors: hasErrors
                }
              };

              // Store the result in the validation task state service
              this.validationTaskStateService.setValidationResult(
                this.appService.selectedWorkspaceId,
                'duplicateResponses',
                validationResult
              );

              // Convert to DuplicateResponseSelectionDto[] and initialize selections
              this.duplicateResponses = typedResult.data.map(duplicate => {
                // For each duplicate, select the first response by default
                const defaultSelectedId = duplicate.duplicates.length > 0 ?
                  duplicate.duplicates[0].responseId : undefined;

                if (defaultSelectedId) {
                  const key = `${duplicate.unitId}_${duplicate.variableId}_${duplicate.testTakerLogin}`;
                  this.duplicateResponseSelections.set(key, defaultSelectedId);
                }

                return {
                  ...duplicate,
                  key: `${duplicate.unitId}_${duplicate.variableId}_${duplicate.testTakerLogin}`
                };
              });

              this.totalDuplicateResponses = typedResult.total;
              this.duplicateResponsesResult = typedResult;
              this.updatePaginatedDuplicateResponses();
              this.isDuplicateResponsesValidationRunning = false;
              this.validateDuplicateResponsesWasRun = true;

              // Save the validation result to the service
              this.saveValidationResult('duplicateResponses');
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.isDuplicateResponsesValidationRunning = false;
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.isDuplicateResponsesValidationRunning = false;
        }
      });

      this.subscriptions.push(pollSubscription);
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

  /**
   * Checks if a specific response is selected for a duplicate
   * @param duplicate The duplicate response
   * @param responseId The response ID to check
   * @returns True if the response is selected, false otherwise
   */
  isSelectedDuplicateResponse(duplicate: DuplicateResponseSelectionDto, responseId: number): boolean {
    return this.duplicateResponseSelections.get(duplicate.key) === responseId;
  }

  /**
   * Selects a specific response for a duplicate
   * @param duplicate The duplicate response
   * @param responseId The response ID to select
   */
  selectDuplicateResponse(duplicate: DuplicateResponseSelectionDto, responseId: number): void {
    this.duplicateResponseSelections.set(duplicate.key, responseId);
  }

  /**
   * Checks if any duplicate responses are selected
   * @returns True if any duplicate responses are selected, false otherwise
   */
  hasSelectedDuplicateResponses(): boolean {
    return this.duplicateResponseSelections.size > 0;
  }

  /**
   * Gets the count of selected duplicate responses
   * @returns The count of selected duplicate responses
   */
  getSelectedDuplicateResponsesCount(): number {
    return this.duplicateResponseSelections.size;
  }

  onDuplicateResponsesPageChange(event: PageEvent): void {
    this.currentDuplicateResponsesPage = event.pageIndex + 1;
    this.duplicateResponsesPageSize = event.pageSize;

    // Reload data from server with new pagination parameters using background task
    this.isDuplicateResponsesValidationRunning = true;

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background validation task
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'duplicateResponses',
      this.currentDuplicateResponsesPage,
      this.duplicateResponsesPageSize
    ).subscribe(task => {
      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              // Type the result as DuplicateResponsesResultDto
              const typedResult = result as DuplicateResponsesResultDto;

              // Convert to DuplicateResponseSelectionDto[] and preserve selections
              this.duplicateResponses = typedResult.data.map(duplicate => {
                const key = `${duplicate.unitId}_${duplicate.variableId}_${duplicate.testTakerLogin}`;

                // If we don't have a selection for this duplicate yet, select the first response by default
                if (!this.duplicateResponseSelections.has(key) && duplicate.duplicates.length > 0) {
                  this.duplicateResponseSelections.set(key, duplicate.duplicates[0].responseId);
                }

                return {
                  ...duplicate,
                  key
                };
              });

              this.totalDuplicateResponses = typedResult.total;
              this.duplicateResponsesResult = typedResult;
              this.updatePaginatedDuplicateResponses();
              this.isDuplicateResponsesValidationRunning = false;
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.isDuplicateResponsesValidationRunning = false;
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.isDuplicateResponsesValidationRunning = false;
        }
      });

      this.subscriptions.push(pollSubscription);
    });

    this.subscriptions.push(subscription);
  }

  /**
   * Resolves duplicate responses by keeping the selected responses
   * This method sends the selected responses to the backend for resolution
   */
  resolveDuplicateResponses(): void {
    if (this.isResolvingDuplicateResponses || !this.hasSelectedDuplicateResponses()) {
      return;
    }

    this.isResolvingDuplicateResponses = true;

    // Create a map of response IDs to keep
    const responseIdsToKeep: Record<string, number> = {};

    // Convert the Map to a Record for the API request
    this.duplicateResponseSelections.forEach((responseId, key) => {
      responseIdsToKeep[key] = responseId;
    });

    // Call the validation service to resolve duplicates
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

  /**
   * Resolves all duplicate responses automatically by keeping the first response for each duplicate
   * This method uses the deleteAllInvalidResponses endpoint with 'duplicateResponses' type
   */
  resolveAllDuplicateResponses(): void {
    if (this.isResolvingDuplicateResponses || this.duplicateResponses.length === 0) {
      return;
    }

    this.isResolvingDuplicateResponses = true;

    // Create a background task to delete all duplicate responses except the first one
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'deleteAllResponses',
      undefined,
      undefined,
      { validationType: 'duplicateResponses' }
    ).subscribe(task => {
      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              const typedResult = result as { deletedCount: number };

              this.snackBar.open(
                `${typedResult.deletedCount} doppelte Antworten wurden automatisch aufgelöst.`,
                'OK',
                { duration: 3000 }
              );

              // Refresh the duplicate responses list
              this.validateDuplicateResponses();
              this.isResolvingDuplicateResponses = false;
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(
              `Fehler beim Auflösen der doppelten Antworten: ${updatedTask.error || 'Unbekannter Fehler'}`,
              'Fehler',
              { duration: 3000 }
            );
            this.isResolvingDuplicateResponses = false;
          }
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

      this.subscriptions.push(pollSubscription);
    });

    this.subscriptions.push(subscription);
  }

  validateVariables(): void {
    this.isVariableValidationRunning = true;
    this.invalidVariables = [];
    this.totalInvalidVariables = 0;
    this.validateVariablesWasRun = false;
    this.selectedResponses.clear();

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background validation task
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'variables',
      this.currentVariablePage,
      this.variablePageSize
    ).subscribe(task => {
      this.variableValidationTask = task;

      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // Update progress if available
          if (updatedTask.progress) {
            // Could show progress here if needed
          }

          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              // Type the result as a PaginatedResponse<InvalidVariableDto>
              const typedResult = result as {
                data: InvalidVariableDto[];
                total: number;
                page: number;
                limit: number;
              };

              // Check if the result indicates errors
              const hasErrors = typedResult.total > 0;

              // Create a validation result with the appropriate status
              const validationResult: ValidationResult = {
                status: hasErrors ? 'failed' : 'success',
                timestamp: Date.now(),
                details: {
                  total: typedResult.total,
                  hasErrors: hasErrors
                }
              };

              // Store the result in the validation task state service
              this.validationTaskStateService.setValidationResult(
                this.appService.selectedWorkspaceId,
                'variables',
                validationResult
              );

              this.invalidVariables = typedResult.data;
              this.totalInvalidVariables = typedResult.total;
              this.currentVariablePage = typedResult.page;
              this.variablePageSize = typedResult.limit;
              this.updatePaginatedVariables();
              this.isVariableValidationRunning = false;
              this.validateVariablesWasRun = true;

              // Save the validation result to the service
              this.saveValidationResult('variables');
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.isVariableValidationRunning = false;
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.isVariableValidationRunning = false;
        }
      });

      this.subscriptions.push(pollSubscription);
    });

    this.subscriptions.push(subscription);
  }

  onVariablePageChange(event: PageEvent): void {
    this.currentVariablePage = event.pageIndex + 1;
    this.variablePageSize = event.pageSize;

    // Reload data from server with new pagination parameters using background task
    this.isVariableValidationRunning = true;

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background validation task
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'variables',
      this.currentVariablePage,
      this.variablePageSize
    ).subscribe(task => {
      this.variableValidationTask = task;

      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              // Type the result as a PaginatedResponse<InvalidVariableDto>
              const typedResult = result as {
                data: InvalidVariableDto[];
                total: number;
                page: number;
                limit: number;
              };

              this.invalidVariables = typedResult.data;
              this.totalInvalidVariables = typedResult.total;
              this.currentVariablePage = typedResult.page;
              this.variablePageSize = typedResult.limit;
              this.updatePaginatedVariables();
              this.isVariableValidationRunning = false;
              this.validateVariablesWasRun = true;
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.isVariableValidationRunning = false;
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.isVariableValidationRunning = false;
        }
      });

      this.subscriptions.push(pollSubscription);
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

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background deletion task
    const subscription = this.backendService.createDeleteResponsesTask(
      this.appService.selectedWorkspaceId,
      responseIds
    ).subscribe(task => {
      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              const typedResult = result as { deletedCount: number };
              this.isDeletingResponses = false;
              this.snackBar.open(`${typedResult.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

              // Start background validation task to refresh the data
              this.isVariableValidationRunning = true;

              // Create a background validation task
              const validationSubscription = this.backendService.createValidationTask(
                this.appService.selectedWorkspaceId,
                'variables',
                this.currentVariablePage,
                this.variablePageSize
              ).subscribe(validationTask => {
                this.variableValidationTask = validationTask;

                // Poll for validation task completion
                const validationPollSubscription = this.backendService.pollValidationTask(
                  this.appService.selectedWorkspaceId,
                  validationTask.id
                ).subscribe({
                  next: updatedValidationTask => {
                    // If task is completed, get the results
                    if (updatedValidationTask.status === 'completed') {
                      this.backendService.getValidationResults(
                        this.appService.selectedWorkspaceId,
                        updatedValidationTask.id
                      ).subscribe(validationResult => {
                        // Type the result as a PaginatedResponse<InvalidVariableDto>
                        const typedValidationResult = validationResult as {
                          data: InvalidVariableDto[];
                          total: number;
                          page: number;
                          limit: number;
                        };

                        this.invalidVariables = typedValidationResult.data;
                        this.totalInvalidVariables = typedValidationResult.total;
                        this.currentVariablePage = typedValidationResult.page;
                        this.variablePageSize = typedValidationResult.limit;
                        this.updatePaginatedVariables();
                        this.isVariableValidationRunning = false;
                        this.validateVariablesWasRun = true;
                      });
                    } else if (updatedValidationTask.status === 'failed') {
                      this.snackBar.open(`Validierung fehlgeschlagen: ${updatedValidationTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
                      this.isVariableValidationRunning = false;
                    }
                  },
                  error: () => {
                    this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
                    this.isVariableValidationRunning = false;
                  }
                });

                this.subscriptions.push(validationPollSubscription);
              });

              this.subscriptions.push(validationSubscription);
            });
          } else if (updatedTask.status === 'failed') {
            this.isDeletingResponses = false;
            this.snackBar.open(`Löschen fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
          }
        },
        error: () => {
          this.isDeletingResponses = false;
          this.snackBar.open('Fehler beim Abrufen des Löschstatus', 'Schließen', { duration: 5000 });
        }
      });

      this.subscriptions.push(pollSubscription);
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

        // Cancel any existing subscription
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];

        // Create a background deletion task
        const subscription = this.backendService.createDeleteAllResponsesTask(
          this.appService.selectedWorkspaceId,
          'variables'
        ).subscribe(task => {
          // Poll for task completion
          const pollSubscription = this.backendService.pollValidationTask(
            this.appService.selectedWorkspaceId,
            task.id
          ).subscribe({
            next: updatedTask => {
              // If task is completed, get the results
              if (updatedTask.status === 'completed') {
                this.backendService.getValidationResults(
                  this.appService.selectedWorkspaceId,
                  updatedTask.id
                ).subscribe(result => {
                  const typedResult = result as { deletedCount: number };
                  this.isDeletingResponses = false;
                  this.snackBar.open(`${typedResult.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

                  // Start background validation task to refresh the data
                  this.isVariableValidationRunning = true;

                  // Create a background validation task
                  const validationSubscription = this.backendService.createValidationTask(
                    this.appService.selectedWorkspaceId,
                    'variables',
                    this.currentVariablePage,
                    this.variablePageSize
                  ).subscribe(validationTask => {
                    this.variableValidationTask = validationTask;

                    // Poll for validation task completion
                    const validationPollSubscription = this.backendService.pollValidationTask(
                      this.appService.selectedWorkspaceId,
                      validationTask.id
                    ).subscribe({
                      next: updatedValidationTask => {
                        // If task is completed, get the results
                        if (updatedValidationTask.status === 'completed') {
                          this.backendService.getValidationResults(
                            this.appService.selectedWorkspaceId,
                            updatedValidationTask.id
                          ).subscribe(validationResult => {
                            // Type the result as a PaginatedResponse<InvalidVariableDto>
                            const typedValidationResult = validationResult as {
                              data: InvalidVariableDto[];
                              total: number;
                              page: number;
                              limit: number;
                            };

                            this.invalidVariables = typedValidationResult.data;
                            this.totalInvalidVariables = typedValidationResult.total;
                            this.currentVariablePage = typedValidationResult.page;
                            this.variablePageSize = typedValidationResult.limit;
                            this.updatePaginatedVariables();
                            this.isVariableValidationRunning = false;
                            this.validateVariablesWasRun = true;
                          });
                        } else if (updatedValidationTask.status === 'failed') {
                          this.snackBar.open(`Validierung fehlgeschlagen: ${updatedValidationTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
                          this.isVariableValidationRunning = false;
                        }
                      },
                      error: () => {
                        this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
                        this.isVariableValidationRunning = false;
                      }
                    });

                    this.subscriptions.push(validationPollSubscription);
                  });

                  this.subscriptions.push(validationSubscription);
                });
              } else if (updatedTask.status === 'failed') {
                this.isDeletingResponses = false;
                this.snackBar.open(`Löschen fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
              }
            },
            error: () => {
              this.isDeletingResponses = false;
              this.snackBar.open('Fehler beim Abrufen des Löschstatus', 'Schließen', { duration: 5000 });
            }
          });

          this.subscriptions.push(pollSubscription);
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

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background validation task
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'variableTypes',
      this.currentTypeVariablePage,
      this.typeVariablePageSize
    ).subscribe(task => {
      this.variableTypeValidationTask = task;

      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // Update progress if available
          if (updatedTask.progress) {
            // Could show progress here if needed
          }

          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              // Type the result as a PaginatedResponse<InvalidVariableDto>
              const typedResult = result as {
                data: InvalidVariableDto[];
                total: number;
                page: number;
                limit: number;
              };

              // Check if the result indicates errors
              const hasErrors = typedResult.total > 0;

              // Create a validation result with the appropriate status
              const validationResult: ValidationResult = {
                status: hasErrors ? 'failed' : 'success',
                timestamp: Date.now(),
                details: {
                  total: typedResult.total,
                  hasErrors: hasErrors
                }
              };

              // Store the result in the validation task state service
              this.validationTaskStateService.setValidationResult(
                this.appService.selectedWorkspaceId,
                'variableTypes',
                validationResult
              );

              this.invalidTypeVariables = typedResult.data;
              this.totalInvalidTypeVariables = typedResult.total;
              this.currentTypeVariablePage = typedResult.page;
              this.typeVariablePageSize = typedResult.limit;
              this.updatePaginatedTypeVariables();
              this.isVariableTypeValidationRunning = false;
              this.validateVariableTypesWasRun = true;

              // Save the validation result to the service
              this.saveValidationResult('variableTypes');
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.isVariableTypeValidationRunning = false;
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.isVariableTypeValidationRunning = false;
        }
      });

      this.subscriptions.push(pollSubscription);
    });

    this.subscriptions.push(subscription);
  }

  validateResponseStatus(): void {
    this.isResponseStatusValidationRunning = true;
    this.invalidStatusVariables = [];
    this.totalInvalidStatusVariables = 0;
    this.validateResponseStatusWasRun = false;
    this.selectedStatusResponses.clear();

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background validation task
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'responseStatus',
      this.currentStatusVariablePage,
      this.statusVariablePageSize
    ).subscribe(task => {
      this.responseStatusValidationTask = task;

      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // Update progress if available
          if (updatedTask.progress) {
            // Could show progress here if needed
          }

          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              // Type the result as a PaginatedResponse<InvalidVariableDto>
              const typedResult = result as {
                data: InvalidVariableDto[];
                total: number;
                page: number;
                limit: number;
              };

              // Check if the result indicates errors
              const hasErrors = typedResult.total > 0;

              // Create a validation result with the appropriate status
              const validationResult: ValidationResult = {
                status: hasErrors ? 'failed' : 'success',
                timestamp: Date.now(),
                details: {
                  total: typedResult.total,
                  hasErrors: hasErrors
                }
              };

              // Store the result in the validation task state service
              this.validationTaskStateService.setValidationResult(
                this.appService.selectedWorkspaceId,
                'responseStatus',
                validationResult
              );

              this.invalidStatusVariables = typedResult.data;
              this.totalInvalidStatusVariables = typedResult.total;
              this.currentStatusVariablePage = typedResult.page;
              this.statusVariablePageSize = typedResult.limit;
              this.updatePaginatedStatusVariables();
              this.isResponseStatusValidationRunning = false;
              this.validateResponseStatusWasRun = true;

              // Save the validation result to the service
              this.saveValidationResult('responseStatus');
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.isResponseStatusValidationRunning = false;
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.isResponseStatusValidationRunning = false;
        }
      });

      this.subscriptions.push(pollSubscription);
    });

    this.subscriptions.push(subscription);
  }

  onTypeVariablePageChange(event: PageEvent): void {
    this.currentTypeVariablePage = event.pageIndex + 1;
    this.typeVariablePageSize = event.pageSize;

    // Reload data from server with new pagination parameters using background task
    this.isVariableTypeValidationRunning = true;

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background validation task
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'variableTypes',
      this.currentTypeVariablePage,
      this.typeVariablePageSize
    ).subscribe(task => {
      this.variableTypeValidationTask = task;

      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              // Type the result as a PaginatedResponse<InvalidVariableDto>
              const typedResult = result as {
                data: InvalidVariableDto[];
                total: number;
                page: number;
                limit: number;
              };

              this.invalidTypeVariables = typedResult.data;
              this.totalInvalidTypeVariables = typedResult.total;
              this.currentTypeVariablePage = typedResult.page;
              this.typeVariablePageSize = typedResult.limit;
              this.updatePaginatedTypeVariables();
              this.isVariableTypeValidationRunning = false;
              this.validateVariableTypesWasRun = true;
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.isVariableTypeValidationRunning = false;
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.isVariableTypeValidationRunning = false;
        }
      });

      this.subscriptions.push(pollSubscription);
    });

    this.subscriptions.push(subscription);
  }

  onStatusVariablePageChange(event: PageEvent): void {
    this.currentStatusVariablePage = event.pageIndex + 1;
    this.statusVariablePageSize = event.pageSize;

    // Reload data from server with new pagination parameters using background task
    this.isResponseStatusValidationRunning = true;

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background validation task
    const subscription = this.backendService.createValidationTask(
      this.appService.selectedWorkspaceId,
      'responseStatus',
      this.currentStatusVariablePage,
      this.statusVariablePageSize
    ).subscribe(task => {
      this.responseStatusValidationTask = task;

      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              // Type the result as a PaginatedResponse<InvalidVariableDto>
              const typedResult = result as {
                data: InvalidVariableDto[];
                total: number;
                page: number;
                limit: number;
              };

              this.invalidStatusVariables = typedResult.data;
              this.totalInvalidStatusVariables = typedResult.total;
              this.currentStatusVariablePage = typedResult.page;
              this.statusVariablePageSize = typedResult.limit;
              this.updatePaginatedStatusVariables();
              this.isResponseStatusValidationRunning = false;
              this.validateResponseStatusWasRun = true;
            });
          } else if (updatedTask.status === 'failed') {
            this.snackBar.open(`Validierung fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            this.isResponseStatusValidationRunning = false;
          }
        },
        error: () => {
          this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
          this.isResponseStatusValidationRunning = false;
        }
      });

      this.subscriptions.push(pollSubscription);
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

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background deletion task
    const subscription = this.backendService.createDeleteResponsesTask(
      this.appService.selectedWorkspaceId,
      responseIds
    ).subscribe(task => {
      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              const typedResult = result as { deletedCount: number };
              this.isDeletingResponses = false;
              this.snackBar.open(`${typedResult.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

              // Start background validation task to refresh the data
              this.isVariableTypeValidationRunning = true;

              // Create a background validation task
              const validationSubscription = this.backendService.createValidationTask(
                this.appService.selectedWorkspaceId,
                'variableTypes',
                this.currentTypeVariablePage,
                this.typeVariablePageSize
              ).subscribe(validationTask => {
                this.variableTypeValidationTask = validationTask;

                // Poll for validation task completion
                const validationPollSubscription = this.backendService.pollValidationTask(
                  this.appService.selectedWorkspaceId,
                  validationTask.id
                ).subscribe({
                  next: updatedValidationTask => {
                    // If task is completed, get the results
                    if (updatedValidationTask.status === 'completed') {
                      this.backendService.getValidationResults(
                        this.appService.selectedWorkspaceId,
                        updatedValidationTask.id
                      ).subscribe(validationResult => {
                        // Type the result as a PaginatedResponse<InvalidVariableDto>
                        const typedValidationResult = validationResult as {
                          data: InvalidVariableDto[];
                          total: number;
                          page: number;
                          limit: number;
                        };

                        this.invalidTypeVariables = typedValidationResult.data;
                        this.totalInvalidTypeVariables = typedValidationResult.total;
                        this.currentTypeVariablePage = typedValidationResult.page;
                        this.typeVariablePageSize = typedValidationResult.limit;
                        this.updatePaginatedTypeVariables();
                        this.isVariableTypeValidationRunning = false;
                        this.validateVariableTypesWasRun = true;
                      });
                    } else if (updatedValidationTask.status === 'failed') {
                      this.snackBar.open(`Validierung fehlgeschlagen: ${updatedValidationTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
                      this.isVariableTypeValidationRunning = false;
                    }
                  },
                  error: () => {
                    this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
                    this.isVariableTypeValidationRunning = false;
                  }
                });

                this.subscriptions.push(validationPollSubscription);
              });

              this.subscriptions.push(validationSubscription);
            });
          } else if (updatedTask.status === 'failed') {
            this.isDeletingResponses = false;
            this.snackBar.open(`Löschen fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
          }
        },
        error: () => {
          this.isDeletingResponses = false;
          this.snackBar.open('Fehler beim Abrufen des Löschstatus', 'Schließen', { duration: 5000 });
        }
      });

      this.subscriptions.push(pollSubscription);
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

        // Cancel any existing subscription
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];

        // Create a background deletion task
        const subscription = this.backendService.createDeleteAllResponsesTask(
          this.appService.selectedWorkspaceId,
          'variableTypes'
        ).subscribe(task => {
          // Poll for task completion
          const pollSubscription = this.backendService.pollValidationTask(
            this.appService.selectedWorkspaceId,
            task.id
          ).subscribe({
            next: updatedTask => {
              // If task is completed, get the results
              if (updatedTask.status === 'completed') {
                this.backendService.getValidationResults(
                  this.appService.selectedWorkspaceId,
                  updatedTask.id
                ).subscribe(result => {
                  const typedResult = result as { deletedCount: number };
                  this.isDeletingResponses = false;
                  this.snackBar.open(`${typedResult.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

                  // Start background validation task to refresh the data
                  this.isVariableTypeValidationRunning = true;

                  // Create a background validation task
                  const validationSubscription = this.backendService.createValidationTask(
                    this.appService.selectedWorkspaceId,
                    'variableTypes',
                    this.currentTypeVariablePage,
                    this.typeVariablePageSize
                  ).subscribe(validationTask => {
                    this.variableTypeValidationTask = validationTask;

                    // Poll for validation task completion
                    const validationPollSubscription = this.backendService.pollValidationTask(
                      this.appService.selectedWorkspaceId,
                      validationTask.id
                    ).subscribe({
                      next: updatedValidationTask => {
                        // If task is completed, get the results
                        if (updatedValidationTask.status === 'completed') {
                          this.backendService.getValidationResults(
                            this.appService.selectedWorkspaceId,
                            updatedValidationTask.id
                          ).subscribe(validationResult => {
                            // Type the result as a PaginatedResponse<InvalidVariableDto>
                            const typedValidationResult = validationResult as {
                              data: InvalidVariableDto[];
                              total: number;
                              page: number;
                              limit: number;
                            };

                            this.invalidTypeVariables = typedValidationResult.data;
                            this.totalInvalidTypeVariables = typedValidationResult.total;
                            this.currentTypeVariablePage = typedValidationResult.page;
                            this.typeVariablePageSize = typedValidationResult.limit;
                            this.updatePaginatedTypeVariables();
                            this.isVariableTypeValidationRunning = false;
                            this.validateVariableTypesWasRun = true;
                          });
                        } else if (updatedValidationTask.status === 'failed') {
                          this.snackBar.open(`Validierung fehlgeschlagen: ${updatedValidationTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
                          this.isVariableTypeValidationRunning = false;
                        }
                      },
                      error: () => {
                        this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
                        this.isVariableTypeValidationRunning = false;
                      }
                    });

                    this.subscriptions.push(validationPollSubscription);
                  });

                  this.subscriptions.push(validationSubscription);
                });
              } else if (updatedTask.status === 'failed') {
                this.isDeletingResponses = false;
                this.snackBar.open(`Löschen fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
              }
            },
            error: () => {
              this.isDeletingResponses = false;
              this.snackBar.open('Fehler beim Abrufen des Löschstatus', 'Schließen', { duration: 5000 });
            }
          });

          this.subscriptions.push(pollSubscription);
        });

        this.subscriptions.push(subscription);
      }
    });
  }

  toggleTypeExpansion(): void {
    this.expandedTypePanel = !this.expandedTypePanel;
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

    // Cancel any existing subscription
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Create a background deletion task
    const subscription = this.backendService.createDeleteResponsesTask(
      this.appService.selectedWorkspaceId,
      responseIds
    ).subscribe(task => {
      // Poll for task completion
      const pollSubscription = this.backendService.pollValidationTask(
        this.appService.selectedWorkspaceId,
        task.id
      ).subscribe({
        next: updatedTask => {
          // If task is completed, get the results
          if (updatedTask.status === 'completed') {
            this.backendService.getValidationResults(
              this.appService.selectedWorkspaceId,
              updatedTask.id
            ).subscribe(result => {
              const typedResult = result as { deletedCount: number };
              this.isDeletingResponses = false;
              this.snackBar.open(`${typedResult.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

              // Start background validation task to refresh the data
              this.isResponseStatusValidationRunning = true;

              // Create a background validation task
              const validationSubscription = this.backendService.createValidationTask(
                this.appService.selectedWorkspaceId,
                'responseStatus',
                this.currentStatusVariablePage,
                this.statusVariablePageSize
              ).subscribe(validationTask => {
                this.responseStatusValidationTask = validationTask;

                // Poll for validation task completion
                const validationPollSubscription = this.backendService.pollValidationTask(
                  this.appService.selectedWorkspaceId,
                  validationTask.id
                ).subscribe({
                  next: updatedValidationTask => {
                    // If task is completed, get the results
                    if (updatedValidationTask.status === 'completed') {
                      this.backendService.getValidationResults(
                        this.appService.selectedWorkspaceId,
                        updatedValidationTask.id
                      ).subscribe(validationResult => {
                        // Type the result as a PaginatedResponse<InvalidVariableDto>
                        const typedValidationResult = validationResult as {
                          data: InvalidVariableDto[];
                          total: number;
                          page: number;
                          limit: number;
                        };

                        this.invalidStatusVariables = typedValidationResult.data;
                        this.totalInvalidStatusVariables = typedValidationResult.total;
                        this.currentStatusVariablePage = typedValidationResult.page;
                        this.statusVariablePageSize = typedValidationResult.limit;
                        this.updatePaginatedStatusVariables();
                        this.isResponseStatusValidationRunning = false;
                        this.validateResponseStatusWasRun = true;
                      });
                    } else if (updatedValidationTask.status === 'failed') {
                      this.snackBar.open(`Validierung fehlgeschlagen: ${updatedValidationTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
                      this.isResponseStatusValidationRunning = false;
                    }
                  },
                  error: () => {
                    this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
                    this.isResponseStatusValidationRunning = false;
                  }
                });

                this.subscriptions.push(validationPollSubscription);
              });

              this.subscriptions.push(validationSubscription);
            });
          } else if (updatedTask.status === 'failed') {
            this.isDeletingResponses = false;
            this.snackBar.open(`Löschen fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
          }
        },
        error: () => {
          this.isDeletingResponses = false;
          this.snackBar.open('Fehler beim Abrufen des Löschstatus', 'Schließen', { duration: 5000 });
        }
      });

      this.subscriptions.push(pollSubscription);
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

        // Cancel any existing subscription
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];

        // Create a background deletion task
        const subscription = this.backendService.createDeleteAllResponsesTask(
          this.appService.selectedWorkspaceId,
          'responseStatus'
        ).subscribe(task => {
          // Poll for task completion
          const pollSubscription = this.backendService.pollValidationTask(
            this.appService.selectedWorkspaceId,
            task.id
          ).subscribe({
            next: updatedTask => {
              // If task is completed, get the results
              if (updatedTask.status === 'completed') {
                this.backendService.getValidationResults(
                  this.appService.selectedWorkspaceId,
                  updatedTask.id
                ).subscribe(result => {
                  const typedResult = result as { deletedCount: number };
                  this.isDeletingResponses = false;
                  this.snackBar.open(`${typedResult.deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

                  // Start background validation task to refresh the data
                  this.isResponseStatusValidationRunning = true;

                  // Create a background validation task
                  const validationSubscription = this.backendService.createValidationTask(
                    this.appService.selectedWorkspaceId,
                    'responseStatus',
                    this.currentStatusVariablePage,
                    this.statusVariablePageSize
                  ).subscribe(validationTask => {
                    this.responseStatusValidationTask = validationTask;

                    // Poll for validation task completion
                    const validationPollSubscription = this.backendService.pollValidationTask(
                      this.appService.selectedWorkspaceId,
                      validationTask.id
                    ).subscribe({
                      next: updatedValidationTask => {
                        // If task is completed, get the results
                        if (updatedValidationTask.status === 'completed') {
                          this.backendService.getValidationResults(
                            this.appService.selectedWorkspaceId,
                            updatedValidationTask.id
                          ).subscribe(validationResult => {
                            // Type the result as a PaginatedResponse<InvalidVariableDto>
                            const typedValidationResult = validationResult as {
                              data: InvalidVariableDto[];
                              total: number;
                              page: number;
                              limit: number;
                            };

                            this.invalidStatusVariables = typedValidationResult.data;
                            this.totalInvalidStatusVariables = typedValidationResult.total;
                            this.currentStatusVariablePage = typedValidationResult.page;
                            this.statusVariablePageSize = typedValidationResult.limit;
                            this.updatePaginatedStatusVariables();
                            this.isResponseStatusValidationRunning = false;
                            this.validateResponseStatusWasRun = true;
                          });
                        } else if (updatedValidationTask.status === 'failed') {
                          this.snackBar.open(`Validierung fehlgeschlagen: ${updatedValidationTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
                          this.isResponseStatusValidationRunning = false;
                        }
                      },
                      error: () => {
                        this.snackBar.open('Fehler beim Abrufen des Validierungsstatus', 'Schließen', { duration: 5000 });
                        this.isResponseStatusValidationRunning = false;
                      }
                    });

                    this.subscriptions.push(validationPollSubscription);
                  });

                  this.subscriptions.push(validationSubscription);
                  this.selectedStatusResponses.clear();
                });
              } else if (updatedTask.status === 'failed') {
                this.isDeletingResponses = false;
                this.snackBar.open(`Löschen fehlgeschlagen: ${updatedTask.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
              }
            },
            error: () => {
              this.isDeletingResponses = false;
              this.snackBar.open('Fehler beim Abrufen des Löschstatus', 'Schließen', { duration: 5000 });
            }
          });

          this.subscriptions.push(pollSubscription);
        });

        this.subscriptions.push(subscription);
      }
    });
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

    // Only save completed results (success or failed)
    if (status === 'success' || status === 'failed') {
      // Create validation result object
      const validationResult = {
        status: status as 'success' | 'failed',
        timestamp: Date.now(),
        details: this.getValidationDetails(type)
      };

      // Save to service
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

    // First load any in-memory results
    const inMemoryResults = this.validationTaskStateService.getAllValidationResults(workspaceId);

    // Process each type of in-memory validation result
    // Pass false for fromCurrentSession since these are from previous sessions
    if (inMemoryResults.variables) {
      this.processVariablesResult(inMemoryResults.variables, false);
    }

    if (inMemoryResults.variableTypes) {
      this.processVariableTypesResult(inMemoryResults.variableTypes, false);
    }

    if (inMemoryResults.responseStatus) {
      this.processResponseStatusResult(inMemoryResults.responseStatus, false);
    }

    if (inMemoryResults.testTakers) {
      this.processTestTakersResult(inMemoryResults.testTakers, false);
    }

    if (inMemoryResults.groupResponses) {
      this.processGroupResponsesResult(inMemoryResults.groupResponses, false);
    }

    // Then fetch and process the last validation results from the backend
    const subscription = this.validationService.getLastValidationResults(workspaceId)
      .subscribe({
        next: results => {
          // Process each type of validation result from the backend
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

            // Store the result in the validation task state service
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

            // Store the result in the validation task state service
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

            // Store the result in the validation task state service
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

            // Store the result in the validation task state service
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

            // Store the result in the validation task state service
            this.validationTaskStateService.setValidationResult(workspaceId, 'groupResponses', validationResult);
          }
        },
        error: () => {
          // Error occurred while loading previous validation results
        }
      });

    this.subscriptions.push(subscription);
  }

  private processVariablesResult(result: ValidationResult, fromCurrentSession: boolean = false): void {
    if (result.status === 'success') {
      // Only set validateVariablesWasRun to true if the result is from the current session
      if (fromCurrentSession) {
        this.validateVariablesWasRun = true;
      }
      this.totalInvalidVariables = 0;
      this.invalidVariables = [];
      this.updatePaginatedVariables();
    } else if (result.status === 'failed' && result.details) {
      // Only set validateVariablesWasRun to true if the result is from the current session
      if (fromCurrentSession) {
        this.validateVariablesWasRun = true;
      }
      const details = result.details as { total: number; hasErrors: boolean };
      this.totalInvalidVariables = details.total;

      // If we have details but no data, we need to fetch the data
      if (details.total > 0 && this.invalidVariables.length === 0) {
        this.validateVariables();
      }
    }
  }

  private processVariableTypesResult(result: ValidationResult, fromCurrentSession: boolean = false): void {
    if (result.status === 'success') {
      // Only set validateVariableTypesWasRun to true if the result is from the current session
      if (fromCurrentSession) {
        this.validateVariableTypesWasRun = true;
      }
      this.totalInvalidTypeVariables = 0;
      this.invalidTypeVariables = [];
      this.updatePaginatedTypeVariables();
    } else if (result.status === 'failed' && result.details) {
      // Only set validateVariableTypesWasRun to true if the result is from the current session
      if (fromCurrentSession) {
        this.validateVariableTypesWasRun = true;
      }
      const details = result.details as { total: number; hasErrors: boolean };
      this.totalInvalidTypeVariables = details.total;

      // If we have details but no data, we need to fetch the data
      if (details.total > 0 && this.invalidTypeVariables.length === 0) {
        this.validateVariableTypes();
      }
    }
  }

  private processResponseStatusResult(result: ValidationResult, fromCurrentSession: boolean = false): void {
    if (result.status === 'success') {
      // Only set validateResponseStatusWasRun to true if the result is from the current session
      if (fromCurrentSession) {
        this.validateResponseStatusWasRun = true;
      }
      this.totalInvalidStatusVariables = 0;
      this.invalidStatusVariables = [];
      this.updatePaginatedStatusVariables();
    } else if (result.status === 'failed' && result.details) {
      // Only set validateResponseStatusWasRun to true if the result is from the current session
      if (fromCurrentSession) {
        this.validateResponseStatusWasRun = true;
      }
      const details = result.details as { total: number; hasErrors: boolean };
      this.totalInvalidStatusVariables = details.total;

      // If we have details but no data, we need to fetch the data
      if (details.total > 0 && this.invalidStatusVariables.length === 0) {
        this.validateResponseStatus();
      }
    }
  }

  private processTestTakersResult(result: ValidationResult, fromCurrentSession: boolean = false): void {
    if (result.status === 'success') {
      // Only set testTakersValidationWasRun to true if the result is from the current session
      if (fromCurrentSession) {
        this.testTakersValidationWasRun = true;
      }
      this.testTakersValidationResult = {
        testTakersFound: true,
        totalGroups: 0,
        totalLogins: 0,
        totalBookletCodes: 0,
        missingPersons: []
      };
      this.updatePaginatedMissingPersons();
    } else if (result.status === 'failed' && result.details) {
      // Only set testTakersValidationWasRun to true if the result is from the current session
      if (fromCurrentSession) {
        this.testTakersValidationWasRun = true;
      }
      const details = result.details as {
        testTakersFound: boolean;
        missingPersonsCount: number;
        hasErrors: boolean
      };

      // If we have details but no data, we need to fetch the data
      if (details.hasErrors && (!this.testTakersValidationResult || this.testTakersValidationResult.missingPersons.length === 0)) {
        this.validateTestTakers();
      }
    }
  }

  private processGroupResponsesResult(result: ValidationResult, fromCurrentSession: boolean = false): void {
    if (result.status === 'success') {
      // Only set groupResponsesValidationWasRun to true if the result is from the current session
      if (fromCurrentSession) {
        this.groupResponsesValidationWasRun = true;
      }
      this.groupResponsesResult = {
        testTakersFound: true,
        groupsWithResponses: [],
        allGroupsHaveResponses: true
      };
      this.updatePaginatedGroupResponses();
    } else if (result.status === 'failed' && result.details) {
      // Only set groupResponsesValidationWasRun to true if the result is from the current session
      if (fromCurrentSession) {
        this.groupResponsesValidationWasRun = true;
      }
      const details = result.details as {
        testTakersFound: boolean;
        allGroupsHaveResponses: boolean;
        hasErrors: boolean
      };

      // If we have details but no data, we need to fetch the data
      if (details.hasErrors && (!this.groupResponsesResult || this.groupResponsesResult.groupsWithResponses.length === 0)) {
        this.validateGroupResponses();
      }
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
