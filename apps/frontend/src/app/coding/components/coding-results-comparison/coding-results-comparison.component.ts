import {
  Component, Inject, inject, OnInit,
  ViewChild
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
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
import {
  getTrainingOptionMeta,
  getTrainingOptionTitle
} from '../../utils/coder-training-display';

interface ReplayCodeSelectedMessage extends PostMessage {
  testPerson: string;
  unitId: string;
  variableId: string;
  code: string;
  score?: number | null;
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
  givenAnswer?: string;
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
  givenAnswer?: string;
  replayCode?: number | null;
  replayScore?: number | null;
  discussionCode?: number | null;
  discussionScore?: number | null;
  discussionManagerUserId?: number | null;
  discussionManagerName?: string | null;
  discussionSource?: 'manual' | 'auto_agreement' | null;
  modalValueDisplay?: ModalValueDisplay;
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
type ComparisonStatus = 'match' | 'differ' | 'incomplete' | 'not_comparable';
type ComparisonCoderResult = TrainingComparison['coders'][number] | WithinTrainingComparison['coders'][number];

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
  meanKappa?: number | null;
  meanAgreement?: number | null;
  caseCount?: number;
  validPairCount?: number;
  coderPairCount?: number;
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
    calculationLevel?: 'code' | 'score';
  };
}

interface VariableKappaSummary {
  key: string;
  unitName: string;
  variableId: string;
  meanKappa: number | null;
  meanAgreement: number | null;
  caseCount: number;
  validPairCount: number;
}

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

interface ModalValueSummary {
  modalValue: string | null;
  deviationCount: number | null;
  validCount: number;
  isTie: boolean;
}

interface ModalValueDisplay {
  valueText: string;
  deviationText: string;
  tooltip: string;
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
  displayedColumns: string[] = ['index', 'unitVariable', 'personInfo', 'replay', 'givenAnswer', 'match'];
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
  incompleteComparisons = 0;
  notComparableComparisons = 0;

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

