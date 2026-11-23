import { TranslateModule } from '@ngx-translate/core';
import {
  Directive, DestroyRef, inject, OnInit, OnDestroy, signal, computed, input, output
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PageEvent } from '@angular/material/paginator';
import { Subscription } from 'rxjs';
import { injectUiTranslator } from '../../../../shared/utils/ui-translator';
import { ValidationTaskDto } from '../../../../models/validation-task.dto';
import {
  ValidationPanelHeaderComponent,
  ValidationStatus,
  ValidationGuidanceComponent,
  ValidationDataTableComponent,
  ValidationTableColumn
} from '../shared';
import {
  InvalidVariableDto,
  VariableValidationSummaryDto
} from '../../../../../../../../api-dto/files/variable-validation.dto';
import { InvalidResponseValidationService, InvalidResponsePage } from '../../../services/validation/invalid-response-validation.service';
import { buildCsv, CsvColumn, downloadCsvFile } from '../shared/validation-export.util';

export const INVALID_RESPONSE_PANEL_IMPORTS = [
  TranslateModule,
  MatExpansionModule,
  MatButtonModule,
  MatProgressSpinnerModule,
  MatIconModule,
  MatSnackBarModule,
  ValidationPanelHeaderComponent,
  ValidationGuidanceComponent,
  ValidationDataTableComponent
];

export interface InvalidResponsePanelConfig {
  title: string;
  run: string;
  running: string;
  formatInvalidResult: (count: number) => string;
  valid: string;
  description: string;
  whyText: string;
  fixHint: string;
  csvFilename: () => string;
  includeExpectedType?: boolean;
  responseIdBeforeReason?: boolean;
}

@Directive()
export abstract class InvalidResponseValidationPanel implements OnInit, OnDestroy {
  protected readonly uiTranslate = injectUiTranslator();

  protected abstract readonly validationService: InvalidResponseValidationService;
  protected abstract readonly config: InvalidResponsePanelConfig;
  private snackBar = inject(MatSnackBar);

  private readonly destroyRef = inject(DestroyRef);

  readonly disabled = input(false);
  readonly validate = output<void>();
  readonly showUnitXml = output<string>();

  protected readonly isRunning = signal(false);
  protected readonly wasRun = signal(false);
  protected readonly isLoadingPage = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly invalidVariables = signal<InvalidVariableDto[]>([]);
  protected readonly totalInvalid = signal(0);
  protected readonly summary = signal<VariableValidationSummaryDto>({
    unitFileNotFound: 0,
    variableNotDefinedInUnit: 0
  });

  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly selectedResponses = signal<Set<number>>(new Set());
  protected readonly expandedPanel = signal(false);
  protected readonly isDeletingResponses = signal(false);
  protected readonly isExporting = signal(false);
  protected readonly activeTask = signal<ValidationTaskDto | null>(null);

  private readonly localizedTableColumns = computed<ValidationTableColumn[]>(() => ([
    {
      key: 'select',
      label: this.uiTranslate('coding.select'),
      type: 'checkbox',
      width: '80px'
    },
    { key: 'fileName', label: this.uiTranslate('file-upload.filename'), type: 'link' },
    { key: 'variableId', label: this.uiTranslate('coding-management.filters.variable-id') },
    { key: 'value', label: this.uiTranslate('coding.value') },
    ...(this.config.includeExpectedType ? [{ key: 'expectedType', label: this.uiTranslate('ui-text.variable-types-validation-panel.expected-type') }] : []),
    { key: 'errorReason', label: this.uiTranslate('ui-text.response-status-validation-panel.error-reason') }
  ]));

  protected get tableColumns(): ValidationTableColumn[] { return this.localizedTableColumns(); }

  private subscription?: Subscription;
  private stateSubscription?: Subscription;
  private taskSubscription?: Subscription;

  ngOnInit(): void {
    const cachedResult =
      this.validationService.observeValidationResult();

    this.stateSubscription = cachedResult.subscribe(result => {
      if (result && !this.isRunning()) {
        this.wasRun.set(true);
        const details = result.details as Record<string, unknown>;
        if (result.status === 'failed' && details?.error) {
          this.errorMessage.set(details.error as string);
          this.invalidVariables.set([]);
          this.totalInvalid.set(0);
          this.summary.set({
            unitFileNotFound: 0,
            variableNotDefinedInUnit: 0
          });
        } else if (result.details) {
          const page = result.details as InvalidResponsePage;
          this.errorMessage.set(null);
          this.invalidVariables.set(page.data || []);
          this.totalInvalid.set(page.total || 0);
          this.currentPage.set(page.page || 1);
          this.pageSize.set(page.limit || 10);
          this.summary.set(page.summary || {
            unitFileNotFound: 0,
            variableNotDefinedInUnit: 0
          });
        }
      }
    });

    // Observe active task
    this.taskSubscription = this.validationService
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
    return this.validationService.getValidationStatus();
  }

