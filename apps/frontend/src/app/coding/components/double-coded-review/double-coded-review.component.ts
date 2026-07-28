import {
  Component,
  OnInit,
  OnDestroy,
  Inject,
  Optional,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  MatPaginatorModule,
  PageEvent,
  MatPaginatorIntl
} from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import {
  MatDialog,
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  FormControl
} from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  takeUntil,
  map,
  merge,
  catchError,
  of,
  forkJoin,
  take,
  finalize,
  concatMap,
  Observable
} from 'rxjs';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { CodingFacadeService } from '../../../services/facades/coding-facade.service';
import { JobDefinition } from '../../services/coding-job-backend.service';
import { CoderTraining } from '../../models/coder-training.model';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import {
  PostMessage,
  PostMessageService
} from '../../../core/services/post-message.service';
import {
  appendReplayUrlParams,
  normalizeReplayUrlToCurrentOrigin
} from '../../utils/replay-url.util';
import { ReviewCodeSelection } from '../../../replay/services/units-replay.service';
import { getJobDefinitionDisplayLabel } from '../../utils/job-definition-display.util';
import {
  DoubleCodedManagerDecisionDto,
  DoubleCodedResolutionDecisionDto,
  DoubleCodedReviewCodeDto,
  SaveDoubleCodedReviewDraftDto
} from '../../../../../../../api-dto/coding/double-coded-review.dto';

interface CoderResult {
  coderId: number;
  coderName: string;
  jobId: number;
  jobName: string;
  code: number | null;
  codingIssueOption?: number | null;
  score: number | null;
  notes: string | null;
  supervisorComment: string | null;
  codedAt: string;
  currentSelectionMatch?: boolean;
}

interface DoubleCodedItem {
  responseId: number;
  sourceUnitId: number;
  unitName: string;
  variableId: string;
  personLogin: string;
  personCode: string;
  bookletName: string;
  givenAnswer: string;
  isResolved: boolean;
  appliedCode: number | null;
  appliedScore: number | null;
  appliedComment: string | null;
  availableCodes: DoubleCodedReviewCodeDto[];
  managerDrafts: DoubleCodedManagerDecisionDto[];
  managerHistory: DoubleCodedManagerDecisionDto[];
  coderResults: CoderResult[];
  selectedCoderResult?: CoderResult;
  currentSelectionCode?: number | null;
}

interface AppliedReviewResult {
  code: number | null;
  score: number | null;
  comment: string | null;
}

interface ReplayDecisionResult {
  source: 'replay';
  code: number;
  score: number | null;
  notes?: string;
}

interface CatalogDecisionResult {
  source: 'catalog';
  code: number;
  score: number | null;
  label: string;
}

type DecisionResult =
  CoderResult | ReplayDecisionResult | CatalogDecisionResult;

interface ReplayCodeSelectedMessage extends PostMessage {
  testPerson: string;
  unitId: string;
  variableId: unknown;
  code: unknown;
  score?: unknown;
  notes?: unknown;
  responseId?: number;
}

type ValidReplayScore = {
  isValid: true;
  hasScore: boolean;
  value: number | null;
};
type ParsedReplayScore = ValidReplayScore | { isValid: false };

interface DoubleCodedReviewRecoveryEntry {
  responseId: number;
  selectedValue: string;
  comment: string;
  replayDecision?: ReplayDecisionResult;
}

interface DoubleCodedReviewRecoveryDraft {
  workspaceId: number;
  entries: DoubleCodedReviewRecoveryEntry[];
}

interface CoderColumnMeta {
  columnId: string;
  coderId: number;
  label: string;
  coderNames: string[];
  jobNames: string[];
}

interface ManagerColumnMeta {
  columnId: string;
  managerUserId: number | null;
  managerKey: string;
  label: string;
}

interface DoubleCodedReviewDialogData {
  canApplyResults?: boolean;
}

type ManagerDraftCommand =
  | {
    kind: 'save';
    workspaceId: number;
    item: DoubleCodedItem;
    draft: SaveDoubleCodedReviewDraftDto;
  }
  | {
    kind: 'delete';
    workspaceId: number;
    item: DoubleCodedItem;
  };

interface ManagerDraftCommandResult {
  command: ManagerDraftCommand;
  savedDraft: DoubleCodedManagerDecisionDto | null;
}

type ConflictType = 'none' | 'inter-coder' | 'same-coder' | 'mixed';

@Component({
  selector: 'coding-box-double-coded-review',
  templateUrl: './double-coded-review.component.html',
  styleUrls: ['./double-coded-review.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule,
    MatDialogModule,
    MatTooltipModule,
    MatSelectModule,
    FormsModule,
    ReactiveFormsModule,
    TranslateModule
  ],
  providers: [{ provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }]
})
export class DoubleCodedReviewComponent implements OnInit, OnDestroy {
  private testPersonCodingService = inject(TestPersonCodingService);
  private appService: AppService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private translateService = inject(TranslateService);
  private dialog = inject(MatDialog);
  private workspaceService = inject(WorkspaceBackendService);
  private codingFacadeService = inject(CodingFacadeService);
  private codingStatisticsService = inject(CodingStatisticsService);
  private postMessageService = inject(PostMessageService);
  private sessionRecoveryService = inject(SessionRecoveryService);

  constructor(
    @Optional() public dialogRef: MatDialogRef<DoubleCodedReviewComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public dialogData: unknown
  ) {}

  get canApplyReviewResults(): boolean {
    return (
      this.appService.authData.isAdmin ||
      (this.dialogData as DoubleCodedReviewDialogData | null)
        ?.canApplyResults === true
    );
  }

  private staticColumns: string[] = [
    'unitVariable',
    'personInfo',
    'givenAnswer'
  ];

  dynamicCoderColumns: string[] = [];
  dynamicManagerColumns: string[] = [];
  displayedColumns: string[] = [...this.staticColumns, 'selection'];
  coderColumnMeta: Record<string, CoderColumnMeta> = {};
  managerColumnMeta: Record<string, ManagerColumnMeta> = {};

  dataSource = new MatTableDataSource<DoubleCodedItem>([]);
  allData: DoubleCodedItem[] = [];
  totalItems = 0;
  currentPage = 1;
  pageSize = 50;
  isLoading = false;
  showOnlyConflicts = false;
  agreementControl = new FormControl<'all' | 'match' | 'differ'>('all');
  searchControl = new FormControl('');
  coderControl = new FormControl<number | null>(null);
  statusControl = new FormControl<string>('all');
  resolvedControl = new FormControl<string>('all');
  scopeControl = new FormControl<string[]>([]);
  availableCoders: { id: number; name: string }[] = [];
  availableJobDefinitions: Array<{ id: number; label: string }> = [];
  availableCoderTrainings: Array<{ id: number; label: string }> = [];
  private filterOptionsLoaded = false;
  private resultsApplied = false;
  private destroy$ = new Subject<void>();

  selectionForm!: FormGroup;
  selectedItem: DoubleCodedItem | null = null;
  replayLoadingByResponseId: Record<number, boolean> = {};
  private replayDecisionByResponseId = new Map<number, ReplayDecisionResult>();
  private replayWindowByResponseId = new Map<number, MessageEventSource>();
  private defaultReviewValueByResponseId = new Map<
  number,
  { selectedValue: string; comment: string }
  >();

  private managerDraftCommandQueues = new Map<
  number,
  Subject<ManagerDraftCommand>
  >();

  private lastManagerDraftCommandSignatureByResponseId = new Map<
  number,
  string
  >();

  private unregisterRecoveryProvider: (() => void) | null = null;
  private readonly replayDecisionPrefix = 'replay:';
  private readonly catalogDecisionPrefix = 'code:';
  private readonly reviewRecoveryKey = 'double-coded-review-active-state';
  private readonly standaloneCodingIssueOptionIds = new Set([-3, -4]);

