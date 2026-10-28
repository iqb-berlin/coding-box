import {
  Component, inject, OnInit, computed, signal, ChangeDetectionStrategy, OnDestroy
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTableDataSource } from '@angular/material/table';
import { Sort } from '@angular/material/sort';
import { MatPaginatorIntl, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule, FormControl } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SelectionModel } from '@angular/cdk/collections';

import { MatSnackBar } from '@angular/material/snack-bar';
import {
  debounceTime, distinctUntilChanged, filter as filterWorkspace, Subject, take, takeUntil
} from 'rxjs';
import { variableKey } from '../../utils/variable-key.util';
import { comparisonPresentation, selectedCodeSlots, ComparisonSelection } from './training-comparison-presentation';
import type { TrainingCodingComparisonPageDto, WithinTrainingCodingComparisonPageDto } from '../../../../../../../api-dto/coding/training-comparison.dto';
import { TrainingComparisonDataFacade } from './training-comparison-data.facade';
import {
  TrainingComparison, WithinTrainingComparison, NotesFilterMode, ComparisonStatus, ComparisonCoderResult, ModalValueDisplay
} from './comparison-view.models';
import { TrainingComparisonSelectionComponent } from './training-comparison-selection.component';
import { TrainingComparisonTableComponent, ComparisonTableRow } from './training-comparison-table.component';
import { VariableKappaSummary } from './training-reliability';
import { TrainingReliabilityFacade, TrainingReliabilityContext } from './training-reliability.facade';
import { CodingPermissionsService } from '../../services/coding-permissions.service';
import { activateOnKeyboard } from '../../../shared/utils/keyboard-activation.util';
import { normalizeTestperson } from '../../../replay/utils/token-utils';
import { PostMessage, PostMessageService } from '../../../core/services/post-message.service';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import type {
  TrainingKappaVariableDto as KappaVariable
} from '../../../../../../../api-dto/coding/training-kappa-statistics.dto';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { CoderTraining } from '../../models/coder-training.model';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { AppService } from '../../../core/services/app.service';
import { AuthRefreshUnavailableError } from '../../../core/interceptors/auth-refresh-unavailable.error';
import { getAuthProviderFailureCode } from '../../../core/interceptors/auth-provider-failure';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { WorkspaceSettingsService } from '../../../shared/services/workspace/workspace-settings.service';
import type { ReviewCodeSelection } from '../../../replay/services/units-replay.service';
import {
  hasInvalidRegexFilter,
  matchesTextFilter
} from '../../../shared/utils/regex-filter.util';
import {
  getTrainingOptionMeta,
  getTrainingOptionTitle
} from '../../utils/coder-training-display';
import {
  ApplyTrainingDiscussionResultsDialogData,
  ApplyTrainingDiscussionResultsDialogComponent,
  ApplyTrainingDiscussionResultsDialogResult
} from './apply-training-discussion-results-dialog.component';
import { TrainingDiscussionApplySource } from '../../../../../../../api-dto/coding/training-discussion-apply.dto';
import {
  TrainingComparisonSummaryDto,
  TrainingComparisonSortBy,
  TrainingComparisonSortDirection
} from '../../../../../../../api-dto/coding/training-comparison.dto';

interface ReplayCodeSelectedMessage extends PostMessage {
  testPerson: string;
  unitId: string;
  variableId: string;
  code: string;
  score?: number | null;
  notes?: string | null;
  responseId?: number;
}

interface ReplayNotesCommittedMessage extends PostMessage {
  testPerson: string;
  unitId: string;
  variableId: string;
  notes?: string | null;
  responseId?: number;
}

export type CodingResultsComparisonMode = 'between-trainings' | 'within-training';

export interface CodingResultsComparisonDialogData {
  workspaceId: number;
  selectedTraining?: CoderTraining;
  initialMode?: CodingResultsComparisonMode;
}

interface ReplayDisplayOptions {
  showScore?: boolean;
  allowComments?: boolean;
  suppressGeneralInstructions?: boolean;
  reviewCodeSelections?: string;
}

interface ComparisonFilters {
  unitName: string;
  variableId: string;
  personLogin: string;
  personGroup: string;
  bookletName: string;
  match: 'all' | 'match' | 'differ';
  notesMode: NotesFilterMode;
}

type RegexComparisonFilterField = 'unitName' | 'variableId' | 'personLogin' | 'personGroup' | 'bookletName';

interface ComparisonWarning {
  icon: string;
  text: string;
  severity: 'info' | 'warn';
}

interface SelectedCodeSlot {
  code: string | null;
  hasEntry: boolean;
  trainingId?: number;
}

interface TrainingDiscussionRecoveryEntry {
  responseId: number;
  codeValue: string;
  score: number | null;
  notes: string;
}

interface TrainingDiscussionRecoveryDraft {
  workspaceId: number;
  trainingId: number;
  entries: TrainingDiscussionRecoveryEntry[];
}

interface ModalValueSummary {
  modalValue: string | null;
  deviationCount: number | null;
  validCount: number;
  isTie: boolean;
}

const EMPTY_COMPARISON_SUMMARY: TrainingComparisonSummaryDto = {
  visibleRows: 0,
  comparableRows: 0,
  matchingRows: 0,
  matchingPercentage: 0,
  incompleteRows: 0,
  notComparableRows: 0,
  deviationRows: 0,
  completionRate: 0
};

const TABLE_FILTER_DEBOUNCE_MS = 400;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-coding-results-comparison',
  templateUrl: './coding-results-comparison.component.html',
  styleUrls: ['./coding-results-comparison.component.scss'],
  standalone: true,
  providers: [TrainingReliabilityFacade, TrainingComparisonDataFacade],
  imports: [
    TrainingComparisonTableComponent,
    TrainingComparisonSelectionComponent,
    CommonModule,
    TranslateModule,
    FormsModule,
    MatDialogModule,
    MatProgressSpinner,
    MatButtonModule,
    MatIcon,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule
  ]
})
export class CodingResultsComparisonComponent implements OnInit, OnDestroy {
  protected readonly variableKey = variableKey;

  readonly permissions = inject(CodingPermissionsService);

  get canEditDiscussion(): boolean {
    if (!this.contextActive) return false;
    const training = this.getSelectedWithinTraining();
    return this.permissions.canApply || (!!training && this.permissions.canEdit(training));
  }

  protected dialogRef = inject<MatDialogRef<CodingResultsComparisonComponent>>(MatDialogRef);
  data = inject<CodingResultsComparisonDialogData>(MAT_DIALOG_DATA);
  private paginatorIntl = inject(MatPaginatorIntl);

  protected readonly onActionKeydown = activateOnKeyboard;