  readonly codingIssueShortLabelMap: Record<number, string> = {
    [-1]: 'Unsicher',
    [-2]: 'Neuer Code',
    [-3]: 'Spaßantwort',
    [-4]: 'Technisch'
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
  discussionErrorByResponseId: Record<number, string> = {};
  isSavingDiscussionByResponseId: Record<number, boolean> = {};
  readonly emptyModalValueDisplay: ModalValueDisplay = {
    valueText: '-',
    deviationText: '-',
    tooltip: ''
  };

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

  applyTableFilters(): void {
    this.dataSource.filter = JSON.stringify(this.tableFilters);
    this.dataSource.paginator?.firstPage();
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

  private getCurrentComparisonRows(): Array<TrainingComparison | WithinTrainingComparison> {
    return this.comparisonMode === 'between-trainings' ? this.comparisonData : this.withinTrainingData;
  }

  getFilteredRowsCount(): number {
    return this.dataSource.filteredData?.length ?? this.dataSource.data.length;
  }

  hasActiveFilters(): boolean {
    return !!(
      this.tableFilters.unitName.trim() ||
      this.tableFilters.variableId.trim() ||
      this.tableFilters.personLogin.trim() ||
      this.tableFilters.personGroup.trim() ||
      this.tableFilters.match !== 'all' ||
      this.tableFilters.notesMode !== 'all'
    );
  }

  hasNoSelectedCodersState(): boolean {
    return this.getCurrentComparisonRows().length > 0 && this.getSelectedComparisonSourceCount() === 0;
  }

  hasFilterEmptyState(): boolean {
    return (
      this.getSelectedComparisonSourceCount() > 0 &&
      this.getCurrentComparisonRows().length > 0 &&
      this.dataSource.data.length > 0 &&
      this.hasActiveFilters() &&
      this.getFilteredRowsCount() === 0
    );
  }

  hasKappaNoDoubleCodingState(): boolean {
    return !!this.kappaStatistics && this.kappaStatistics.workspaceSummary.totalDoubleCodedResponses === 0;
  }

  getSelectedWithinTraining(): CoderTraining | undefined {
    if (!this.selectedTrainingForWithin) {
      return undefined;
    }

    return this.availableTrainings.find(training => training.id === this.selectedTrainingForWithin);
  }

  private getSelectedTrainingsWithoutCodes(): CoderTraining[] {
    if (this.comparisonMode !== 'between-trainings' || this.comparisonData.length === 0) {
      return [];
    }

    return this.availableTrainings.filter(training => (
      this.selectedTrainings.isSelected(training.id) &&
      !this.comparisonData.some(row => (
        row.coders.some(coder => coder.trainingId === training.id && coder.code !== null)
      ))
    ));
  }

  private formatTrainingList(trainings: CoderTraining[]): string {
    const visible = trainings.slice(0, 3).map(training => this.getTrainingOptionTitle(training));
    const remaining = trainings.length - visible.length;
    return remaining > 0 ? `${visible.join(', ')} und ${remaining} weitere` : visible.join(', ');
  }

  getComparisonWarnings(): ComparisonWarning[] {
    const warnings: ComparisonWarning[] = [];
    const selectedSourceCount = this.getSelectedComparisonSourceCount();

    if (this.getCurrentComparisonRows().length === 0) {
      return warnings;
    }

    if (selectedSourceCount === 0) {
      warnings.push({
        icon: 'person_off',
        text: 'Es ist kein Kodierer ausgewählt. Wählen Sie mindestens zwei Kodierer aus, um Vergleichswerte zu sehen.',
        severity: 'info'
      });
    } else if (selectedSourceCount === 1) {
      warnings.push({
        icon: 'person',
        text: 'Aktuell ist nur ein Kodierer ausgewählt. Die Fälle werden angezeigt, sind aber noch nicht vergleichbar.',
        severity: 'warn'
      });
    }

    const trainingsWithoutCodes = this.getSelectedTrainingsWithoutCodes();
    if (trainingsWithoutCodes.length > 0) {
      warnings.push({
        icon: 'playlist_remove',
        text: `Keine Kodierergebnisse im Vergleich für: ${this.formatTrainingList(trainingsWithoutCodes)}.`,
        severity: 'warn'
      });
    }

    if (selectedSourceCount >= 2 && this.incompleteComparisons > 0) {
      const incompleteCasesText = this.incompleteComparisons === 1 ?
        '1 sichtbarer Fall ist unvollständig' :
        `${this.incompleteComparisons} sichtbare Fälle sind unvollständig`;
      warnings.push({
        icon: 'warning',
        text: `${incompleteCasesText}, weil mindestens ein ausgewählter Kodierer keinen Code hat.`,
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
        text: 'Diese Schulung enthält Fälle, aber noch keine vollständig kodierten Vergleichspaare.',
        severity: 'warn'
      });
    }

    return warnings;
  }

  getCodingIssueLabel(codingIssueOption: number | null | undefined): string {
    if (codingIssueOption === null || codingIssueOption === undefined) {
      return '';
    }
    return this.codingIssueLabelMap[codingIssueOption] || `Hinweis ${codingIssueOption}`;
  }

  getCodingIssueShortLabel(codingIssueOption: number | null | undefined): string {
    if (codingIssueOption === null || codingIssueOption === undefined) {
      return '';
    }
    return this.codingIssueShortLabelMap[codingIssueOption] || `Hinweis ${codingIssueOption}`;
  }

  private getCoderSourceLabel(coder: ComparisonCoderResult): string {
    if ('trainingLabel' in coder) {
      return `${coder.trainingLabel} - ${coder.coderName}`;
    }

    return coder.coderName;
  }

  hasCoderNote(coder: Pick<ComparisonCoderResult, 'notes'> | null | undefined): boolean {
    return !!coder?.notes?.trim();
  }

  getCoderNoteTooltip(coder: ComparisonCoderResult): string {
    const note = coder.notes?.trim() || '';
    return note ? `${this.getCoderSourceLabel(coder)}: ${note}` : '';
  }

  hasCodingIssue(coder: Pick<ComparisonCoderResult, 'codingIssueOption'> | null | undefined): boolean {
    return !!this.getCodingIssueLabel(coder?.codingIssueOption);
  }

  getCodingIssueTooltip(coder: ComparisonCoderResult): string {
    const issue = this.getCodingIssueLabel(coder.codingIssueOption);
    return issue ? `${this.getCoderSourceLabel(coder)}: ${issue}` : '';
  }

  getCodingIssueClass(coder: Pick<ComparisonCoderResult, 'codingIssueOption'>): string {
    return coder.codingIssueOption === -1 || coder.codingIssueOption === -2 ?
      'coding-issue-review' :
      'coding-issue-info';
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

  private getSelectedComparisonSourceCount(): number {
    if (this.comparisonMode === 'between-trainings') {
      return (this.codersFromTrainingsFormControl.value || []).length;
    }

    return (this.codersFormControl.value || []).length;
  }

  private getSelectedCodeSlots(comparison: TrainingComparison | WithinTrainingComparison): SelectedCodeSlot[] {
    if (this.comparisonMode === 'between-trainings') {
      const item = comparison as TrainingComparison;
      const selectedKeys = this.codersFromTrainingsFormControl.value || [];
      const slots = selectedKeys.map(key => {
        const coder = this.getCoderFromTraining(item, key);
        const trainingId = parseInt(key.split('_')[0], 10);
        return {
          code: coder?.code ?? null,
          hasEntry: !!coder,
          trainingId
        };
      });

      const trainingsWithSelectedCoder = new Set(slots.map(slot => slot.trainingId));
      this.selectedTrainings.selected.forEach(trainingId => {
        if (!trainingsWithSelectedCoder.has(trainingId)) {
          slots.push({
            code: null,
            hasEntry: false,
            trainingId
          });
        }
      });

      return slots;
    }

    const item = comparison as WithinTrainingComparison;
    return (this.codersFormControl.value || []).map(jobId => {
      const coder = this.getCoderForWithin(item, jobId);
      return {
        code: coder?.code ?? null,
        hasEntry: !!coder
      };
    });
  }

  getComparisonStatus(comparison: TrainingComparison | WithinTrainingComparison): ComparisonStatus {
    const selectedSlots = this.getSelectedCodeSlots(comparison);
    if (selectedSlots.length < 2) {
      return 'not_comparable';
    }

    if (selectedSlots.some(slot => !slot.hasEntry || slot.code === null)) {
      return 'incomplete';
    }

    const firstCode = selectedSlots[0].code;
    return selectedSlots.every(slot => slot.code === firstCode) ? 'match' : 'differ';
  }

  getComparisonStatusIcon(comparison: TrainingComparison | WithinTrainingComparison): string {
    switch (this.getComparisonStatus(comparison)) {
      case 'match':
        return 'check_circle';
      case 'differ':
        return 'cancel';
      case 'incomplete':
        return 'warning';
      default:
        return 'remove_circle_outline';
    }
  }

  getComparisonStatusTooltip(comparison: TrainingComparison | WithinTrainingComparison): string {
    switch (this.getComparisonStatus(comparison)) {
      case 'match':
        return 'Alle ausgewählten Kodierer stimmen überein.';
      case 'differ':
        return 'Mindestens zwei ausgewählte Kodierer weichen ab.';
      case 'incomplete':
        return 'Mindestens ein ausgewählter Kodierer hat für diesen Fall noch keinen Code.';
      default:
        return 'Für einen Vergleich müssen mindestens zwei Kodierer ausgewählt sein.';
    }
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

  getDeviationComparisons(): number {
    return Math.max(this.totalComparisons - this.matchingComparisons, 0);
  }

  getVisibleCompletionRate(): number {
    const visibleRows = this.getFilteredRowsCount();
    if (visibleRows === 0) {
      return 0;
    }

    return Math.round((this.totalComparisons / visibleRows) * 100);
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

  onDiscussionCodeInput(comparison: TrainingComparison | WithinTrainingComparison, value: string): void {
    if (this.comparisonMode !== 'within-training') {
      return;
    }
    const responseId = (comparison as WithinTrainingComparison).responseId;
    this.discussionCodeByResponseId[responseId] = value;
    this.discussionErrorByResponseId[responseId] = '';

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

  private isUnchangedDiscussionValue(
    comparison: WithinTrainingComparison,
    parsedCode: number | null,
    score: number | null,
    scoreOverride?: number | null
  ): boolean {
    if (scoreOverride !== undefined) {
      return false;
    }

    return parsedCode === (comparison.discussionCode ?? null) &&
      score === (comparison.discussionScore ?? null);
  }

  onDiscussionCodeBlur(
    comparison: TrainingComparison | WithinTrainingComparison,
    scoreOverride?: number | null
  ): void {
    if (this.comparisonMode !== 'within-training' || !this.selectedTrainingForWithin) {
      return;
    }

    const withinComparison = comparison as WithinTrainingComparison;
    const responseId = withinComparison.responseId;
    const rawValue = this.discussionCodeByResponseId[responseId] || '';
    const parsedCode = this.parseDiscussionCode(rawValue);

    if (parsedCode === undefined) {
      this.discussionErrorByResponseId[responseId] = 'Bitte nur ganze Zahlen für den Diskussionscode eingeben.';
      this.snackBar.open('Bitte nur ganze Zahlen für den Diskussionscode eingeben.', this.translate.instant('common.close'), { duration: 3000 });
      return;
    }

    let score: number | null = null;
    if (parsedCode !== null) {
      score = scoreOverride !== undefined ?
        scoreOverride :
        this.getDiscussionScoreFromKnownCodes(withinComparison, parsedCode);
    }
    this.discussionErrorByResponseId[responseId] = '';

    if (this.isUnchangedDiscussionValue(withinComparison, parsedCode, score, scoreOverride)) {
      this.discussionCodeByResponseId[responseId] = parsedCode !== null ? parsedCode.toString() : '';
      this.discussionScoreByResponseId[responseId] = withinComparison.discussionScore ?? null;
      return;
    }

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
        withinComparison.discussionSource = result.source;
        this.discussionErrorByResponseId[responseId] = '';
        if (result.managerName) {
          this.discussionManagerLabel = result.managerName;
        }
        this.isSavingDiscussionByResponseId[responseId] = false;
      },
      error: error => {
        this.isSavingDiscussionByResponseId[responseId] = false;
        const message = this.getDiscussionSaveErrorMessage(error);
        this.discussionErrorByResponseId[responseId] = message;
        this.snackBar.open(message, this.translate.instant('common.close'), { duration: 4000 });
      }
    });
  }

  private getDiscussionSaveErrorMessage(error: unknown): string {
    const fallbackMessage = 'Diskussionsergebnis konnte nicht gespeichert werden.';
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
      return 'Der Code ist im Kodierschema dieser Variable nicht vorhanden.';
    }

    if (message.includes('Unsupported missing code')) {
      return 'Der Code ist im Missing-Profil nicht als negativer Code hinterlegt.';
    }

    if (message.includes('Conflicting missing profiles')) {
      return 'Für diesen Fall sind unterschiedliche Missing-Profile im Training hinterlegt.';
    }

    if (message.includes('Missing profile') && message.includes('not found')) {
      return 'Das Missing-Profil des Kodierjobs konnte nicht geladen werden.';
    }

    if (message.includes('Coding scheme not found') || message.includes('Coding scheme variable not found')) {
      return 'Der Score konnte nicht aus dem Kodierschema abgeleitet werden.';
    }

    if (message.includes('Discussion code must be an integer')) {
      return 'Bitte nur ganze Zahlen für den Diskussionscode eingeben.';
    }

    return message;
  }

  private initDiscussionValues(data: WithinTrainingComparison[]): void {
    this.discussionCodeByResponseId = {};
    this.discussionScoreByResponseId = {};
    this.discussionErrorByResponseId = {};
    this.isSavingDiscussionByResponseId = {};

    const persistedManager = data.find(item => !!item.discussionManagerName)?.discussionManagerName;
    if (persistedManager) {
      this.discussionManagerLabel = persistedManager;
    }

    data.forEach(item => {
      if (item.discussionCode !== null && item.discussionCode !== undefined) {
        this.discussionCodeByResponseId[item.responseId] = this.mapCodeForDisplay(item.discussionCode.toString());
        this.discussionScoreByResponseId[item.responseId] = item.discussionScore ?? this.getDiscussionScoreFromKnownCodes(item, item.discussionCode);
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

    this.appService.createOwnToken(workspaceId, 1).subscribe({
      next: token => {
        this.codingStatisticsService.getReplayUrl(workspaceId, responseId, token).subscribe({
          next: result => {
            if (result.replayUrl) {
              window.open(this.buildReplayUrl(result.replayUrl, responseId), '_blank');
            } else {
              this.snackBar.open('Replay-URL konnte nicht erzeugt werden.', this.translate.instant('common.close'), { duration: 3000 });
            }
          },
          error: () => {
            this.snackBar.open('Replay konnte nicht geöffnet werden.', this.translate.instant('common.close'), { duration: 3000 });
          }
        });
      },
      error: () => {
        this.snackBar.open('Replay-Token konnte nicht erzeugt werden.', this.translate.instant('common.close'), { duration: 3000 });
      }
    });
  }

  private buildReplayUrl(replayUrl: string, responseId: number): string {
    const [baseUrl, fragment = ''] = replayUrl.split('#', 2);
    const appendParams = (value: string): string => {
      const [path, query = ''] = value.split('?', 2);
      const params = new URLSearchParams(query);
      params.set('mode', 'coding');
      params.set('originResponseId', responseId.toString());
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

  getTrainingOptionTitle(training: CoderTraining): string {
    return getTrainingOptionTitle(training);
  }

  getTrainingOptionMeta(training: CoderTraining): string {
    return getTrainingOptionMeta(training, 'Kodierer', 'Kodierer');
  }

  getTrainingCoderOptionLabel(coder: { trainingId: number; trainingLabel: string; coderName: string }): string {
    return `${coder.trainingLabel} · ID ${coder.trainingId}: ${coder.coderName}`;
  }

  onModeChange(): void {
    this.resetKappaState();
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
    this.resetKappaState();
    if (this.comparisonMode === 'between-trainings' && this.selectedTrainings.selected.length >= 2) {
      this.loadComparison();
    } else {
      this.comparisonData = [];
      this.availableCodersFromTrainings = [];
      this.codersFromTrainingsFormControl.setValue([]);
      this.selectedCodersFromTrainings.clear();
      this.dataSource.data = [];
      this.calculateStatistics();
      this.updateDisplayedColumns();
    }
  }

  onTrainingForWithinChange(): void {
    this.resetKappaState();
    if (this.comparisonMode === 'within-training' && this.selectedTrainingForWithin) {
      this.loadComparison();
    } else {
      this.withinTrainingData = [];
      this.availableCoders = [];
      this.codersFormControl.setValue([]);
      this.selectedCoderIds.clear();
      this.dataSource.data = [];
      this.calculateStatistics();
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

  onCodersFromTrainingsSelectionChange(): void {
    const selectedKeys = this.codersFromTrainingsFormControl.value || [];
    this.selectedCodersFromTrainings = new Set(selectedKeys);
    this.updateDisplayedColumns();
    this.refreshDisplayedRows();
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

  hasCoderFromTrainingDisplayData(comparison: TrainingComparison, key: string): boolean {
    const parts = key.split('_');
    if (parts.length !== 2) return false;
    const trainingId = parseInt(parts[0], 10);
    const coderId = parseInt(parts[1], 10);
    const coder = comparison.coders.find(c => c.trainingId === trainingId && c.coderId === coderId);
    return this.hasCoderDisplayData(coder);
  }

  calculateStatistics(): void {
    const data = this.dataSource.filteredData || this.dataSource.data;
    const statuses = data.map(item => this.getComparisonStatus(item));
    const total = statuses.filter(status => status === 'match' || status === 'differ').length;
    const matching = statuses.filter(status => status === 'match').length;

    this.totalComparisons = total;
    this.matchingComparisons = matching;
    this.matchingPercentage = total > 0 ? Math.round((matching / total) * 100) : 0;
    this.incompleteComparisons = statuses.filter(status => status === 'incomplete').length;
    this.notComparableComparisons = statuses.filter(status => status === 'not_comparable').length;
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
    this.applyTableFilters();
  }

  loadComparison(): void {
    if (this.comparisonMode === 'between-trainings') {
      if (this.selectedTrainings.selected.length < 2) {
        this.snackBar.open(this.translate.instant('coding.trainings.compare.notEnough'), this.translate.instant('common.close'), { duration: 3000 });
        return;
      }

      this.isLoading = true;
      this.resetKappaState();
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
          this.updateDisplayedColumns();
          this.refreshDisplayedRows();
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
      this.resetKappaState();
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
            givenAnswer: item.givenAnswer,
            replayCode: item.replayCode,
            replayScore: item.replayScore,
            discussionCode: item.discussionCode,
            discussionScore: item.discussionScore,
            discussionManagerUserId: item.discussionManagerUserId,
            discussionManagerName: item.discussionManagerName,
            discussionSource: item.discussionSource,
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
          this.updateDisplayedColumns();
          this.refreshDisplayedRows();
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
    this.refreshDisplayedRows();
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

  hasCoderDisplayDataForWithin(comparison: WithinTrainingComparison, jobId: number): boolean {
    const coder = comparison.coders.find(c => c.jobId === jobId);
    return this.hasCoderDisplayData(coder);
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

    this.filteredTrainings = this.availableTrainings.filter(training => (
      `${training.label} ${training.id} ${this.getTrainingOptionMeta(training)}`.toLowerCase().includes(value)
    ));
  }

  trackByCoder(index: number, coder: { jobId: number; coderName: string }): number {
    return coder.jobId;
  }

  loadKappaStatistics(): void {
    if (this.comparisonMode !== 'within-training' || !this.selectedTrainingForWithin) {
      this.resetKappaState();
      return;
    }

    this.resetKappaState();
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
      this.kappaStatistics = null;
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

  private countSelectedValidCoderValues(coders: WithinTrainingComparison['coders'], selectedCoderIds: number[]): number {
    return coders.filter(coder => (
      selectedCoderIds.includes(coder.jobId) &&
      (this.useCodeLevel ? coder.code !== null : coder.score !== null)
    )).length;
  }

  private countValidCasesForVariable(unitName: string, variableId: string, selectedCoderIds: number[]): number {
    return this.withinTrainingData.filter(item => (
      item.unitName === unitName &&
      item.variableId === variableId &&
      this.countSelectedValidCoderValues(item.coders, selectedCoderIds) >= 2
    )).length;
  }

  private buildVariableKappaSummaries(): void {
    if (!this.kappaStatistics) {
      this.variableKappaSummaries = [];
      return;
    }

    const selectedCoderIds = this.codersFormControl.value || [];

    this.variableKappaSummaries = this.kappaStatistics.variables.map(variable => {
      let kappaSum = 0;
      let kappaWeightedSum = 0;
      let kappaWeight = 0;
      let kappaCount = 0;
      let agreementSum = 0;
      let agreementWeightedSum = 0;
      let agreementCount = 0;
      let validPairCount = 0;

      variable.coderPairs.forEach(pair => {
        if (pair.validPairs > 0) {
          agreementSum += pair.agreement;
          agreementWeightedSum += pair.agreement * pair.validPairs;
          agreementCount += 1;
          validPairCount += pair.validPairs;
        }

        if (pair.kappa !== null && pair.validPairs > 0) {
          kappaSum += pair.kappa;
          kappaWeightedSum += pair.kappa * pair.validPairs;
          kappaWeight += pair.validPairs;
          kappaCount += 1;
        }
      });

      let meanKappa: number | null = null;
      if (this.useWeightedMean && kappaWeight > 0) {
        meanKappa = kappaWeightedSum / kappaWeight;
      } else if (!this.useWeightedMean && kappaCount > 0) {
        meanKappa = kappaSum / kappaCount;
      }

      let meanAgreement: number | null = null;
      if (this.useWeightedMean && validPairCount > 0) {
        meanAgreement = agreementWeightedSum / validPairCount;
      } else if (!this.useWeightedMean && agreementCount > 0) {
        meanAgreement = agreementSum / agreementCount;
      }

      return {
        key: this.buildVariableSummaryKey(variable.unitName, variable.variableId),
        unitName: variable.unitName,
        variableId: variable.variableId,
        meanKappa,
        meanAgreement,
        caseCount: this.countValidCasesForVariable(variable.unitName, variable.variableId, selectedCoderIds),
        validPairCount
      };
    });
  }

  getVariableSummary(variable: Pick<KappaVariable, 'unitName' | 'variableId'>): VariableKappaSummary | undefined {
    const key = this.buildVariableSummaryKey(variable.unitName, variable.variableId);
    return this.variableKappaSummaries.find(summary => summary.key === key);
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
    this.kappaStatistics.workspaceSummary.totalDoubleCodedResponses = this.withinTrainingData.filter(
      d => this.countSelectedValidCoderValues(d.coders, selectedCoderIds) >= 2
    ).length;

    let pairCount = 0;
    let totalKappaWeight = 0;
    let kappaPairCount = 0;
    let totalKappaWeighted = 0;
    let totalKappaSum = 0;

    this.kappaStatistics.variables.forEach(variable => {
      variable.coderPairs.forEach(pair => {
        if (pair.validPairs > 0) {
          pairCount += 1;
        }

        if (pair.validPairs > 0 && pair.kappa !== null && !Number.isNaN(pair.kappa)) {
          totalKappaWeighted += pair.kappa * pair.validPairs;
          totalKappaWeight += pair.validPairs;
          totalKappaSum += pair.kappa;
          kappaPairCount += 1;
        }
      });
    });

    const meanKappaWeighted = totalKappaWeight > 0 ? totalKappaWeighted / totalKappaWeight : null;
    const meanKappaArithmetic = kappaPairCount > 0 ? totalKappaSum / kappaPairCount : null;

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
      this.kappaStatistics.workspaceSummary.meanAgreement = totalWeight > 0 ? totalAgreementWeighted / totalWeight : null;
    } else {
      this.kappaStatistics.workspaceSummary.meanAgreement = pairCount > 0 ? totalAgreementSum / pairCount : null;
    }
  }

  private resetKappaState(): void {
    this.kappaStatistics = null;
    this.originalKappaStatistics = null;
    this.variableKappaSummaries = [];
    this.isLoadingKappa = false;
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

  private handleReplayCodeSelected(data: ReplayCodeSelectedMessage): void {
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
      this.discussionScoreByResponseId[row.responseId] =
        data.score !== undefined ? data.score : this.getDiscussionScoreFromKnownCodes(row, parseInt(data.code, 10));
      this.onDiscussionCodeBlur(row, data.score);

      this.snackBar.open(
        `Kodierung für ${data.variableId} aus Replay übernommen`,
        this.translate.instant('common.close'),
        { duration: 3000 }
      );
    }
  }
}
