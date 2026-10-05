import {
  Component, DestroyRef, inject, OnInit, OnDestroy, signal, computed, input, output, ChangeDetectionStrategy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PageEvent } from '@angular/material/paginator';
import { Subscription } from 'rxjs';
import { ValidationTaskDto } from '../../../../../models/validation-task.dto';
import {
  ValidationPanelHeaderComponent,
  ValidationStatus,
  ValidationGuidanceComponent,
  ValidationDataTableComponent,
  ValidationTableColumn
} from '../../shared';
import { InvalidVariableDto } from '../../../../../../../../../api-dto/files/variable-validation.dto';
import { ResponseStatusValidationService } from '../../../../services/validation';
import { buildCsv, downloadCsvFile } from '../../shared/validation-export.util';

interface ResponseStatusValidationResult {
  data: InvalidVariableDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Panel component for response status validation.
 * Displays validation results for response status and allows deletion of invalid responses.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-response-status-validation-panel',
  standalone: true,
  imports: [
    MatExpansionModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatSnackBarModule,
    ValidationPanelHeaderComponent,
    ValidationGuidanceComponent,
    ValidationDataTableComponent
  ],
  templateUrl: './response-status-validation-panel.component.html',
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
    `
  ]
})
export class ResponseStatusValidationPanelComponent
implements OnInit, OnDestroy {
  private responseStatusValidationService = inject(ResponseStatusValidationService);
  private snackBar = inject(MatSnackBar);

  private readonly destroyRef = inject(DestroyRef);

  readonly disabled = input(false);
  readonly validate = output<void>();
  readonly showUnitXml = output<string>();

  protected readonly isRunning = signal(false);
  protected readonly wasRun = signal(false);
  protected readonly isLoadingPage = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly invalidStatusVariables = signal<InvalidVariableDto[]>([]);
  protected readonly totalInvalid = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly selectedResponses = signal<Set<number>>(new Set());
  protected readonly expandedPanel = signal(false);
  protected readonly isDeletingResponses = signal(false);
  protected readonly isExporting = signal(false);
  protected readonly activeTask = signal<ValidationTaskDto | null>(null);

  protected tableColumns: ValidationTableColumn[] = [
    {
      key: 'select',
      label: 'Auswählen',
      type: 'checkbox',
      width: '80px'
    },
    { key: 'fileName', label: 'Dateiname', type: 'link' },
    { key: 'variableId', label: 'Variablen-ID' },
    { key: 'value', label: 'Wert' },
    { key: 'errorReason', label: 'Fehlergrund' }
  ];

  private subscription?: Subscription;
  private stateSubscription?: Subscription;
  private taskSubscription?: Subscription;

  ngOnInit(): void {
    const cachedResult =
      this.responseStatusValidationService.observeValidationResult();

    this.stateSubscription = cachedResult.subscribe(result => {
      if (result && !this.isRunning()) {
        this.wasRun.set(true);
        const details = result.details as Record<string, unknown>;
        if (result.status === 'failed' && details?.error) {
          this.errorMessage.set(details.error as string);
          this.invalidStatusVariables.set([]);
          this.totalInvalid.set(0);
        } else if (result.details) {
          const statusResult = result.details as ResponseStatusValidationResult;
          this.errorMessage.set(null);
          this.invalidStatusVariables.set(statusResult.data || []);
          this.totalInvalid.set(statusResult.total || 0);
          this.currentPage.set(statusResult.page || 1);
          this.pageSize.set(statusResult.limit || 10);
        }
      }
    });

    // Observe active task
    this.taskSubscription = this.responseStatusValidationService
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

  protected get status(): ValidationStatus {
    return this.responseStatusValidationService.getValidationStatus();
  }

  protected readonly errorCount = computed<number>(() => this.totalInvalid());

  protected onValidate(): void {
    if (this.isRunning() || this.disabled()) {
      return;
    }

    this.isRunning.set(true);
    this.subscription = this.responseStatusValidationService
      .validate(this.currentPage(), this.pageSize())
      .subscribe({
        next: result => {
          this.invalidStatusVariables.set(result.data);
          this.totalInvalid.set(result.total);
          this.currentPage.set(result.page);
          this.pageSize.set(result.limit);
          this.wasRun.set(true);
          this.isRunning.set(false);
        },
        error: () => {
          this.isRunning.set(false);
          this.snackBar.open('Fehler bei der Validierung', 'Schließen', {
            duration: 5000
          });
        }
      });

    this.validate.emit();
  }

  protected onPageChange(event: PageEvent): void {
    this.currentPage.set(event.pageIndex + 1);
    this.pageSize.set(event.pageSize);
    this.isLoadingPage.set(true);
    this.subscription?.unsubscribe();
    this.subscription = this.responseStatusValidationService
      .fetchPage(this.currentPage(), this.pageSize())
      .subscribe({
        next: result => {
          this.invalidStatusVariables.set(result.data);
          this.totalInvalid.set(result.total);
          this.currentPage.set(result.page);
          this.pageSize.set(result.limit);
          this.isLoadingPage.set(false);
        },
        error: () => {
          this.isLoadingPage.set(false);

          this.snackBar.open('Fehler beim Laden der Seite', 'Schließen', {
            duration: 5000
          });
        }
      });
  }

  protected onSelectionChange(newSelection: Set<unknown>): void {
    this.selectedResponses.set(newSelection as Set<number>);
  }

  protected onLinkClick(event: { item: InvalidVariableDto; columnKey: string }): void {
    if (event.columnKey === 'fileName') {
      this.showUnitXml.emit(event.item.fileName);
    }
  }

  protected toggleExpansion(): void {
    this.expandedPanel.set(!this.expandedPanel());
  }

  protected selectAll(): void {
    this.selectedResponses.set(new Set(this.invalidStatusVariables().filter(v => v.responseId !== undefined)
      .map(v => v.responseId!)));
  }

  protected deselectAll(): void {
    this.selectedResponses.set(new Set());
  }

  protected deleteSelected(): void {
    if (this.selectedResponses().size === 0 || this.isDeletingResponses()) {
      return;
    }

    this.isDeletingResponses.set(true);
    this.responseStatusValidationService
      .deleteSelected(Array.from(this.selectedResponses()))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isDeletingResponses.set(false);

          this.selectedResponses.set(new Set());
          this.snackBar.open('Ausgewählte Antworten wurden gelöscht', 'OK', {
            duration: 3000
          });
          this.onValidate();
        },
        error: () => {
          this.isDeletingResponses.set(false);

          this.snackBar.open('Fehler beim Löschen', 'Schließen', {
            duration: 5000
          });
        }
      });
  }

  protected deleteAll(): void {
    if (this.invalidStatusVariables().length === 0 || this.isDeletingResponses()) {
      return;
    }

    this.isDeletingResponses.set(true);
    this.responseStatusValidationService.deleteAll().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.isDeletingResponses.set(false);

        this.selectedResponses.set(new Set());
        this.snackBar.open('Alle ungültigen Antworten wurden gelöscht', 'OK', {
          duration: 3000
        });
        this.onValidate();
      },
      error: () => {
        this.isDeletingResponses.set(false);

        this.snackBar.open('Fehler beim Löschen', 'Schließen', {
          duration: 5000
        });
      }
    });
  }

  protected exportCsv(): void {
    if (this.isExporting()) {
      return;
    }

    this.isExporting.set(true);
    this.subscription?.unsubscribe();
    this.subscription = this.responseStatusValidationService
      .fetchPage(1, Number.MAX_SAFE_INTEGER)
      .subscribe({
        next: result => {
          const csvContent = buildCsv(result.data, [
            { header: 'Dateiname', value: row => row.fileName },
            { header: 'Variablen-ID', value: row => row.variableId },
            { header: 'Wert', value: row => row.value },
            { header: 'Fehlergrund', value: row => row.errorReason ?? '' },
            { header: 'Response-ID', value: row => row.responseId ?? '' }
          ]);

          downloadCsvFile('validierung-antwortstatus.csv', csvContent);
          this.snackBar.open('CSV-Export erfolgreich erstellt', 'OK', {
            duration: 3000
          });
          this.isExporting.set(false);
        },
        error: () => {
          this.isExporting.set(false);

          this.snackBar.open('Fehler beim CSV-Export', 'Schließen', {
            duration: 5000
          });
        }
      });
  }
}