  private codingTrainingBackendService = inject(CodingTrainingBackendService);
  private translate = inject(TranslateService);
  private snackBar = inject(MatSnackBar);
  private codingStatisticsService = inject(CodingStatisticsService);
  private appService = inject(AppService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private postMessageService = inject(PostMessageService);
  private sessionRecoveryService = inject(SessionRecoveryService);
  private dialog = inject(MatDialog);
  private testPersonCodingService = inject(TestPersonCodingService);
  private ngUnsubscribe = new Subject<void>();
  private contextActive = true;
  private discussionContextId = 0;
  private tableFilterChanges$ = new Subject<string>();
  private coderTrainingsRequestId = 0;
  private hasInitializedBetweenCoderSelection = false;
  private hasInitializedWithinCoderSelection = false;
  private unregisterRecoveryProvider: (() => void) | null = null;
  private readonly trainingDiscussionRecoveryKey = 'training-discussion-active-state';

  private readonly comparisons = inject(TrainingComparisonDataFacade);
  readonly isLoading = this.comparisons.isLoading;
  private readonly reliability = inject(TrainingReliabilityFacade);
  readonly isLoadingKappa = this.reliability.isLoading;
  protected readonly isApplyingDiscussionResults = signal(false);
  dataSource = new MatTableDataSource<TrainingComparison | WithinTrainingComparison>([]);
  displayedColumns: string[] = ['index', 'unitVariable', 'personInfo', 'replay', 'givenAnswer', 'match'];
  protected dynamicCoderColumns: string[] = [];
  readonly availableTrainings = signal<CoderTraining[]>([]);
  private readonly trainingFilter = signal('');
  readonly filteredTrainings = computed(() => {
    const filter = this.trainingFilter();
    const trainings = this.availableTrainings();
    return filter ? trainings.filter(training => (
      `${training.label} ${training.id} ${this.getTrainingOptionMeta(training)}`.toLowerCase().includes(filter)
    )) : trainings;
  });

  readonly selectedTrainings = new SelectionModel<number>(true, []);
  private readonly trainingSelectionChange = toSignal(this.selectedTrainings.changed, { initialValue: null });
  private readonly comparisonDataState = signal<TrainingComparison[]>([]);

  get comparisonData(): TrainingComparison[] {
    return this.comparisonDataState();
  }

  set comparisonData(value: TrainingComparison[]) {
    this.comparisonDataState.set(value);
  }

  private readonly withinTrainingDataState = signal<WithinTrainingComparison[]>([]);
  get withinTrainingData(): WithinTrainingComparison[] { return this.withinTrainingDataState(); }
  set withinTrainingData(value: WithinTrainingComparison[]) { this.withinTrainingDataState.set(value); }
  private readonly comparisonModeState = signal<CodingResultsComparisonMode>('between-trainings');

  get comparisonMode(): CodingResultsComparisonMode {
    return this.comparisonModeState();
  }

  set comparisonMode(value: CodingResultsComparisonMode) {
    this.comparisonModeState.set(value);
  }

  // Scan result codes once per page; selection and label changes only filter the training list.
  private readonly trainingIdsWithCodes = computed(() => {
    const ids = new Set<number>();
    this.comparisonData.forEach(row => row.coders.forEach(coder => {
      if (coder.code !== null) ids.add(coder.trainingId);
    }));
    return ids;
  });

  private readonly selectedTrainingsWithoutCodes = computed(() => {
    if (this.comparisonMode !== 'between-trainings' || this.comparisonData.length === 0) {
      return [];
    }
    this.trainingSelectionChange();
    const idsWithCodes = this.trainingIdsWithCodes();
    return this.availableTrainings().filter(training => (
      this.selectedTrainings.isSelected(training.id) && !idsWithCodes.has(training.id)
    ));
  });

  selectedTrainingForWithin: number | null = null;

  availableCoders: Array<{ jobId: number; coderName: string }> = [];
  codersFormControl = new FormControl<number[]>([]);
  selectedCoderIds = new SelectionModel<number>(true, []);

  // For Between Trainings Mode
  availableCodersFromTrainings: Array<{ trainingId: number; trainingLabel: string; coderId: number; coderName: string }> = [];
  codersFromTrainingsFormControl = new FormControl<string[]>([]); // Storing composite keys like "trainingId_coderId"
  selectedCodersFromTrainings = new Set<string>();

  private readonly withinCoderSelection = toSignal(this.codersFormControl.valueChanges, { initialValue: this.codersFormControl.value });
  private readonly betweenCoderSelection = toSignal(this.codersFromTrainingsFormControl.valueChanges, { initialValue: this.codersFromTrainingsFormControl.value });
  private readonly comparisonSelection = computed<ComparisonSelection>(() => {
    this.trainingSelectionChange();
    return {
      mode: this.comparisonMode,
      trainingIds: [...this.selectedTrainings.selected],
      coderKeys: this.betweenCoderSelection() ?? [],
      jobIds: this.withinCoderSelection() ?? []
    };
  });

  protected readonly comparisonPresentations = computed(() => {
    const selection = this.comparisonSelection();
    const rows = selection.mode === 'between-trainings' ? this.comparisonData : this.withinTrainingData;
    return new Map(rows.map(row => [row, comparisonPresentation(row, selection)]));
  });

  protected getComparisonPresentation(row: TrainingComparison | WithinTrainingComparison) {
    return this.comparisonPresentations().get(row) ?? comparisonPresentation(row, this.comparisonSelection());
  }

  totalComparisons = 0;
  matchingComparisons = 0;
  matchingPercentage = 0;
  incompleteComparisons = 0;
  protected notComparableComparisons = 0;
  totalItems = 0;
  protected pageIndex = 0;
  protected pageSize = 50;
  protected sortBy: TrainingComparisonSortBy = 'unitName';
  protected sortDirection: TrainingComparisonSortDirection = 'asc';
  comparisonSummary: TrainingComparisonSummaryDto = { ...EMPTY_COMPARISON_SUMMARY };

  // Cohen's Kappa properties
  readonly kappaStatistics = this.reliability.statistics;

  readonly showKappaStatistics = signal(false);
  readonly useWeightedMean = this.reliability.useWeightedMean;
  readonly useCodeLevel = this.reliability.useCodeLevel; // true = code level, false = score level
  readonly isExportingReliability = this.reliability.isExporting;

  readonly originalKappaStatistics = this.reliability.originalStatistics;
  readonly variableKappaSummaries = this.reliability.variableKappaSummaries;

  readonly codingIssueLabelMap: Record<number, string> = {
    [-1]: 'coding.trainings.compare.issue-uncertain',
    [-2]: 'coding.trainings.compare.issue-new-code',
    [-3]: 'coding.trainings.compare.issue-invalid',
    [-4]: 'coding.trainings.compare.issue-technical'
  };

  readonly codingIssueShortLabelMap: Record<number, string> = {
    [-1]: 'coding.trainings.compare.issue-uncertain-short',
    [-2]: 'coding.trainings.compare.issue-new-code-short',
    [-3]: 'coding.trainings.compare.issue-invalid-short',
    [-4]: 'coding.trainings.compare.issue-technical-short'
  };

  private readonly standaloneCodingIssueOptionIds = new Set([-3, -4]);

  tableFilters: ComparisonFilters = {
    unitName: '',
    variableId: '',
    personLogin: '',
    personGroup: '',
    bookletName: '',
    match: 'all',
    notesMode: 'all'
  };

  readonly enableRegexSearch = signal(false);

  readonly discussionManagerLabel = signal('');
  readonly discussionCodeByResponseId = signal<Record<number, string>>({});
  readonly discussionScoreByResponseId = signal<Record<number, number | null>>({});
  readonly discussionNotesByResponseId = signal<Record<number, string>>({});
  readonly discussionErrorByResponseId = signal<Record<number, string>>({});
  readonly isSavingDiscussionByResponseId = signal<Record<number, boolean>>({});
  private pendingDiscussionNotesByResponseId: Record<number, string> = {};
  protected readonly emptyModalValueDisplay: ModalValueDisplay = {
    valueText: '-',
    deviationText: '-',
    tooltip: ''
  };

  protected setTrainingFilter(value: string): void {
    this.trainingFilter.set(value.toLowerCase());
  }

  protected get comparisonCoderColumns(): { id: string; label: string }[] {
    return this.dynamicCoderColumns.map(id => ({
      id,
      label: this.comparisonMode === 'between-trainings' ?
        this.getCoderFromTrainingColumnName(id.substring(6)) : this.getCoderName(+id.substring(6))
    }));
  }

  protected get comparisonTableRows(): ComparisonTableRow[] {
    return this.dataSource.filteredData.map(source => {
      const coders: ComparisonTableRow['coders'] = {};
      this.dynamicCoderColumns.forEach(column => {
        const key = column.substring(6);
        const coder = this.comparisonMode === 'between-trainings' ?
          this.getCoderFromTraining(source as TrainingComparison, key) : this.getCoderForWithin(source as WithinTrainingComparison, +key);
        coders[column] = coder && this.hasCoderDisplayData(coder) ? {
          code: this.getDisplayCodeText(coder.code, coder.codingIssueOption),
          score: coder.score,
          showScore: this.shouldShowScore(coder),
          issueLabel: this.hasCodingIssue(coder) ? this.getCodingIssueShortLabel(coder.codingIssueOption) : '',
          issueClass: this.getCodingIssueClass(coder),
          issueTooltip: this.getCodingIssueTooltip(coder),
          noteTooltip: this.hasCoderNote(coder) ? this.getCoderNoteTooltip(coder) : ''
        } : null;
      });
      return {
        source,
        status: this.getComparisonStatus(source),
        statusIcon: this.getComparisonStatusIcon(source),
        statusTooltip: this.getComparisonStatusTooltip(source),
        modalValue: (source as WithinTrainingComparison).modalValueDisplay || this.emptyModalValueDisplay,
        discussion: {
          editable: this.canEditDiscussion,
          code: this.discussionCodeByResponseId()[source.responseId] || '',
          score: this.discussionScoreByResponseId()[source.responseId] ?? null,
          notes: this.discussionNotesByResponseId()[source.responseId] || '',
          saving: this.isSavingDiscussionByResponseId()[source.responseId] ?? false,
          error: this.discussionErrorByResponseId()[source.responseId] || '',
          source: (source as WithinTrainingComparison).discussionSource ?? null
        },
        coders
      };
    });
  }

  constructor() {
    this.paginatorIntl.itemsPerPageLabel = this.translate.instant('paginator.itemsPerPageLabel');
    this.paginatorIntl.nextPageLabel = this.translate.instant('paginator.nextPageLabel');
    this.paginatorIntl.previousPageLabel = this.translate.instant('paginator.previousPageLabel');
    this.paginatorIntl.firstPageLabel = this.translate.instant('paginator.firstPageLabel');
    this.paginatorIntl.lastPageLabel = this.translate.instant('paginator.lastPageLabel');
    this.paginatorIntl.getRangeLabel = (page: number, pageSize: number, length: number) => {
      if (length === 0 || pageSize === 0) {
        return this.translate.instant('paginator.getRangeLabel', { startIndex: 0, endIndex: 0, length });
      }
      const effectiveLength = Math.max(length, 0);
      const startIndex = page * pageSize;
      const endIndex = startIndex < effectiveLength ? Math.min(startIndex + pageSize, effectiveLength) : startIndex + pageSize;
      return this.translate.instant('paginator.getRangeLabel', { startIndex: startIndex + 1, endIndex, length: effectiveLength });
    };
  }

  ngOnInit(): void {
    this.comparisons.loaded$.pipe(takeUntil(this.ngUnsubscribe)).subscribe(result => {
      if (result.mode === 'between-trainings') this.acceptBetweenComparison(result.page);
      else this.acceptWithinComparison(result.page);
    });
    this.comparisons.failed$.pipe(takeUntil(this.ngUnsubscribe)).subscribe(() => {
      this.snackBar.open(this.translate.instant('variable-analysis.error-loading-results'), this.translate.instant('common.close'), { duration: 3000 });
    });
    this.appService.selectedWorkspaceId$.pipe(
      filterWorkspace(workspaceId => workspaceId !== this.data.workspaceId),
      take(1),
      takeUntil(this.ngUnsubscribe)
    ).subscribe(() => {
      this.contextActive = false;
      this.coderTrainingsRequestId += 1;
      this.cancelComparisonRequest();
      this.invalidateDiscussionContext();
      this.reliability.reset();
      this.ngUnsubscribe.next();
      this.dialogRef.close();
    });
    if (!this.contextActive) return;
    this.reliability.downloads$.pipe(takeUntil(this.ngUnsubscribe)).subscribe(({ blob, trainingId }) => {
      this.downloadReliability(blob, trainingId);
    });
    this.reliability.errors$.pipe(takeUntil(this.ngUnsubscribe)).subscribe(kind => {
      const key = kind === 'load' ? 'coding.trainings.kappa.error' : 'coding.trainings.compare.reliability-export-error';
      this.snackBar.open(this.translate.instant(key), this.translate.instant('common.close'), { duration: 3000 });
    });
    this.permissions.load(this.data.workspaceId);
    this.unregisterRecoveryProvider = this.sessionRecoveryService.registerProvider({
      key: this.trainingDiscussionRecoveryKey,
      capture: () => this.createTrainingDiscussionRecoveryDraft()
    });
    this.sessionRecoveryService.restore$
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(() => this.restoreTrainingDiscussionRecoveryDraft());

    this.setupFilterPredicate();
    this.setupTableFilterChanges();
    this.discussionManagerLabel.set(this.appService.authData.userName || this.appService.loggedUser?.preferred_username || 'Diskussion');
    this.comparisonMode = this.data.initialMode || 'between-trainings';

    this.workspaceSettingsService.getEnableRegexSearch(this.data.workspaceId)
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(enabled => {
        const changed = this.enableRegexSearch() !== enabled;
        this.enableRegexSearch.set(enabled);
        if (changed) this.applyTableFilters();
      });

    this.loadCoderTrainings().then(() => {
      if (this.contextActive && this.data.selectedTraining) {
        this.comparisonMode = 'within-training';
        this.selectedTrainingForWithin = this.data.selectedTraining.id;
        this.loadComparison();
      }
    }).catch(() => {
      // Loading errors are already reported by loadCoderTrainings.
    });

    this.postMessageService.getMessages<ReplayCodeSelectedMessage>('replayCodeSelected')
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(msg => {
        this.handleReplayCodeSelected(msg.message);
      });

    this.postMessageService.getMessages<ReplayNotesCommittedMessage>('replayNotesCommitted')
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(msg => {
        this.handleReplayNotesCommitted(msg.message);
      });
  }

  ngOnDestroy(): void {
    this.contextActive = false;
    this.coderTrainingsRequestId += 1;
    this.invalidateDiscussionContext();
    this.unregisterRecoveryProvider?.();
    this.unregisterRecoveryProvider = null;
    this.cancelComparisonRequest();
    this.reliability.reset();
    this.ngUnsubscribe.next();
    this.tableFilterChanges$.complete();
    this.ngUnsubscribe.complete();
  }

  private cancelComparisonRequest(): void { this.comparisons.cancel(); }

  private getSelectedCoderResults(comparison: TrainingComparison | WithinTrainingComparison): ComparisonCoderResult[] {
    if (this.comparisonMode === 'between-trainings') {
      const selectedKeys = this.codersFromTrainingsFormControl.value || [];
      return selectedKeys
        .map(key => this.getCoderFromTraining(comparison as TrainingComparison, key))
        .filter((coder): coder is TrainingComparison['coders'][number] => !!coder);
    }

    const selectedJobIds = this.codersFormControl.value || [];
    return selectedJobIds
      .map(jobId => this.getCoderForWithin(comparison as WithinTrainingComparison, jobId))
      .filter((coder): coder is WithinTrainingComparison['coders'][number] => !!coder);
  }

  private rowHasNotes(comparison: TrainingComparison | WithinTrainingComparison): boolean {
    return this.getSelectedCoderResults(comparison)
      .some(coder => !!coder.notes && coder.notes.trim().length > 0);
  }

  private setupFilterPredicate(): void {
    this.dataSource.filterPredicate = (row: TrainingComparison | WithinTrainingComparison, filterJson: string): boolean => {
      const filters = JSON.parse(filterJson) as ComparisonFilters & { regexSearch?: boolean };
      const regexSearch = filters.regexSearch === true;

      if (!matchesTextFilter((row as TrainingComparison).unitName, filters.unitName, regexSearch)) {
        return false;
      }
      if (!matchesTextFilter((row as TrainingComparison).variableId, filters.variableId, regexSearch)) {
        return false;
      }
      if (!matchesTextFilter((row as TrainingComparison).personLogin, filters.personLogin, regexSearch)) {
        return false;
      }
      if (!matchesTextFilter((row as TrainingComparison).personGroup, filters.personGroup, regexSearch)) {
        return false;
      }
      if (!matchesTextFilter((row as TrainingComparison).bookletName, filters.bookletName, regexSearch)) {
        return false;
      }

      const comparisonStatus = this.getComparisonStatus(row);
      if (filters.match === 'match' && comparisonStatus !== 'match') {
        return false;
      }
      if (filters.match === 'differ' && comparisonStatus !== 'differ') {
        return false;
      }

      const hasNotes = this.rowHasNotes(row);
      if (filters.notesMode === 'none') return !hasNotes;
      if (filters.notesMode === 'with-notes') return hasNotes;

      return true;
    };
  }

  private setupTableFilterChanges(): void {
    this.tableFilterChanges$
      .pipe(
        debounceTime(TABLE_FILTER_DEBOUNCE_MS),
        distinctUntilChanged(),
        takeUntil(this.ngUnsubscribe)
      )
      .subscribe(() => this.applyTableFilters());
  }

  private getTableFilterSignature(): string {
    return JSON.stringify({
      ...this.tableFilters,
      regexSearch: this.enableRegexSearch()
    });
  }

  applyTableFilters(): void {
    if (this.hasInvalidTableRegexFilters()) {
      return;
    }

    this.reloadComparisonFirstPage();
  }

  onTextTableFilterChange(): void {
    this.tableFilterChanges$.next(this.getTableFilterSignature());
  }

  protected resetTableFilters(): void {
    this.tableFilters = {
      unitName: '',
      variableId: '',
      personLogin: '',
      personGroup: '',
      bookletName: '',
      match: 'all',
      notesMode: 'all'
    };
    this.applyTableFilters();
  }

  private getCurrentComparisonRows(): Array<TrainingComparison | WithinTrainingComparison> {
    return this.comparisonMode === 'between-trainings' ? this.comparisonData : this.withinTrainingData;
  }

  protected hasComparisonRows(): boolean {
    return this.getCurrentComparisonRows().length > 0;
  }

  getFilteredRowsCount(): number {
    return this.comparisonSummary.visibleRows;
  }

  protected hasActiveFilters(): boolean {
    return !!(
      this.tableFilters.unitName.trim() ||
      this.tableFilters.variableId.trim() ||
      this.tableFilters.personLogin.trim() ||
      this.tableFilters.personGroup.trim() ||
      this.tableFilters.bookletName.trim() ||
      this.tableFilters.match !== 'all' ||
      this.tableFilters.notesMode !== 'all'
    );
  }

  isTableRegexFilterInvalid(field: RegexComparisonFilterField): boolean {
    return hasInvalidRegexFilter(this.tableFilters[field], this.enableRegexSearch());
  }

  private hasInvalidTableRegexFilters(): boolean {
    return ([
      'unitName',
      'variableId',
      'personLogin',
      'personGroup',
      'bookletName'
    ] as RegexComparisonFilterField[]).some(field => this.isTableRegexFilterInvalid(field));
  }

  protected hasNoSelectedCodersState(): boolean {
    const hasAvailableCoders = this.comparisonMode === 'between-trainings' ?
      this.availableCodersFromTrainings.length > 0 :
      this.availableCoders.length > 0;
    return hasAvailableCoders && this.getSelectedComparisonSourceCount() === 0;
  }

  hasFilterEmptyState(): boolean {
    return (
      this.getSelectedComparisonSourceCount() > 0 &&
      this.hasActiveFilters() &&
      this.totalItems === 0
    );
  }

  protected hasKappaNoDoubleCodingState(): boolean {
    return this.kappaStatistics()?.workspaceSummary.totalDoubleCodedResponses === 0;
  }

  protected getSelectedWithinTraining(): CoderTraining | undefined {
    if (!this.selectedTrainingForWithin) {
      return undefined;
    }

    return this.availableTrainings().find(training => training.id === this.selectedTrainingForWithin) ||
      (this.data.selectedTraining?.id === this.selectedTrainingForWithin ? this.data.selectedTraining : undefined);
  }

  private formatTrainingList(trainings: CoderTraining[]): string {
    const visible = trainings.slice(0, 3).map(training => this.getTrainingOptionTitle(training));
    const remaining = trainings.length - visible.length;
    return remaining > 0 ? this.translate.instant('coding.trainings.compare.more-trainings', { trainings: visible.join(', '), count: remaining }) : visible.join(', ');
  }

  protected getComparisonWarnings(): ComparisonWarning[] {
    const warnings: ComparisonWarning[] = [];
    const selectedSourceCount = this.getSelectedComparisonSourceCount();

    if (this.totalItems === 0 && !this.hasNoSelectedCodersState()) {
      return warnings;
    }

    if (selectedSourceCount === 0) {
      warnings.push({
        icon: 'person_off',
        text: this.translate.instant('coding.trainings.compare.warning-no-coders'),
        severity: 'info'
      });
    } else if (selectedSourceCount === 1) {
      warnings.push({
        icon: 'person',
        text: this.translate.instant('coding.trainings.compare.warning-one-coder'),
        severity: 'warn'
      });
    }

    const trainingsWithoutCodes = this.selectedTrainingsWithoutCodes();
    if (trainingsWithoutCodes.length > 0) {
      warnings.push({
        icon: 'playlist_remove',
        text: this.translate.instant('coding.trainings.compare.warning-no-codes', { trainings: this.formatTrainingList(trainingsWithoutCodes) }),
        severity: 'warn'
      });
    }

    if (selectedSourceCount >= 2 && this.incompleteComparisons > 0) {
      warnings.push({
        icon: 'warning',
        text: this.translate.instant(
          this.incompleteComparisons === 1 ? 'coding.trainings.compare.warning-incomplete-one' :
            'coding.trainings.compare.warning-incomplete-many',
          { count: this.incompleteComparisons }
        ),
        severity: 'warn'
      });
    }

    if (
      this.comparisonMode === 'within-training' &&
      selectedSourceCount >= 2 &&
      this.withinTrainingData.length > 0 &&
      this.totalComparisons === 0 &&
      this.incompleteComparisons > 0
    ) {
      warnings.push({
        icon: 'pending_actions',
        text: this.translate.instant('coding.trainings.compare.warning-no-complete-pairs'),
        severity: 'warn'
      });
    }

    return warnings;
  }

  getCodingIssueLabel(codingIssueOption: number | null | undefined): string {
    if (codingIssueOption === null || codingIssueOption === undefined) {
      return '';
    }
    return this.translate.instant(this.codingIssueLabelMap[codingIssueOption] || 'coding.trainings.compare.issue-unknown', { count: codingIssueOption });
  }

  getCodingIssueShortLabel(codingIssueOption: number | null | undefined): string {
    if (codingIssueOption === null || codingIssueOption === undefined) {
      return '';
    }
    return this.translate.instant(this.codingIssueShortLabelMap[codingIssueOption] || 'coding.trainings.compare.issue-unknown', { count: codingIssueOption });
  }

  private getCoderSourceLabel(coder: ComparisonCoderResult): string {
    if ('trainingLabel' in coder) {
      return `${coder.trainingLabel} - ${coder.coderName}`;
    }

    return coder.coderName;
  }

  protected hasCoderNote(coder: Pick<ComparisonCoderResult, 'notes'> | null | undefined): boolean {
    return !!coder?.notes?.trim();
  }

  getCoderNoteTooltip(coder: ComparisonCoderResult): string {
    const note = coder.notes?.trim() || '';
    return note ? `${this.getCoderSourceLabel(coder)}: ${note}` : '';
  }

  protected hasCodingIssue(coder: Pick<ComparisonCoderResult, 'codingIssueOption'> | null | undefined): boolean {
    return !!this.getCodingIssueLabel(coder?.codingIssueOption);
  }

  getCodingIssueTooltip(coder: ComparisonCoderResult): string {
    const issue = this.getCodingIssueLabel(coder.codingIssueOption);
    return issue ? `${this.getCoderSourceLabel(coder)}: ${issue}` : '';
  }

  protected getCodingIssueClass(coder: Pick<ComparisonCoderResult, 'codingIssueOption'>): string {
    return coder.codingIssueOption === -1 || coder.codingIssueOption === -2 ?
      'coding-issue-review' :
      'coding-issue-info';
  }

  protected getCoderFromTraining(comparison: TrainingComparison, key: string) {
    const parts = key.split('_');
    if (parts.length !== 2) return undefined;
    const trainingId = parseInt(parts[0], 10);
    const coderId = parseInt(parts[1], 10);
    return comparison.coders.find(c => c.trainingId === trainingId && c.coderId === coderId);
  }

  protected getCoderForWithin(comparison: WithinTrainingComparison, jobId: number) {
    return comparison.coders.find(c => c.jobId === jobId);
  }

  private getSelectedComparisonSourceCount(): number {
    if (this.comparisonMode === 'between-trainings') {
      return (this.codersFromTrainingsFormControl.value || []).length;
    }

    return (this.codersFormControl.value || []).length;
  }

  private getSelectedCodeSlots(comparison: TrainingComparison | WithinTrainingComparison): SelectedCodeSlot[] {
    return selectedCodeSlots(comparison, this.comparisonSelection());
  }

  getComparisonStatus(comparison: TrainingComparison | WithinTrainingComparison): ComparisonStatus {
    return this.getComparisonPresentation(comparison).status;
  }

  protected getComparisonStatusIcon(comparison: TrainingComparison | WithinTrainingComparison): string {
    return this.getComparisonPresentation(comparison).icon;
  }

  protected getComparisonStatusTooltip(comparison: TrainingComparison | WithinTrainingComparison): string {
    return this.translate.instant(this.getComparisonPresentation(comparison).tooltipKey);
  }

  private sortCodeValues(values: string[]): string[] {
    return [...values].sort((a, b) => {
      const aNumber = Number(a);
      const bNumber = Number(b);
      const bothNumeric = Number.isFinite(aNumber) && Number.isFinite(bNumber);
      return bothNumeric ? aNumber - bNumber : a.localeCompare(b);
    });
  }

  private getModalValueSummary(comparison: TrainingComparison | WithinTrainingComparison): ModalValueSummary {
    const values = this.getSelectedCoderResults(comparison)
      .map(coder => coder.code)
      .filter((code): code is string => code !== null);

    if (values.length === 0) {
      return {
        modalValue: null,
        deviationCount: null,
        validCount: 0,
        isTie: false
      };
    }

    const counts = new Map<string, number>();
    values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));

