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
import { VariableValidationService } from '../../../../services/validation';
import { buildCsv, downloadCsvFile } from '../../shared/validation-export.util';

interface VariablesValidationResult {
  data: InvalidVariableDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Panel component for variables validation.
 * Displays validation results for variables and allows deletion of invalid responses.
 */
@Component({
  selector: 'coding-box-variables-validation-panel',
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
  templateUrl: './variables-validation-panel.component.html',
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
export class VariablesValidationPanelComponent implements OnInit, OnDestroy {
  @Input() disabled = false;
  @Output() validate = new EventEmitter<void>();
  @Output() showUnitXml = new EventEmitter<string>();

  isRunning = false;
  wasRun = false;
  isLoadingPage = false;
  errorMessage: string | null = null;
  invalidVariables: InvalidVariableDto[] = [];
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
    { key: 'value', label: 'Wert' }
  ];

  private subscription?: Subscription;
  private stateSubscription?: Subscription;
  private taskSubscription?: Subscription;

  constructor(
    private variableValidationService: VariableValidationService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    const cachedResult =
      this.variableValidationService.observeValidationResult();

    this.stateSubscription = cachedResult.subscribe(result => {
      if (result && !this.isRunning) {
        this.wasRun = true;
        const details = result.details as Record<string, unknown>;
        if (result.status === 'failed' && details?.error) {
          this.errorMessage = details.error as string;
          this.invalidVariables = [];
          this.totalInvalid = 0;
        } else if (result.details) {
          const variablesResult = result.details as VariablesValidationResult;
          this.errorMessage = null;
          this.invalidVariables = variablesResult.data || [];
          this.totalInvalid = variablesResult.total || 0;
          this.currentPage = variablesResult.page || 1;
          this.pageSize = variablesResult.limit || 10;
        }
      }
    });

    // Observe active task
    this.taskSubscription = this.variableValidationService
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
    return this.variableValidationService.getValidationStatus();
  }

  get errorCount(): number {
    return this.totalInvalid;
  }

  onValidate(): void {
    if (this.isRunning || this.disabled) {
      return;
    }

    this.isRunning = true;
    this.subscription = this.variableValidationService
      .validate(this.currentPage, this.pageSize)
      .subscribe({
        next: result => {
          this.invalidVariables = result.data;
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
    this.subscription = this.variableValidationService
      .fetchPage(this.currentPage, this.pageSize)
      .subscribe({
        next: result => {
          this.invalidVariables = result.data;
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
      this.invalidVariables
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
    this.variableValidationService
      .deleteSelected(Array.from(this.selectedResponses))
      .subscribe({
        next: () => {
          this.isDeletingResponses = false;
          this.selectedResponses.clear();
          this.snackBar.open('Ausgewählte Antworten wurden gelöscht', 'OK', {
            duration: 3000
          });
          this.onValidate(); // Refresh results
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
    if (this.invalidVariables.length === 0 || this.isDeletingResponses) {
      return;
    }

    this.isDeletingResponses = true;
    this.variableValidationService.deleteAll().subscribe({
      next: () => {
        this.isDeletingResponses = false;
        this.selectedResponses.clear();
        this.snackBar.open('Alle ungültigen Antworten wurden gelöscht', 'OK', {
          duration: 3000
        });
        this.onValidate(); // Refresh results
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
    this.subscription = this.variableValidationService
      .fetchPage(1, Number.MAX_SAFE_INTEGER)
      .subscribe({
        next: result => {
          const csvContent = buildCsv(result.data, [
            { header: 'Dateiname', value: row => row.fileName },
            { header: 'Variablen-ID', value: row => row.variableId },
            { header: 'Wert', value: row => row.value },
            { header: 'Response-ID', value: row => row.responseId ?? '' }
          ]);

          downloadCsvFile('validierung-variablen.csv', csvContent);
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
