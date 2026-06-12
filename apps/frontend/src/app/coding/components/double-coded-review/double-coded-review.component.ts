import {
  Component, OnInit, OnDestroy, Inject, Optional, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent, MatPaginatorIntl } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import {
  MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormControl
} from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  Subject, debounceTime, distinctUntilChanged, takeUntil, map, merge, catchError, of, forkJoin, take, finalize
} from 'rxjs';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { CodingFacadeService } from '../../../services/facades/coding-facade.service';
import { JobDefinition } from '../../services/coding-job-backend.service';
import { CoderTraining } from '../../models/coder-training.model';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { PostMessage, PostMessageService } from '../../../core/services/post-message.service';
import {
  appendReplayUrlParams,
  normalizeReplayUrlToCurrentOrigin
} from '../../utils/replay-url.util';

interface CoderResult {
  coderId: number;
  coderName: string;
  jobId: number;
  jobName: string;
  code: number | null;
  score: number | null;
  notes: string | null;
  supervisorComment: string | null;
  codedAt: string;
}

interface DoubleCodedItem {
  responseId: number;
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
  coderResults: CoderResult[];
  selectedCoderResult?: CoderResult;
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
}

type DecisionResult = CoderResult | ReplayDecisionResult;

interface ReplayCodeSelectedMessage extends PostMessage {
  testPerson: string;
  unitId: string;
  variableId: unknown;
  code: unknown;
  score?: unknown;
  responseId?: number;
}

type ValidReplayScore = { isValid: true; hasScore: boolean; value: number | null };
type ParsedReplayScore = ValidReplayScore | { isValid: false };

type DoubleCodedResolutionDecision = {
  responseId: number;
  selectedJobId?: number;
  code?: number;
  score?: number | null;
  resolutionComment?: string;
};

interface CoderColumnMeta {
  columnId: string;
  coderId: number;
  label: string;
  coderNames: string[];
  jobNames: string[];
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

  constructor(
    @Optional() public dialogRef: MatDialogRef<DoubleCodedReviewComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public dialogData: unknown
  ) {}

  private staticColumns: string[] = ['unitVariable', 'personInfo', 'givenAnswer'];
  dynamicCoderColumns: string[] = [];
  displayedColumns: string[] = [...this.staticColumns, 'selection'];
  coderColumnMeta: Record<string, CoderColumnMeta> = {};

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
  private readonly replayDecisionPrefix = 'replay:';

