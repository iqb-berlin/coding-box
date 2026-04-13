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
import { MatRadioModule } from '@angular/material/radio';
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
  Subject, debounceTime, distinctUntilChanged, takeUntil, map, merge, catchError, of, forkJoin
} from 'rxjs';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { CodingFacadeService } from '../../../services/facades/coding-facade.service';
import { JobDefinition } from '../../services/coding-job-backend.service';
import { CoderTraining } from '../../models/coder-training.model';

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
  coderResults: CoderResult[];
  selectedCoderResult?: CoderResult;
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
    MatRadioModule,
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

  constructor(
    @Optional() public dialogRef: MatDialogRef<DoubleCodedReviewComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public dialogData: unknown
  ) {}

  displayedColumns: string[] = [
    'unitVariable',
    'personInfo',
    'givenAnswer',
    'coderResults',
    'selection'
  ];

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
  private resultsApplied = false;
  private destroy$ = new Subject<void>();

  selectionForm!: FormGroup;
  selectedItem: DoubleCodedItem | null = null;

  ngOnInit(): void {
    this.initializeForm();
    this.setupFilters();
    this.loadCoders();
    this.loadFilterOptions();
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
          .filter(definition => definition.id !== undefined)
          .sort((a, b) => (b.id || 0) - (a.id || 0));

        this.availableJobDefinitions = sortedJobDefinitions.map(definition => ({
          id: definition.id!,
          label: this.getJobDefinitionLabel(definition)
        }));

        this.availableCoderTrainings = coderTrainings.map(training => ({
          id: training.id,
          label: training.label || `Training #${training.id}`
        }));

        if ((!this.scopeControl.value || this.scopeControl.value.length === 0) && this.availableJobDefinitions.length > 0) {
          this.scopeControl.setValue([`job_${this.availableJobDefinitions[0].id}`], { emitEvent: false });
        }

        this.loadData();
      });
  }

  private getJobDefinitionLabel(definition: JobDefinition): string {
    const definitionId = definition.id ?? 0;
    const status = definition.status ? ` (${definition.status})` : '';
    return `Definition #${definitionId}${status}`;
  }

  getScopeSelectionSummary(): string {
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
      return this.availableCoderTrainings.find(training => training.id === scopeId)?.label || `Training #${scopeId}`;
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

  private updateForm(): void {
    // Clear existing form controls
    Object.keys(this.selectionForm.controls).forEach(key => {
      this.selectionForm.removeControl(key);
    });

    const currentItems = this.dataSource.data;

    currentItems.forEach(item => {
      const controlName = this.getItemControlName(item);

      // Look for an existing resolution (a coder result that has a supervisor comment)
      const resolvedResult = item.coderResults.find(cr => !!cr.supervisorComment);

      let defaultValue = '';
      if (resolvedResult) {
        defaultValue = resolvedResult.jobId.toString();
      } else if (item.coderResults.length > 0) {
        defaultValue = item.coderResults[0].jobId.toString();
      }

      this.selectionForm.addControl(controlName, new FormControl(defaultValue));

      const commentControlName = this.getCommentControlName(item);
      if (this.hasConflict(item) || (resolvedResult && resolvedResult.supervisorComment)) {
        const defaultComment = resolvedResult ? (resolvedResult.supervisorComment || '') : '';
        this.selectionForm.addControl(commentControlName, new FormControl(defaultComment));
      }
    });
  }

  hasConflict(item: DoubleCodedItem): boolean {
    const validResults = item.coderResults.filter(cr => cr.code !== null);
    if (validResults.length < 2) {
      return false;
    }
    const firstCode = validResults[0].code;
    return validResults.some(result => result.code !== firstCode);
  }

  isAllCodersDone(item: DoubleCodedItem): boolean {
    return item.coderResults.every(cr => cr.code !== null);
  }

  getCodedCount(item: DoubleCodedItem): number {
    return item.coderResults.filter(cr => cr.code !== null).length;
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
          selectedCoderResult: item.coderResults[0]
        }));
        this.dataSource.data = this.allData;
        this.totalItems = response.total;

        this.updateForm();
        this.isLoading = false;
      },
      error: () => {
        this.translateService.get('double-coded-review.errors.failed-to-load').subscribe(message => {
          this.showError(message);
        });
        this.isLoading = false;
      }
    });
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.loadData();
  }

  onSelectionChange(item: DoubleCodedItem, selectedJobId: string): void {
    const selectedResult = item.coderResults.find(cr => cr.jobId.toString() === selectedJobId);
    if (selectedResult) {
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

    const decisions: Array<{ responseId: number; selectedJobId: number; resolutionComment?: string }> = [];
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

  private confirmIncompleteResolution(workspaceId: number, decisions: Array<{ responseId: number; selectedJobId: number; resolutionComment?: string }>): void {
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

  private getDecisionForItem(item: DoubleCodedItem): { responseId: number; selectedJobId: number; resolutionComment?: string } | null {
    const controlName = this.getItemControlName(item);
    const selectedJobId = this.selectionForm.get(controlName)?.value;

    if (selectedJobId) {
      const selectedResult = item.coderResults.find(cr => cr.jobId.toString() === selectedJobId);
      if (selectedResult) {
        const decision: { responseId: number; selectedJobId: number; resolutionComment?: string } = {
          responseId: item.responseId,
          selectedJobId: selectedResult.jobId
        };

        if (this.hasConflict(item)) {
          const commentControlName = this.getCommentControlName(item);
          const comment = this.selectionForm.get(commentControlName)?.value;
          if (comment && comment.trim()) {
            decision.resolutionComment = comment.trim();
          }
        }
        return decision;
      }
    }
    return null;
  }

  private sendDecisions(
    workspaceId: number,
    decisions: Array<{ responseId: number; selectedJobId: number; resolutionComment?: string }>
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
      case -3:
        return '-98';
      case -4:
        return '-97';
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
