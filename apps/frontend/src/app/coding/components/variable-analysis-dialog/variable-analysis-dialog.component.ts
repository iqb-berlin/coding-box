import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { Subscription, finalize, Subject } from 'rxjs';
import {
  computed,
  ChangeDetectorRef, Component, inject, OnInit, viewChild, effect, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import {
  MatPaginator, MatPaginatorModule, MatPaginatorIntl, PageEvent
} from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { AppService } from '../../../core/services/app.service';
import { VariableAnalysisItemDto } from '../../../../../../../api-dto/coding/variable-analysis-item.dto';
import { WorkspaceSettingsService } from '../../../shared/services/workspace/workspace-settings.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { hasInvalidRegexFilter } from '../../../shared/utils/regex-filter.util';

export interface VariableAnalysisDialogData {
  workspaceId: number;
  initialData?: {
    data: VariableAnalysisItemDto[];
    total: number;
    page: number;
    limit: number;
  };
}

function createVariableAnalysisPaginatorIntl(): MatPaginatorIntl {
  const paginatorIntl = new MatPaginatorIntl();
  const translate = injectUiTranslator();
  const service = inject(TranslateService);
  const updateLabels = () => {
    paginatorIntl.itemsPerPageLabel = translate('variable-analysis.distribution-rows-per-page');
    paginatorIntl.nextPageLabel = translate('paginator.nextPageLabel');
    paginatorIntl.previousPageLabel = translate('paginator.previousPageLabel');
    paginatorIntl.firstPageLabel = translate('paginator.firstPageLabel');
    paginatorIntl.lastPageLabel = translate('paginator.lastPageLabel');
    paginatorIntl.changes.next();
  };
  service.onLangChange.pipe(takeUntilDestroyed()).subscribe(updateLabels);
  updateLabels();
  paginatorIntl.getRangeLabel = (page, pageSize, length) => translate('variable-analysis.distribution-row-range', {
    startIndex: length === 0 || pageSize === 0 ? 0 : page * pageSize + 1,
    endIndex: length === 0 || pageSize === 0 ? 0 : Math.min((page + 1) * pageSize, length),
    length: length === 0 || pageSize === 0 ? 0 : length
  });
  return paginatorIntl;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-variable-analysis-dialog',
  templateUrl: './variable-analysis-dialog.component.html',
  styleUrls: ['./variable-analysis-dialog.component.scss'],
  standalone: true,
  providers: [
    { provide: MatPaginatorIntl, useFactory: createVariableAnalysisPaginatorIntl }
  ],
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    TranslateModule
  ]
})
export class VariableAnalysisDialogComponent implements OnInit {
  private readonly uiTranslate = injectUiTranslator();

  dialogRef = inject<MatDialogRef<VariableAnalysisDialogComponent>>(MatDialogRef);
  data = inject<VariableAnalysisDialogData>(MAT_DIALOG_DATA);
  private statisticsService = inject(CodingStatisticsService);
  private appService = inject(AppService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private snackBar = inject(MatSnackBar);

  private analysisRequest?: Subscription;

  private readonly destroyRef = inject(DestroyRef);

  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  private readonly localizedDistributionRowsTooltip = computed<string>(() => (this.uiTranslate('ui-text.variable-analysis-dialog.distribution-row-tooltip')));
  protected get distributionRowsTooltip(): string { return this.localizedDistributionRowsTooltip(); }

  private readonly localizedOccurrenceCountTooltip = computed<string>(() => (this.uiTranslate('ui-text.variable-analysis-dialog.occurrences-tooltip')));
  protected get occurrenceCountTooltip(): string { return this.localizedOccurrenceCountTooltip(); }

  private readonly localizedTotalCountTooltip = computed<string>(() => (this.uiTranslate('ui-text.variable-analysis-dialog.total-responses-tooltip')));
  protected get totalCountTooltip(): string { return this.localizedTotalCountTooltip(); }

  private readonly localizedRelativeOccurrenceTooltip = computed<string>(() => (this.uiTranslate('ui-text.variable-analysis-dialog.proportion-tooltip')));
  protected get relativeOccurrenceTooltip(): string { return this.localizedRelativeOccurrenceTooltip(); }

  variableAnalysisData: VariableAnalysisItemDto[] = [];
  protected variableAnalysisDataSource = new MatTableDataSource<VariableAnalysisItemDto>([]);
  protected variableAnalysisColumns: string[] = [
    'replayUrl', 'unitId', 'variableId',
    'code', 'score', 'occurrenceCount',
    'totalCount', 'relativeOccurrence'
  ];

  protected totalVariableAnalysisRecords = 0;
  protected variableAnalysisPageIndex = 0;
  protected variableAnalysisPageSize = 200;
  protected variableAnalysisPageSizeOptions = [100, 200, 500];
  unitIdFilter = '';
  variableIdFilter = '';
  enableRegexSearch = false;
  isLoadingVariableAnalysis = false;
  variableAnalysisFilterChanged = new Subject<void>();

  readonly sort = viewChild(MatSort);
  private readonly synchronizeSort = effect(() => {
    this.variableAnalysisDataSource.sort = this.sort() ?? null;
  });

  readonly paginator = viewChild(MatPaginator);

  ngOnInit(): void {
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(id => {
      if (id !== this.data.workspaceId) this.dialogRef.close();
    });
    this.workspaceSettingsService.getEnableRegexSearch(this.data.workspaceId).pipe(takeUntil(this.dialogRef.beforeClosed()), takeUntilDestroyed(this.destroyRef)).subscribe(enabled => {
      this.enableRegexSearch = enabled;
      this.changeDetectorRef.markForCheck();
    });

    this.variableAnalysisFilterChanged.pipe(
      debounceTime(500),
      takeUntil(this.dialogRef.beforeClosed())
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.fetchVariableAnalysis(1, this.variableAnalysisPageSize);
    });

    if (this.data.initialData) {
      this.variableAnalysisData = this.data.initialData.data;
      this.variableAnalysisDataSource.data = this.data.initialData.data;
      this.totalVariableAnalysisRecords = this.data.initialData.total;
      this.variableAnalysisPageIndex = this.data.initialData.page - 1; // MatPaginator uses 0-based index
      this.variableAnalysisPageSize = this.data.initialData.limit;
    } else {
      this.fetchVariableAnalysis(1, this.variableAnalysisPageSize);
    }
  }