  ngOnInit(): void {
    this.initializeForm();
    this.setupFilters();
    this.loadCoders();
    this.loadFilterOptions();
    this.postMessageService.getMessages<ReplayCodeSelectedMessage>('replayCodeSelected')
      .pipe(takeUntil(this.destroy$))
      .subscribe(data => this.handleReplayCodeSelected(data.message, data.source, data.origin));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupFilters(): void {
    const agreement$ = this.agreementControl.valueChanges.pipe(distinctUntilChanged());
    const search$ = this.searchControl.valueChanges.pipe(debounceTime(500), distinctUntilChanged());
    const coder$ = this.coderControl.valueChanges.pipe(distinctUntilChanged());
    const status$ = this.statusControl.valueChanges.pipe(distinctUntilChanged());
    const resolved$ = this.resolvedControl.valueChanges.pipe(distinctUntilChanged());
    const scope$ = this.scopeControl.valueChanges.pipe(
      distinctUntilChanged((a, b) => JSON.stringify(a || []) === JSON.stringify(b || []))
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

    this.workspaceService.getWorkspaceCoders(workspaceId)
      .pipe(
        map(response => response.data.map((user: { userId: number; username: string }) => ({
          id: user.userId,
          name: user.username || `User ${user.userId}`
        })))
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
      jobDefinitions: this.codingFacadeService.getJobDefinitions(workspaceId).pipe(catchError(() => of([] as JobDefinition[]))),
      coderTrainings: this.codingFacadeService.getCoderTrainings(workspaceId).pipe(catchError(() => of([] as CoderTraining[])))
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ jobDefinitions, coderTrainings }) => {
        const sortedJobDefinitions = [...jobDefinitions]
          .filter(definition => definition.id !== undefined && (definition.createdJobsCount ?? 0) > 0)
          .sort((a, b) => (b.id || 0) - (a.id || 0));

        this.availableJobDefinitions = sortedJobDefinitions.map(definition => ({
          id: definition.id!,
          label: this.getJobDefinitionLabel(definition)
        }));

        this.availableCoderTrainings = coderTrainings
          .filter(training => (training.jobsCount ?? 0) > 0)
          .map(training => ({
            id: training.id,
            label: this.getCoderTrainingLabel(training)
          }));

        const validScopes = new Set([
          ...this.availableJobDefinitions.map(definition => `job_${definition.id}`),
          ...this.availableCoderTrainings.map(training => `training_${training.id}`)
        ]);
        const currentScopes = (this.scopeControl.value || [])
          .filter(scope => validScopes.has(scope));

        if (currentScopes.length > 0) {
          this.scopeControl.setValue(currentScopes, { emitEvent: false });
        } else if (this.availableJobDefinitions.length > 0) {
          this.scopeControl.setValue([`job_${this.availableJobDefinitions[0].id}`], { emitEvent: false });
        } else if (this.availableCoderTrainings.length > 0) {
          this.scopeControl.setValue([`training_${this.availableCoderTrainings[0].id}`], { emitEvent: false });
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
    const definitionId = definition.id ?? 0;
    const statusLabel = this.getJobDefinitionStatusLabel(definition.status);
    const status = statusLabel ? ` (${statusLabel})` : '';
    const jobsCount = definition.createdJobsCount ?? 0;
    return `Definition #${definitionId}${status}, ${jobsCount} ${this.getJobCountLabel(jobsCount)}`;
  }

  private getCoderTrainingLabel(training: CoderTraining): string {
    const jobsCount = training.jobsCount ?? 0;
    const trainingLabel = training.label || this.translateService.instant('double-coded-review.filter.training-fallback', {
      id: training.id
    });
    return `${trainingLabel} (${jobsCount} ${this.getJobCountLabel(jobsCount)})`;
  }

  private getJobDefinitionStatusLabel(status: JobDefinition['status']): string {
    if (!status) {
      return '';
    }

    const statusKey = status === 'pending_review' ?
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
    return this.availableJobDefinitions.length > 0 || this.availableCoderTrainings.length > 0;
  }

  getScopeSelectionSummary(): string {
    if (this.filterOptionsLoaded && !this.hasScopeOptions()) {
      return this.translateService.instant('double-coded-review.filter.scope-none');
    }

    const selectedScopes = this.scopeControl.value || [];
    if (selectedScopes.length === 0) {
      return this.translateService.instant('double-coded-review.filter.scope-all');
    }

    if (selectedScopes.length === 1) {
      return this.getScopeLabel(selectedScopes[0]);
    }

    const selectedJobDefinitions = this.getSelectedJobDefinitionIds().length;
    const selectedTrainings = this.getSelectedCoderTrainingIds().length;
    return this.translateService.instant('double-coded-review.filter.scope-summary', {
      jobs: selectedJobDefinitions,
      trainings: selectedTrainings
    });
  }

  private getScopeLabel(scope: string): string {
    if (scope.startsWith('job_')) {
      const scopeId = parseInt(scope.replace('job_', ''), 10);
      return this.availableJobDefinitions.find(definition => definition.id === scopeId)?.label || `Definition #${scopeId}`;
    }

    if (scope.startsWith('training_')) {
      const scopeId = parseInt(scope.replace('training_', ''), 10);
      return this.availableCoderTrainings.find(training => training.id === scopeId)?.label ||
        this.translateService.instant('double-coded-review.filter.training-fallback', { id: scopeId });
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

    const currentItems = this.dataSource.data;

    currentItems.forEach(item => {
      const controlName = this.getItemControlName(item);

      const resolvedResult = this.getAppliedMatchingCoderResult(item) ||
        item.coderResults.find(cr => !!cr.supervisorComment);
      const firstCodedResult = item.coderResults.find(cr => cr.code !== null);

      let defaultValue = '';
      if (resolvedResult) {
        defaultValue = resolvedResult.jobId.toString();
      } else if (firstCodedResult) {
        defaultValue = firstCodedResult.jobId.toString();
      }

      this.selectionForm.addControl(controlName, new FormControl(defaultValue));

      const commentControlName = this.getCommentControlName(item);
      if (this.hasConflict(item) || (resolvedResult && resolvedResult.supervisorComment)) {
        const defaultComment = resolvedResult ? (resolvedResult.supervisorComment || '') : '';
        this.selectionForm.addControl(commentControlName, new FormControl(defaultComment));
      }
    });
  }

  private updateDisplayedColumns(items: DoubleCodedItem[]): void {
    const meta: Record<string, CoderColumnMeta> = {};

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

        if (result.jobName && !meta[columnId].jobNames.includes(result.jobName)) {
          meta[columnId].jobNames.push(result.jobName);
        }
      });
    });

    this.coderColumnMeta = meta;
    this.dynamicCoderColumns = Object.values(meta)
      .sort((a, b) => {
        const labelComparison = a.label.localeCompare(b.label, 'de', { sensitivity: 'base' });
        return labelComparison || a.coderId - b.coderId;
      })
      .map(column => column.columnId);

    this.displayedColumns = [...this.staticColumns, ...this.dynamicCoderColumns, 'selection'];
  }

