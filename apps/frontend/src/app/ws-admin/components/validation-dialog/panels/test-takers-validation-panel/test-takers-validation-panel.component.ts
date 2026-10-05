import {
  Component, OnInit, OnDestroy, signal, computed, input, output, viewChild, effect, ChangeDetectionStrategy
} from '@angular/core';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-test-takers-validation-panel',
  standalone: true,
  imports: [
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
  readonly paginator = viewChild(MatPaginator);
  private readonly synchronizePaginator = effect(() => {
    this.paginatedMissingPersons.paginator = this.paginator() ?? null;
  });

  readonly disabled = input(false);
  readonly validate = output<void>();

  protected readonly isRunning = signal(false);
  readonly wasRun = signal(false);
  protected readonly isLoadingPage = signal(false);
  protected readonly isExporting = signal(false);
  readonly result = signal<TestTakersValidationDto | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  readonly expandedPanel = signal(false);
  protected paginatedMissingPersons = new MatTableDataSource<MissingPersonDto>([]);
  protected displayedColumns = ['group', 'login', 'code', 'reason'];
  protected readonly activeTask = signal<ValidationTaskDto | null>(null);

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
      if (result && !this.isRunning()) {
        this.wasRun.set(true);
        const details = result.details as Record<string, unknown>;
        if (result.status === 'failed' && details?.error) {
          this.errorMessage.set(details.error as string);
          this.result.set(null);
        } else {
          this.errorMessage.set(null);
          this.result.set(result.details as TestTakersValidationDto);
          this.updatePaginatedMissingPersons();
        }
      }
    });

    // Observe active task
    this.taskSubscription = this.testTakersValidationService
      .observeValidationTask()
      .subscribe(task => {
        this.activeTask.set(task);
        this.isRunning.set(!!task);
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

  protected readonly errorCount = computed(() => this.result()?.missingPersons.length || 0);

  onValidate(): void {
    if (this.isRunning() || this.disabled()) {
      return;
    }

    this.isRunning.set(true);
    this.subscription = this.testTakersValidationService.validate().subscribe({
      next: result => {
        this.result.set(result);
        this.wasRun.set(true);
        this.isRunning.set(false);
        this.updatePaginatedMissingPersons();
      },
      error: () => {
        this.isRunning.set(false);
      }
    });

    this.validate.emit();
  }

  toggleExpansion(): void {
    this.expandedPanel.set(!this.expandedPanel());
  }

  private updatePaginatedMissingPersons(): void {
    const resultSnapshot = this.result();

    if (resultSnapshot?.missingPersons) {
      this.paginatedMissingPersons.data = resultSnapshot.missingPersons;
      this.paginatedMissingPersons.paginator = this.paginator() ?? null;
    }
  }

  protected exportCsv(): void {
    const resultSnapshot = this.result();

    if (this.isExporting() || !resultSnapshot) {
      return;
    }

    this.isExporting.set(true);
    const csvContent = buildCsv(resultSnapshot.missingPersons || [], [
      { header: 'Gruppe', value: row => row.group },
      { header: 'Login', value: row => row.login },
      { header: 'Code', value: row => row.code },
      { header: 'Grund', value: row => row.reason }
    ]);

    downloadCsvFile('validierung-testpersonen.csv', csvContent);
    this.isExporting.set(false);
  }
}
