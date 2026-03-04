import {
  Component, Inject, inject, OnInit,
  ViewChild
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatPaginator, MatPaginatorIntl, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SelectionModel } from '@angular/cdk/collections';

import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, takeUntil } from 'rxjs';
import { normalizeTestperson } from '../../../replay/utils/token-utils';
import { PostMessage, PostMessageService } from '../../../core/services/post-message.service';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { CoderTraining } from '../../models/coder-training.model';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { AppService } from '../../../core/services/app.service';

interface ReplayCodeSelectedMessage extends PostMessage {
  testPerson: string;
  unitId: string;
  variableId: string;
  code: string;
  responseId?: number;
}

interface TrainingComparison {
  responseId: number;
  unitName: string;
  variableId: string;
  personCode: string;
  personLogin: string;
  personGroup: string;
  testPerson: string;
  coders: Array<{
    trainingId: number;
    trainingLabel: string;
    coderId: number;
    coderName: string;
    code: string | null;
    score: number | null;
    notes?: string | null;
    codingIssueOption?: number | null;
  }>;
}

interface WithinTrainingComparison {
  responseId: number;
  unitName: string;
  variableId: string;
  testperson?: string;
  personLogin?: string;
  personCode?: string;
  personGroup?: string;
  replayCode?: number | null;
  replayScore?: number | null;
  discussionCode?: number | null;
  discussionScore?: number | null;
  discussionManagerUserId?: number | null;
  discussionManagerName?: string | null;
  coders: Array<{
    jobId: number;
    coderName: string;
    code: string | null;
    score: number | null;
    notes?: string | null;
    codingIssueOption?: number | null;
  }>;
}

type NotesFilterMode = 'all' | 'none' | 'with-notes';

interface ComparisonFilters {
  unitName: string;
  variableId: string;
  personLogin: string;
  personGroup: string;
  match: 'all' | 'match' | 'differ';
  notesMode: NotesFilterMode;
}

interface KappaCoderPair {
  coder1Id: number;
  coder1Name: string;
  coder2Id: number;
  coder2Name: string;
  kappa: number | null;
  agreement: number;
  totalItems: number;
  validPairs: number;
  interpretation: string;
}

interface KappaVariable {
  unitName: string;
  variableId: string;
  coderPairs: KappaCoderPair[];
}

interface KappaStatistics {
  variables: KappaVariable[];
  workspaceSummary: {
    totalDoubleCodedResponses: number;
    totalCoderPairs: number;
    averageKappa: number | null;
    meanAgreement?: number | null;
    variablesIncluded: number;
    codersIncluded: number;
    weightingMethod: 'weighted' | 'unweighted';
  };
}

interface VariableKappaSummary {
  key: string;
  unitName: string;
  variableId: string;
  meanKappa: number | null;
  meanAgreement: number | null;
  caseCount: number;
}

