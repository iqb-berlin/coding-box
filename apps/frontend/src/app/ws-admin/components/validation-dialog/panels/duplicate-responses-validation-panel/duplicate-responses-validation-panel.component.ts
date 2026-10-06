import {
  Component, DestroyRef, inject, OnInit, OnDestroy, signal, computed, input, output, ChangeDetectionStrategy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { forkJoin, Subscription } from 'rxjs';
import { ValidationTaskDto } from '../../../../../models/validation-task.dto';
import {
  ValidationPanelHeaderComponent,
  ValidationStatus,
  ValidationGuidanceComponent
} from '../../shared';
import {
  DuplicateResponseDto,
  DuplicateResponsesResultDto
} from '../../../../../../../../../api-dto/files/duplicate-response.dto';
import { DuplicateResponseSelectionDto } from '../../../../models/duplicate-response-selection.dto';
import { DuplicateResponsesValidationService } from '../../../../services/validation';
import { buildCsv, downloadCsvFile } from '../../shared/validation-export.util';

/**
 * Panel component for duplicate responses validation.
 * Displays duplicate responses and allows users to select which ones to keep.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-duplicate-responses-validation-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatExpansionModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatPaginatorModule,
    MatIconModule,
    MatSnackBarModule,
    ValidationPanelHeaderComponent,
    ValidationGuidanceComponent
  ],
  templateUrl: './duplicate-responses-validation-panel.component.html',
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

      .duplicate-response-item {
        margin-bottom: 24px;
        padding: 16px;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        background-color: #fafafa;
      }

      .duplicate-response-header {
        margin-bottom: 12px;
        font-weight: 500;
      }

      .duplicate-response-table {
        width: 100%;
        border-collapse: collapse;
        background-color: white;
      }

      .duplicate-response-table th,
      .duplicate-response-table td {
        padding: 8px;
        border: 1px solid #e0e0e0;
        text-align: left;
      }

      .duplicate-response-table th {
        background-color: #f5f5f5;
        font-weight: 500;
      }

      .duplicate-row-selected {
        background-color: rgba(33, 150, 243, 0.08);
      }

      .duplicate-cell-conflict {
        background-color: rgba(244, 67, 54, 0.1);
      }

      .duplicate-cell-selected {
        outline: 2px solid rgba(33, 150, 243, 0.35);
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

      .auto-resolve-info {
        margin: 0 0 12px 0;
        padding: 10px 12px;
        border: 1px solid #b3e5fc;
        border-radius: 4px;
        background-color: #e1f5fe;
        color: #01579b;
      }

      .auto-resolve-info-title {
        font-weight: 600;
        margin: 0 0 6px 0;
      }

      .auto-resolve-info ul {
        margin: 0;
        padding-left: 18px;
      }

      .auto-resolve-info li {
        margin: 2px 0;
      }
    `
  ]
})
export class DuplicateResponsesValidationPanelComponent
implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  readonly disabled = input(false);
  readonly validate = output<void>();

  protected readonly isRunning = signal(false);
  protected readonly wasRun = signal(false);
  protected readonly isLoadingPage = signal(false);
  protected readonly isExporting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  readonly duplicateResponses = signal<DuplicateResponseSelectionDto[]>([]);
  protected readonly totalDuplicates = signal(0);
  readonly duplicateResponseSelections = signal<Map<string, number>>(new Map());
  readonly duplicateResponseTouchedKeys = signal<Set<string>>(new Set());
  protected readonly expandedPanel = signal(false);
  protected readonly isResolvingDuplicates = signal(false);
  protected readonly activeTask = signal<ValidationTaskDto | null>(null);

  // Pagination state
  protected readonly pageSize = signal(10);
  protected readonly currentPage = signal(1);

  private subscription?: Subscription;
  private stateSubscription?: Subscription;
  private taskSubscription?: Subscription;

  constructor(
    private duplicateResponsesValidationService: DuplicateResponsesValidationService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    const cachedResult =
      this.duplicateResponsesValidationService.observeValidationResult();

    this.stateSubscription = cachedResult.subscribe(result => {
      if (result && !this.isRunning()) {
        this.wasRun.set(true);
        const details = result.details as Record<string, unknown>;
        if (result.status === 'failed' && details?.error) {
          this.errorMessage.set(details.error as string);
          this.duplicateResponses.set([]);
          this.totalDuplicates.set(0);
        } else if (result.details) {
          const duplicateResult = result.details as DuplicateResponsesResultDto;
          this.errorMessage.set(null);
          this.duplicateResponses.set(((duplicateResult.data || []) as DuplicateResponseSelectionDto[]).map(d => ({
            ...d,
            key: this.buildDuplicateKey(d)
          })));
          this.totalDuplicates.set(duplicateResult.total || 0);
          this.currentPage.set(duplicateResult.page || 1);
          this.pageSize.set(duplicateResult.limit || 10);
        }
      }
    });

    // Observe active task
    this.taskSubscription = this.duplicateResponsesValidationService
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
    return this.duplicateResponsesValidationService.getValidationStatus();
  }

  readonly errorCount = computed<number>(() => this.totalDuplicates());

  onValidate(): void {
    if (this.isRunning() || this.disabled()) {
      return;
    }

    this.isRunning.set(true);
    this.subscription = this.duplicateResponsesValidationService
      .validate(this.currentPage(), this.pageSize())
      .subscribe({
        next: result => {
          this.duplicateResponses.set((result.data as DuplicateResponseSelectionDto[]).map(d => ({
            ...d,
            key: this.buildDuplicateKey(d)
          })));
          this.totalDuplicates.set(result.total);
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
    this.subscription = this.duplicateResponsesValidationService
      .fetchPage(this.currentPage(), this.pageSize())
      .subscribe({
        next: result => {
          this.duplicateResponses.set((result.data as DuplicateResponseSelectionDto[]).map(d => ({
            ...d,
            key: this.buildDuplicateKey(d)
          })));
          this.totalDuplicates.set(result.total);
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

  protected toggleExpansion(): void {
    this.expandedPanel.set(!this.expandedPanel());
  }

  private buildDuplicateKey(duplicate: DuplicateResponseDto): string {
    return `${encodeURIComponent(duplicate.unitName)}|${encodeURIComponent(duplicate.variableId)}|${encodeURIComponent(duplicate.subform || '')}|${encodeURIComponent(duplicate.testTakerLogin)}|${encodeURIComponent(duplicate.testTakerCode || '')}|${encodeURIComponent(duplicate.testTakerGroup || '')}`;
  }

  protected selectDuplicateResponse(
    duplicate: DuplicateResponseSelectionDto,
    responseId: number
  ): void {
    this.duplicateResponseSelections.update(value => {
      const next = new Map(value);
      next.set(duplicate.key, responseId);
      return next;
    });
    this.duplicateResponseTouchedKeys.update(value => {
      const next = new Set(value);
      next.add(duplicate.key);
      return next;
    });
  }

  protected isSelectedDuplicateResponse(
    duplicate: DuplicateResponseSelectionDto,
    responseId: number
  ): boolean {
    return this.duplicateResponseSelections().get(duplicate.key) === responseId;
  }

  protected isDuplicateRowSelected(
    duplicate: DuplicateResponseSelectionDto,
    responseId: number
  ): boolean {
    return this.isSelectedDuplicateResponse(duplicate, responseId);
  }

  protected isDuplicateValueConflicting(
    duplicate: DuplicateResponseSelectionDto,
    responseId: number
  ): boolean {
    const values = new Set(
      (duplicate.duplicates || []).map(d => String(d.value ?? ''))
    );
    if (values.size <= 1) return false;

    const selectedId = this.duplicateResponseSelections().get(duplicate.key);
    if (!selectedId) return true;

    const selected = (duplicate.duplicates || []).find(
      d => d.responseId === selectedId
    );
    const current = (duplicate.duplicates || []).find(
      d => d.responseId === responseId
    );
    return String(current?.value ?? '') !== String(selected?.value ?? '');
  }

  protected isDuplicateStatusConflicting(
    duplicate: DuplicateResponseSelectionDto,
    responseId: number
  ): boolean {
    const statuses = new Set(
      (duplicate.duplicates || []).map(d => String(d.status ?? ''))
    );
    if (statuses.size <= 1) return false;

    const selectedId = this.duplicateResponseSelections().get(duplicate.key);
    if (!selectedId) return true;

    const selected = (duplicate.duplicates || []).find(
      d => d.responseId === selectedId
    );
    const current = (duplicate.duplicates || []).find(
      d => d.responseId === responseId
    );
    return String(current?.status ?? '') !== String(selected?.status ?? '');
  }

  protected getDuplicateConflictLabel(duplicate: DuplicateResponseSelectionDto): string {
    const parts: string[] = [];
    const values = new Set(
      (duplicate.duplicates || []).map(d => String(d.value ?? ''))
    );
    const statuses = new Set(
      (duplicate.duplicates || []).map(d => String(d.status ?? ''))
    );

    if (values.size > 1) parts.push('Wert');
    if (statuses.size > 1) parts.push('Status');

    return parts.length === 0 ?
      'Duplikate sind identisch' :
      `Unterschiede: ${parts.join(', ')}`;
  }

  protected isDuplicateGroupTouched(duplicate: DuplicateResponseSelectionDto): boolean {
    return this.duplicateResponseTouchedKeys().has(duplicate.key);
  }

  protected hasSelectedDuplicateResponses(): boolean {
    return this.duplicateResponseSelections().size > 0;
  }

  protected getSelectedDuplicateResponsesCount(): number {
    return this.duplicateResponseSelections().size;
  }

  protected selectSuggestedDuplicateResponse(
    duplicate: DuplicateResponseSelectionDto
  ): void {
    // Smart selection: prefer non-empty values, then keep newest response id.
    const best = [...(duplicate.duplicates || [])].sort((a, b) => {
      if (a.value && !b.value) return -1;
      if (!a.value && b.value) return 1;
      return b.responseId - a.responseId;
    })[0];

    if (best) {
      this.selectDuplicateResponse(duplicate, best.responseId);
    }
  }

  protected resolveDuplicateGroup(duplicate: DuplicateResponseSelectionDto): void {
    const selectedId = this.duplicateResponseSelections().get(duplicate.key);
    if (!selectedId) return;

    const responseIdsToDelete = (duplicate.duplicates || [])
      .filter(d => d.responseId !== selectedId)
      .map(d => d.responseId);

    if (responseIdsToDelete.length === 0) return;

    this.isResolvingDuplicates.set(true);
    this.duplicateResponsesValidationService
      .resolveDuplicateGroup(responseIdsToDelete)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isResolvingDuplicates.set(false);

          this.duplicateResponseSelections.update(value => {
            const next = new Map(value);
            next.delete(duplicate.key);
            return next;
          });
          this.duplicateResponseTouchedKeys.update(value => {
            const next = new Set(value);
            next.delete(duplicate.key);
            return next;
          });
          this.snackBar.open('Duplikate wurden aufgelöst', 'OK', {
            duration: 3000
          });
          this.onValidate();
        },
        error: () => {
          this.isResolvingDuplicates.set(false);

          this.snackBar.open('Fehler beim Auflösen', 'Schließen', {
            duration: 5000
          });
        }
      });
  }

  protected resolveAllDuplicates(): void {
    if (this.duplicateResponses().length === 0 || this.isResolvingDuplicates()) {
      return;
    }

    this.isResolvingDuplicates.set(true);
    this.duplicateResponsesValidationService.resolveAllDuplicates().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.isResolvingDuplicates.set(false);

        this.duplicateResponseSelections.set(new Map());
        this.duplicateResponseTouchedKeys.set(new Set());
        this.snackBar.open(
          'Alle Duplikate wurden automatisch aufgelöst',
          'OK',
          { duration: 3000 }
        );
        this.onValidate();
      },
      error: () => {
        this.isResolvingDuplicates.set(false);

        this.snackBar.open('Fehler beim Auflösen', 'Schließen', {
          duration: 5000
        });
      }
    });
  }

  resolveSelectedDuplicates(): void {
    // Resolve all duplicates that have a selection
    const duplicatesToResolve = this.duplicateResponses().filter(d => this.duplicateResponseTouchedKeys().has(d.key)
    );

    if (duplicatesToResolve.length === 0) return;

    const resolvedKeys: string[] = [];
    const resolveRequests = duplicatesToResolve.flatMap(duplicate => {
      const selectedId = this.duplicateResponseSelections().get(duplicate.key);
      if (!selectedId) return [];

      const responseIdsToDelete = (duplicate.duplicates || [])
        .filter(d => d.responseId !== selectedId)
        .map(d => d.responseId);

      if (responseIdsToDelete.length === 0) return [];

      resolvedKeys.push(duplicate.key);
      return [
        this.duplicateResponsesValidationService
          .resolveDuplicateGroup(responseIdsToDelete)
      ];
    });

    if (resolveRequests.length === 0) return;

    this.isResolvingDuplicates.set(true);
    forkJoin(resolveRequests).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.isResolvingDuplicates.set(false);

        resolvedKeys.forEach(key => {
          this.duplicateResponseSelections.update(value => {
            const next = new Map(value);
            next.delete(key);
            return next;
          });
          this.duplicateResponseTouchedKeys.update(value => {
            const next = new Set(value);
            next.delete(key);
            return next;
          });
        });
        this.snackBar.open(
          `${resolvedKeys.length} Duplikatgruppen wurden aufgelöst`,
          'OK',
          { duration: 3000 }
        );
        this.onValidate();
      },
      error: () => {
        this.isResolvingDuplicates.set(false);

        this.snackBar.open('Fehler beim Auflösen', 'Schließen', {
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
    this.subscription = this.duplicateResponsesValidationService
      .fetchPage(1, Number.MAX_SAFE_INTEGER)
      .subscribe({
        next: result => {
          const rows = result.data.flatMap(duplicate => duplicate.duplicates.map(duplicateValue => ({
            unitName: duplicate.unitName,
            variableId: duplicate.variableId,
            subform: duplicate.subform || '',
            bookletName: duplicate.bookletName || '',
            testTakerGroup: duplicate.testTakerGroup || '',
            testTakerLogin: duplicate.testTakerLogin || '',
            testTakerCode: duplicate.testTakerCode || '',
            responseId: duplicateValue.responseId,
            value: duplicateValue.value,
            status: duplicateValue.status
          }))
          );

          const csvContent = buildCsv(rows, [
            { header: 'Unit', value: row => row.unitName },
            { header: 'Variablen-ID', value: row => row.variableId },
            { header: 'Subform', value: row => row.subform },
            { header: 'Booklet', value: row => row.bookletName },
            { header: 'Gruppe', value: row => row.testTakerGroup },
            { header: 'Login', value: row => row.testTakerLogin },
            { header: 'Code', value: row => row.testTakerCode },
            { header: 'Response-ID', value: row => row.responseId },
            { header: 'Wert', value: row => row.value },
            { header: 'Status', value: row => row.status }
          ]);

          downloadCsvFile('validierung-duplikate.csv', csvContent);
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
