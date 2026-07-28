import {
  ChangeDetectorRef,
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
  finalize
} from 'rxjs';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { DoubleCodedReviewApiService } from '../../services/double-coded-review-api.service';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { CodingFacadeService } from '../../../services/facades/coding-facade.service';
import { JobDefinition } from '../../services/coding-job-backend.service';
import { CoderTraining } from '../../models/coder-training.model';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import {
  appendReplayUrlParams,
  normalizeReplayUrlToCurrentOrigin
} from '../../utils/replay-url.util';
import { ReviewCodeSelection } from '../../../replay/services/units-replay.service';
import { getJobDefinitionDisplayLabel } from '../../utils/job-definition-display.util';
import {
  DoubleCodedManagerDecisionDto,
  DoubleCodedResolutionDecisionDto,
  DoubleCodedReviewCodeDto
} from '../../../../../../../api-dto/coding/double-coded-review.dto';
import { DoubleCodedDecisionCellComponent } from './double-coded-decision-cell.component';
import { DoubleCodedReviewFacade } from './double-coded-review.facade';
import {
  ConflictType,
  CoderResult,
  DoubleCodedItem,
  ReplayCodeSelectedMessage,
  ReplayDecisionSelection
} from './double-coded-review.models';
import {
  ReplayDecisionBridgeEvent,
  ReplayDecisionBridgeService
} from './replay-decision-bridge.service';

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
    TranslateModule,
    DoubleCodedDecisionCellComponent
  ],
  providers: [
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl },
    DoubleCodedReviewFacade,
    ReplayDecisionBridgeService
  ]
})
export class DoubleCodedReviewComponent implements OnInit, OnDestroy {
  private testPersonCodingService = inject(TestPersonCodingService);
  private doubleCodedReviewApi = inject(DoubleCodedReviewApiService);
  private appService: AppService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  private dialog = inject(MatDialog);
  private workspaceService = inject(WorkspaceBackendService);
  private codingFacadeService = inject(CodingFacadeService);
  private codingStatisticsService = inject(CodingStatisticsService);
  private reviewFacade = inject(DoubleCodedReviewFacade);
  private replayDecisionBridge = inject(ReplayDecisionBridgeService);
  private changeDetectorRef = inject(ChangeDetectorRef);
  selectionForm: FormGroup = this.reviewFacade.selectionForm;

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
  statusControl = new FormControl<'all' | 'done' | 'pending'>('all');
  resolvedControl = new FormControl<'all' | 'resolved' | 'unresolved'>('all');
  scopeControl = new FormControl<string[]>([]);
  availableCoders: { id: number; name: string }[] = [];
  availableJobDefinitions: Array<{ id: number; label: string }> = [];
  availableCoderTrainings: Array<{ id: number; label: string }> = [];
  private filterOptionsLoaded = false;
  private resultsApplied = false;
  private destroy$ = new Subject<void>();

  selectedItem: DoubleCodedItem | null = null;
  replayLoadingByResponseId: Record<number, boolean> = {};
  private get replayWindowByResponseId(): Map<number, MessageEventSource> {
    return this.replayDecisionBridge.replayWindowByResponseId;
  }

  private readonly standaloneCodingIssueOptionIds = new Set([-3, -4]);