  ngOnInit(): void {
    this.initializeForm();
    this.unregisterRecoveryProvider =
      this.sessionRecoveryService.registerProvider({
        key: this.reviewRecoveryKey,
        capture: () => this.createReviewRecoveryDraft()
      });
    this.sessionRecoveryService.restore$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.restoreReviewRecoveryDraft());
    this.setupFilters();
    this.loadCoders();
    this.loadFilterOptions();
    this.postMessageService
      .getMessages<ReplayCodeSelectedMessage>('replayCodeSelected')
      .pipe(takeUntil(this.destroy$))
      .subscribe(data => this.handleReplayCodeSelected(data.message, data.source, data.origin)
      );
  }

  ngOnDestroy(): void {
    this.allData.forEach(item => {
      if (this.createReviewRecoveryEntry(item)) {
        this.persistManagerDraft(item);
      }
    });
    this.managerDraftCommandQueues.forEach(queue => queue.complete());
    this.managerDraftCommandQueues.clear();
    this.unregisterRecoveryProvider?.();
    this.unregisterRecoveryProvider = null;
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupFilters(): void {
    const agreement$ = this.agreementControl.valueChanges.pipe(
      distinctUntilChanged()
    );
    const search$ = this.searchControl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged()
    );
    const coder$ = this.coderControl.valueChanges.pipe(distinctUntilChanged());
    const status$ = this.statusControl.valueChanges.pipe(
      distinctUntilChanged()
    );
    const resolved$ = this.resolvedControl.valueChanges.pipe(
      distinctUntilChanged()
    );
    const scope$ = this.scopeControl.valueChanges.pipe(
      distinctUntilChanged(
        (a, b) => JSON.stringify(a || []) === JSON.stringify(b || [])
      )
    );

    merge(agreement$, search$, coder$, status$, resolved$, scope$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.onFilterChange();
      });
  }

  private loadCoders(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.workspaceService
      .getWorkspaceCoders(workspaceId)
      .pipe(
        map(response => response.data.map((user: { userId: number; username: string }) => ({
          id: user.userId,
          name: user.username || `User ${user.userId}`
        }))
        )
      )
      .subscribe(coders => {
        this.availableCoders = coders;
      });
  }

  private initializeForm(): void {
    this.selectionForm = this.fb.group({});
  }

  private loadFilterOptions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.loadData();
      return;
    }

    forkJoin({
      jobDefinitions: this.codingFacadeService
        .getJobDefinitions(workspaceId)
        .pipe(catchError(() => of([] as JobDefinition[]))),
      coderTrainings: this.codingFacadeService
        .getCoderTrainings(workspaceId)
        .pipe(catchError(() => of([] as CoderTraining[])))
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ jobDefinitions, coderTrainings }) => {
        const sortedJobDefinitions = [...jobDefinitions]
          .filter(
            definition => definition.id !== undefined &&
              (definition.createdJobsCount ?? 0) > 0
          )
          .sort((a, b) => (b.id || 0) - (a.id || 0));

        this.availableJobDefinitions = sortedJobDefinitions.map(
          definition => ({
            id: definition.id!,
            label: this.getJobDefinitionLabel(definition)
          })
        );

        this.availableCoderTrainings = coderTrainings
          .filter(training => (training.jobsCount ?? 0) > 0)
          .map(training => ({
            id: training.id,
            label: this.getCoderTrainingLabel(training)
          }));

        const validScopes = new Set([
          ...this.availableJobDefinitions.map(
            definition => `job_${definition.id}`
          ),
          ...this.availableCoderTrainings.map(
            training => `training_${training.id}`
          )
        ]);
        const currentScopes = (this.scopeControl.value || []).filter(scope => validScopes.has(scope)
        );

        if (currentScopes.length > 0) {
          this.scopeControl.setValue(currentScopes, { emitEvent: false });
        } else if (this.availableJobDefinitions.length > 0) {
          this.scopeControl.setValue(
            [`job_${this.availableJobDefinitions[0].id}`],
            { emitEvent: false }
          );
        } else if (this.availableCoderTrainings.length > 0) {
          this.scopeControl.setValue(
            [`training_${this.availableCoderTrainings[0].id}`],
            { emitEvent: false }
          );
        } else {
          this.scopeControl.setValue([], { emitEvent: false });
        }

        this.filterOptionsLoaded = true;
        if (!this.hasScopeOptions()) {
          this.clearReviewData();
          return;
        }

        this.loadData();
      });
  }

  private getJobDefinitionLabel(definition: JobDefinition): string {
    const statusLabel = this.getJobDefinitionStatusLabel(definition.status);
    const status = statusLabel ? ` (${statusLabel})` : '';
    const jobsCount = definition.createdJobsCount ?? 0;
    return `${getJobDefinitionDisplayLabel(definition)}${status}, ${jobsCount} ${this.getJobCountLabel(jobsCount)}`;
  }

  private getCoderTrainingLabel(training: CoderTraining): string {
    const jobsCount = training.jobsCount ?? 0;
    const trainingLabel =
      training.label ||
      this.translateService.instant(
        'double-coded-review.filter.training-fallback',
        {
          id: training.id
        }
      );
    return `${trainingLabel} (${jobsCount} ${this.getJobCountLabel(jobsCount)})`;
  }

  private getJobDefinitionStatusLabel(status: JobDefinition['status']): string {
    if (!status) {
      return '';
    }

    const statusKey =
      status === 'pending_review' ?
        'coding-job-definition-dialog.status.definition.pending-review' :
        `coding-job-definition-dialog.status.definition.${status}`;
    return this.translateService.instant(statusKey);
  }

  private getJobCountLabel(count: number): string {
    return this.translateService.instant(
      count === 1 ?
        'double-coded-review.filter.job-count-singular' :
        'double-coded-review.filter.job-count-plural'
    );
  }

  hasScopeOptions(): boolean {
    return (
      this.availableJobDefinitions.length > 0 ||
      this.availableCoderTrainings.length > 0
    );
  }

  getScopeSelectionSummary(): string {
    if (this.filterOptionsLoaded && !this.hasScopeOptions()) {
      return this.translateService.instant(
        'double-coded-review.filter.scope-none'
      );
    }

    const selectedScopes = this.scopeControl.value || [];
    if (selectedScopes.length === 0) {
      return this.translateService.instant(
        'double-coded-review.filter.scope-all'
      );
    }

    if (selectedScopes.length === 1) {
      return this.getScopeLabel(selectedScopes[0]);
    }

    const selectedJobDefinitions = this.getSelectedJobDefinitionIds().length;
    const selectedTrainings = this.getSelectedCoderTrainingIds().length;
    return this.translateService.instant(
      'double-coded-review.filter.scope-summary',
      {
        jobs: selectedJobDefinitions,
        trainings: selectedTrainings
      }
    );
  }

  private getScopeLabel(scope: string): string {
    if (scope.startsWith('job_')) {
      const scopeId = parseInt(scope.replace('job_', ''), 10);
      return this.availableJobDefinitions.find(definition => definition.id === scopeId)?.label ||
        getJobDefinitionDisplayLabel({ id: scopeId });
    }

    if (scope.startsWith('training_')) {
      const scopeId = parseInt(scope.replace('training_', ''), 10);
      return (
        this.availableCoderTrainings.find(training => training.id === scopeId)
          ?.label ||
        this.translateService.instant(
          'double-coded-review.filter.training-fallback',
          { id: scopeId }
        )
      );
    }

    return scope;
  }

  private getSelectedJobDefinitionIds(): number[] {
    return (this.scopeControl.value || [])
      .filter(scope => scope.startsWith('job_'))
      .map(scope => parseInt(scope.replace('job_', ''), 10))
      .filter(id => !Number.isNaN(id));
  }

  private getSelectedCoderTrainingIds(): number[] {
    return (this.scopeControl.value || [])
      .filter(scope => scope.startsWith('training_'))
      .map(scope => parseInt(scope.replace('training_', ''), 10))
      .filter(id => !Number.isNaN(id));
  }

  getCurrentItems(): DoubleCodedItem[] {
    return this.dataSource.data;
  }

  getItemControlName(item: DoubleCodedItem): string {
    return `item_${item.responseId}`;
  }

  getCommentControlName(item: DoubleCodedItem): string {
    return `comment_${item.responseId}`;
  }

  getItemControl(item: DoubleCodedItem): FormControl {
    return this.getOrCreateFormControl(this.getItemControlName(item));
  }

  getCommentControl(item: DoubleCodedItem): FormControl {
    return this.getOrCreateFormControl(this.getCommentControlName(item));
  }

  private getOrCreateFormControl(controlName: string): FormControl {
    const control = this.selectionForm.get(controlName);
    if (control instanceof FormControl) {
      return control;
    }

    const fallbackControl = new FormControl('');
    this.selectionForm.addControl(controlName, fallbackControl);
    return fallbackControl;
  }

  private updateForm(): void {
    // Clear existing form controls
    Object.keys(this.selectionForm.controls).forEach(key => {
      this.selectionForm.removeControl(key);
    });
    this.defaultReviewValueByResponseId =
      this.defaultReviewValueByResponseId || new Map();
    this.defaultReviewValueByResponseId.clear();

    const currentItems = this.dataSource.data;

    currentItems.forEach(item => {
      const controlName = this.getItemControlName(item);

      const ownDraft = this.getOwnManagerDraft(item);
      const modeCode = this.getModeCode(item);
      const defaultCode =
        ownDraft?.code ?? (item.isResolved ? item.appliedCode : modeCode);
      const defaultValue =
        defaultCode === null || defaultCode === undefined ?
          '' :
          this.getCatalogDecisionControlValue(defaultCode);
      const selectionControl = new FormControl({
        value: defaultValue,
        disabled: item.isResolved
      });
      this.selectionForm.addControl(controlName, selectionControl);

      const commentControlName = this.getCommentControlName(item);
      const defaultComment =
        ownDraft?.comment || (item.isResolved ? item.appliedComment || '' : '');
      const commentControl = new FormControl({
        value: defaultComment,
        disabled: item.isResolved
      });
      this.selectionForm.addControl(commentControlName, commentControl);
      this.defaultReviewValueByResponseId.set(item.responseId, {
        selectedValue: defaultValue,
        comment: defaultComment
      });
      this.setCurrentSelectionCode(item, defaultCode ?? null);
      commentControl.valueChanges
        .pipe(
          debounceTime(750),
          distinctUntilChanged(),
          takeUntil(this.destroy$)
        )
        .subscribe(() => this.persistManagerDraft(item));
    });
  }

  private updateDisplayedColumns(items: DoubleCodedItem[]): void {
    const meta: Record<string, CoderColumnMeta> = {};
    const managerMeta: Record<string, ManagerColumnMeta> = {};

    items.forEach(item => {
      item.coderResults.forEach(result => {
        const columnId = `coder_${result.coderId}`;
        const coderName = this.getCoderDisplayName(result);
        if (!meta[columnId]) {
          meta[columnId] = {
            columnId,
            coderId: result.coderId,
            label: coderName,
            coderNames: [],
            jobNames: []
          };
        }

        if (!meta[columnId].coderNames.includes(coderName)) {
          meta[columnId].coderNames.push(coderName);
        }

        if (
          result.jobName &&
          !meta[columnId].jobNames.includes(result.jobName)
        ) {
          meta[columnId].jobNames.push(result.jobName);
        }
      });

      [...(item.managerDrafts || []), ...(item.managerHistory || [])].forEach(
        decision => {
          if (decision.managerUserId === this.appService.userId) {
            return;
          }
          const managerKey = this.getManagerDecisionKey(decision);
          const columnId = `manager_${managerKey}`;
          managerMeta[columnId] = {
            columnId,
            managerUserId: decision.managerUserId,
            managerKey,
            label: decision.managerName || this.getUnknownManagerLabel()
          };
        }
      );
    });

    this.coderColumnMeta = meta;
    this.dynamicCoderColumns = Object.values(meta)
      .sort((a, b) => {
        const labelComparison = a.label.localeCompare(b.label, 'de', {
          sensitivity: 'base'
        });
        return labelComparison || a.coderId - b.coderId;
      })
      .map(column => column.columnId);

    this.managerColumnMeta = managerMeta;
    this.dynamicManagerColumns = Object.values(managerMeta)
      .sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' })
      )
      .map(column => column.columnId);

    this.displayedColumns = [
      ...this.staticColumns,
      ...this.dynamicCoderColumns,
      ...this.dynamicManagerColumns,
      'selection'
    ];
  }

  getSelectionColumnHeader(): string {
    return (
      this.appService.authData.userName ||
      this.appService.loggedUser?.preferred_username ||
      this.translateService.instant('double-coded-review.columns.selection')
    );
  }

  getCoderColumnHeader(columnId: string): string {
    return (
      this.coderColumnMeta[columnId]?.label ||
      this.translateService.instant('double-coded-review.columns.coder-results')
    );
  }

  getCoderColumnTooltip(columnId: string): string {
    const meta = this.coderColumnMeta[columnId];
    if (!meta) return '';

    const details: string[] = [];
    const alternativeCoderNames = meta.coderNames.filter(
      name => name !== meta.label
    );

    if (alternativeCoderNames.length > 0) {
      const namesSummary = this.getVisibleValueSummary(alternativeCoderNames);
      const translatedAlternativeNames = this.translateService.instant(
        'double-coded-review.columns.alternative-coder-names',
        { names: namesSummary }
      );
      details.push(
        translatedAlternativeNames ===
          'double-coded-review.columns.alternative-coder-names' ?
          `Weitere Namen: ${namesSummary}` :
          translatedAlternativeNames
      );
    }

    if (meta.jobNames.length > 0) {
      details.push(this.getVisibleValueSummary(meta.jobNames));
    }

    if (details.length === 0) {
      return meta.label;
    }

    return `${meta.label} (${details.join('; ')})`;
  }

  getCoderResultsForColumn(
    item: DoubleCodedItem,
    columnId: string
  ): CoderResult[] {
    const meta = this.coderColumnMeta[columnId];
    if (!meta) return [];

    return item.coderResults
      .filter(result => result.coderId === meta.coderId)
      .sort((a, b) => {
        const jobNameComparison = a.jobName.localeCompare(b.jobName, 'de', {
          sensitivity: 'base'
        });
        return jobNameComparison || a.jobId - b.jobId;
      });
  }

  getManagerColumnHeader(columnId: string): string {
    return (
      this.managerColumnMeta[columnId]?.label || this.getUnknownManagerLabel()
    );
  }

  getManagerDecisionForColumn(
    item: DoubleCodedItem,
    columnId: string
  ): DoubleCodedManagerDecisionDto | undefined {
    const managerKey = this.managerColumnMeta[columnId]?.managerKey;
    const decisions = [
      ...(item.managerDrafts || []),
      ...(item.managerHistory || [])
    ]
      .filter(decision => this.getManagerDecisionKey(decision) === managerKey)
      .sort(
        (a, b) => this.getDecisionTimestamp(b) - this.getDecisionTimestamp(a)
      );
    return decisions[0];
  }

  private getManagerDecisionKey(
    decision: DoubleCodedManagerDecisionDto
  ): string {
    if (decision.managerKey?.trim()) {
      return decision.managerKey.trim();
    }
    if (decision.managerUserId !== null) {
      return String(decision.managerUserId);
    }
    if (!decision.legacy && decision.id !== null) {
      return `decision_${decision.id}`;
    }
    return 'legacy';
  }

  getManagerDecisionStateLabel(
    decision: DoubleCodedManagerDecisionDto
  ): string {
    const fallbackByState: Record<
    DoubleCodedManagerDecisionDto['state'],
    string
    > = {
      draft: 'Entwurf',
      applied: 'Angewendet',
      superseded: 'Überholt'
    };
    return this.translateWithFallback(
      `double-coded-review.manager-state.${decision.state}`,
      fallbackByState[decision.state]
    );
  }

  getManagerDecisionDisplayCode(
    decision: DoubleCodedManagerDecisionDto
  ): string {
    const selectedCode = decision.selectedCode ?? decision.code;
    return (
      this.getCodeLabel(selectedCode) ||
      (selectedCode === null ? '' : String(selectedCode))
    );
  }

  private getUnknownManagerLabel(): string {
    return this.translateWithFallback(
      'double-coded-review.columns.manager-unknown',
      'Manager unbekannt'
    );
  }

  private translateWithFallback(key: string, fallback: string): string {
    const translated = this.translateService.instant(key);
    return translated === key ? fallback : translated;
  }

  private getDecisionTimestamp(
    decision: DoubleCodedManagerDecisionDto
  ): number {
    const rawTimestamp =
      decision.finalizedAt || decision.updatedAt || decision.createdAt;
    const timestamp = rawTimestamp ? new Date(rawTimestamp).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  getCoderResultSourceLabel(result: CoderResult): string {
    return result.jobName ?
      `${result.jobName} (#${result.jobId})` :
      `#${result.jobId}`;
  }

  hasMultipleResultsForCoder(
    item: DoubleCodedItem,
    result: Pick<CoderResult, 'coderId'>
  ): boolean {
    return (
      item.coderResults.filter(
        coderResult => coderResult.coderId === result.coderId
      ).length > 1
    );
  }

  getDecisionResultSourceLabel(
    item: DoubleCodedItem,
    result: DecisionResult
  ): string {
    if (this.isCatalogDecisionResult(result)) {
      return result.label;
    }
    if (this.isReplayDecisionResult(result)) {
      return this.translateService.instant(
        'double-coded-review.decision.replay-source'
      );
    }

    if (!this.hasMultipleResultsForCoder(item, result)) {
      return this.getCoderDisplayName(result);
    }

    return `${this.getCoderDisplayName(result)} - ${this.getCoderResultSourceLabel(result)}`;
  }

  getSelectedDecisionResult(item: DoubleCodedItem): DecisionResult | undefined {
    const selectedValue = this.selectionForm?.get(
      this.getItemControlName(item)
    )?.value;
    const catalogDecision = this.getCatalogDecisionForControlValue(
      item,
      selectedValue
    );
    if (catalogDecision) {
      return catalogDecision;
    }
    const replayDecision = this.getReplayDecisionForControlValue(
      item,
      selectedValue
    );
    if (replayDecision) {
      return replayDecision;
    }

    const selectedResult = selectedValue ?
      item.coderResults.find(
        result => result.jobId.toString() === selectedValue
      ) :
      undefined;

    return selectedResult && selectedResult.code !== null ?
      selectedResult :
      undefined;
  }

  getDecisionDisplayCode(result: DecisionResult): string {
    return this.isCatalogDecisionResult(result) && result.code < 0 ?
      '' :
      this.getCodeDisplay(result.code);
  }

  getAvailableSchemaCodes(item: DoubleCodedItem): DoubleCodedReviewCodeDto[] {
    return item.availableCodes.filter(option => option.source === 'schema');
  }

  getAvailableGeneralCodes(item: DoubleCodedItem): DoubleCodedReviewCodeDto[] {
    return item.availableCodes.filter(option => option.source === 'general');
  }

  private isReplayDecisionResult(
    result: DecisionResult
  ): result is ReplayDecisionResult {
    return 'source' in result && result.source === 'replay';
  }

  private isCatalogDecisionResult(
    result: DecisionResult
  ): result is CatalogDecisionResult {
    return 'source' in result && result.source === 'catalog';
  }

  getAppliedReviewResult(item: DoubleCodedItem): AppliedReviewResult | null {
    if (!item.isResolved) {
      return null;
    }

    const code = item.appliedCode ?? null;
    const score = item.appliedScore ?? null;
    const comment =
      item.appliedComment?.trim() ||
      item.coderResults
        .find(result => !!result.supervisorComment)
        ?.supervisorComment?.trim() ||
      null;

    if (code === null && score === null && !comment) {
      return null;
    }

    return {
      code,
      score,
      comment
    };
  }

  getAppliedMatchingCoderResult(
    item: DoubleCodedItem
  ): CoderResult | undefined {
    const appliedResult = this.getAppliedReviewResult(item);
    if (!appliedResult || appliedResult.code === null) {
      return undefined;
    }

    return (
      item.coderResults.find(
        result => result.code === appliedResult.code &&
          (result.score ?? null) === (appliedResult.score ?? null)
      ) ||
      item.coderResults.find(result => result.code === appliedResult.code)
    );
  }

  getAppliedResultSourceLabel(item: DoubleCodedItem): string {
    const matchingResult = this.getAppliedMatchingCoderResult(item);
    if (matchingResult) {
      return this.getDecisionResultSourceLabel(item, matchingResult);
    }

    return this.translateService.instant(
      'double-coded-review.applied-result.final-source'
    );
  }

  getAppliedResultTooltip(item: DoubleCodedItem): string {
    const appliedResult = this.getAppliedReviewResult(item);
    if (!appliedResult) {
      return '';
    }

    const codeDisplay =
      this.getCodeDisplay(appliedResult.code) ||
      this.getCodeLabel(appliedResult.code) ||
      'N/A';
    const scoreDisplay =
      appliedResult.score !== null ? ` (${appliedResult.score})` : '';

    return `${this.translateService.instant('double-coded-review.applied-result.label')}: ${codeDisplay}${scoreDisplay}`;
  }

  isAppliedCodeMatch(item: DoubleCodedItem, result: CoderResult): boolean {
    const appliedResult = this.getAppliedReviewResult(item);
    return (
      !!appliedResult &&
      appliedResult.code !== null &&
      result.code === appliedResult.code
    );
  }

  isCurrentCodeMatch(item: DoubleCodedItem, result: CoderResult): boolean {
    if (item.isResolved) {
      return false;
    }
    const selectedCode = item.currentSelectionCode ?? null;
    if (selectedCode === null) {
      return false;
    }
    return selectedCode === this.getReviewSelectionCode(result);
  }

  private updateCurrentSelectionCode(item: DoubleCodedItem): void {
    const selected = this.getSelectedDecisionResult(item);
    this.setCurrentSelectionCode(
      item,
      selected ? this.getReviewSelectionCode(selected) : null
    );
  }

  private setCurrentSelectionCode(
    item: DoubleCodedItem,
    code: number | null
  ): void {
    item.currentSelectionCode = code;
    item.coderResults.forEach(result => {
      result.currentSelectionMatch =
        !item.isResolved &&
        code !== null &&
        code === this.getReviewSelectionCode(result);
    });
  }

  private getReviewSelectionCode(result: DecisionResult): number | null {
    if (
      !this.isReplayDecisionResult(result) &&
      !this.isCatalogDecisionResult(result)
    ) {
      const codingIssueOption = result.codingIssueOption;
      if (
        codingIssueOption !== null &&
        codingIssueOption !== undefined &&
        this.standaloneCodingIssueOptionIds.has(codingIssueOption)
      ) {
        return codingIssueOption;
      }
    }
    return result.code;
  }

  getDecisionStatusClass(item: DoubleCodedItem): string {
    if (item.isResolved) {
      return 'resolved';
    }

    if (this.getConflictType(item) !== 'none') {
      return 'conflict';
    }

    return this.isAllCodersDone(item) ? 'match' : 'incomplete';
  }

  getDecisionStatusIcon(item: DoubleCodedItem): string {
    const statusClass = this.getDecisionStatusClass(item);

    switch (statusClass) {
      case 'resolved':
        return 'check_circle';
      case 'conflict':
        return 'warning';
      case 'match':
        return 'task_alt';
      default:
        return 'pending';
    }
  }

  getDecisionStatusLabel(item: DoubleCodedItem): string {
    const statusClass = this.getDecisionStatusClass(item);

    if (statusClass === 'resolved') {
      return this.translateService.instant('double-coded-review.applied');
    }

    const conflictType = this.getConflictType(item);
    if (conflictType !== 'none') {
      return this.translateService.instant(
        `double-coded-review.decision.status-${conflictType}-conflict`
      );
    }

    return this.translateService.instant(
      `double-coded-review.decision.status-${statusClass}`
    );
  }

  getDecisionStatusTooltip(item: DoubleCodedItem): string {
    if (item.isResolved) {
      return this.translateService.instant('double-coded-review.applied');
    }

    const progressText = `${this.getCodedCount(item)}/${this.getCoderCount(item)} ${this.translateService.instant(
      'double-coded-review.coders-done'
    )}`;
    const conflictType = this.getConflictType(item);

    if (conflictType === 'none') {
      return progressText;
    }

    return `${this.translateService.instant(`double-coded-review.decision.tooltip-${conflictType}-conflict`)} - ${progressText}`;
  }

  shouldShowDecisionComment(item: DoubleCodedItem): boolean {
    return (
      this.hasConflict(item) ||
      !!this.selectionForm?.get(this.getCommentControlName(item))?.value
    );
  }

  isGeoGebraAnswer(value: string | null | undefined): boolean {
    const normalizedValue = (value || '').trim();
    return (
      normalizedValue.startsWith('UEsD') ||
      /^data:[^,]*;base64,UEsD/i.test(normalizedValue)
    );
  }

  getAnswerDisplay(value: string | null | undefined): string {
    if (!value) {
      return 'N/A';
    }

    if (this.isGeoGebraAnswer(value)) {
      return this.translateService.instant(
        'double-coded-review.values.geogebra-answer'
      );
    }

    return value;
  }

  getAnswerTooltip(value: string | null | undefined): string {
    if (!value) {
      return 'N/A';
    }

    if (this.isGeoGebraAnswer(value)) {
      return this.translateService.instant(
        'double-coded-review.values.geogebra-tooltip'
      );
    }

    return value;
  }

  openReplay(itemOrResponseId: DoubleCodedItem | number): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    const responseId =
      typeof itemOrResponseId === 'number' ?
        itemOrResponseId :
        itemOrResponseId.responseId;
    const item =
      typeof itemOrResponseId === 'number' ?
        this.allData.find(
          reviewItem => reviewItem.responseId === responseId
        ) :
        itemOrResponseId;

    if (!workspaceId || !responseId) {
      this.showError(
        this.translateService.instant(
          'coding-management.descriptions.missing-replay-info'
        )
      );
      return;
    }

    this.replayLoadingByResponseId[responseId] = true;
    this.codingStatisticsService
      .getReplayUrl(workspaceId, responseId)
      .pipe(
        take(1),
        finalize(() => {
          this.replayLoadingByResponseId[responseId] = false;
        })
      )
      .subscribe({
        next: result => {
          if (!result.replayUrl) {
            this.showError(
              this.translateService.instant(
                'double-coded-review.errors.replay-failed'
              )
            );
            return;
          }

          const replayWindow = window.open(
            this.buildReplayDecisionUrl(result.replayUrl, responseId, item),
            '_blank'
          );
          if (replayWindow) {
            this.replayWindowByResponseId.set(responseId, replayWindow);
          }
        },
        error: () => {
          this.showError(
            this.translateService.instant(
              'double-coded-review.errors.replay-failed'
            )
          );
        }
      });
  }

  private buildReplayDecisionUrl(
    replayUrl: string,
    responseId: number,
    item?: DoubleCodedItem
  ): string {
    return appendReplayUrlParams(normalizeReplayUrlToCurrentOrigin(replayUrl), {
      mode: 'coding-decision',
      originResponseId: responseId,
      workspaceId: this.appService.selectedWorkspaceId,
      decisionReadOnly: item?.isResolved || undefined,
      reviewCodeSelections: item ?
        this.serializeReviewCodeSelections(item) :
        undefined
    });
  }

  private serializeReviewCodeSelections(
    item: DoubleCodedItem
  ): string | undefined {
    const selections = this.getReviewCodeSelections(item);
    return selections.length > 0 ? JSON.stringify(selections) : undefined;
  }

  private getReviewCodeSelections(
    item: DoubleCodedItem
  ): ReviewCodeSelection[] {
    const coderNamesByCode = new Map<number, string[]>();

    item.coderResults.forEach(result => {
      const coderName = this.getCoderDisplayName(result);
      this.getReviewSelectionCodes(result).forEach(code => {
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

  private getReviewSelectionCodes(result: CoderResult): number[] {
    if (
      result.codingIssueOption !== null &&
      result.codingIssueOption !== undefined &&
      this.standaloneCodingIssueOptionIds.has(result.codingIssueOption)
    ) {
      return [result.codingIssueOption];
    }

    const codes = new Set<number>();
    if (result.code !== null && result.code !== undefined) {
      codes.add(result.code);
    }
    if (
      result.codingIssueOption !== null &&
      result.codingIssueOption !== undefined
    ) {
      codes.add(result.codingIssueOption);
    }
    return Array.from(codes);
  }

  private handleReplayCodeSelected(
    data: ReplayCodeSelectedMessage,
    source: MessageEventSource | null,
    origin: string = window.location.origin
  ): void {
    if (!this.isReplayMessageSourceAllowed(data, source, origin)) {
      return;
    }

    const item = this.findReplaySelectedItem(data);
    const selectedCode = this.parseReplaySelectedCode(data.code);

    if (!item || selectedCode === null) {
      this.showError(
        this.translateService.instant(
          'double-coded-review.errors.replay-code-not-in-decisions'
        )
      );
      return;
    }

    const selectedScore = this.parseReplaySelectedScore(
      data.score,
      Object.prototype.hasOwnProperty.call(data, 'score')
    );
    if (!selectedScore.isValid) {
      this.showError(
        this.translateService.instant(
          'double-coded-review.errors.replay-code-not-in-decisions'
        )
      );
      return;
    }

    const hasReplayNotes = Object.prototype.hasOwnProperty.call(data, 'notes');
    const replayNotes = this.normalizeReplayMessageText(data.notes);
    const selectedResult = this.findReplaySelectedResult(
      item,
      selectedCode,
      selectedScore
    );

    if (selectedResult) {
      const selectedJobId = selectedResult.jobId.toString();
      this.replayDecisionByResponseId.delete(item.responseId);
      this.getOrCreateFormControl(this.getItemControlName(item)).setValue(
        selectedJobId
      );
      this.onSelectionChange(item, selectedJobId);
      this.applyReplayNotesToComment(item, replayNotes, hasReplayNotes);
      this.showSuccess(
        this.translateService.instant(
          'double-coded-review.success.replay-code-selected'
        )
      );
      return;
    }

    const replayDecision: ReplayDecisionResult = {
      source: 'replay',
      code: selectedCode,
      score: selectedScore.value,
      ...(replayNotes ? { notes: replayNotes } : {})
    };
    this.replayDecisionByResponseId.set(item.responseId, replayDecision);
    item.selectedCoderResult = undefined;
    this.getOrCreateFormControl(this.getItemControlName(item)).setValue(
      this.getReplayDecisionControlValue(item)
    );
    this.applyReplayNotesToComment(item, replayNotes, hasReplayNotes);
    this.updateCurrentSelectionCode(item);
    this.persistManagerDraft(item);
    this.refreshReviewRows(item);
    this.showSuccess(
      this.translateService.instant(
        'double-coded-review.success.replay-code-selected'
      )
    );
  }

  private applyReplayNotesToComment(
    item: DoubleCodedItem,
    notes: string,
    hasReplayNotes: boolean
  ): void {
    if (!hasReplayNotes) {
      return;
    }

    this.getOrCreateFormControl(this.getCommentControlName(item)).setValue(
      notes
    );
  }

  private isReplayMessageSourceAllowed(
    data: ReplayCodeSelectedMessage,
    source: MessageEventSource | null,
    origin: string
  ): boolean {
    if (!data.responseId || !source || origin !== window.location.origin) {
      return false;
    }

    return this.replayWindowByResponseId.get(data.responseId) === source;
  }

  private findReplaySelectedItem(
    data: ReplayCodeSelectedMessage
  ): DoubleCodedItem | undefined {
    const variableId = this.normalizeReplayMessageText(
      data.variableId
    ).toLowerCase();
    const candidates = data.responseId ?
      this.allData.filter(item => item.responseId === data.responseId) :
      this.allData;

    return (
      candidates.find(
        item => item.variableId.trim().toLowerCase() === variableId
      ) || (data.responseId ? candidates[0] : undefined)
    );
  }

  private parseReplaySelectedCode(code: unknown): number | null {
    if (typeof code !== 'string' && typeof code !== 'number') {
      return null;
    }

    const trimmedCode = String(code).trim();
    if (trimmedCode === '') {
      return null;
    }

    const selectedCode = Number(trimmedCode);
    return Number.isFinite(selectedCode) ? selectedCode : null;
  }

  private parseReplaySelectedScore(
    score: unknown,
    hasScore: boolean
  ): ParsedReplayScore {
    if (!hasScore) {
      return { isValid: true, hasScore: false, value: null };
    }

    if (score === null) {
      return { isValid: true, hasScore: true, value: null };
    }

    if (typeof score !== 'string' && typeof score !== 'number') {
      return { isValid: false };
    }

    if (typeof score === 'string' && score.trim() === '') {
      return { isValid: false };
    }

    const selectedScore = Number(score);
    return Number.isFinite(selectedScore) ?
      { isValid: true, hasScore: true, value: selectedScore } :
      { isValid: false };
  }

  private findReplaySelectedResult(
    item: DoubleCodedItem,
    selectedCode: number,
    selectedScore: ValidReplayScore
  ): CoderResult | undefined {
    const matchingCodeResults = item.coderResults.filter(
      result => result.code === selectedCode
    );

    if (selectedScore.hasScore) {
      return matchingCodeResults.find(
        result => result.score === selectedScore.value
      );
    }

    return matchingCodeResults[0];
  }

  private normalizeReplayMessageText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private getReplayDecisionControlValue(item: DoubleCodedItem): string {
    return `${this.replayDecisionPrefix}${item.responseId}`;
  }

  getCatalogDecisionControlValue(code: number): string {
    return `${this.catalogDecisionPrefix}${code}`;
  }

  private getCatalogDecisionForControlValue(
    item: DoubleCodedItem,
    controlValue: string | null | undefined
  ): CatalogDecisionResult | undefined {
    if (!controlValue?.startsWith(this.catalogDecisionPrefix)) {
      return undefined;
    }
    const code = Number(controlValue.slice(this.catalogDecisionPrefix.length));
    const option = item.availableCodes.find(
      candidate => candidate.code === code
    );
    if (option) {
      return {
        source: 'catalog',
        code: option.code,
        score: option.score,
        label: option.label
      };
    }

    if (item.isResolved && item.appliedCode === code) {
      return {
        source: 'catalog',
        code,
        score: item.appliedScore,
        label: this.getCodeLabel(code) || String(code)
      };
    }
    return undefined;
  }

  private getReplayDecisionForControlValue(
    item: DoubleCodedItem,
    controlValue: string | null | undefined
  ): ReplayDecisionResult | undefined {
    return controlValue === this.getReplayDecisionControlValue(item) ?
      this.replayDecisionByResponseId.get(item.responseId) :
      undefined;
  }

  private getOwnManagerDraft(
    item: DoubleCodedItem
  ): DoubleCodedManagerDecisionDto | undefined {
    return (item.managerDrafts || []).find(
      decision => decision.managerUserId === this.appService.userId
    );
  }

  private getModeCode(item: DoubleCodedItem): number | null {
    const availableCodes = new Set(
      (
        item.availableCodes || this.getFallbackAvailableCodes(item.coderResults)
      ).map(option => option.code)
    );
    const counts = new Map<number, number>();
    item.coderResults.forEach(result => {
      const code =
        result.codingIssueOption !== null &&
        result.codingIssueOption !== undefined &&
        this.standaloneCodingIssueOptionIds.has(result.codingIssueOption) ?
          result.codingIssueOption :
          result.code;
      if (
        code === null ||
        code === undefined ||
        code === -1 ||
        code === -2 ||
        !availableCodes.has(code)
      ) {
        return;
      }
      counts.set(code, (counts.get(code) || 0) + 1);
    });
    if (counts.size === 0) {
      return null;
    }
    const highestCount = Math.max(...counts.values());
    const candidates = [...counts.entries()]
      .filter(([, count]) => count === highestCount)
      .map(([code]) => code);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private persistManagerDraft(item: DoubleCodedItem): void {
    if (item.isResolved) {
      return;
    }
    const workspaceId = this.appService.selectedWorkspaceId;
    const selectedValue = this.selectionForm.get(
      this.getItemControlName(item)
    )?.value;
    const catalogDecision = this.getCatalogDecisionForControlValue(
      item,
      selectedValue
    );
    const replayDecision = this.getReplayDecisionForControlValue(
      item,
      selectedValue
    );
    const coderResult = selectedValue ?
      item.coderResults.find(
        result => result.jobId.toString() === selectedValue
      ) :
      undefined;
    const selected = catalogDecision || replayDecision || coderResult;
    if (
      !workspaceId ||
      !selected ||
      selected.code === null ||
      selected.code === -1 ||
      selected.code === -2
    ) {
      if (workspaceId && !selectedValue) {
        this.enqueueManagerDraftCommand({ kind: 'delete', workspaceId, item });
      }
      return;
    }

    const comment =
      this.selectionForm.get(this.getCommentControlName(item))?.value?.trim() ||
      null;
    this.enqueueManagerDraftCommand({
      kind: 'save',
      workspaceId,
      item,
      draft: {
        sourceUnitId: item.sourceUnitId,
        code: selected.code,
        score: selected.score,
        comment
      }
    });
  }

  private enqueueManagerDraftCommand(command: ManagerDraftCommand): void {
    const signature = this.getManagerDraftCommandSignature(command);
    if (
      this.lastManagerDraftCommandSignatureByResponseId.get(
        command.item.responseId
      ) === signature
    ) {
      return;
    }
    this.lastManagerDraftCommandSignatureByResponseId.set(
      command.item.responseId,
      signature
    );
    let queue = this.managerDraftCommandQueues.get(command.item.responseId);
    if (!queue) {
      queue = this.createManagerDraftCommandQueue();
      this.managerDraftCommandQueues.set(command.item.responseId, queue);
    }
    queue.next(command);
  }

  private getManagerDraftCommandSignature(
    command: ManagerDraftCommand
  ): string {
    return command.kind === 'delete' ?
      'delete' :
      JSON.stringify({
        code: command.draft.code,
        score: command.draft.score ?? null,
        comment: command.draft.comment ?? null
      });
  }

  private createManagerDraftCommandQueue(): Subject<ManagerDraftCommand> {
    const queue = new Subject<ManagerDraftCommand>();
    queue
      .pipe(
        concatMap(command => {
          let request: Observable<ManagerDraftCommandResult>;
          if (command.kind === 'save') {
            request = this.testPersonCodingService
              .saveDoubleCodedReviewDraft(
                command.workspaceId,
                command.item.responseId,
                command.draft
              )
              .pipe(map(savedDraft => ({ command, savedDraft })));
          } else {
            request = this.testPersonCodingService
              .deleteDoubleCodedReviewDraft(
                command.workspaceId,
                command.item.responseId
              )
              .pipe(map(() => ({ command, savedDraft: null })));
          }
          return request.pipe(
            catchError(() => {
              const signature = this.getManagerDraftCommandSignature(command);
              if (
                this.lastManagerDraftCommandSignatureByResponseId.get(
                  command.item.responseId
                ) === signature
              ) {
                this.lastManagerDraftCommandSignatureByResponseId.delete(
                  command.item.responseId
                );
              }
              this.storeCurrentReviewRecoveryDraft();
              return of(null);
            })
          );
        })
      )
      .subscribe(result => this.applyManagerDraftCommandResult(result));
    return queue;
  }

  private applyManagerDraftCommandResult(
    result: ManagerDraftCommandResult | null
  ): void {
    if (!result) {
      return;
    }
    const { command, savedDraft } = result;
    const managerDrafts = command.item.managerDrafts || [];
    const retainedDrafts = managerDrafts.filter(
      decision => decision.managerUserId !== this.appService.userId
    );
    if (savedDraft) {
      retainedDrafts.push(savedDraft);
    }
    managerDrafts.splice(0, managerDrafts.length, ...retainedDrafts);
    command.item.managerDrafts = managerDrafts;
  }

  private storeCurrentReviewRecoveryDraft(): void {
    const recoveryDraft = this.createReviewRecoveryDraft();
    if (recoveryDraft) {
      this.sessionRecoveryService.saveDraft(
        this.reviewRecoveryKey,
        recoveryDraft
      );
    }
  }

  hasConflict(item: DoubleCodedItem): boolean {
    // Keep same-coder deviations actionable; the detailed conflict type decides how they are labelled.
    return this.getConflictType(item) !== 'none';
  }

  getConflictType(item: DoubleCodedItem): ConflictType {
    const validResults = item.coderResults
      .map(result => ({
        coderId: result.coderId,
        signature: this.getCoderResultSignature(result)
      }))
      .filter(
        (result): result is { coderId: number; signature: string } => result.signature !== null
      );

    if (validResults.length < 2) {
      return 'none';
    }

    const signaturesByCoderId = new Map<number, Set<string>>();
    validResults.forEach(result => {
      const signatures =
        signaturesByCoderId.get(result.coderId) || new Set<string>();
      signatures.add(result.signature);
      signaturesByCoderId.set(result.coderId, signatures);
    });

    const hasSameCoderConflict = Array.from(signaturesByCoderId.values()).some(
      signatures => signatures.size > 1
    );
    const hasInterCoderConflict = validResults.some((result, index) => validResults
      .slice(index + 1)
      .some(
        otherResult => otherResult.coderId !== result.coderId &&
            otherResult.signature !== result.signature
      )
    );

    if (hasSameCoderConflict && hasInterCoderConflict) {
      return 'mixed';
    }

    if (hasSameCoderConflict) {
      return 'same-coder';
    }

    return hasInterCoderConflict ? 'inter-coder' : 'none';
  }

  private getCoderResultSignature(
    result: Pick<CoderResult, 'code' | 'score'>
  ): string | null {
    if (result.code === null || result.code === undefined) {
      return null;
    }

    return `${result.code}:${result.score ?? 'NULL'}`;
  }

  private getCoderDisplayName(
    result: Pick<CoderResult, 'coderId' | 'coderName'>
  ): string {
    return result.coderName?.trim() || `Coder ${result.coderId}`;
  }

  private getVisibleValueSummary(values: string[], visibleCount = 3): string {
    const visibleValues = values.slice(0, visibleCount);
    const remainingValueCount = values.length - visibleValues.length;

    return remainingValueCount > 0 ?
      `${visibleValues.join(', ')} (+${remainingValueCount})` :
      visibleValues.join(', ');
  }

  isAllCodersDone(item: DoubleCodedItem): boolean {
    return item.coderResults.every(cr => cr.code !== null);
  }

  getCoderCount(item: DoubleCodedItem): number {
    return this.getCoderCompletionStates(item).length;
  }

  getCodedCount(item: DoubleCodedItem): number {
    return this.getCoderCompletionStates(item).filter(isDone => isDone)
      .length;
  }

  getCoderCompletionStates(item: DoubleCodedItem): boolean[] {
    const resultsByCoderId = new Map<number, CoderResult[]>();

    item.coderResults.forEach(result => {
      const results = resultsByCoderId.get(result.coderId) || [];
      results.push(result);
      resultsByCoderId.set(result.coderId, results);
    });

    return Array.from(resultsByCoderId.values()).map(results => results.every(result => result.code !== null)
    );
  }

  onFilterChange(): void {
    this.showOnlyConflicts = this.agreementControl.value === 'differ';
    this.currentPage = 1;
    this.loadData();
  }

  areAllVisibleConflictsResolved(): boolean {
    const currentItems = this.dataSource.data;
    return currentItems.every(item => {
      if (!this.hasConflict(item)) {
        return true;
      }
      const controlName = this.getItemControlName(item);
      const value = this.selectionForm.get(controlName)?.value;
      return value && value !== '';
    });
  }

  getUnresolvedCount(): number {
    const currentItems = this.dataSource.data;
    return currentItems.filter(item => {
      if (!this.hasConflict(item)) return false;
      const controlName = this.getItemControlName(item);
      const value = this.selectionForm.get(controlName)?.value;
      return !value || value === '';
    }).length;
  }

  loadData(): void {
    this.isLoading = true;
    const agreementFilter = this.agreementControl.value || 'all';
    this.showOnlyConflicts = agreementFilter === 'differ';
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.translateService
        .get('double-coded-review.errors.no-workspace-selected')
        .subscribe(message => {
          this.showError(message);
        });
      this.isLoading = false;
      return;
    }

    if (this.filterOptionsLoaded && !this.hasScopeOptions()) {
      this.clearReviewData();
      return;
    }

    this.testPersonCodingService
      .getDoubleCodedVariablesForReview(
        workspaceId,
        this.currentPage,
        this.pageSize,
        this.showOnlyConflicts,
        false,
        this.searchControl.value || undefined,
        this.coderControl.value || undefined,
        this.statusControl.value || undefined,
        this.resolvedControl.value || undefined,
        agreementFilter,
        this.getSelectedJobDefinitionIds(),
        this.getSelectedCoderTrainingIds()
      )
      .subscribe({
        next: response => {
          this.allData = response.data.map(item => ({
            ...item,
            availableCodes:
              item.availableCodes ||
              this.getFallbackAvailableCodes(item.coderResults),
            managerDrafts: item.managerDrafts || [],
            managerHistory: item.managerHistory || [],
            selectedCoderResult:
              this.getAppliedMatchingCoderResult(item) ||
              item.coderResults.find(result => result.code !== null)
          }));
          this.updateDisplayedColumns(this.allData);
          this.dataSource.data = this.allData;
          this.totalItems = response.total;

          this.updateForm();
          this.restoreReviewRecoveryDraft();
          this.isLoading = false;
        },
        error: () => {
          this.updateDisplayedColumns([]);
          this.translateService
            .get('double-coded-review.errors.failed-to-load')
            .subscribe(message => {
              this.showError(message);
            });
          this.isLoading = false;
        }
      });
  }

  private clearReviewData(): void {
    this.allData = [];
    this.dataSource.data = [];
    this.totalItems = 0;
    this.updateDisplayedColumns([]);
    if (this.selectionForm) {
      this.updateForm();
    }
    this.isLoading = false;
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.loadData();
  }

  onSelectionChange(item: DoubleCodedItem, selectedJobId: string): void {
    this.replayDecisionByResponseId.delete(item.responseId);
    const selectedResult = item.coderResults.find(
      cr => cr.jobId.toString() === selectedJobId
    );
    if (selectedResult && selectedResult.code !== null) {
      item.selectedCoderResult = selectedResult;
    } else {
      item.selectedCoderResult = undefined;
    }
    this.updateCurrentSelectionCode(item);
    this.persistManagerDraft(item);
    this.refreshReviewRows(item);
  }

  private refreshReviewRows(item: DoubleCodedItem): void {
    const refreshedItem = { ...item };
    this.allData = this.allData.map(candidate => (candidate.responseId === item.responseId ? refreshedItem : candidate)
    );
    this.dataSource.data = this.dataSource.data.map(candidate => (candidate.responseId === item.responseId ? refreshedItem : candidate)
    );
  }

  applyReviewDecisions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.translateService
        .get('double-coded-review.errors.no-workspace-selected')
        .subscribe(message => {
          this.showError(message);
        });
      return;
    }

    const decisions: DoubleCodedResolutionDecisionDto[] = [];
    const currentItems = this.getCurrentItems();
    let hasIncomplete = false;

    currentItems.forEach(item => {
      if (item.isResolved) return; // Skip already resolved items

      const decision = this.getDecisionForItem(item);
      if (decision) {
        decisions.push(decision);
        if (!this.isAllCodersDone(item)) {
          hasIncomplete = true;
        }
      }
    });

    if (decisions.length === 0) {
      this.translateService
        .get('double-coded-review.errors.no-decisions')
        .subscribe(message => {
          this.showError(message);
        });
      return;
    }

    if (hasIncomplete) {
      this.confirmIncompleteResolution(workspaceId, decisions);
    } else {
      this.sendDecisions(workspaceId, decisions);
    }
  }

  applySingleDecision(item: DoubleCodedItem): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.translateService
        .get('double-coded-review.errors.no-workspace-selected')
        .subscribe(message => {
          this.showError(message);
        });
      return;
    }

    const decision = this.getDecisionForItem(item);

    if (!decision) {
      this.translateService
        .get('double-coded-review.errors.no-decision-for-item')
        .subscribe(message => {
          this.showError(message);
        });
      return;
    }

    if (!this.isAllCodersDone(item)) {
      this.confirmIncompleteResolution(workspaceId, [decision]);
    } else {
      this.sendDecisions(workspaceId, [decision]);
    }
  }

  private confirmIncompleteResolution(
    workspaceId: number,
    decisions: DoubleCodedResolutionDecisionDto[]
  ): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translateService.instant(
          'double-coded-review.warnings.incomplete-title'
        ),
        message: this.translateService.instant(
          'double-coded-review.warnings.incomplete-message'
        ),
        confirmButtonText: this.translateService.instant('confirm'),
        cancelButtonText: this.translateService.instant('cancel')
      }
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.sendDecisions(workspaceId, decisions);
      }
    });
  }

  private getDecisionForItem(
    item: DoubleCodedItem
  ): DoubleCodedResolutionDecisionDto | null {
    const controlName = this.getItemControlName(item);
    const selectedValue = this.selectionForm.get(controlName)?.value;
    const catalogDecision = this.getCatalogDecisionForControlValue(
      item,
      selectedValue
    );
    if (catalogDecision) {
      return this.withResolutionComment(item, {
        responseId: item.responseId,
        sourceUnitId: item.sourceUnitId,
        code: catalogDecision.code,
        score: catalogDecision.score
      });
    }
    const replayDecision = this.getReplayDecisionForControlValue(
      item,
      selectedValue
    );

    if (replayDecision) {
      return this.withResolutionComment(item, {
        responseId: item.responseId,
        sourceUnitId: item.sourceUnitId,
        code: replayDecision.code,
        score: replayDecision.score
      });
    }

    if (selectedValue) {
      const selectedResult = item.coderResults.find(
        cr => cr.jobId.toString() === selectedValue
      );
      if (selectedResult && selectedResult.code !== null) {
        return this.withResolutionComment(item, {
          responseId: item.responseId,
          sourceUnitId: item.sourceUnitId,
          selectedJobId: selectedResult.jobId
        });
      }
    }
    return null;
  }

  private getFallbackAvailableCodes(
    coderResults: CoderResult[]
  ): DoubleCodedReviewCodeDto[] {
    const options = new Map<number, DoubleCodedReviewCodeDto>();
    coderResults.forEach(result => {
      const codes =
        result.codingIssueOption !== null &&
        result.codingIssueOption !== undefined &&
        this.standaloneCodingIssueOptionIds.has(result.codingIssueOption) ?
          [result.codingIssueOption] :
          [result.code];
      codes.forEach(code => {
        if (code === null || code === -1 || code === -2 || options.has(code)) {
          return;
        }
        options.set(code, {
          code,
          label: this.getCodeLabel(code) || String(code),
          score: result.score,
          source: code < 0 ? 'general' : 'schema',
          commentRequired: false
        });
      });
    });
    [-3, -4].forEach(code => {
      if (!options.has(code)) {
        options.set(code, {
          code,
          label: this.getCodeLabel(code),
          score: null,
          source: 'general',
          commentRequired: false
        });
      }
    });
    return [...options.values()];
  }

  private withResolutionComment(
    item: DoubleCodedItem,
    decision: DoubleCodedResolutionDecisionDto
  ): DoubleCodedResolutionDecisionDto {
    const commentControlName = this.getCommentControlName(item);
    const comment = this.selectionForm.get(commentControlName)?.value;
    if (comment && comment.trim()) {
      decision.resolutionComment = comment.trim();
    }

    return decision;
  }

  private sendDecisions(
    workspaceId: number,
    decisions: DoubleCodedResolutionDecisionDto[]
  ): void {
    this.isLoading = true;
    this.testPersonCodingService
      .applyDoubleCodedResolutions(workspaceId, { decisions })
      .subscribe({
        next: response => {
          if (response.failedCount > 0 || response.skippedCount > 0) {
            this.translateService
              .get('double-coded-review.errors.resolutions-partially-applied', {
                applied: response.appliedCount,
                skipped: response.skippedCount,
                failed: response.failedCount
              })
              .subscribe(message => this.showError(message));
          } else {
            this.translateService
              .get('double-coded-review.success.resolutions-applied', {
                count: response.appliedCount
              })
              .subscribe(message => this.showSuccess(message));
          }
          if (response.appliedCount > 0) {
            this.testPersonCodingService.notifyTestResultsChanged({
              workspaceId,
              statisticsVersion: 'v2'
            });
            this.resultsApplied = true;
          }
          this.loadData();
        },
        error: () => {
          this.translateService
            .get('double-coded-review.errors.failed-to-apply')
            .subscribe(message => {
              this.showError(message);
            });
          this.isLoading = false;
        }
      });
  }

  private createReviewRecoveryDraft(): DoubleCodedReviewRecoveryDraft | null {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || !this.selectionForm || this.allData.length === 0) {
      return null;
    }

    const entries = this.allData
      .map(item => this.createReviewRecoveryEntry(item))
      .filter(
        (entry): entry is DoubleCodedReviewRecoveryEntry => entry !== null
      );
    if (entries.length === 0) {
      return null;
    }

    return {
      workspaceId,
      entries
    };
  }

  private createReviewRecoveryEntry(
    item: DoubleCodedItem
  ): DoubleCodedReviewRecoveryEntry | null {
    if (item.isResolved) {
      return null;
    }

    const selectedValue =
      this.selectionForm.get(this.getItemControlName(item))?.value || '';
    const comment =
      this.selectionForm.get(this.getCommentControlName(item))?.value || '';
    const replayDecision = this.replayDecisionByResponseId.get(item.responseId);
    const defaults = this.defaultReviewValueByResponseId.get(
      item.responseId
    ) || {
      selectedValue: '',
      comment: ''
    };
    const isDirty =
      !!replayDecision ||
      selectedValue !== defaults.selectedValue ||
      comment !== defaults.comment;
    if (!isDirty) {
      return null;
    }

    return {
      responseId: item.responseId,
      selectedValue,
      comment,
      ...(replayDecision ? { replayDecision } : {})
    };
  }

  private restoreReviewRecoveryDraft(): boolean {
    const draft =
      this.sessionRecoveryService.peekDraft<DoubleCodedReviewRecoveryDraft>(
        this.reviewRecoveryKey
      );
    if (!draft || draft.workspaceId !== this.appService.selectedWorkspaceId) {
      return false;
    }
    if (this.allData.length === 0 || !this.selectionForm) {
      return false;
    }

    const remainingEntries: DoubleCodedReviewRecoveryEntry[] = [];
    draft.entries.forEach(entry => {
      const item = this.allData.find(
        candidate => candidate.responseId === entry.responseId
      );
      if (!item) {
        remainingEntries.push(entry);
        return;
      }

      if (entry.replayDecision) {
        this.replayDecisionByResponseId.set(
          entry.responseId,
          entry.replayDecision
        );
        item.selectedCoderResult = undefined;
      } else {
        this.replayDecisionByResponseId.delete(entry.responseId);
      }

      const selectedValue =
        entry.selectedValue ||
        (entry.replayDecision ? this.getReplayDecisionControlValue(item) : '');
      this.getOrCreateFormControl(this.getItemControlName(item)).setValue(
        selectedValue
      );
      if (selectedValue && !entry.replayDecision) {
        this.onSelectionChange(item, selectedValue);
      } else {
        this.updateCurrentSelectionCode(item);
      }

      if (
        entry.comment ||
        this.selectionForm.get(this.getCommentControlName(item))
      ) {
        this.getOrCreateFormControl(this.getCommentControlName(item)).setValue(
          entry.comment
        );
      }
    });

    if (remainingEntries.length > 0) {
      this.sessionRecoveryService.saveDraft(this.reviewRecoveryKey, {
        ...draft,
        entries: remainingEntries
      });
    } else {
      this.sessionRecoveryService.clearDraft(this.reviewRecoveryKey);
    }

    return remainingEntries.length !== draft.entries.length;
  }

  private showError(message: string): void {
    this.translateService.get('close').subscribe(closeText => {
      this.snackBar.open(message, closeText, {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    });
  }

  private showSuccess(message: string): void {
    this.translateService.get('close').subscribe(closeText => {
      this.snackBar.open(message, closeText, {
        duration: 5000,
        panelClass: ['success-snackbar']
      });
    });
  }

  getCodeDisplay(code: number | null): string {
    if (code === null || code === undefined) {
      return 'N/A';
    }

    switch (code) {
      case -1:
      case -2:
        return '';
      default:
        return code.toString();
    }
  }

  getCodeLabel(code: number | null): string {
    if (code === null || code === undefined) {
      return '';
    }

    switch (code) {
      case -1:
        return this.translateService.instant(
          'code-selector.coding-issue-options.code-assignment-uncertain'
        );
      case -2:
        return this.translateService.instant(
          'code-selector.coding-issue-options.new-code-needed'
        );
      case -3:
        return this.translateService.instant(
          'code-selector.coding-issue-options.invalid-joke-answer'
        );
      case -4:
        return this.translateService.instant(
          'code-selector.coding-issue-options.technical-problems'
        );
      default:
        return '';
    }
  }

  close(): void {
    if (this.dialogRef) {
      this.dialogRef.close({ resultsApplied: this.resultsApplied });
    }
  }
}