    const maxCount = Math.max(...counts.values());
    const modalCandidates = this.sortCodeValues(
      Array.from(counts.entries())
        .filter(([, count]) => count === maxCount)
        .map(([value]) => value)
    );
    const modalValue = modalCandidates[0] ?? null;

    return {
      modalValue,
      deviationCount: modalValue === null ? null : values.length - maxCount,
      validCount: values.length,
      isTie: modalCandidates.length > 1
    };
  }

  private getModalValueText(summary: ModalValueSummary): string {
    if (summary.modalValue === null) {
      return '-';
    }

    return summary.isTie ? `${summary.modalValue}*` : summary.modalValue;
  }

  private getModalDeviationText(summary: ModalValueSummary): string {
    return summary.deviationCount === null ? '-' : summary.deviationCount.toString();
  }

  private getModalValueTooltip(summary: ModalValueSummary): string {
    if (summary.validCount === 0) {
      return this.translate.instant('coding.trainings.compare.modal-no-value-tooltip');
    }

    if (summary.isTie) {
      return this.translate.instant('coding.trainings.compare.modal-tie-tooltip');
    }

    return this.translate.instant('coding.trainings.compare.modal-value-tooltip');
  }

  private getModalValueDisplay(comparison: TrainingComparison | WithinTrainingComparison): ModalValueDisplay {
    const summary = this.getModalValueSummary(comparison);
    return {
      valueText: this.getModalValueText(summary),
      deviationText: this.getModalDeviationText(summary),
      tooltip: this.getModalValueTooltip(summary)
    };
  }

  private updateModalValueDisplays(): void {
    if (this.comparisonMode !== 'within-training') {
      return;
    }

    this.withinTrainingData.forEach(comparison => {
      comparison.modalValueDisplay = this.getModalValueDisplay(comparison);
    });
  }

  protected getDeviationComparisons(): number {
    return this.comparisonSummary.deviationRows;
  }

  protected getVisibleCompletionRate(): number {
    return this.comparisonSummary.completionRate;
  }

  getDisplayCodeText(code: string | null, issueOption?: number | null): string {
    const issue = this.getCodingIssueLabel(issueOption);
    if (code === null) {
      return issue || '-';
    }

    if (code === '-1' || code === '-2') {
      return issue || code;
    }

    return code;
  }

  shouldShowScore(coder: Pick<ComparisonCoderResult, 'code' | 'score' | 'codingIssueOption'>): boolean {
    if (coder.code === '-1' || coder.code === '-2') {
      return false;
    }

    if (coder.code === null && (coder.codingIssueOption === -1 || coder.codingIssueOption === -2)) {
      return false;
    }

    return coder.code !== null || coder.score !== null;
  }

  private hasCoderDisplayData(coder: ComparisonCoderResult | undefined): boolean {
    return !!coder && (
      coder.code !== null ||
      coder.score !== null ||
      this.hasCodingIssue(coder) ||
      this.hasCoderNote(coder)
    );
  }

  mapCodeForDisplay(code: string | number | null | undefined): string {
    if (code === null || code === undefined || code === '') {
      return '';
    }
    const codeNum = typeof code === 'string' ? parseInt(code, 10) : code;
    if (Number.isNaN(codeNum)) {
      return String(code);
    }
    if (codeNum === -1 || codeNum === -2) {
      return '';
    }
    return String(codeNum);
  }

  private getDiscussionScoreFromKnownCodes(comparison: WithinTrainingComparison, codeAsNumber: number): number | null {
    const matchedCoder = comparison.coders.find(c => c.code !== null && parseInt(c.code, 10) === codeAsNumber && c.score !== null);
    if (matchedCoder) {
      return matchedCoder.score;
    }

    if (comparison.replayCode !== null && comparison.replayCode !== undefined && comparison.replayCode === codeAsNumber) {
      return comparison.replayScore ?? null;
    }

    if (codeAsNumber < 0) {
      return 0;
    }

    return null;
  }

  protected onDiscussionCodeInput(comparison: TrainingComparison | WithinTrainingComparison, value: string): void {
    if (!this.canEditDiscussion) return;
    if (this.comparisonMode !== 'within-training') {
      return;
    }
    const responseId = (comparison as WithinTrainingComparison).responseId;
    this.discussionCodeByResponseId.update(current => ({ ...current, [responseId]: value }));
    this.discussionErrorByResponseId.update(current => ({ ...current, [responseId]: '' }));

    const codeAsNumber = parseInt(value, 10);
    if (Number.isNaN(codeAsNumber)) {
      this.discussionScoreByResponseId.update(current => ({ ...current, [responseId]: null }));
      return;
    }

    this.discussionScoreByResponseId.update(current => ({
      ...current,
      [responseId]: this.getDiscussionScoreFromKnownCodes(
        comparison as WithinTrainingComparison,
        codeAsNumber
      )
    }));
  }

  private parseDiscussionCode(value: string): number | null | undefined {
    const normalized = (value || '').trim();
    if (!normalized) {
      return null;
    }

    if (!/^-?\d+$/.test(normalized)) {
      return undefined;
    }

    return parseInt(normalized, 10);
  }

  private isUnchangedDiscussionValue(
    comparison: WithinTrainingComparison,
    parsedCode: number | null,
    score: number | null,
    notes: string | null,
    scoreOverride?: number | null
  ): boolean {
    if (scoreOverride !== undefined) {
      return false;
    }

    return parsedCode === (comparison.discussionCode ?? null) &&
      score === (comparison.discussionScore ?? null) &&
      notes === ((comparison.discussionNotes || '').trim() || null);
  }

  protected onDiscussionNotesInput(comparison: TrainingComparison | WithinTrainingComparison, value: string): void {
    if (!this.canEditDiscussion) return;
    if (this.comparisonMode !== 'within-training') {
      return;
    }
    const responseId = (comparison as WithinTrainingComparison).responseId;
    this.discussionNotesByResponseId.update(current => ({ ...current, [responseId]: value }));
    this.discussionErrorByResponseId.update(current => ({ ...current, [responseId]: '' }));
  }

  protected onDiscussionNotesBlur(comparison: TrainingComparison | WithinTrainingComparison): void {
    this.onDiscussionCodeBlur(comparison);
  }

  onDiscussionCodeBlur(
    comparison: TrainingComparison | WithinTrainingComparison,
    scoreOverride?: number | null
  ): void {
    if (!this.contextActive || !this.canEditDiscussion) return;
    if (this.comparisonMode !== 'within-training' || !this.selectedTrainingForWithin) {
      return;
    }

    const withinComparison = comparison as WithinTrainingComparison;
    const responseId = withinComparison.responseId;
    const rawValue = this.discussionCodeByResponseId()[responseId] || '';
    const parsedCode = this.parseDiscussionCode(rawValue);

    if (parsedCode === undefined) {
      this.discussionErrorByResponseId.update(current => ({ ...current, [responseId]: this.translate.instant('coding.trainings.compare.discussion-integer-required') }));
      this.snackBar.open(this.translate.instant('coding.trainings.compare.discussion-integer-required'), this.translate.instant('common.close'), { duration: 3000 });
      return;
    }

    const notes = (this.discussionNotesByResponseId()[responseId] || '').trim() || null;
    const trainingId = this.selectedTrainingForWithin;
    const contextId = this.discussionContextId;

    let score: number | null = null;
    if (parsedCode !== null) {
      score = scoreOverride !== undefined ?
        scoreOverride :
        this.getDiscussionScoreFromKnownCodes(withinComparison, parsedCode);
    }
    this.discussionErrorByResponseId.update(current => ({ ...current, [responseId]: '' }));

    if (this.isUnchangedDiscussionValue(withinComparison, parsedCode, score, notes, scoreOverride)) {
      this.discussionCodeByResponseId.update(current => ({ ...current, [responseId]: parsedCode !== null ? parsedCode.toString() : '' }));
      this.discussionScoreByResponseId.update(current => ({ ...current, [responseId]: withinComparison.discussionScore ?? null }));
      this.discussionNotesByResponseId.update(current => ({ ...current, [responseId]: withinComparison.discussionNotes || '' }));
      this.clearTrainingDiscussionRecoveryEntry(responseId);
      return;
    }

    this.isSavingDiscussionByResponseId.update(current => ({ ...current, [responseId]: true }));

    this.codingTrainingBackendService.saveDiscussionResult(
      this.data.workspaceId,
      trainingId,
      responseId,
      parsedCode,
      score,
      notes
    ).pipe(takeUntil(this.ngUnsubscribe))
      .subscribe({
        next: result => {
          if (!this.contextActive || contextId !== this.discussionContextId ||
            this.comparisonMode !== 'within-training' || this.selectedTrainingForWithin !== trainingId) {
            return;
          }
          const hasPendingNotes = Object.prototype.hasOwnProperty.call(
            this.pendingDiscussionNotesByResponseId,
            responseId
          );
          const pendingNotes = hasPendingNotes ?
            this.pendingDiscussionNotesByResponseId[responseId] :
            '';

          this.discussionCodeByResponseId.update(current => ({ ...current, [responseId]: result.code !== null ? result.code.toString() : '' }));
          this.discussionScoreByResponseId.update(current => ({ ...current, [responseId]: result.score }));
          this.discussionNotesByResponseId.update(current => ({ ...current, [responseId]: hasPendingNotes ? pendingNotes : result.notes || '' }));
          withinComparison.discussionCode = result.code;
          withinComparison.discussionScore = result.score;
          withinComparison.discussionNotes = result.notes;
          withinComparison.discussionManagerUserId = result.managerUserId;
          withinComparison.discussionManagerName = result.managerName;
          withinComparison.discussionSource = result.source;
          this.discussionErrorByResponseId.update(current => ({ ...current, [responseId]: '' }));
          if (result.managerName) {
            this.discussionManagerLabel.set(result.managerName);
          }
          this.isSavingDiscussionByResponseId.update(current => ({ ...current, [responseId]: false }));

          if (hasPendingNotes) {
            delete this.pendingDiscussionNotesByResponseId[responseId];
            const normalizedPendingNotes = pendingNotes.trim() || null;
            const normalizedSavedNotes = (result.notes || '').trim() || null;
            if (normalizedPendingNotes !== normalizedSavedNotes) {
              this.onDiscussionCodeBlur(withinComparison, result.score);
              return;
            }
          }
          this.clearTrainingDiscussionRecoveryEntry(responseId);
        },
        error: error => {
          if (!this.contextActive || contextId !== this.discussionContextId ||
            this.comparisonMode !== 'within-training' || this.selectedTrainingForWithin !== trainingId) {
            return;
          }
          this.isSavingDiscussionByResponseId.update(current => ({ ...current, [responseId]: false }));
          if (this.isRecoverableDiscussionAuthError(error)) {
            const message = error instanceof AuthRefreshUnavailableError || getAuthProviderFailureCode(error) ?
              this.translate.instant('error.auth_refresh_pending_save_message') :
              this.translate.instant('coding.trainings.compare.discussion-requires-login');
            this.discussionErrorByResponseId.update(current => ({ ...current, [responseId]: message }));
            const draft = this.createTrainingDiscussionRecoveryDraft();
            if (draft) {
              this.saveTrainingDiscussionRecoveryDraft(draft);
            }
            this.snackBar.open(message, this.translate.instant('common.close'), { duration: 4000 });
            return;
          }
          delete this.pendingDiscussionNotesByResponseId[responseId];
          const message = this.getDiscussionSaveErrorMessage(error);
          this.discussionErrorByResponseId.update(current => ({ ...current, [responseId]: message }));
          this.snackBar.open(message, this.translate.instant('common.close'), { duration: 4000 });
        }
      });
  }

  private getDiscussionSaveErrorMessage(error: unknown): string {
    const fallbackMessage = this.translate.instant('coding.trainings.compare.discussion-save-error');
    if (!(error instanceof HttpErrorResponse)) {
      return fallbackMessage;
    }

    const responseMessage = error.error?.message;
    const message = Array.isArray(responseMessage) ?
      responseMessage.join(' ') :
      responseMessage || error.message;

    if (typeof message !== 'string' || !message.trim()) {
      return fallbackMessage;
    }

    if (message.includes('Unsupported code for variable')) {
      return this.translate.instant('coding.trainings.compare.discussion-code-unknown');
    }

    if (message.includes('Unsupported missing code')) {
      return this.translate.instant('coding.trainings.compare.discussion-missing-code-unknown');
    }

    if (message.includes('Conflicting missing profiles')) {
      return this.translate.instant('coding.trainings.compare.discussion-conflicting-profiles');
    }

    if (message.includes('Missing profile') && message.includes('not found')) {
      return this.translate.instant('coding.trainings.compare.discussion-profile-unavailable');
    }

    if (message.includes('Coding scheme not found') || message.includes('Coding scheme variable not found')) {
      return this.translate.instant('coding.trainings.compare.discussion-score-unavailable');
    }

    if (message.includes('Discussion code must be an integer')) {
      return this.translate.instant('coding.trainings.compare.discussion-integer-required');
    }

    return message;
  }

  openApplyTrainingDiscussionResults(source: TrainingDiscussionApplySource): void {
    if (!this.permissions.canApply) return;
    if (this.comparisonMode !== 'within-training' || !this.selectedTrainingForWithin) {
      this.snackBar.open(this.translate.instant('coding.trainings.compare.training-required'), this.translate.instant('common.close'), { duration: 3000 });
      return;
    }

    const trainingId = this.selectedTrainingForWithin;
    this.isApplyingDiscussionResults.set(true);
    this.codingTrainingBackendService.previewApplyDiscussionResults(
      this.data.workspaceId,
      trainingId,
      source
    ).pipe(takeUntil(this.ngUnsubscribe))
      .subscribe({
        next: preview => {
          if (this.comparisonMode !== 'within-training' ||
            this.selectedTrainingForWithin !== trainingId) {
            this.isApplyingDiscussionResults.set(false);
            return;
          }
          this.isApplyingDiscussionResults.set(false);
          const dialogRef = this.dialog.open<ApplyTrainingDiscussionResultsDialogComponent, ApplyTrainingDiscussionResultsDialogData, ApplyTrainingDiscussionResultsDialogResult | undefined>(ApplyTrainingDiscussionResultsDialogComponent, {
            width: '720px',
            data: { preview, source }
          });

          dialogRef.afterClosed()
            .pipe(takeUntil(this.ngUnsubscribe))
            .subscribe(result => {
              if (!result ||
                this.comparisonMode !== 'within-training' ||
                this.selectedTrainingForWithin !== trainingId) {
                return;
              }
              this.applyTrainingDiscussionResults(source, result, trainingId);
            });
        },
        error: error => {
          if (this.comparisonMode !== 'within-training' ||
            this.selectedTrainingForWithin !== trainingId) {
            this.isApplyingDiscussionResults.set(false);
            return;
          }
          this.isApplyingDiscussionResults.set(false);
          this.snackBar.open(
            this.getApplyDiscussionResultsErrorMessage(error),
            this.translate.instant('common.close'),
            { duration: 4000 }
          );
        }
      });
  }

  private applyTrainingDiscussionResults(
    source: TrainingDiscussionApplySource,
    strategies: ApplyTrainingDiscussionResultsDialogResult,
    trainingId = this.selectedTrainingForWithin
  ): void {
    if (!this.permissions.canApply) return;
    if (!trainingId) {
      return;
    }

    this.isApplyingDiscussionResults.set(true);
    this.codingTrainingBackendService.applyDiscussionResults(
      this.data.workspaceId,
      trainingId,
      {
        source,
        existingResultStrategy: strategies.existingResultStrategy,
        jobConflictStrategy: strategies.jobConflictStrategy
      }
    ).pipe(takeUntil(this.ngUnsubscribe))
      .subscribe({
        next: result => {
          if (this.comparisonMode !== 'within-training' ||
            this.selectedTrainingForWithin !== trainingId) {
            this.isApplyingDiscussionResults.set(false);
            return;
          }
          this.isApplyingDiscussionResults.set(false);
          this.snackBar.open(
            this.getApplyDiscussionResultsMessage(result),
            this.translate.instant('common.close'),
            { duration: 5000 }
          );
          if (result.updatedResponsesCount > 0 || result.removedJobUnitCount > 0) {
            this.testPersonCodingService.notifyTestResultsChanged({
              workspaceId: this.data.workspaceId,
              statisticsVersion: 'v2'
            });
          }
          this.loadComparison();
        },
        error: error => {
          if (this.comparisonMode !== 'within-training' ||
            this.selectedTrainingForWithin !== trainingId) {
            this.isApplyingDiscussionResults.set(false);
            return;
          }
          this.isApplyingDiscussionResults.set(false);
          this.snackBar.open(
            this.getApplyDiscussionResultsErrorMessage(error),
            this.translate.instant('common.close'),
            { duration: 5000 }
          );
        }
      });
  }

  private getApplyDiscussionResultsMessage(result: {
    success: boolean;
    updatedResponsesCount: number;
    skippedExistingResultsCount: number;
    overwrittenExistingResultsCount: number;
    skippedJobConflictCount: number;
    skippedMissingScoreCount: number;
    removedJobUnitCount: number;
  }): string {
    if (!result.success) {
      return this.translate.instant('coding.trainings.compare.apply-error');
    }

    const parts = [this.translate.instant('coding.trainings.compare.apply-updated', { count: result.updatedResponsesCount })];
    if (result.overwrittenExistingResultsCount > 0) {
      parts.push(this.translate.instant('coding.trainings.compare.apply-overwritten', { count: result.overwrittenExistingResultsCount }));
    }
    if (result.skippedExistingResultsCount > 0) {
      parts.push(this.translate.instant('coding.trainings.compare.apply-skipped-existing', { count: result.skippedExistingResultsCount }));
    }
    if (result.skippedJobConflictCount > 0) {
      parts.push(this.translate.instant('coding.trainings.compare.apply-skipped-conflicts', { count: result.skippedJobConflictCount }));
    }
    if (result.skippedMissingScoreCount > 0) {
      parts.push(this.translate.instant('coding.trainings.compare.apply-skipped-scores', { count: result.skippedMissingScoreCount }));
    }
    if (result.removedJobUnitCount > 0) {
      parts.push(this.translate.instant('coding.trainings.compare.apply-removed-jobs', { count: result.removedJobUnitCount }));
    }

    return `${parts.join(', ')}.`;
  }

  private getApplyDiscussionResultsErrorMessage(error: unknown): string {
    const fallbackMessage = this.translate.instant('coding.trainings.compare.apply-error');
    if (!(error instanceof HttpErrorResponse)) {
      return fallbackMessage;
    }

    const responseMessage = error.error?.message;
    const message = Array.isArray(responseMessage) ?
      responseMessage.join(' ') :
      responseMessage || error.message;

    return typeof message === 'string' && message.trim() ?
      message :
      fallbackMessage;
  }

  private initDiscussionValues(data: WithinTrainingComparison[]): void {
    const codes: Record<number, string> = {};
    const scores: Record<number, number | null> = {};
    const notes: Record<number, string> = {};
    this.discussionErrorByResponseId.set({});
    this.isSavingDiscussionByResponseId.set({});
    this.pendingDiscussionNotesByResponseId = {};

    const persistedManager = data.find(item => !!item.discussionManagerName)?.discussionManagerName;
    if (persistedManager) {
      this.discussionManagerLabel.set(persistedManager);
    }

    data.forEach(item => {
      if (item.discussionCode !== null && item.discussionCode !== undefined) {
        codes[item.responseId] = this.mapCodeForDisplay(item.discussionCode.toString());
        scores[item.responseId] = item.discussionScore ?? this.getDiscussionScoreFromKnownCodes(item, item.discussionCode);
        notes[item.responseId] = item.discussionNotes || '';
      } else {
        codes[item.responseId] = '';
        scores[item.responseId] = null;
        notes[item.responseId] = '';
      }
    });
    this.discussionCodeByResponseId.set(codes);
    this.discussionScoreByResponseId.set(scores);
    this.discussionNotesByResponseId.set(notes);
  }

  private isRecoverableDiscussionAuthError(error: unknown): boolean {
    return error instanceof AuthRefreshUnavailableError || !!getAuthProviderFailureCode(error) || this.appService.needsReAuthentication ||
      (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403));
  }

  openReplay(comparison: TrainingComparison | WithinTrainingComparison): void {
    const responseId = (comparison as WithinTrainingComparison).responseId || (comparison as TrainingComparison).responseId;
    if (!responseId) {
      return;
    }

    const workspaceId = this.data.workspaceId;

    this.codingStatisticsService.getReplayUrl(workspaceId, responseId)
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe({
        next: result => {
          if (result.replayUrl) {
            window.open(this.buildReplayUrl(
              result.replayUrl,
              responseId,
              this.getReplayDisplayOptions(comparison)
            ), '_blank');
          } else {
            this.snackBar.open(this.translate.instant('coding.trainings.compare.replay-url-error'), this.translate.instant('common.close'), { duration: 3000 });
          }
        },
        error: () => {
          this.snackBar.open(this.translate.instant('coding.trainings.compare.replay-open-error'), this.translate.instant('common.close'), { duration: 3000 });
        }
      });
  }

  private getReplayDisplayOptions(comparison?: TrainingComparison | WithinTrainingComparison): ReplayDisplayOptions {
    const reviewCodeSelections = comparison ? this.serializeReviewCodeSelections(comparison) : undefined;
    if (this.comparisonMode !== 'within-training') {
      return { reviewCodeSelections };
    }

    const selectedTraining = this.getSelectedWithinTraining();
    if (!selectedTraining) {
      return { reviewCodeSelections };
    }

    return {
      showScore: selectedTraining.show_score ?? false,
      allowComments: selectedTraining.allow_comments ?? true,
      suppressGeneralInstructions: selectedTraining.suppress_general_instructions ?? false,
      reviewCodeSelections
    };
  }

  private serializeReviewCodeSelections(comparison: TrainingComparison | WithinTrainingComparison): string | undefined {
    const selections = this.getReviewCodeSelections(comparison);
    return selections.length > 0 ? JSON.stringify(selections) : undefined;
  }

  private getReviewCodeSelections(comparison: TrainingComparison | WithinTrainingComparison): ReviewCodeSelection[] {
    const coderNamesByCode = new Map<number, string[]>();

    comparison.coders.forEach(coder => {
      const coderName = this.getCoderSourceLabel(coder);
      this.getReviewSelectionCodes(coder).forEach(code => {
        const coderNames = coderNamesByCode.get(code) || [];
        if (!coderNames.includes(coderName)) {
          coderNames.push(coderName);
        }
        coderNamesByCode.set(code, coderNames);
      });
    });

    return Array.from(coderNamesByCode.entries())
      .sort(([codeA], [codeB]) => codeA - codeB)
      .map(([code, coderNames]) => ({ code, coderNames }));
  }

  private getReviewSelectionCodes(coder: ComparisonCoderResult): number[] {
    if (
      coder.codingIssueOption !== null &&
      coder.codingIssueOption !== undefined &&
      this.standaloneCodingIssueOptionIds.has(coder.codingIssueOption)
    ) {
      return [coder.codingIssueOption];
    }

    const codes = new Set<number>();
    const code = this.parseReviewCode(coder.code);
    if (code !== null) {
      codes.add(code);
    }
    if (coder.codingIssueOption !== null && coder.codingIssueOption !== undefined) {
      codes.add(coder.codingIssueOption);
    }
    return Array.from(codes);
  }

  private parseReviewCode(code: string | null): number | null {
    const trimmedCode = code?.trim();
    if (!trimmedCode) {
      return null;
    }

    const parsedCode = Number(trimmedCode);
    return Number.isFinite(parsedCode) ? parsedCode : null;
  }

  private buildReplayUrl(
    replayUrl: string,
    responseId: number,
    displayOptions: ReplayDisplayOptions = {}
  ): string {
    const [baseUrl, fragment = ''] = replayUrl.split('#', 2);
    const appendParams = (value: string): string => {
      const [path, query = ''] = value.split('?', 2);
      const params = new URLSearchParams(query);
      params.set('mode', 'coding-decision');
      params.set('decisionReadOnly', String(this.comparisonMode !== 'within-training' || !this.canEditDiscussion));
      params.set('originResponseId', responseId.toString());
      if (displayOptions.showScore !== undefined) {
        params.set('showScore', String(displayOptions.showScore));
      }
      if (displayOptions.allowComments !== undefined) {
        params.set('allowComments', String(displayOptions.allowComments));
      }
      if (displayOptions.suppressGeneralInstructions !== undefined) {
        params.set('suppressGeneralInstructions', String(displayOptions.suppressGeneralInstructions));
      }
      if (displayOptions.reviewCodeSelections) {
        params.set('reviewCodeSelections', displayOptions.reviewCodeSelections);
      }
      const serializedParams = params.toString();
      return serializedParams ? `${path}?${serializedParams}` : path;
    };

    if (fragment) {
      return `${baseUrl}#${appendParams(fragment)}`;
    }

    return appendParams(baseUrl);
  }

  loadCoderTrainings(): Promise<void> {
    return new Promise((resolve, reject) => {
      const workspaceId = this.data.workspaceId;
      if (!workspaceId) {
        reject();
        return;
      }

      this.coderTrainingsRequestId += 1;
      const requestId = this.coderTrainingsRequestId;
      this.codingTrainingBackendService.getCoderTrainings(workspaceId)
        .pipe(takeUntil(this.ngUnsubscribe))
        .subscribe({
          next: trainings => {
            if (requestId !== this.coderTrainingsRequestId ||
              workspaceId !== this.data.workspaceId) {
              return;
            }
            this.availableTrainings.set([...trainings]);
            this.trainingFilter.set('');
            resolve();
          },
          error: () => {
            if (requestId !== this.coderTrainingsRequestId ||
              workspaceId !== this.data.workspaceId) {
              return;
            }
            this.snackBar.open(this.translate.instant('coding.trainings.loading.error'), this.translate.instant('common.close'), { duration: 3000 });
            reject();
          }
        });
    });
  }

  getTrainingOptionTitle(training: CoderTraining): string {
    return getTrainingOptionTitle(training);
  }

  getTrainingOptionMeta(training: CoderTraining): string {
    return getTrainingOptionMeta(training, this.translate.instant('coding.trainings.compare.coder'), this.translate.instant('coding.trainings.compare.coder'));
  }

  getTrainingCoderOptionLabel(coder: { trainingId: number; trainingLabel: string; coderName: string }): string {
    return this.translate.instant('coding.trainings.compare.training-coder', { training: coder.trainingLabel, id: coder.trainingId, coder: coder.coderName });
  }

  private invalidateDiscussionContext(): void {
    // A -> B -> A is a different editing session. Accepted server writes may
    // finish, but their responses cannot replace drafts in the new cohort.
    this.discussionContextId += 1;
    this.isSavingDiscussionByResponseId.set({});
    this.pendingDiscussionNotesByResponseId = {};
  }

  onModeChange(): void {
    this.invalidateDiscussionContext();
    this.cancelComparisonRequest();
    this.reliability.reset();
    this.selectedTrainings.clear();
    this.trainingFilter.set('');
    this.selectedTrainingForWithin = null;
    this.comparisonData = [];
    this.withinTrainingData = [];
    this.availableCoders = [];
    this.availableCodersFromTrainings = [];
    this.codersFormControl.setValue([]);
    this.codersFromTrainingsFormControl.setValue([]);
    this.hasInitializedBetweenCoderSelection = false;
    this.hasInitializedWithinCoderSelection = false;
    this.selectedCodersFromTrainings.clear();
    this.selectedCoderIds.clear();
    this.dataSource.data = [];
    this.resetTableFilters();
    this.updateDisplayedColumns();
  }

  protected onTrainingSelectionChange(): void {
    this.invalidateDiscussionContext();
    this.reliability.reset();
    this.hasInitializedBetweenCoderSelection = false;
    this.codersFromTrainingsFormControl.setValue([]);
    this.selectedCodersFromTrainings.clear();
    if (this.comparisonMode === 'between-trainings' && this.selectedTrainings.selected.length >= 2) {
      this.clearComparisonRows();
      this.reloadComparisonFirstPage();
    } else {
      this.cancelComparisonRequest();
      this.hasInitializedBetweenCoderSelection = false;
      this.clearComparisonRows();
      this.availableCodersFromTrainings = [];
      this.updateDisplayedColumns();
    }
  }

  protected onTrainingForWithinChange(): void {
    this.invalidateDiscussionContext();
    this.reliability.reset();
    this.hasInitializedWithinCoderSelection = false;
    if (this.comparisonMode === 'within-training' && this.selectedTrainingForWithin) {
      this.availableCoders = [];
      this.codersFormControl.setValue([]);
      this.selectedCoderIds.clear();
      this.updateDisplayedColumns();
      this.clearComparisonRows();
      this.reloadComparisonFirstPage();
    } else {
      this.cancelComparisonRequest();
      this.clearComparisonRows();
      this.availableCoders = [];
      this.codersFormControl.setValue([]);
      this.selectedCoderIds.clear();
      this.updateDisplayedColumns();
    }
  }

  private updateDisplayedColumns(): void {
    const baseColumns = ['index', 'unitVariable', 'personInfo', 'replay', 'givenAnswer'];
    this.dynamicCoderColumns = [];

    if (this.comparisonMode === 'between-trainings') {
      // Generate columns for selected coders
      this.availableCodersFromTrainings.forEach(coder => {
        const key = `${coder.trainingId}_${coder.coderId}`;
        if (this.selectedCodersFromTrainings.has(key)) {
          this.dynamicCoderColumns.push(`coder_${key}`);
        }
      });

      this.displayedColumns = [...baseColumns, 'match', ...this.dynamicCoderColumns];
    } else if (this.comparisonMode === 'within-training') {
      if (this.selectedTrainingForWithin && this.withinTrainingData.length > 0) {
        // Filter columns based on selected coders
        const selectedCoderIds = this.codersFormControl.value || [];
        this.dynamicCoderColumns = selectedCoderIds.map(jobId => `coder_${jobId}`);
        this.displayedColumns = [...baseColumns, 'match', 'modalValue', ...this.dynamicCoderColumns, 'discussion'];
      } else {
        this.displayedColumns = [...baseColumns, 'match', 'modalValue', 'discussion'];
      }
    }
  }

  protected onCodersFromTrainingsSelectionChange(): void {
    this.invalidateDiscussionContext();
    const selectedKeys = this.codersFromTrainingsFormControl.value || [];
    this.hasInitializedBetweenCoderSelection = true;
    this.selectedCodersFromTrainings = new Set(selectedKeys);
    this.updateDisplayedColumns();
    this.reloadComparisonFirstPage();
  }

  protected getCoderFromTrainingColumnName(key: string): string {
    const parts = key.split('_');
    if (parts.length !== 2) return key;
    const trainingId = parseInt(parts[0], 10);
    const coderId = parseInt(parts[1], 10);
    const coder = this.availableCodersFromTrainings.find(c => c.trainingId === trainingId && c.coderId === coderId);
    return coder ? `${coder.trainingLabel} - ${coder.coderName}` : key;
  }

  protected getCoderName(jobId: number): string {
    const coder = this.availableCoders.find(c => c.jobId === jobId);
    return coder ? coder.coderName : this.translate.instant('coding.trainings.compare.coder-number', { id: jobId });
  }

  getCoderFromTrainingCode(comparison: TrainingComparison, key: string): string | null {
    const parts = key.split('_');
    if (parts.length !== 2) return null;
    const trainingId = parseInt(parts[0], 10);
    const coderId = parseInt(parts[1], 10);
    const coder = comparison.coders.find(c => c.trainingId === trainingId && c.coderId === coderId);
    return coder ? coder.code : null;
  }

  getCoderFromTrainingScore(comparison: TrainingComparison, key: string): number | null {
    const parts = key.split('_');
    if (parts.length !== 2) return null;
    const trainingId = parseInt(parts[0], 10);
    const coderId = parseInt(parts[1], 10);
    const coder = comparison.coders.find(c => c.trainingId === trainingId && c.coderId === coderId);
    return coder ? coder.score : null;
  }

  protected hasCoderFromTrainingDisplayData(comparison: TrainingComparison, key: string): boolean {
    const parts = key.split('_');
    if (parts.length !== 2) return false;
    const trainingId = parseInt(parts[0], 10);
    const coderId = parseInt(parts[1], 10);
    const coder = comparison.coders.find(c => c.trainingId === trainingId && c.coderId === coderId);
    return this.hasCoderDisplayData(coder);
  }

  private applyComparisonSummary(summary: TrainingComparisonSummaryDto, total: number): void {
    this.comparisonSummary = summary;
    this.totalItems = total;
    this.totalComparisons = summary.comparableRows;
    this.matchingComparisons = summary.matchingRows;
    this.matchingPercentage = summary.matchingPercentage;
    this.incompleteComparisons = summary.incompleteRows;
    this.notComparableComparisons = summary.notComparableRows;
  }

  private resetComparisonSummary(): void {
    this.applyComparisonSummary({ ...EMPTY_COMPARISON_SUMMARY }, 0);
  }

  calculateStatistics(): void {
    const data = this.dataSource.data;
    if (this.totalItems === 0 && this.comparisonSummary.visibleRows === 0 && data.length > 0) {
      const statuses = data.map(item => this.getComparisonStatus(item));
      const total = statuses.filter(status => status === 'match' || status === 'differ').length;
      const matching = statuses.filter(status => status === 'match').length;
      this.applyComparisonSummary({
        visibleRows: data.length,
        comparableRows: total,
        matchingRows: matching,
        matchingPercentage: total > 0 ? Math.round((matching / total) * 100) : 0,
        incompleteRows: statuses.filter(status => status === 'incomplete').length,
        notComparableRows: statuses.filter(status => status === 'not_comparable').length,
        deviationRows: Math.max(total - matching, 0),
        completionRate: data.length > 0 ? Math.round((total / data.length) * 100) : 0
      }, data.length);
      return;
    }

    this.applyComparisonSummary(this.comparisonSummary, this.totalItems);
  }

  private countSelectedCodes(comparison: TrainingComparison | WithinTrainingComparison): number {
    return this.getSelectedCodeSlots(comparison).filter(slot => slot.code !== null).length;
  }

  areCodesTheSame(comparison: TrainingComparison | WithinTrainingComparison): boolean {
    return this.getComparisonStatus(comparison) === 'match';
  }

  hasAnyCode(comparison: TrainingComparison | WithinTrainingComparison): boolean {
    return this.countSelectedCodes(comparison) > 0;
  }

  private refreshDisplayedRows(): void {
    this.updateModalValueDisplays();

    if (this.getSelectedComparisonSourceCount() === 0) {
      this.dataSource.data = [];
    } else if (this.comparisonMode === 'between-trainings') {
      this.dataSource.data = this.comparisonData;
    } else {
      this.dataSource.data = this.withinTrainingData;
    }
  }

  private canLoadCurrentComparison(): boolean {
    return (
      (this.comparisonMode === 'between-trainings' && this.selectedTrainings.selected.length >= 2) ||
      (this.comparisonMode === 'within-training' && !!this.selectedTrainingForWithin)
    );
  }

  private getComparisonQueryOptions() {
    const baseOptions = {
      page: this.pageIndex + 1,
      limit: this.pageSize,
      sortBy: this.sortBy,
      sortDirection: this.sortDirection,
      filters: {
        ...this.tableFilters,
        regexSearch: this.enableRegexSearch()
      }
    };

    if (this.comparisonMode === 'between-trainings') {
      return {
        ...baseOptions,
        selectedCoderKeys: this.hasInitializedBetweenCoderSelection ?
          (this.codersFromTrainingsFormControl.value || []) :
          undefined
      };
    }

    return {
      ...baseOptions,
      selectedJobIds: this.hasInitializedWithinCoderSelection ?
        (this.codersFormControl.value || []) :
        undefined
    };
  }

  private clearComparisonRows(): void {
    this.comparisonData = [];
    this.withinTrainingData = [];
    this.dataSource.data = [];
    this.resetComparisonSummary();
  }

  private reloadComparisonFirstPage(): void {
    this.pageIndex = 0;

    if (this.canLoadCurrentComparison()) {
      this.loadComparison();
      return;
    }

    this.clearComparisonRows();
  }

  protected onComparisonPageChange(event: PageEvent): void {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    if (this.canLoadCurrentComparison()) {
      this.loadComparison();
    }
  }

  protected onComparisonSortChange(sort: Sort): void {
    if (this.isSupportedComparisonSort(sort.active) && sort.direction) {
      this.sortBy = sort.active;
      this.sortDirection = sort.direction;
    } else {
      this.sortBy = 'unitName';
      this.sortDirection = 'asc';
    }
    this.reloadComparisonFirstPage();
  }

  private isSupportedComparisonSort(sortBy: string): sortBy is TrainingComparisonSortBy {
    return [
      'responseId',
      'unitName',
      'variableId',
      'personLogin',
      'personGroup',
      'bookletName'
    ].includes(sortBy);
  }

  loadComparison(): void {
    if (!this.contextActive) return;
    const mode = this.comparisonMode;
    if (mode === 'between-trainings' && this.selectedTrainings.selected.length < 2) {
      this.snackBar.open(this.translate.instant('coding.trainings.compare.notEnough'), this.translate.instant('common.close'), { duration: 3000 });
      return;
    }
    if (mode === 'within-training' && !this.selectedTrainingForWithin) {
      this.snackBar.open(this.translate.instant('coding.trainings.select-training'), this.translate.instant('common.close'), { duration: 3000 });
      return;
    }
    this.resetKappaState();
    const trainingIds = [...this.selectedTrainings.selected];
    const trainingId = this.selectedTrainingForWithin;
    this.comparisons.load({
      workspaceId: this.data.workspaceId,
      options: this.getComparisonQueryOptions(),
      ...(mode === 'between-trainings' ? { mode, trainingIds } : { mode, trainingId: trainingId! }),
      isCurrent: () => this.contextActive && this.comparisonMode === mode && (mode === 'between-trainings' ?
        this.selectedTrainings.selected.join(',') === trainingIds.join(',') : this.selectedTrainingForWithin === trainingId)
    });
  }

  private acceptBetweenComparison(response: TrainingCodingComparisonPageDto): void {
    this.comparisonData = response.data;
    this.availableCodersFromTrainings = response.availableCoders;
    this.applyComparisonSummary(response.summary, response.total);
    const previousSelection = this.codersFromTrainingsFormControl.value || [];
    const allKeys = this.availableCodersFromTrainings.map(c => `${c.trainingId}_${c.coderId}`);
    let newSelection: string[];
    if (!this.hasInitializedBetweenCoderSelection) {
      newSelection = allKeys;
      this.hasInitializedBetweenCoderSelection = true;
    } else {
      const currentlySelectedTrainings = new Set(previousSelection.map(key => key.split('_')[0]));
      newSelection = allKeys.filter(key => {
        const [trainingId] = key.split('_');
        return previousSelection.includes(key) || !currentlySelectedTrainings.has(trainingId);
      });
    }
    this.codersFromTrainingsFormControl.setValue(newSelection);
    this.selectedCodersFromTrainings = new Set(newSelection);
    this.updateDisplayedColumns();
    this.refreshDisplayedRows();
  }

  private acceptWithinComparison(response: WithinTrainingCodingComparisonPageDto): void {
    this.availableCoders = response.availableCoders;
    this.applyComparisonSummary(response.summary, response.total);
    const data = response.data;
    const mappedData: WithinTrainingComparison[] = data.map(item => ({ ...item, testperson: item.testPerson }));

    if (this.availableCoders.length > 0) {
      const allCoderIds = this.availableCoders.map(c => c.jobId);
      const currentSelection = this.codersFormControl.value || [];
      const selectedIds = this.hasInitializedWithinCoderSelection ?
        currentSelection.filter(jobId => allCoderIds.includes(jobId)) :
        allCoderIds;
      this.hasInitializedWithinCoderSelection = true;
      this.codersFormControl.setValue(selectedIds);
      this.selectedCoderIds.setSelection(...selectedIds);
    } else {
      this.codersFormControl.setValue([]);
      this.selectedCoderIds.clear();
      this.hasInitializedWithinCoderSelection = true;
    }
    this.withinTrainingData = mappedData;
    this.initDiscussionValues(mappedData);
    this.updateDisplayedColumns();
    this.refreshDisplayedRows();
    this.restoreTrainingDiscussionRecoveryDraft();
    if (this.showKappaStatistics()) {
      this.loadKappaStatistics();
    }
  }

  protected onCoderSelectionChange(): void {
    this.invalidateDiscussionContext();
    this.reliability.reset();
    const selectedIds = this.codersFormControl.value || [];
    this.hasInitializedWithinCoderSelection = true;
    this.selectedCoderIds.clear();
    this.selectedCoderIds.select(...selectedIds);
    this.updateDisplayedColumns();
    this.reloadComparisonFirstPage();
  }

  getCoderCode(comparison: WithinTrainingComparison, jobId: number): string | null {
    const coder = comparison.coders.find(c => c.jobId === jobId);
    return coder ? coder.code : null;
  }

  getCoderScore(comparison: WithinTrainingComparison, jobId: number): number | null {
    const coder = comparison.coders.find(c => c.jobId === jobId);
    return coder ? coder.score : null;
  }

  protected hasCoderDisplayDataForWithin(comparison: WithinTrainingComparison, jobId: number): boolean {
    const coder = comparison.coders.find(c => c.jobId === jobId);
    return this.hasCoderDisplayData(coder);
  }

  applyFilter(event: Event): void {
    this.tableFilters.unitName = (event.target as HTMLInputElement)?.value?.trim() || '';
    this.applyTableFilters();
  }

  applyTrainingFilter(event: Event): void {
    const value = ((event.target as HTMLInputElement)?.value || '').trim().toLowerCase();
    this.trainingFilter.set(value);
  }

  trackByCoder(index: number, coder: { jobId: number; coderName: string }): number {
    return coder.jobId;
  }

  private reliabilityContext(): TrainingReliabilityContext | null {
    if (this.comparisonMode !== 'within-training' || !this.selectedTrainingForWithin) return null;
    return {
      workspaceId: this.data.workspaceId,
      trainingId: this.selectedTrainingForWithin,
      weighted: this.useWeightedMean(),
      level: this.useCodeLevel() ? 'code' : 'score',
      coderIds: [...(this.codersFormControl.value || [])]
    };
  }

  private isCurrentReliabilityContext(context: TrainingReliabilityContext): boolean {
    return this.comparisonMode === 'within-training' && this.selectedTrainingForWithin === context.trainingId;
  }

  loadKappaStatistics(): void {
    const context = this.reliabilityContext();
    if (!context) { this.reliability.reset(); return; }
    this.reliability.load(context, () => this.isCurrentReliabilityContext(context));
  }

  exportTrainingReliability(): void {
    if (
      this.comparisonMode !== 'within-training' ||
      !this.selectedTrainingForWithin ||
      !this.kappaStatistics() ||
      this.isExportingReliability()
    ) {
      return;
    }

    const context = this.reliabilityContext();
    if (!context) return;
    this.reliability.exportCsv(context, () => this.isCurrentReliabilityContext(context));
  }

  private downloadReliability(blob: Blob, trainingId: number): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `interrater-reliability-training-${trainingId}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  setWeightingMethod(weighted: boolean): void {
    this.reliability.setWeightingMethod(weighted);
  }

  setCalculationLevel(codeLevel: boolean): void {
    this.reliability.setCalculationLevel(codeLevel);
  }

  private buildVariableSummaryKey(unitName: string, variableId: string): string {
    return `${unitName}::${variableId}`;
  }

  protected getVariableSummary(variable: Pick<KappaVariable, 'unitName' | 'variableId'>): VariableKappaSummary | undefined {
    const key = this.buildVariableSummaryKey(variable.unitName, variable.variableId);
    return this.variableKappaSummaries().find(summary => summary.key === key);
  }

  protected getVariableLabel(variable: Pick<KappaVariable, 'unitName' | 'variableId'>): string {
    return `${variable.unitName} - ${variable.variableId}`;
  }

  protected getKappaCellClass(kappa: number | null): string {
    if (kappa === null) {
      return 'kappa-na';
    }
    if (kappa < 0.4) {
      return 'kappa-low';
    }
    if (kappa < 0.6) {
      return 'kappa-fair';
    }
    if (kappa < 0.81) {
      return 'kappa-moderate';
    }
    if (kappa <= 0.95) {
      return 'kappa-good';
    }
    return 'kappa-perfect';
  }

  private resetKappaState(): void {
    this.reliability.resetStatistics();
  }

  protected toggleKappaStatistics(): void {
    this.showKappaStatistics.set(!this.showKappaStatistics());
    if (this.showKappaStatistics() && !this.kappaStatistics()) {
      this.loadKappaStatistics();
    }
  }

  protected toggleWeightingMethod(): void {
    this.reliability.reset();
    this.loadKappaStatistics();
  }

  protected toggleCalculationLevel(): void {
    this.reliability.reset();
    this.loadKappaStatistics();
  }

  private findWithinTrainingReplayRow(
    data: Pick<ReplayCodeSelectedMessage, 'testPerson' | 'unitId' | 'variableId' | 'responseId'>
  ): WithinTrainingComparison | null {
    const targetVarId = (data.variableId || '').toLowerCase();
    const targetUnitId = (data.unitId || '').toLowerCase();
    const normalizedMsgTP = normalizeTestperson(data.testPerson || '').toLowerCase();

    // 1. Primary match: responseId (most reliable)
    let row = data.responseId ? this.withinTrainingData.find(d => d.responseId === data.responseId &&
      (d.variableId || '').toLowerCase() === targetVarId
    ) : null;

    // 2. Fallback match: unitName + variableId + testperson
    if (!row) {
      row = this.withinTrainingData.find(d => {
        const rowUnitId = (d.unitName || '').toLowerCase();
        const rowVarId = (d.variableId || '').toLowerCase();
        const rowTP = normalizeTestperson(d.testperson || '').toLowerCase();
        return rowUnitId === targetUnitId && rowVarId === targetVarId && rowTP === normalizedMsgTP;
      });
    }

    return row || null;
  }

  private getDiscussionScoreOverride(responseId: number): number | null | undefined {
    return Object.prototype.hasOwnProperty.call(this.discussionScoreByResponseId(), responseId) ?
      this.discussionScoreByResponseId()[responseId] :
      undefined;
  }

  private handleReplayCodeSelected(data: ReplayCodeSelectedMessage): void {
    if (this.comparisonMode !== 'within-training') return;

    const row = this.findWithinTrainingReplayRow(data);

    if (row) {
      this.discussionCodeByResponseId.update(current => ({ ...current, [row.responseId]: this.mapCodeForDisplay(data.code) }));
      this.discussionScoreByResponseId.update(current => ({ ...current, [row.responseId]: data.score !== undefined ? data.score : this.getDiscussionScoreFromKnownCodes(row, parseInt(data.code, 10)) }));
      if (Object.prototype.hasOwnProperty.call(data, 'notes')) {
        this.discussionNotesByResponseId.update(current => ({ ...current, [row.responseId]: data.notes || '' }));
      }
      this.onDiscussionCodeBlur(row, data.score);

      this.snackBar.open(
        this.translate.instant('coding.trainings.compare.code-from-replay', { variable: data.variableId }),
        this.translate.instant('common.close'),
        { duration: 3000 }
      );
    }
  }

  private handleReplayNotesCommitted(data: ReplayNotesCommittedMessage): void {
    if (this.comparisonMode !== 'within-training') return;

    const row = this.findWithinTrainingReplayRow(data);
    if (!row) {
      return;
    }

    const responseId = row.responseId;
    const notes = data.notes || '';
    this.discussionNotesByResponseId.update(current => ({ ...current, [responseId]: notes }));
    this.discussionErrorByResponseId.update(current => ({ ...current, [responseId]: '' }));

    const currentCode = (this.discussionCodeByResponseId()[responseId] || '').trim() ||
      (row.discussionCode !== null && row.discussionCode !== undefined ? row.discussionCode.toString() : '');
    if (!currentCode) {
      return;
    }

    this.discussionCodeByResponseId.update(current => ({ ...current, [responseId]: currentCode }));
    if (this.isSavingDiscussionByResponseId()[responseId]) {
      this.pendingDiscussionNotesByResponseId[responseId] = notes;
      return;
    }

    this.onDiscussionCodeBlur(row, this.getDiscussionScoreOverride(responseId));
  }

  private createTrainingDiscussionRecoveryDraft(): TrainingDiscussionRecoveryDraft | null {
    if (this.comparisonMode !== 'within-training' || !this.selectedTrainingForWithin) {
      return null;
    }

    const entries = this.withinTrainingData
      .map(row => this.createTrainingDiscussionRecoveryEntry(row))
      .filter((entry): entry is TrainingDiscussionRecoveryEntry => entry !== null);

    if (entries.length === 0) {
      return null;
    }

    return {
      workspaceId: this.data.workspaceId,
      trainingId: this.selectedTrainingForWithin,
      entries
    };
  }

  private createTrainingDiscussionRecoveryEntry(row: WithinTrainingComparison): TrainingDiscussionRecoveryEntry | null {
    const responseId = row.responseId;
    const codeValue = Object.prototype.hasOwnProperty.call(this.discussionCodeByResponseId(), responseId) ?
      this.discussionCodeByResponseId()[responseId] :
      this.getPersistedDiscussionCodeValue(row);
    const score = Object.prototype.hasOwnProperty.call(this.discussionScoreByResponseId(), responseId) ?
      this.discussionScoreByResponseId()[responseId] :
      row.discussionScore ?? null;
    const notes = Object.prototype.hasOwnProperty.call(this.discussionNotesByResponseId(), responseId) ?
      this.discussionNotesByResponseId()[responseId] :
      row.discussionNotes || '';

    const hasPendingNotes = Object.prototype.hasOwnProperty.call(this.pendingDiscussionNotesByResponseId, responseId);
    const isDirty = codeValue !== this.getPersistedDiscussionCodeValue(row) ||
      score !== (row.discussionScore ?? null) ||
      notes !== (row.discussionNotes || '') ||
      hasPendingNotes ||
      !!this.isSavingDiscussionByResponseId()[responseId] ||
      !!this.discussionErrorByResponseId()[responseId];
    if (!isDirty) {
      return null;
    }

    return {
      responseId,
      codeValue,
      score,
      notes: hasPendingNotes ? this.pendingDiscussionNotesByResponseId[responseId] : notes
    };
  }

  private getPersistedDiscussionCodeValue(row: WithinTrainingComparison): string {
    return row.discussionCode !== null && row.discussionCode !== undefined ?
      this.mapCodeForDisplay(row.discussionCode.toString()) :
      '';
  }

  private restoreTrainingDiscussionRecoveryDraft(): boolean {
    const draft = this.sessionRecoveryService.peekDraft<TrainingDiscussionRecoveryDraft>(
      this.trainingDiscussionRecoveryKey
    );
    if (!draft || !this.isTrainingDiscussionRecoveryDraftForCurrentContext(draft)) {
      return false;
    }
    if (this.withinTrainingData.length === 0) {
      return false;
    }

    let restoredAnyEntry = false;
    draft.entries.forEach(entry => {
      const row = this.withinTrainingData.find(item => item.responseId === entry.responseId);
      if (!row) {
        return;
      }

      restoredAnyEntry = true;
      this.discussionCodeByResponseId.update(current => ({ ...current, [entry.responseId]: entry.codeValue }));
      this.discussionScoreByResponseId.update(current => ({ ...current, [entry.responseId]: entry.score }));
      this.discussionNotesByResponseId.update(current => ({ ...current, [entry.responseId]: entry.notes }));
      this.discussionErrorByResponseId.update(current => ({ ...current, [entry.responseId]: '' }));
      this.onDiscussionCodeBlur(row, entry.score);
    });

    return restoredAnyEntry;
  }

  private isTrainingDiscussionRecoveryDraftForCurrentContext(draft: TrainingDiscussionRecoveryDraft): boolean {
    return draft.workspaceId === this.data.workspaceId &&
      draft.trainingId === this.selectedTrainingForWithin &&
      this.comparisonMode === 'within-training';
  }

  private saveTrainingDiscussionRecoveryDraft(draft: TrainingDiscussionRecoveryDraft): void {
    const existingDraft = this.sessionRecoveryService.peekDraft<TrainingDiscussionRecoveryDraft>(
      this.trainingDiscussionRecoveryKey
    );
    if (!existingDraft || !this.isSameTrainingDiscussionRecoveryContext(existingDraft, draft)) {
      this.sessionRecoveryService.saveDraft(this.trainingDiscussionRecoveryKey, draft);
      return;
    }

    const entriesByResponseId = new Map<number, TrainingDiscussionRecoveryEntry>();
    existingDraft.entries.forEach(entry => entriesByResponseId.set(entry.responseId, entry));
    draft.entries.forEach(entry => entriesByResponseId.set(entry.responseId, entry));
    this.sessionRecoveryService.saveDraft(this.trainingDiscussionRecoveryKey, {
      ...draft,
      entries: Array.from(entriesByResponseId.values())
    });
  }

  private clearTrainingDiscussionRecoveryEntry(responseId: number): void {
    const draft = this.sessionRecoveryService.peekDraft<TrainingDiscussionRecoveryDraft>(
      this.trainingDiscussionRecoveryKey
    );
    if (!draft || !this.isTrainingDiscussionRecoveryDraftForCurrentContext(draft)) {
      return;
    }

    const entries = draft.entries.filter(entry => entry.responseId !== responseId);
    if (entries.length === draft.entries.length) {
      return;
    }

    if (entries.length > 0) {
      this.sessionRecoveryService.saveDraft(this.trainingDiscussionRecoveryKey, {
        ...draft,
        entries
      });
    } else {
      this.sessionRecoveryService.clearDraft(this.trainingDiscussionRecoveryKey);
    }
  }

  private isSameTrainingDiscussionRecoveryContext(
    first: TrainingDiscussionRecoveryDraft,
    second: TrainingDiscussionRecoveryDraft
  ): boolean {
    return first.workspaceId === second.workspaceId &&
      first.trainingId === second.trainingId;
  }
}