  ngOnInit(): void {
    this.reviewFacade.connectRecovery(() => this.allData);
    this.setupFilters();
    this.loadCoders();
    this.loadFilterOptions();
    this.replayDecisionBridge.events$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => this.handleReplayBridgeEvent(event));
  }

  ngOnDestroy(): void {
    this.reviewFacade.destroy(this.allData);
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
      return (
        this.availableJobDefinitions.find(
          definition => definition.id === scopeId
        )?.label || getJobDefinitionDisplayLabel({ id: scopeId })
      );
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
    return this.reviewFacade.getItemControl(item);
  }

  getCommentControl(item: DoubleCodedItem): FormControl {
    return this.reviewFacade.getCommentControl(item);
  }

  private updateForm(): void {
    this.reviewFacade.initialize(this.dataSource.data);
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
    const selectedCode = decision.selectedCode ?? decision.effectiveCode;
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

  isAppliedCodeMatch(item: DoubleCodedItem, result: CoderResult): boolean {
    return this.reviewFacade.isAppliedCodeMatch(item, result);
  }

  isCurrentCodeMatch(item: DoubleCodedItem, result: CoderResult): boolean {
    return this.reviewFacade.isCurrentCodeMatch(item, result);
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
            this.replayDecisionBridge.registerReplayWindow(
              responseId,
              replayWindow
            );
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
    const event = this.replayDecisionBridge.accept(data, source, origin);
    if (event) this.handleReplayBridgeEvent(event);
  }

  private handleReplayBridgeEvent(event: ReplayDecisionBridgeEvent): void {
    if (event.kind === 'invalid') {
      this.showReplaySelectionError();
      return;
    }
    this.applyReplayDecisionSelection(event.selection);
  }

  private applyReplayDecisionSelection(
    selection: ReplayDecisionSelection
  ): void {
    const candidates = this.allData.filter(
      item => item.responseId === selection.responseId
    );
    const item =
      candidates.find(
        candidate => candidate.variableId.trim().toLowerCase() === selection.variableId
      ) || candidates[0];
    if (!item) {
      this.showReplaySelectionError();
      return;
    }

    this.reviewFacade.applyReplaySelection(
      item,
      selection.code,
      selection.score,
      selection.hasScore,
      selection.notes,
      selection.hasNotes
    );
    this.refreshReviewRows(item);
    this.changeDetectorRef.detectChanges();
    this.showSuccess(
      this.translateService.instant(
        'double-coded-review.success.replay-code-selected'
      )
    );
  }

  private showReplaySelectionError(): void {
    this.showError(
      this.translateService.instant(
        'double-coded-review.errors.replay-code-not-in-decisions'
      )
    );
  }

  getCatalogDecisionControlValue(code: number): string {
    return this.reviewFacade.getCatalogDecisionControlValue(code);
  }

  hasConflict(item: DoubleCodedItem): boolean {
    return this.getConflictType(item) !== 'none';
  }

  getConflictType(item: DoubleCodedItem): ConflictType {
    return this.reviewFacade.getConflictType(item);
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
    return item.coderResults.every(result => result.code !== null);
  }

  getCoderCount(item: DoubleCodedItem): number {
    return this.getCoderCompletionStates(item).length;
  }

  getCodedCount(item: DoubleCodedItem): number {
    return this.getCoderCompletionStates(item).filter(Boolean).length;
  }

  getCoderCompletionStates(item: DoubleCodedItem): boolean[] {
    return this.reviewFacade.getCoderCompletionStates(item);
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

    this.doubleCodedReviewApi
      .getDoubleCodedVariablesForReview(
        workspaceId,
        {
          page: this.currentPage,
          limit: this.pageSize,
          onlyConflicts: this.showOnlyConflicts,
          excludeTrainings: false,
          search: this.searchControl.value || undefined,
          coderId: this.coderControl.value || undefined,
          statusFilter: this.statusControl.value || undefined,
          resolvedFilter: this.resolvedControl.value || undefined,
          agreementFilter,
          jobDefinitionIds: this.getSelectedJobDefinitionIds(),
          coderTrainingIds: this.getSelectedCoderTrainingIds()
        }
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
              this.reviewFacade.getAppliedMatchingCoderResult(item) ||
              item.coderResults.find(result => result.code !== null)
          }));
          this.updateDisplayedColumns(this.allData);
          this.dataSource.data = this.allData;
          this.totalItems = response.total;

          this.updateForm();
          this.reviewFacade.restoreRecoveryDraft(this.allData);
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

  onSelectionChange(item: DoubleCodedItem, selectedValue: string): void {
    this.reviewFacade.select(item, selectedValue);
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
    return this.reviewFacade.getDecisionForItem(item);
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
          source: code < 0 ? 'general' : 'schema'
        });
      });
    });
    [-3, -4].forEach(code => {
      if (!options.has(code)) {
        options.set(code, {
          code,
          label: this.getCodeLabel(code),
          score: null,
          source: 'general'
        });
      }
    });
    return [...options.values()];
  }

  private sendDecisions(
    workspaceId: number,
    decisions: DoubleCodedResolutionDecisionDto[]
  ): void {
    this.isLoading = true;
    this.doubleCodedReviewApi
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