  fetchVariableAnalysis(page: number = 1, limit: number = 100): void {
    this.analysisRequest?.unsubscribe();
    if (this.isVariableIdRegexInvalid()) {
      this.isLoadingVariableAnalysis = false;
      this.changeDetectorRef.markForCheck();
      return;
    }

    const workspaceId = this.data.workspaceId;
    this.isLoadingVariableAnalysis = true;
    this.changeDetectorRef.markForCheck();

    const unitId = this.unitIdFilter.trim() || undefined;
    const variableId = this.variableIdFilter.trim() || undefined;

    this.analysisRequest = this.statisticsService.getVariableAnalysis(
      workspaceId,
      page,
      limit,
      unitId,
      variableId,
      undefined,
      this.enableRegexSearch
    ).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntil(this.dialogRef.beforeClosed()), takeUntilDestroyed(this.destroyRef), finalize(() => { if (!this.destroyRef.destroyed) { this.isLoadingVariableAnalysis = false; this.changeDetectorRef.markForCheck(); } }))
      .subscribe({
        next: response => {
          this.variableAnalysisData = response.data;
          this.variableAnalysisDataSource.data = response.data;
          this.totalVariableAnalysisRecords = response.total;
          this.variableAnalysisPageIndex = response.page - 1; // MatPaginator uses 0-based index
          this.variableAnalysisPageSize = response.limit;

          this.isLoadingVariableAnalysis = false;
          this.changeDetectorRef.markForCheck();
        },
        error: () => {
          this.isLoadingVariableAnalysis = false;
          this.changeDetectorRef.markForCheck();
          this.snackBar.open(this.uiTranslate('ui-text.variable-analysis-dialog.load-failed'), this.uiTranslate('deferred-view.close'), {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
        }
      });
  }

  protected onVariableAnalysisPaginatorChange(event: PageEvent): void {
    const page = event.pageIndex + 1; // Convert from 0-based to 1-based index
    const limit = event.pageSize;
    this.fetchVariableAnalysis(page, limit);
  }

  protected clearVariableAnalysisFilters(): void {
    this.unitIdFilter = '';
    this.variableIdFilter = '';
    this.fetchVariableAnalysis(1, this.variableAnalysisPageSize);
  }

  onVariableAnalysisFilterChange(): void {
    // Cancel the previous text's request before the debounce or regex validation.
    this.analysisRequest?.unsubscribe();
    this.isLoadingVariableAnalysis = false;
    if (this.isVariableIdRegexInvalid()) {
      return;
    }

    this.variableAnalysisFilterChanged.next();
  }

  protected isVariableIdRegexInvalid(): boolean {
    return hasInvalidRegexFilter(this.variableIdFilter, this.enableRegexSearch);
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
