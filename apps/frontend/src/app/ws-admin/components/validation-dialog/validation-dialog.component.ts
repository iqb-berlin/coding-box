import {
  Component, Inject, OnInit, OnDestroy,
  ChangeDetectorRef
} from '@angular/core';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { Subscription } from 'rxjs';
import { AppService } from '../../../services/app.service';
import { ValidationTaskStateService } from '../../../services/validation-task-state.service';
import { ContentDialogComponent } from '../../../shared/dialogs/content-dialog/content-dialog.component';

// Import panel components
import {
  TestTakersValidationPanelComponent,
  VariablesValidationPanelComponent,
  VariableTypesValidationPanelComponent,
  ResponseStatusValidationPanelComponent,
  GroupResponsesValidationPanelComponent,
  DuplicateResponsesValidationPanelComponent
} from './panels';

// Import shared components
import { ValidationResultBannerComponent, OverallValidationStatus } from './shared';
import { ValidationBatchRunnerService } from '../../../services/validation-batch-runner.service';

/**
 * Validation Dialog Component
 *
 * Coordinates validation of response data across multiple validation types.
 * Each validation type is handled by a dedicated panel component.
 *
 * @example
 * this.dialog.open(ValidationDialogComponent, {
 *   data: { autoStart: true },
 *   width: '90vw',
 *   maxWidth: '1200px'
 * });
 */
@Component({
  selector: 'coding-box-validation-dialog',
  templateUrl: './validation-dialog.component.html',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    // Panel components
    ValidationResultBannerComponent,
    TestTakersValidationPanelComponent,
    VariablesValidationPanelComponent,
    VariableTypesValidationPanelComponent,
    ResponseStatusValidationPanelComponent,
    GroupResponsesValidationPanelComponent,
    DuplicateResponsesValidationPanelComponent
  ],
  styles: [`
    .actions-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }

    .info-banner {
      display: flex;
      align-items: flex-start;
      padding: 8px 16px;
      margin: 10px 0;
      border-radius: 4px;
      background-color: rgba(33, 150, 243, 0.1);
      color: #2196F3;
      border: 1px solid #2196F3;
    }

    .info-banner mat-icon {
      margin-right: 8px;
      flex-shrink: 0;
    }

    .info-banner span {
      flex: 1;
    }
  `]
})
export class ValidationDialogComponent implements OnInit, OnDestroy {
  private subscriptions: Subscription[] = [];

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { autoStart?: boolean },
    private dialogRef: MatDialogRef<ValidationDialogComponent>,
    private dialog: MatDialog,
    private appService: AppService,
    private validationTaskStateService: ValidationTaskStateService,
    private batchRunnerService: ValidationBatchRunnerService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    // Subscribe to state changes to ensure UI updates correctly
    const sub1 = this.validationTaskStateService.observeValidationResults(workspaceId)
      .subscribe(() => {
        this.cdr.markForCheck();
      });
    this.subscriptions.push(sub1);

    const sub2 = this.validationTaskStateService.observeTaskIds(workspaceId)
      .subscribe(() => {
        this.cdr.markForCheck();
      });
    this.subscriptions.push(sub2);

    // Auto-start functionality
    if (this.data?.autoStart) {
      this.startAllValidations();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  /**
   * Close the dialog
   */
  close(): void {
    this.dialogRef.close();
  }

  /**
   * Check if any validation is currently running
   */
  isAnyValidationRunning(): boolean {
    const workspaceId = this.appService.selectedWorkspaceId;
    const taskIds = this.validationTaskStateService.getAllTaskIds(workspaceId);
    return Object.values(taskIds).some(id => id !== null && id !== undefined);
  }

  /**
   * Show unit XML file in a dialog
   */
  showUnitXml(fileName: string): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.dialog.open(ContentDialogComponent, {
      data: {
        title: `Unit XML: ${fileName}`,
        content: `Loading ${fileName}...`,
        type: 'xml',
        workspaceId,
        fileName
      },
      width: '80vw',
      maxWidth: '1000px',
      height: '80vh'
    });
  }

  /**
   * Get overall validation status
   */
  getOverallStatus(): OverallValidationStatus {
    const workspaceId = this.appService.selectedWorkspaceId;
    const taskIds = this.validationTaskStateService.getAllTaskIds(workspaceId);
    const results = this.validationTaskStateService.getAllValidationResults(workspaceId);

    // Check if any validation is running
    const isRunning = Object.values(taskIds).some(id => id !== null && id !== undefined);
    if (isRunning) {
      return 'running';
    }

    // Check if any validation has results
    const hasResults = Object.values(results).some(result => result !== null && result !== undefined);
    if (!hasResults) {
      return 'not-run';
    }

    // Check for failures
    const hasFailures = Object.values(results).some(result => result.status === 'failed');
    if (hasFailures) {
      return 'failed';
    }

    // All passed
    return 'success';
  }

  /**
   * Get overall headline text
   */
  getOverallHeadline(): string {
    const status = this.getOverallStatus();
    switch (status) {
      case 'running':
        return 'Validierungen laufen...';
      case 'failed':
        return 'Einige Prüfungen sind fehlgeschlagen';
      case 'success':
        return 'Alle Prüfungen bestanden';
      default:
        return 'Bereit zum Prüfen';
    }
  }

  /**
   * Get overall subline text
   */
  getOverallSubline(): string {
    const status = this.getOverallStatus();
    if (status === 'running') {
      return 'Bitte warten Sie, bis alle Validierungen abgeschlossen sind.';
    }
    if (status === 'failed') {
      return 'Bitte beheben Sie die gefundenen Fehler.';
    }
    if (status === 'success') {
      return 'Alle Antwortdaten sind gültig.';
    }
    return 'Starten Sie die Prüfungen, um Ihre Antwortdaten zu validieren.';
  }

  /**
   * Get recommended next step
   */
  getRecommendedNextStep(): string {
    const status = this.getOverallStatus();
    if (status === 'failed') {
      return 'Beheben Sie die Fehler und führen Sie die Prüfungen erneut durch.';
    }
    if (status === 'success') {
      return 'Sie können den Dialog schließen.';
    }
    return '';
  }

  /**
   * Start all validations using the batch runner
   */
  startAllValidations(): void {
    if (this.isAnyValidationRunning()) {
      return;
    }
    const workspaceId = this.appService.selectedWorkspaceId;
    this.batchRunnerService.startBatch(workspaceId, { force: true });
  }
}