@Component({
  selector: 'coding-box-coding-results-comparison',
  templateUrl: './coding-results-comparison.component.html',
  styleUrls: ['./coding-results-comparison.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatProgressSpinner,
    MatButtonModule,
    MatIcon,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatRadioModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule
  ]
})
export class CodingResultsComparisonComponent implements OnInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) set matPaginator(mp: MatPaginator) {
    if (mp) {
      this.dataSource.paginator = mp;
    }
  }

  private codingTrainingBackendService = inject(CodingTrainingBackendService);
  private translate = inject(TranslateService);
  private snackBar = inject(MatSnackBar);
  private codingStatisticsService = inject(CodingStatisticsService);
  private appService = inject(AppService);
  private postMessageService = inject(PostMessageService);
  private ngUnsubscribe = new Subject<void>();

  isLoading = false;
  isLoadingKappa = false;
  dataSource = new MatTableDataSource<TrainingComparison | WithinTrainingComparison>([]);
  displayedColumns: string[] = ['index', 'unitName', 'variableId', 'personLogin', 'personCode', 'personGroup', 'match'];
  dynamicCoderColumns: string[] = [];
  availableTrainings: CoderTraining[] = [];
  filteredTrainings: CoderTraining[] = [];
  selectedTrainings = new SelectionModel<number>(true, []);
  comparisonData: TrainingComparison[] = [];
  withinTrainingData: WithinTrainingComparison[] = [];
  comparisonMode: 'between-trainings' | 'within-training' = 'between-trainings';
  selectedTrainingForWithin: number | null = null;

  availableCoders: Array<{ jobId: number; coderName: string }> = [];
  codersFormControl = new FormControl<number[]>([]);
  selectedCoderIds = new SelectionModel<number>(true, []);

  // For Between Trainings Mode
  availableCodersFromTrainings: Array<{ trainingId: number; trainingLabel: string; coderId: number; coderName: string }> = [];
  codersFromTrainingsFormControl = new FormControl<string[]>([]); // Storing composite keys like "trainingId_coderId"
  selectedCodersFromTrainings = new Set<string>();

  totalComparisons = 0;
  matchingComparisons = 0;
  matchingPercentage = 0;

  // Cohen's Kappa properties
  kappaStatistics: KappaStatistics | null = null;

  showKappaStatistics = false;
  useWeightedMean = true;
  useCodeLevel = true; // true = code level, false = score level

  originalKappaStatistics: KappaStatistics | null = null; // Store original for filtering
  variableKappaSummaries: VariableKappaSummary[] = [];

  readonly codingIssueLabelMap: Record<number, string> = {
    [-1]: 'Code-Vergabe unsicher',
    [-2]: 'Neuer Code nötig',
    [-3]: 'Ungültig (Spaßantwort)',
    [-4]: 'Technische Probleme'
  };

  tableFilters: ComparisonFilters = {
    unitName: '',
    variableId: '',
    personLogin: '',
    personGroup: '',
    match: 'all',
    notesMode: 'all'
  };

  discussionManagerLabel = '';
  discussionCodeByResponseId: Record<number, string> = {};
  discussionScoreByResponseId: Record<number, number | null> = {};
  isSavingDiscussionByResponseId: Record<number, boolean> = {};

  constructor(
    public dialogRef: MatDialogRef<CodingResultsComparisonComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { workspaceId: number; selectedTraining?: CoderTraining },
    private paginatorIntl: MatPaginatorIntl
  ) {
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
    this.setupFilterPredicate();
    this.discussionManagerLabel = this.appService.authData.userName || this.appService.loggedUser?.preferred_username || 'Diskussion';

    this.loadCoderTrainings().then(() => {
      if (this.data.selectedTraining) {
        this.comparisonMode = 'within-training';
        this.selectedTrainingForWithin = this.data.selectedTraining.id;
        this.loadComparison();
      }
    });

    this.postMessageService.getMessages<ReplayCodeSelectedMessage>('replayCodeSelected')
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(msg => {
        this.handleReplayCodeSelected(msg.message);
      });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
  }

  private getFilterValue(value: string | undefined): string {
    return (value || '').trim().toLowerCase();
  }

  private rowHasNotes(comparison: TrainingComparison | WithinTrainingComparison): boolean {
    return comparison.coders.some(coder => !!coder.notes && coder.notes.trim().length > 0);
  }

  private setupFilterPredicate(): void {
    this.dataSource.filterPredicate = (row: TrainingComparison | WithinTrainingComparison, filterJson: string): boolean => {
      const filters = JSON.parse(filterJson) as ComparisonFilters;
      const unitName = this.getFilterValue((row as TrainingComparison).unitName);
      const variableId = this.getFilterValue((row as TrainingComparison).variableId);
      const personLogin = this.getFilterValue((row as TrainingComparison).personLogin);
      const personGroup = this.getFilterValue((row as TrainingComparison).personGroup);

      if (filters.unitName && !unitName.includes(this.getFilterValue(filters.unitName))) {
        return false;
      }
      if (filters.variableId && !variableId.includes(this.getFilterValue(filters.variableId))) {
        return false;
      }
      if (filters.personLogin && !personLogin.includes(this.getFilterValue(filters.personLogin))) {
        return false;
      }
      if (filters.personGroup && !personGroup.includes(this.getFilterValue(filters.personGroup))) {
        return false;
      }

      if (filters.match === 'match' && !this.areCodesTheSame(row)) {
        return false;
      }
      if (filters.match === 'differ' && this.areCodesTheSame(row)) {
        return false;
      }

      const hasNotes = this.rowHasNotes(row);
      if (filters.notesMode === 'none') return !hasNotes;
      if (filters.notesMode === 'with-notes') return hasNotes;

      return true;
    };
  }

  applyTableFilters(): void {
    this.dataSource.filter = JSON.stringify(this.tableFilters);
    this.calculateStatistics();
  }

  resetTableFilters(): void {
    this.tableFilters = {
      unitName: '',
      variableId: '',
      personLogin: '',
      personGroup: '',
      match: 'all',
      notesMode: 'all'
    };
    this.applyTableFilters();
  }

  getCodingIssueLabel(codingIssueOption: number | null | undefined): string {
    if (codingIssueOption === null || codingIssueOption === undefined) {
      return '';
    }
    return this.codingIssueLabelMap[codingIssueOption] || `Hinweis ${codingIssueOption}`;
  }

  getCoderFromTraining(comparison: TrainingComparison, key: string) {
    const parts = key.split('_');
    if (parts.length !== 2) return undefined;
    const trainingId = parseInt(parts[0], 10);
    const coderId = parseInt(parts[1], 10);
    return comparison.coders.find(c => c.trainingId === trainingId && c.coderId === coderId);
  }

  getCoderForWithin(comparison: WithinTrainingComparison, jobId: number) {
    return comparison.coders.find(c => c.jobId === jobId);
  }

  getDisplayCodeAndIssueText(code: string | null, issueOption?: number | null): string {
    if (code === null) {
      return '-';
    }
    const issue = this.getCodingIssueLabel(issueOption);
    if (code === '-1' || code === '-2') {
      return issue || code;
    }
    return issue ? `${code} (${issue})` : code;
  }

  /**
   * Maps auto-coder codes for display in the coding manager UI.
   * - Code -4 (technical problems) → -97
   * - Code -3 (invalid/fun response) → -98
   * - Codes -1 and -2 → null (empty)
   */
  mapCodeForDisplay(code: string | number | null | undefined): string {
    if (code === null || code === undefined || code === '') {
      return '';
    }
    const codeNum = typeof code === 'string' ? parseInt(code, 10) : code;
    if (Number.isNaN(codeNum)) {
      return String(code);
    }
    if (codeNum === -4) {
      return '-97';
    }
    if (codeNum === -3) {
      return '-98';
    }
    if (codeNum === -1 || codeNum === -2) {
      return '';
    }
    return String(codeNum);
  }

  private getDiscussionScoreFromKnownCodes(comparison: WithinTrainingComparison, codeAsNumber: number): number | null {
    // Handle mapped codes: -97 (from -4) and -98 (from -3) should have score 0
    if (codeAsNumber === -97 || codeAsNumber === -98) {
      return 0;
    }

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

  onDiscussionCodeInput(comparison: TrainingComparison | WithinTrainingComparison, value: string): void {
    if (this.comparisonMode !== 'within-training') {
      return;
    }
    const responseId = (comparison as WithinTrainingComparison).responseId;
    this.discussionCodeByResponseId[responseId] = value;

    const codeAsNumber = parseInt(value, 10);
    if (Number.isNaN(codeAsNumber)) {
      this.discussionScoreByResponseId[responseId] = null;
      return;
    }

    this.discussionScoreByResponseId[responseId] = this.getDiscussionScoreFromKnownCodes(
      comparison as WithinTrainingComparison,
      codeAsNumber
    );
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

  onDiscussionCodeBlur(comparison: TrainingComparison | WithinTrainingComparison): void {
    if (this.comparisonMode !== 'within-training' || !this.selectedTrainingForWithin) {
      return;
    }

    const withinComparison = comparison as WithinTrainingComparison;
    const responseId = withinComparison.responseId;
    const rawValue = this.discussionCodeByResponseId[responseId] || '';
    const parsedCode = this.parseDiscussionCode(rawValue);

    if (parsedCode === undefined) {
      this.snackBar.open('Bitte nur ganze Zahlen für den Diskussionscode eingeben.', this.translate.instant('common.close'), { duration: 3000 });
      return;
    }

    const score = parsedCode === null ? null : this.getDiscussionScoreFromKnownCodes(withinComparison, parsedCode);
    this.isSavingDiscussionByResponseId[responseId] = true;

    this.codingTrainingBackendService.saveDiscussionResult(
      this.data.workspaceId,
      this.selectedTrainingForWithin,
      responseId,
      parsedCode,
      score
    ).subscribe({
      next: result => {
        this.discussionCodeByResponseId[responseId] = result.code !== null ? result.code.toString() : '';
        this.discussionScoreByResponseId[responseId] = result.score;
        withinComparison.discussionCode = result.code;
        withinComparison.discussionScore = result.score;
        withinComparison.discussionManagerUserId = result.managerUserId;
        withinComparison.discussionManagerName = result.managerName;
        if (result.managerName) {
          this.discussionManagerLabel = result.managerName;
        }
        this.isSavingDiscussionByResponseId[responseId] = false;
      },
      error: () => {
        this.isSavingDiscussionByResponseId[responseId] = false;
        this.snackBar.open('Diskussionsergebnis konnte nicht gespeichert werden.', this.translate.instant('common.close'), { duration: 3000 });
      }
    });
  }

  private initDiscussionValues(data: WithinTrainingComparison[]): void {
    this.discussionCodeByResponseId = {};
    this.discussionScoreByResponseId = {};
    this.isSavingDiscussionByResponseId = {};

    const persistedManager = data.find(item => !!item.discussionManagerName)?.discussionManagerName;
    if (persistedManager) {
      this.discussionManagerLabel = persistedManager;
    }

    data.forEach(item => {
      if (item.discussionCode !== null && item.discussionCode !== undefined) {
        this.discussionCodeByResponseId[item.responseId] = this.mapCodeForDisplay(item.discussionCode.toString());
        this.discussionScoreByResponseId[item.responseId] = item.discussionScore ?? this.getDiscussionScoreFromKnownCodes(item, item.discussionCode);
      } else if (item.replayCode !== null && item.replayCode !== undefined) {
        this.discussionCodeByResponseId[item.responseId] = this.mapCodeForDisplay(item.replayCode.toString());
        this.discussionScoreByResponseId[item.responseId] = item.replayScore ?? this.getDiscussionScoreFromKnownCodes(item, item.replayCode);
      } else {
        this.discussionCodeByResponseId[item.responseId] = '';
        this.discussionScoreByResponseId[item.responseId] = null;
      }
    });
  }

  openReplay(comparison: TrainingComparison | WithinTrainingComparison): void {
    const responseId = (comparison as WithinTrainingComparison).responseId || (comparison as TrainingComparison).responseId;
    if (!responseId) {
      return;
    }

    const workspaceId = this.data.workspaceId;
    const identity = this.appService.loggedUser?.sub || '';

    this.appService.createToken(workspaceId, identity, 3600).subscribe({
      next: token => {
        this.codingStatisticsService.getReplayUrl(workspaceId, responseId, token).subscribe({
          next: result => {
            if (result.replayUrl) {
              const separator = result.replayUrl.includes('?') ? '&' : '?';
              window.open(`${result.replayUrl}${separator}mode=coding&originResponseId=${responseId}`, '_blank');
            }
          }
        });
      }
    });
  }

  loadCoderTrainings(): Promise<void> {
    return new Promise((resolve, reject) => {
      const workspaceId = this.data.workspaceId;
      if (!workspaceId) {
        reject();
        return;
      }

      this.codingTrainingBackendService.getCoderTrainings(workspaceId).subscribe({
        next: trainings => {
          this.availableTrainings = trainings;
          this.filteredTrainings = [...trainings];
          resolve();
        },
        error: () => {
          this.snackBar.open(this.translate.instant('coding.trainings.loading.error'), this.translate.instant('common.close'), { duration: 3000 });
          reject();
        }
      });
    });
  }

  onModeChange(): void {
    this.selectedTrainings.clear();
    this.filteredTrainings = [...this.availableTrainings];
    this.selectedTrainingForWithin = null;
    this.comparisonData = [];
    this.withinTrainingData = [];
    this.availableCoders = [];
    this.availableCodersFromTrainings = [];
    this.codersFormControl.setValue([]);
    this.codersFromTrainingsFormControl.setValue([]);
    this.selectedCodersFromTrainings.clear();
    this.selectedCoderIds.clear();
    this.dataSource.data = [];
    this.resetTableFilters();
    this.updateDisplayedColumns();
  }

  onTrainingSelectionChange(): void {
    if (this.comparisonMode === 'between-trainings' && this.selectedTrainings.selected.length >= 2) {
      this.loadComparison();
    } else {
      this.comparisonData = [];
      this.availableCodersFromTrainings = [];
      this.codersFromTrainingsFormControl.setValue([]);
      this.selectedCodersFromTrainings.clear();
      this.dataSource.data = [];
      this.updateDisplayedColumns();
    }
  }

  onTrainingForWithinChange(): void {
    if (this.comparisonMode === 'within-training' && this.selectedTrainingForWithin) {
      this.loadComparison();
    } else {
      this.withinTrainingData = [];
      this.availableCoders = [];
      this.codersFormControl.setValue([]);
      this.selectedCoderIds.clear();
      this.dataSource.data = [];
      this.updateDisplayedColumns();
    }
  }

  private updateDisplayedColumns(): void {
    const baseColumns = ['index', 'unitName', 'variableId'];
    this.dynamicCoderColumns = [];

    if (this.comparisonMode === 'between-trainings') {
      const personColumns = ['personLogin', 'personCode', 'personGroup'];

      // Generate columns for selected coders
      this.availableCodersFromTrainings.forEach(coder => {
        const key = `${coder.trainingId}_${coder.coderId}`;
        if (this.selectedCodersFromTrainings.has(key)) {
          this.dynamicCoderColumns.push(`coder_${key}`);
        }
      });

      this.displayedColumns = [...baseColumns, ...personColumns, 'match', 'replay', ...this.dynamicCoderColumns];
    } else if (this.comparisonMode === 'within-training') {
      // For within training, we show detailed person info
      const personColumns = ['personLogin', 'personCode', 'personGroup'];

      if (this.selectedTrainingForWithin && this.withinTrainingData.length > 0) {
        // Filter columns based on selected coders
        const selectedCoderIds = this.codersFormControl.value || [];
        this.dynamicCoderColumns = selectedCoderIds.map(jobId => `coder_${jobId}`);
        this.displayedColumns = [...baseColumns, ...personColumns, 'match', 'replay', ...this.dynamicCoderColumns, 'discussion'];
      } else {
        this.displayedColumns = [...baseColumns, ...personColumns, 'match', 'replay', 'discussion'];
      }
    }
  }

  onCodersFromTrainingsSelectionChange(): void {
    const selectedKeys = this.codersFromTrainingsFormControl.value || [];
    this.selectedCodersFromTrainings = new Set(selectedKeys);
    this.updateDisplayedColumns();
    // Filter rows to only show those that have data for SELECTED coders
    this.dataSource.data = this.comparisonData.filter(d => this.hasAnyCode(d));
    this.applyTableFilters();
  }

  getCoderFromTrainingColumnName(key: string): string {
    const parts = key.split('_');
    if (parts.length !== 2) return key;
    const trainingId = parseInt(parts[0], 10);
    const coderId = parseInt(parts[1], 10);
    const coder = this.availableCodersFromTrainings.find(c => c.trainingId === trainingId && c.coderId === coderId);
    return coder ? `${coder.trainingLabel} - ${coder.coderName}` : key;
  }

  getCoderName(jobId: number): string {
    const coder = this.availableCoders.find(c => c.jobId === jobId);
    return coder ? coder.coderName : `Kodierer ${jobId}`;
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

  hasCoderFromTrainingCodeOrScore(comparison: TrainingComparison, key: string): boolean {
    const parts = key.split('_');
    if (parts.length !== 2) return false;
    const trainingId = parseInt(parts[0], 10);
    const coderId = parseInt(parts[1], 10);
    const coder = comparison.coders.find(c => c.trainingId === trainingId && c.coderId === coderId);
    return !!(coder && (coder.code !== null || coder.score !== null));
  }

  calculateStatistics(): void {
    const data = this.dataSource.data;
    // Only count items with at least two codes from selected sources
    const doubleCodedItems = data.filter(item => this.countSelectedCodes(item) >= 2);

    const total = doubleCodedItems.length;
    const matching = doubleCodedItems.filter(item => this.areCodesTheSame(item)).length;

    this.totalComparisons = total;
    this.matchingComparisons = matching;
    this.matchingPercentage = total > 0 ? Math.round((matching / total) * 100) : 0;
  }

  private countSelectedCodes(comparison: TrainingComparison | WithinTrainingComparison): number {
    let codes: (string | null)[];
    if (this.comparisonMode === 'between-trainings') {
      const item = comparison as TrainingComparison;
      // Filter by selected coders from trainings
      codes = item.coders
        .filter(c => this.selectedCodersFromTrainings.has(`${c.trainingId}_${c.coderId}`))
        .map(c => c.code);
    } else {
      const item = comparison as WithinTrainingComparison;
      const selectedIds = this.codersFormControl.value || [];
      codes = item.coders
        .filter(c => selectedIds.includes(c.jobId))
        .map(c => c.code);
    }
    return codes.filter(c => c !== null).length;
  }

  areCodesTheSame(comparison: TrainingComparison | WithinTrainingComparison): boolean {
    let codes: (string | null)[];
    if (this.comparisonMode === 'between-trainings') {
      const item = comparison as TrainingComparison;
      codes = item.coders
        .filter(c => this.selectedCodersFromTrainings.has(`${c.trainingId}_${c.coderId}`))
        .map(c => c.code);
    } else {
      const item = comparison as WithinTrainingComparison;
      const selectedIds = this.codersFormControl.value || [];
      codes = item.coders
        .filter(c => selectedIds.includes(c.jobId))
        .map(c => c.code);
    }
    const filteredCodes = codes.filter(c => c !== null);
    if (filteredCodes.length === 0) return true;
    const first = filteredCodes[0];
    return filteredCodes.every(code => code === first);
  }

  hasAnyCode(comparison: TrainingComparison | WithinTrainingComparison): boolean {
    let codes: (string | null)[];
    if (this.comparisonMode === 'between-trainings') {
      const item = comparison as TrainingComparison;
      codes = item.coders
        .filter(c => this.selectedCodersFromTrainings.has(`${c.trainingId}_${c.coderId}`))
        .map(c => c.code);
    } else {
      const item = comparison as WithinTrainingComparison;
      // Check ALL coders for this item if selected? Or just any code existence?
      // Logic: Show row if ANY selected coder has a code?
      const selectedIds = this.codersFormControl.value || [];
      codes = item.coders
        .filter(c => selectedIds.includes(c.jobId))
        .map(c => c.code);
    }
    return codes.some(c => c !== null);
  }

  loadComparison(): void {
    if (this.comparisonMode === 'between-trainings') {
      if (this.selectedTrainings.selected.length < 2) {
        this.snackBar.open(this.translate.instant('coding.trainings.compare.notEnough'), this.translate.instant('common.close'), { duration: 3000 });
        return;
      }

      this.isLoading = true;
      const trainingIds = this.selectedTrainings.selected.join(',');
      this.codingTrainingBackendService.compareTrainingCodingResults(this.data.workspaceId, trainingIds).subscribe({
        next: data => {
          this.comparisonData = data;

          // Extract all unique coders available in the data
          const codersMap = new Map<string, { trainingId: number; trainingLabel: string; coderId: number; coderName: string }>();
          this.comparisonData.forEach(item => {
            item.coders.forEach(c => {
              const key = `${c.trainingId}_${c.coderId}`;
              if (!codersMap.has(key)) {
                codersMap.set(key, {
                  trainingId: c.trainingId,
                  trainingLabel: c.trainingLabel,
                  coderId: c.coderId,
                  coderName: c.coderName
                });
              }
            });
          });

          this.availableCodersFromTrainings = Array.from(codersMap.values()).sort((a, b) => {
            if (a.trainingId !== b.trainingId) return a.trainingId - b.trainingId;
            return a.coderName.localeCompare(b.coderName);
          });

          const previousSelection = this.codersFromTrainingsFormControl.value || [];
          const allKeys = this.availableCodersFromTrainings.map(c => `${c.trainingId}_${c.coderId}`);

          let newSelection: string[];
          if (previousSelection.length === 0) {
            newSelection = allKeys;
          } else {
            const currentlySelectedTrainings = new Set(previousSelection.map(key => key.split('_')[0]));
            newSelection = allKeys.filter(key => {
              const [trainingId] = key.split('_');
              return previousSelection.includes(key) || !currentlySelectedTrainings.has(trainingId);
            });
          }

          this.codersFromTrainingsFormControl.setValue(newSelection);
          this.selectedCodersFromTrainings = new Set(newSelection);
          this.dataSource.data = this.comparisonData.filter(d => this.hasAnyCode(d));
          this.applyTableFilters();
          this.updateDisplayedColumns();
          this.calculateStatistics();
          this.isLoading = false;
        },
        error: () => {
          this.snackBar.open(this.translate.instant('variable-analysis.error-loading-results'), this.translate.instant('common.close'), { duration: 3000 });
          this.isLoading = false;
        }
      });
    } else if (this.comparisonMode === 'within-training') {
      if (!this.selectedTrainingForWithin) {
        this.snackBar.open(this.translate.instant('coding.trainings.select-training'), this.translate.instant('common.close'), { duration: 3000 });
        return;
      }

      this.isLoading = true;
      this.codingTrainingBackendService.compareWithinTrainingCodingResults(this.data.workspaceId, this.selectedTrainingForWithin).subscribe({
        next: data => {
          const mappedData: WithinTrainingComparison[] = data.map(item => ({
            responseId: item.responseId,
            unitName: item.unitName,
            variableId: item.variableId,
            testperson: item.testPerson,
            personLogin: item.personLogin,
            personCode: item.personCode,
            personGroup: item.personGroup,
            replayCode: item.replayCode,
            replayScore: item.replayScore,
            discussionCode: item.discussionCode,
            discussionScore: item.discussionScore,
            discussionManagerUserId: item.discussionManagerUserId,
            discussionManagerName: item.discussionManagerName,
            coders: item.coders
          }));

          // Determine available coders from all data items
          if (mappedData.length > 0) {
            this.availableCoders = mappedData[0].coders.map(c => ({
              jobId: c.jobId,
              coderName: c.coderName
            }));
            // Select all coders by default
            const allCoderIds = this.availableCoders.map(c => c.jobId);
            this.codersFormControl.setValue(allCoderIds);
            this.selectedCoderIds.setSelection(...allCoderIds);
          } else {
            this.availableCoders = [];
            this.codersFormControl.setValue([]);
            this.selectedCoderIds.clear();
          }

          this.withinTrainingData = mappedData;
          this.initDiscussionValues(mappedData);
          // Now filter based on the (now initialized) selection
          this.dataSource.data = this.withinTrainingData.filter(d => this.hasAnyCode(d));
          this.applyTableFilters();
          this.updateDisplayedColumns();
          this.calculateStatistics();
          // Automatically load Kappa statistics to show Mean Agreement in summary
          this.loadKappaStatistics();
          this.isLoading = false;
        },
        error: () => {
          this.snackBar.open(this.translate.instant('variable-analysis.error-loading-results'), this.translate.instant('common.close'), { duration: 3000 });
          this.isLoading = false;
        }
      });
    }
  }

  onCoderSelectionChange(): void {
    const selectedIds = this.codersFormControl.value || [];
    this.selectedCoderIds.clear();
    this.selectedCoderIds.select(...selectedIds);
    this.updateDisplayedColumns();

    if (this.comparisonMode === 'within-training') {
      this.dataSource.data = this.withinTrainingData.filter(d => this.hasAnyCode(d));
    }

    this.applyTableFilters();
    this.filterKappaStatistics();
  }

  getCoderCode(comparison: WithinTrainingComparison, jobId: number): string | null {
    const coder = comparison.coders.find(c => c.jobId === jobId);
    return coder ? coder.code : null;
  }

  getCoderScore(comparison: WithinTrainingComparison, jobId: number): number | null {
    const coder = comparison.coders.find(c => c.jobId === jobId);
    return coder ? coder.score : null;
  }

  hasCoderCodeOrScore(comparison: WithinTrainingComparison, jobId: number): boolean {
    const coder = comparison.coders.find(c => c.jobId === jobId);
    return !!(coder && (coder.code !== null || coder.score !== null));
  }

  applyFilter(event: Event): void {
    this.tableFilters.unitName = (event.target as HTMLInputElement)?.value?.trim() || '';
    this.applyTableFilters();
  }

  applyTrainingFilter(event: Event): void {
    const value = ((event.target as HTMLInputElement)?.value || '').trim().toLowerCase();
    if (!value) {
      this.filteredTrainings = [...this.availableTrainings];
      return;
    }

    this.filteredTrainings = this.availableTrainings.filter(training => training.label.toLowerCase().includes(value)
    );
  }

  trackByCoder(index: number, coder: { jobId: number; coderName: string }): number {
    return coder.jobId;
  }

  loadKappaStatistics(): void {
    if (this.comparisonMode !== 'within-training' || !this.selectedTrainingForWithin) {
      return;
    }

    this.isLoadingKappa = true;
    const level = this.useCodeLevel ? 'code' : 'score';
    this.codingTrainingBackendService
      .getTrainingCohensKappa(
        this.data.workspaceId,
        this.selectedTrainingForWithin,
        this.useWeightedMean,
        level
      )
      .subscribe({
        next: stats => {
          this.originalKappaStatistics = stats;
          this.filterKappaStatistics();
          this.isLoadingKappa = false;
        },
        error: () => {
          this.isLoadingKappa = false;
          this.snackBar.open(
            this.translate.instant('coding.trainings.kappa.error'),
            this.translate.instant('common.close'),
            { duration: 3000 }
          );
        }
      });
  }

  filterKappaStatistics(): void {
    if (!this.originalKappaStatistics) {
      this.variableKappaSummaries = [];
      return;
    }

    const selectedCoderIds = this.codersFormControl.value || [];

    // Deep copy
    const filteredStats = JSON.parse(JSON.stringify(this.originalKappaStatistics));

    // Filter coder pairs for each variable
    filteredStats.variables = filteredStats.variables.map((variable: KappaVariable) => {
      variable.coderPairs = variable.coderPairs.filter((pair: KappaCoderPair) => selectedCoderIds.includes(pair.coder1Id) && selectedCoderIds.includes(pair.coder2Id)
      );
      return variable;
    }).filter((variable: KappaVariable) => variable.coderPairs.length > 0);

    this.kappaStatistics = filteredStats;
    this.buildVariableKappaSummaries();
    this.calculateMeanAgreement();
    this.updateSummaryFromFiltered();
  }

  private buildVariableSummaryKey(unitName: string, variableId: string): string {
    return `${unitName}::${variableId}`;
  }

  private buildVariableKappaSummaries(): void {
    if (!this.kappaStatistics) {
      this.variableKappaSummaries = [];
      return;
    }

    this.variableKappaSummaries = this.kappaStatistics.variables.map(variable => {
      let kappaSum = 0;
      let kappaCount = 0;
      let agreementSum = 0;
      let agreementCount = 0;
      let caseCount = 0;

      variable.coderPairs.forEach(pair => {
        if (pair.validPairs > 0) {
          agreementSum += pair.agreement;
          agreementCount += 1;
          caseCount += pair.validPairs;
        }

        if (pair.kappa !== null && pair.validPairs > 0) {
          kappaSum += pair.kappa;
          kappaCount += 1;
        }
      });

      return {
        key: this.buildVariableSummaryKey(variable.unitName, variable.variableId),
        unitName: variable.unitName,
        variableId: variable.variableId,
        meanKappa: kappaCount > 0 ? kappaSum / kappaCount : null,
        meanAgreement: agreementCount > 0 ? agreementSum / agreementCount : null,
        caseCount
      };
    });
  }

  getVariableLabel(variable: Pick<KappaVariable, 'unitName' | 'variableId'>): string {
    return `${variable.unitName} - ${variable.variableId}`;
  }

  getKappaCellClass(kappa: number | null): string {
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

  updateSummaryFromFiltered(): void {
    if (!this.kappaStatistics) return;

    // Recalculate totalDoubleCodedResponses based on selected coders and withinTrainingData
    const selectedCoderIds = this.codersFormControl.value || [];
    this.kappaStatistics.workspaceSummary.totalDoubleCodedResponses = this.withinTrainingData.filter(d => {
      const coderCodes = d.coders
        .filter(c => selectedCoderIds.includes(c.jobId))
        .map(c => c.code)
        .filter(c => c !== null);
      return coderCodes.length >= 2;
    }).length;

    let totalWeight = 0;
    let pairCount = 0;

    this.kappaStatistics.variables.forEach(variable => {
      variable.coderPairs.forEach(pair => {
        if (pair.validPairs > 0) {
          totalWeight += pair.validPairs;
          pairCount += 1;
        }
      });
    });

    // Recalculate average Kappa similarly
    let totalKappaWeighted = 0;
    let totalKappaSum = 0;

    this.kappaStatistics.variables.forEach(variable => {
      variable.coderPairs.forEach(pair => {
        if (pair.validPairs > 0 && pair.kappa !== null) {
          totalKappaWeighted += pair.kappa * pair.validPairs;
          totalKappaSum += pair.kappa;
        }
      });
    });

    const meanKappaWeighted = totalWeight > 0 ? totalKappaWeighted / totalWeight : null;
    const meanKappaArithmetic = pairCount > 0 ? totalKappaSum / pairCount : null;

    this.kappaStatistics.workspaceSummary.averageKappa = this.useWeightedMean ?
      meanKappaWeighted : meanKappaArithmetic;

    this.kappaStatistics.workspaceSummary.totalCoderPairs = pairCount;
    this.kappaStatistics.workspaceSummary.codersIncluded = this.codersFormControl.value?.length || 0;
    this.kappaStatistics.workspaceSummary.variablesIncluded = this.kappaStatistics.variables.length;
  }

  calculateMeanAgreement(): void {
    if (!this.kappaStatistics) return;

    let totalAgreementWeighted = 0;
    let totalWeight = 0;
    let totalAgreementSum = 0;
    let pairCount = 0;

    this.kappaStatistics.variables.forEach(variable => {
      variable.coderPairs.forEach(pair => {
        if (pair.validPairs > 0) { // Only consider pairs with data
          totalAgreementWeighted += pair.agreement * pair.validPairs;
          totalWeight += pair.validPairs;
          totalAgreementSum += pair.agreement;
          pairCount += 1;
        }
      });
    });

    if (this.useWeightedMean) {
      this.kappaStatistics.workspaceSummary.meanAgreement = totalWeight > 0 ? totalAgreementWeighted / totalWeight : 0;
    } else {
      this.kappaStatistics.workspaceSummary.meanAgreement = pairCount > 0 ? totalAgreementSum / pairCount : 0;
    }
  }

  toggleKappaStatistics(): void {
    this.showKappaStatistics = !this.showKappaStatistics;
    if (this.showKappaStatistics && !this.kappaStatistics) {
      this.loadKappaStatistics();
    }
  }

  toggleWeightingMethod(): void {
    this.loadKappaStatistics();
  }

  toggleCalculationLevel(): void {
    this.loadKappaStatistics();
  }

  private handleReplayCodeSelected(data: { testPerson: string; unitId: string; variableId: string; code: string, responseId?: number }): void {
    if (this.comparisonMode !== 'within-training') return;

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

    if (row) {
      this.discussionCodeByResponseId[row.responseId] = this.mapCodeForDisplay(data.code);
      // Trigger the existing save logic as if the user blurs the input
      this.onDiscussionCodeBlur(row);

      this.snackBar.open(
        `Kodierung für ${data.variableId} aus Replay übernommen`,
        this.translate.instant('common.close'),
        { duration: 3000 }
      );
    }
  }
}
