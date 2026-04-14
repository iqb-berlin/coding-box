import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import {
  ValidationPanelHeaderComponent,
  ValidationStatus,
  ValidationGuidanceComponent
} from '../../shared';
import {
  TestTakersValidationDto,
  MissingPersonDto
} from '../../../../../../../../../api-dto/files/testtakers-validation.dto';
import { TestTakersValidationService } from '../../../../services/validation';
import { ValidationTaskDto } from '../../../../../models/validation-task.dto';
import { buildCsv, downloadCsvFile } from '../../shared/validation-export.util';

/**
 * Panel component for test takers validation.
 * Displays validation results and allows users to check if all test persons
 * exist in TestTakers XML files.
 */
@Component({
  selector: 'coding-box-test-takers-validation-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatExpansionModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatTableModule,
    MatPaginatorModule,
    MatIconModule,
    ValidationPanelHeaderComponent,
    ValidationGuidanceComponent
  ],
  templateUrl: './test-takers-validation-panel.component.html',
  styles: [
    `
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
        color: #4caf50;
        border: 1px solid #4caf50;
      }

      .validation-error {
        background-color: rgba(244, 67, 54, 0.1);
        color: #f44336;
        border: 1px solid #f44336;
      }

      .validation-result mat-icon {
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

      .actions-container {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }

      .validation-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      table {
        width: 100%;
      }

      .validation-panel-content {
        position: relative;
      }

      .loading-fade {
        opacity: 0.6;
        pointer-events: none;
      }

      .loading-progress {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10;
      }
    `
  ]
})
export class TestTakersValidationPanelComponent implements OnInit, OnDestroy {
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  @Input() disabled = false;
  @Output() validate = new EventEmitter<void>();

  isRunning = false;
  wasRun = false;
  isLoadingPage = false;
  isExporting = false;
  result: TestTakersValidationDto | null = null;
  errorMessage: string | null = null;
  expandedPanel = false;
  paginatedMissingPersons = new MatTableDataSource<MissingPersonDto>([]);
  displayedColumns = ['group', 'login', 'code', 'reason'];
  activeTask: ValidationTaskDto | null = null;

  private subscription?: Subscription;
  private stateSubscription?: Subscription;
  private taskSubscription?: Subscription;

  constructor(
    private testTakersValidationService: TestTakersValidationService
  ) {}

  ngOnInit(): void {
    // Load cached result if available
    const cachedResult =
      this.testTakersValidationService.observeValidationResult();

    this.stateSubscription = cachedResult.subscribe(result => {
      if (result && !this.isRunning) {
        this.wasRun = true;
        const details = result.details as Record<string, unknown>;
        if (result.status === 'failed' && details?.error) {
          this.errorMessage = details.error as string;
          this.result = null;
        } else {
          this.errorMessage = null;
          this.result = result.details as TestTakersValidationDto;
          this.updatePaginatedMissingPersons();
        }
      }
    });

    // Observe active task
    this.taskSubscription = this.testTakersValidationService
      .observeValidationTask()
      .subscribe(task => {
        this.activeTask = task;
        this.isRunning = !!task;
      });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.stateSubscription?.unsubscribe();
    this.taskSubscription?.unsubscribe();
  }

  get status(): ValidationStatus {
    return this.testTakersValidationService.getValidationStatus();
  }

  get errorCount(): number {
    return this.result?.missingPersons.length || 0;
  }

  onValidate(): void {
    if (this.isRunning || this.disabled) {
      return;
    }

    this.isRunning = true;
    this.subscription = this.testTakersValidationService.validate().subscribe({
      next: result => {
        this.result = result;
        this.wasRun = true;
        this.isRunning = false;
        this.updatePaginatedMissingPersons();
      },
      error: () => {
        this.isRunning = false;
      }
    });

    this.validate.emit();
  }

  toggleExpansion(): void {
    this.expandedPanel = !this.expandedPanel;
  }

  private updatePaginatedMissingPersons(): void {
    if (this.result?.missingPersons) {
      this.paginatedMissingPersons.data = this.result.missingPersons;
      this.paginatedMissingPersons.paginator = this.paginator;
    }
  }

  exportCsv(): void {
    if (this.isExporting || !this.result) {
      return;
    }

    this.isExporting = true;
    const csvContent = buildCsv(this.result.missingPersons || [], [
      { header: 'Gruppe', value: row => row.group },
      { header: 'Login', value: row => row.login },
      { header: 'Code', value: row => row.code },
      { header: 'Grund', value: row => row.reason }
    ]);

    downloadCsvFile('validierung-testpersonen.csv', csvContent);
    this.isExporting = false;
  }
}