  getSelectionColumnHeader(): string {
    return this.appService.authData.userName ||
      this.appService.loggedUser?.preferred_username ||
      this.translateService.instant('double-coded-review.columns.selection');
  }

  getCoderColumnHeader(columnId: string): string {
    return this.coderColumnMeta[columnId]?.label || this.translateService.instant('double-coded-review.columns.coder-results');
  }

  getCoderColumnTooltip(columnId: string): string {
    const meta = this.coderColumnMeta[columnId];
    if (!meta) return '';

    const details: string[] = [];
    const alternativeCoderNames = meta.coderNames.filter(name => name !== meta.label);

    if (alternativeCoderNames.length > 0) {
      const namesSummary = this.getVisibleValueSummary(alternativeCoderNames);
      const translatedAlternativeNames = this.translateService.instant(
        'double-coded-review.columns.alternative-coder-names',
        { names: namesSummary }
      );
      details.push(
        translatedAlternativeNames === 'double-coded-review.columns.alternative-coder-names' ?
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

  getCoderResultsForColumn(item: DoubleCodedItem, columnId: string): CoderResult[] {
    const meta = this.coderColumnMeta[columnId];
    if (!meta) return [];

    return item.coderResults
      .filter(result => result.coderId === meta.coderId)
      .sort((a, b) => {
        const jobNameComparison = a.jobName.localeCompare(b.jobName, 'de', { sensitivity: 'base' });
        return jobNameComparison || a.jobId - b.jobId;
      });
  }

  getCoderResultSourceLabel(result: CoderResult): string {
    return result.jobName ? `${result.jobName} (#${result.jobId})` : `#${result.jobId}`;
  }

  hasMultipleResultsForCoder(item: DoubleCodedItem, result: Pick<CoderResult, 'coderId'>): boolean {
    return item.coderResults.filter(coderResult => coderResult.coderId === result.coderId).length > 1;
  }

  getDecisionResultSourceLabel(item: DoubleCodedItem, result: DecisionResult): string {
    if (this.isReplayDecisionResult(result)) {
      return this.translateService.instant('double-coded-review.decision.replay-source');
    }

    if (!this.hasMultipleResultsForCoder(item, result)) {
      return this.getCoderDisplayName(result);
    }

    return `${this.getCoderDisplayName(result)} - ${this.getCoderResultSourceLabel(result)}`;
  }

  getSelectedDecisionResult(item: DoubleCodedItem): DecisionResult | undefined {
    const selectedValue = this.selectionForm?.get(this.getItemControlName(item))?.value;
    const replayDecision = this.getReplayDecisionForControlValue(item, selectedValue);
    if (replayDecision) {
      return replayDecision;
    }

    const selectedResult = selectedValue ?
      item.coderResults.find(result => result.jobId.toString() === selectedValue) :
      item.selectedCoderResult;

    return selectedResult && selectedResult.code !== null ? selectedResult : undefined;
  }

  private isReplayDecisionResult(result: DecisionResult): result is ReplayDecisionResult {
    return 'source' in result && result.source === 'replay';
  }

  getAppliedReviewResult(item: DoubleCodedItem): AppliedReviewResult | null {
    if (!item.isResolved) {
      return null;
    }

    const code = item.appliedCode ?? null;
    const score = item.appliedScore ?? null;
    const comment = item.appliedComment?.trim() ||
      item.coderResults.find(result => !!result.supervisorComment)?.supervisorComment?.trim() ||
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

  getAppliedMatchingCoderResult(item: DoubleCodedItem): CoderResult | undefined {
    const appliedResult = this.getAppliedReviewResult(item);
    if (!appliedResult || appliedResult.code === null) {
      return undefined;
    }

    return item.coderResults.find(result => (
      result.code === appliedResult.code &&
      (result.score ?? null) === (appliedResult.score ?? null)
    )) || item.coderResults.find(result => result.code === appliedResult.code);
  }

  getAppliedResultSourceLabel(item: DoubleCodedItem): string {
    const matchingResult = this.getAppliedMatchingCoderResult(item);
    if (matchingResult) {
      return this.getDecisionResultSourceLabel(item, matchingResult);
    }

    return this.translateService.instant('double-coded-review.applied-result.final-source');
  }

  getAppliedResultTooltip(item: DoubleCodedItem): string {
    const appliedResult = this.getAppliedReviewResult(item);
    if (!appliedResult) {
      return '';
    }

    const codeDisplay = this.getCodeDisplay(appliedResult.code) || this.getCodeLabel(appliedResult.code) || 'N/A';
    const scoreDisplay = appliedResult.score !== null ? ` (${appliedResult.score})` : '';

    return `${this.translateService.instant('double-coded-review.applied-result.label')}: ${codeDisplay}${scoreDisplay}`;
  }

  isAppliedCodeMatch(item: DoubleCodedItem, result: CoderResult): boolean {
    const appliedResult = this.getAppliedReviewResult(item);
    return !!appliedResult &&
      appliedResult.code !== null &&
      result.code === appliedResult.code;
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
      return this.translateService.instant(`double-coded-review.decision.status-${conflictType}-conflict`);
    }

    return this.translateService.instant(`double-coded-review.decision.status-${statusClass}`);
  }

  getDecisionStatusTooltip(item: DoubleCodedItem): string {
    if (item.isResolved) {
      return this.translateService.instant('double-coded-review.applied');
    }

    const progressText = `${this.getCodedCount(item)}/${this.getCoderCount(item)} ${
      this.translateService.instant('double-coded-review.coders-done')
    }`;
    const conflictType = this.getConflictType(item);

    if (conflictType === 'none') {
      return progressText;
    }

    return `${this.translateService.instant(`double-coded-review.decision.tooltip-${conflictType}-conflict`)} - ${progressText}`;
  }

  shouldShowDecisionComment(item: DoubleCodedItem): boolean {
    return this.hasConflict(item) ||
      !!this.selectionForm?.get(this.getCommentControlName(item))?.value;
  }

  isGeoGebraAnswer(value: string | null | undefined): boolean {
    const normalizedValue = (value || '').trim();
    return normalizedValue.startsWith('UEsD') || /^data:[^,]*;base64,UEsD/i.test(normalizedValue);
  }

  getAnswerDisplay(value: string | null | undefined): string {
    if (!value) {
      return 'N/A';
    }

    if (this.isGeoGebraAnswer(value)) {
      return this.translateService.instant('double-coded-review.values.geogebra-answer');
    }

    return value;
  }

  getAnswerTooltip(value: string | null | undefined): string {
    if (!value) {
      return 'N/A';
    }

    if (this.isGeoGebraAnswer(value)) {
      return this.translateService.instant('double-coded-review.values.geogebra-tooltip');
    }

    return value;
  }

  openReplay(responseId: number): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId || !responseId) {
      this.showError(this.translateService.instant('coding-management.descriptions.missing-replay-info'));
      return;
    }

    this.replayLoadingByResponseId[responseId] = true;
    this.codingStatisticsService.getReplayUrl(workspaceId, responseId).pipe(
      take(1),
      finalize(() => {
        this.replayLoadingByResponseId[responseId] = false;
      })
    ).subscribe({
      next: result => {
        if (!result.replayUrl) {
          this.showError(this.translateService.instant('double-coded-review.errors.replay-failed'));
          return;
        }

        const replayWindow = window.open(this.buildReplayDecisionUrl(result.replayUrl, responseId), '_blank');
        if (replayWindow) {
          this.replayWindowByResponseId.set(responseId, replayWindow);
        }
      },
      error: () => {
        this.showError(this.translateService.instant('double-coded-review.errors.replay-failed'));
      }
    });
  }

  private buildReplayDecisionUrl(replayUrl: string, responseId: number): string {
    return appendReplayUrlParams(
      normalizeReplayUrlToCurrentOrigin(replayUrl),
      {
        mode: 'coding-decision',
        originResponseId: responseId,
        workspaceId: this.appService.selectedWorkspaceId
      }
    );
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
      this.showError(this.translateService.instant('double-coded-review.errors.replay-code-not-in-decisions'));
      return;
    }

    const selectedScore = this.parseReplaySelectedScore(
      data.score,
      Object.prototype.hasOwnProperty.call(data, 'score')
    );
    if (!selectedScore.isValid) {
      this.showError(this.translateService.instant('double-coded-review.errors.replay-code-not-in-decisions'));
      return;
    }

    const selectedResult = this.findReplaySelectedResult(item, selectedCode, selectedScore);

    if (selectedResult) {
      const selectedJobId = selectedResult.jobId.toString();
      this.replayDecisionByResponseId.delete(item.responseId);
      this.getOrCreateFormControl(this.getItemControlName(item)).setValue(selectedJobId);
      this.onSelectionChange(item, selectedJobId);
      this.showSuccess(this.translateService.instant('double-coded-review.success.replay-code-selected'));
      return;
    }

    const replayDecision: ReplayDecisionResult = {
      source: 'replay',
      code: selectedCode,
      score: selectedScore.value
    };
    this.replayDecisionByResponseId.set(item.responseId, replayDecision);
    item.selectedCoderResult = undefined;
    this.getOrCreateFormControl(this.getItemControlName(item))
      .setValue(this.getReplayDecisionControlValue(item));
    this.showSuccess(this.translateService.instant('double-coded-review.success.replay-code-selected'));
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

  private findReplaySelectedItem(data: ReplayCodeSelectedMessage): DoubleCodedItem | undefined {
    const variableId = this.normalizeReplayMessageText(data.variableId).toLowerCase();
    const candidates = data.responseId ?
      this.allData.filter(item => item.responseId === data.responseId) :
      this.allData;

    return candidates.find(item => item.variableId.trim().toLowerCase() === variableId) ||
      (data.responseId ? candidates[0] : undefined);
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

  private parseReplaySelectedScore(score: unknown, hasScore: boolean): ParsedReplayScore {
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
    const matchingCodeResults = item.coderResults
      .filter(result => result.code === selectedCode);

    if (selectedScore.hasScore) {
      return matchingCodeResults.find(result => result.score === selectedScore.value);
    }

    return matchingCodeResults[0];
  }

  private normalizeReplayMessageText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private getReplayDecisionControlValue(item: DoubleCodedItem): string {
    return `${this.replayDecisionPrefix}${item.responseId}`;
  }

  private getReplayDecisionForControlValue(
    item: DoubleCodedItem,
    controlValue: string | null | undefined
  ): ReplayDecisionResult | undefined {
    return controlValue === this.getReplayDecisionControlValue(item) ?
      this.replayDecisionByResponseId.get(item.responseId) :
      undefined;
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
      .filter((result): result is { coderId: number; signature: string } => result.signature !== null);

    if (validResults.length < 2) {
      return 'none';
    }

    const signaturesByCoderId = new Map<number, Set<string>>();
    validResults.forEach(result => {
      const signatures = signaturesByCoderId.get(result.coderId) || new Set<string>();
      signatures.add(result.signature);
      signaturesByCoderId.set(result.coderId, signatures);
    });

    const hasSameCoderConflict = Array.from(signaturesByCoderId.values())
      .some(signatures => signatures.size > 1);
    const hasInterCoderConflict = validResults.some((result, index) => (
      validResults.slice(index + 1).some(otherResult => (
        otherResult.coderId !== result.coderId &&
        otherResult.signature !== result.signature
      ))
    ));

    if (hasSameCoderConflict && hasInterCoderConflict) {
      return 'mixed';
    }

    if (hasSameCoderConflict) {
      return 'same-coder';
    }

    return hasInterCoderConflict ? 'inter-coder' : 'none';
  }

  private getCoderResultSignature(result: Pick<CoderResult, 'code' | 'score'>): string | null {
    if (result.code === null || result.code === undefined) {
      return null;
    }

    return `${result.code}:${result.score ?? 'NULL'}`;
  }

  private getCoderDisplayName(result: Pick<CoderResult, 'coderId' | 'coderName'>): string {
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
    return this.getCoderCompletionStates(item).filter(isDone => isDone).length;
  }

  getCoderCompletionStates(item: DoubleCodedItem): boolean[] {
    const resultsByCoderId = new Map<number, CoderResult[]>();

    item.coderResults.forEach(result => {
      const results = resultsByCoderId.get(result.coderId) || [];
      results.push(result);
      resultsByCoderId.set(result.coderId, results);
    });

    return Array.from(resultsByCoderId.values())
      .map(results => results.every(result => result.code !== null));
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
      this.translateService.get('double-coded-review.errors.no-workspace-selected').subscribe(message => {
        this.showError(message);
      });
      this.isLoading = false;
      return;
    }

    if (this.filterOptionsLoaded && !this.hasScopeOptions()) {
      this.clearReviewData();
      return;
    }

    this.testPersonCodingService.getDoubleCodedVariablesForReview(
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
    ).subscribe({
      next: response => {
        this.allData = response.data.map(item => ({
          ...item,
          selectedCoderResult: this.getAppliedMatchingCoderResult(item) ||
            item.coderResults.find(result => result.code !== null)
        }));
        this.updateDisplayedColumns(this.allData);
        this.dataSource.data = this.allData;
        this.totalItems = response.total;

        this.updateForm();
        this.isLoading = false;
      },
      error: () => {
        this.updateDisplayedColumns([]);
        this.translateService.get('double-coded-review.errors.failed-to-load').subscribe(message => {
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
    const selectedResult = item.coderResults.find(cr => cr.jobId.toString() === selectedJobId);
    if (selectedResult && selectedResult.code !== null) {
      item.selectedCoderResult = selectedResult;
    }
  }

  applyReviewDecisions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.translateService.get('double-coded-review.errors.no-workspace-selected').subscribe(message => {
        this.showError(message);
      });
      return;
    }

    const decisions: DoubleCodedResolutionDecision[] = [];
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
      this.translateService.get('double-coded-review.errors.no-decisions').subscribe(message => {
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
      this.translateService.get('double-coded-review.errors.no-workspace-selected').subscribe(message => {
        this.showError(message);
      });
      return;
    }

    const decision = this.getDecisionForItem(item);

    if (!decision) {
      this.translateService.get('double-coded-review.errors.no-decision-for-item').subscribe(message => {
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

  private confirmIncompleteResolution(workspaceId: number, decisions: DoubleCodedResolutionDecision[]): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translateService.instant('double-coded-review.warnings.incomplete-title'),
        message: this.translateService.instant('double-coded-review.warnings.incomplete-message'),
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

  private getDecisionForItem(item: DoubleCodedItem): DoubleCodedResolutionDecision | null {
    const controlName = this.getItemControlName(item);
    const selectedValue = this.selectionForm.get(controlName)?.value;
    const replayDecision = this.getReplayDecisionForControlValue(item, selectedValue);

    if (replayDecision) {
      return this.withResolutionComment(item, {
        responseId: item.responseId,
        code: replayDecision.code,
        score: replayDecision.score
      });
    }

    if (selectedValue) {
      const selectedResult = item.coderResults.find(cr => cr.jobId.toString() === selectedValue);
      if (selectedResult && selectedResult.code !== null) {
        return this.withResolutionComment(item, {
          responseId: item.responseId,
          selectedJobId: selectedResult.jobId
        });
      }
    }
    return null;
  }

  private withResolutionComment(
    item: DoubleCodedItem,
    decision: DoubleCodedResolutionDecision
  ): DoubleCodedResolutionDecision {
    if (this.hasConflict(item)) {
      const commentControlName = this.getCommentControlName(item);
      const comment = this.selectionForm.get(commentControlName)?.value;
      if (comment && comment.trim()) {
        decision.resolutionComment = comment.trim();
      }
    }

    return decision;
  }

  private sendDecisions(
    workspaceId: number,
    decisions: DoubleCodedResolutionDecision[]
  ): void {
    this.isLoading = true;
    this.testPersonCodingService.applyDoubleCodedResolutions(workspaceId, { decisions }).subscribe({
      next: response => {
        this.translateService.get('double-coded-review.success.resolutions-applied', {
          count: response.appliedCount
        }).subscribe(message => {
          this.showSuccess(message);
        });
        this.resultsApplied = true;
        this.loadData();
      },
      error: () => {
        this.translateService.get('double-coded-review.errors.failed-to-apply').subscribe(message => {
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
        return this.translateService.instant('code-selector.coding-issue-options.code-assignment-uncertain');
      case -2:
        return this.translateService.instant('code-selector.coding-issue-options.new-code-needed');
      case -3:
        return this.translateService.instant('code-selector.coding-issue-options.invalid-joke-answer');
      case -4:
        return this.translateService.instant('code-selector.coding-issue-options.technical-problems');
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
