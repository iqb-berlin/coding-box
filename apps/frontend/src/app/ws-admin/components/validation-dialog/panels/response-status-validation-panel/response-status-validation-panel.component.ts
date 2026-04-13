import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
  selector: 'coding-box-response-status-validation-panel',
  standalone: true,
  imports: [
    CommonModule,
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
  @Input() disabled = false;
  @Output() validate = new EventEmitter<void>();
  @Output() showUnitXml = new EventEmitter<string>();

  isRunning = false;
  wasRun = false;
  isLoadingPage = false;
  errorMessage: string | null = null;
  invalidStatusVariables: InvalidVariableDto[] = [];
  totalInvalid = 0;
  currentPage = 1;
  pageSize = 10;
  selectedResponses: Set<number> = new Set();
  expandedPanel = false;
  isDeletingResponses = false;
  isExporting = false;
  activeTask: ValidationTaskDto | null = null;

  tableColumns: ValidationTableColumn[] = [
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

  constructor(
    private responseStatusValidationService: ResponseStatusValidationService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    const cachedResult =
      this.responseStatusValidationService.observeValidationResult();

    this.stateSubscription = cachedResult.subscribe(result => {
      if (result && !this.isRunning) {
        this.wasRun = true;
        const details = result.details as Record<string, unknown>;
        if (result.status === 'failed' && details?.error) {
          this.errorMessage = details.error as string;
          this.invalidStatusVariables = [];
          this.totalInvalid = 0;
        } else if (result.details) {
          const statusResult = result.details as ResponseStatusValidationResult;
          this.errorMessage = null;
          this.invalidStatusVariables = statusResult.data || [];
          this.totalInvalid = statusResult.total || 0;
          this.currentPage = statusResult.page || 1;
          this.pageSize = statusResult.limit || 10;
        }
      }
    });

    // Observe active task
    this.taskSubscription = this.responseStatusValidationService
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
    return this.responseStatusValidationService.getValidationStatus();
  }

  get errorCount(): number {
    return this.totalInvalid;
  }

  onValidate(): void {
    if (this.isRunning || this.disabled) {
      return;
    }

    this.isRunning = true;
    this.subscription = this.responseStatusValidationService
      .validate(this.currentPage, this.pageSize)
      .subscribe({
        next: result => {
          this.invalidStatusVariables = result.data;
          this.totalInvalid = result.total;
          this.currentPage = result.page;
          this.pageSize = result.limit;
          this.wasRun = true;
          this.isRunning = false;
        },
        error: () => {
          this.isRunning = false;
          this.snackBar.open('Fehler bei der Validierung', 'Schließen', {
            duration: 5000
          });
        }
      });

    this.validate.emit();
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.isLoadingPage = true;
    this.subscription?.unsubscribe();
    this.subscription = this.responseStatusValidationService
      .fetchPage(this.currentPage, this.pageSize)
      .subscribe({
        next: result => {
          this.invalidStatusVariables = result.data;
          this.totalInvalid = result.total;
          this.currentPage = result.page;
          this.pageSize = result.limit;
          this.isLoadingPage = false;
        },
        error: () => {
          this.isLoadingPage = false;
          this.snackBar.open('Fehler beim Laden der Seite', 'Schließen', {
            duration: 5000
          });
        }
      });
  }

  onSelectionChange(newSelection: Set<unknown>): void {
    this.selectedResponses = newSelection as Set<number>;
  }

  onLinkClick(event: { item: InvalidVariableDto; columnKey: string }): void {
    if (event.columnKey === 'fileName') {
      this.showUnitXml.emit(event.item.fileName);
    }
  }

  toggleExpansion(): void {
    this.expandedPanel = !this.expandedPanel;
  }

  selectAll(): void {
    this.selectedResponses = new Set(
      this.invalidStatusVariables
        .filter(v => v.responseId !== undefined)
        .map(v => v.responseId!)
    );
  }

  deselectAll(): void {
    this.selectedResponses.clear();
  }

  deleteSelected(): void {
    if (this.selectedResponses.size === 0 || this.isDeletingResponses) {
      return;
    }

    this.isDeletingResponses = true;
    this.responseStatusValidationService
      .deleteSelected(Array.from(this.selectedResponses))
      .subscribe({
        next: () => {
          this.isDeletingResponses = false;
          this.selectedResponses.clear();
          this.snackBar.open('Ausgewählte Antworten wurden gelöscht', 'OK', {
            duration: 3000
          });
          this.onValidate();
        },
        error: () => {
          this.isDeletingResponses = false;
          this.snackBar.open('Fehler beim Löschen', 'Schließen', {
            duration: 5000
          });
        }
      });
  }

  deleteAll(): void {
    if (this.invalidStatusVariables.length === 0 || this.isDeletingResponses) {
      return;
    }

    this.isDeletingResponses = true;
    this.responseStatusValidationService.deleteAll().subscribe({
      next: () => {
        this.isDeletingResponses = false;
        this.selectedResponses.clear();
        this.snackBar.open('Alle ungültigen Antworten wurden gelöscht', 'OK', {
          duration: 3000
        });
        this.onValidate();
      },
      error: () => {
        this.isDeletingResponses = false;
        this.snackBar.open('Fehler beim Löschen', 'Schließen', {
          duration: 5000
        });
      }
    });
  }

  exportCsv(): void {
    if (this.isExporting) {
      return;
    }

    this.isExporting = true;
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
          this.isExporting = false;
        },
        error: () => {
          this.isExporting = false;
          this.snackBar.open('Fehler beim CSV-Export', 'Schließen', {
            duration: 5000
          });
        }
      });
  }
}