  protected readonly errorCount = computed<number>(() => this.totalInvalid());

  protected onValidate(): void {
    if (this.isRunning() || this.disabled()) {
      return;
    }

    this.isRunning.set(true);
    this.subscription = this.validationService
      .validate(this.currentPage(), this.pageSize())
      .subscribe({
        next: result => {
          this.invalidVariables.set(result.data);
          this.totalInvalid.set(result.total);
          this.currentPage.set(result.page);
          this.pageSize.set(result.limit);
          this.summary.set(result.summary || {
            unitFileNotFound: 0,
            variableNotDefinedInUnit: 0
          });
          this.wasRun.set(true);
          this.isRunning.set(false);
        },
        error: () => {
          this.isRunning.set(false);
          this.snackBar.open(this.uiTranslate('coding-management-manual.errors.validation-failed'), this.uiTranslate('deferred-view.close'), {
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
    this.subscription = this.validationService
      .fetchPage(this.currentPage(), this.pageSize())
      .subscribe({
        next: result => {
          this.invalidVariables.set(result.data);
          this.totalInvalid.set(result.total);
          this.currentPage.set(result.page);
          this.pageSize.set(result.limit);
          this.summary.set(result.summary || {
            unitFileNotFound: 0,
            variableNotDefinedInUnit: 0
          });
          this.isLoadingPage.set(false);
        },
        error: () => {
          this.isLoadingPage.set(false);

          this.snackBar.open(this.uiTranslate('ui-text.duplicate-responses-validation-panel.page-load-failed'), this.uiTranslate('deferred-view.close'), {
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
    this.selectedResponses.set(new Set(this.invalidVariables().filter(v => v.responseId !== undefined)
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
    this.validationService
      .deleteSelected(Array.from(this.selectedResponses()))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isDeletingResponses.set(false);

          this.selectedResponses.set(new Set());
          this.snackBar.open(this.uiTranslate('ui-text.response-status-validation-panel.selected-deleted'), 'OK', {
            duration: 3000
          });
          this.onValidate(); // Refresh results
        },
        error: () => {
          this.isDeletingResponses.set(false);

          this.snackBar.open(this.uiTranslate('ui-text.response-status-validation-panel.delete-failed'), this.uiTranslate('deferred-view.close'), {
            duration: 5000
          });
        }
      });
  }

  protected deleteAll(): void {
    if (this.invalidVariables().length === 0 || this.isDeletingResponses()) {
      return;
    }

    this.isDeletingResponses.set(true);
    this.validationService.deleteAll().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.isDeletingResponses.set(false);

        this.selectedResponses.set(new Set());
        this.snackBar.open(this.uiTranslate('ui-text.response-status-validation-panel.all-deleted'), 'OK', {
          duration: 3000
        });
        this.onValidate(); // Refresh results
      },
      error: () => {
        this.isDeletingResponses.set(false);

        this.snackBar.open(this.uiTranslate('ui-text.response-status-validation-panel.delete-failed'), this.uiTranslate('deferred-view.close'), {
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
    this.subscription = this.validationService
      .fetchPage(1, Number.MAX_SAFE_INTEGER)
      .subscribe({
        next: result => {
          const responseId: CsvColumn<InvalidVariableDto> = { header: 'Response-ID', value: row => row.responseId ?? '' };
          const errorReason: CsvColumn<InvalidVariableDto> = { header: 'Fehlergrund', value: row => row.errorReason ?? '' };
          const columns: CsvColumn<InvalidVariableDto>[] = [
            { header: 'Dateiname', value: row => row.fileName },
            { header: this.uiTranslate('coding-management.filters.variable-id'), value: row => row.variableId },
            { header: 'Wert', value: row => row.value }
          ];
          if (this.config.includeExpectedType) {
            columns.push({
              header: this.uiTranslate('ui-text.variable-types-validation-panel.expected-type'),
              value: row => row.expectedType ?? ''
            });
          }
          columns.push(...(this.config.responseIdBeforeReason ? [responseId, errorReason] : [errorReason, responseId]));

          downloadCsvFile(this.config.csvFilename(), buildCsv(result.data, columns));
          this.snackBar.open(this.uiTranslate('ui-text.duplicate-responses-validation-panel.export-success'), 'OK', {
            duration: 3000
          });
          this.isExporting.set(false);
        },
        error: () => {
          this.isExporting.set(false);

          this.snackBar.open(this.uiTranslate('ui-text.duplicate-responses-validation-panel.export-failed'), this.uiTranslate('deferred-view.close'), {
            duration: 5000
          });
        }
      });
  }
}
