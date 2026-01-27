import {
  Component, OnInit, Inject, Optional, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import {
  FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormControl
} from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';

interface CoderResult {
  coderId: number;
  coderName: string;
  jobId: number;
  code: number | null;
  score: number | null;
  notes: string | null;
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
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule,
    MatDialogModule,
    FormsModule,
    ReactiveFormsModule,
    TranslateModule
  ]
})
export class DoubleCodedReviewComponent implements OnInit {
  private testPersonCodingService = inject(TestPersonCodingService);
  private appService: AppService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private translateService = inject(TranslateService);

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
  pageSize = 10;
  isLoading = false;
  showOnlyConflicts = true;

  selectionForm!: FormGroup;

  ngOnInit(): void {
    this.initializeForm();
    this.setupFilterPredicate();
    this.loadData();
  }

  private setupFilterPredicate(): void {
    this.dataSource.filterPredicate = (data: DoubleCodedItem, filter: string): boolean => {
      if (filter === 'conflicts-only') {
        return this.hasConflict(data);
      }
      return true;
    };
  }

  private initializeForm(): void {
    this.selectionForm = this.fb.group({});
  }

  getCurrentItems(): DoubleCodedItem[] {
    return this.dataSource.filteredData && this.dataSource.filteredData.length > 0 ?
      this.dataSource.filteredData :
      this.dataSource.data;
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

    // Determine the current set of rows to base the form on (respect active filter)
    const currentItems = this.getCurrentItems();

    // Add form controls for each visible/filtered item
    currentItems.forEach(item => {
      const controlName = this.getItemControlName(item);
      const defaultValue = item.coderResults.length > 0 ? item.coderResults[0].coderId.toString() : '';
      this.selectionForm.addControl(controlName, new FormControl(defaultValue));

      // Add comment control for conflicting items
      if (this.hasConflict(item)) {
        const commentControlName = this.getCommentControlName(item);
        this.selectionForm.addControl(commentControlName, new FormControl(''));
      }
    });
  }

  hasConflict(item: DoubleCodedItem): boolean {
    if (item.coderResults.length < 2) {
      return false;
    }
    const firstCode = item.coderResults[0].code;
    return item.coderResults.some(result => result.code !== firstCode);
  }

  onFilterChange(): void {
    this.dataSource.filter = this.showOnlyConflicts ? 'conflicts-only' : '';
    // Rebuild form controls to match the currently visible (filtered) rows
    this.updateForm();
  }

  areAllVisibleConflictsResolved(): boolean {
    const currentItems = this.getCurrentItems();
    return currentItems.every(item => {
      if (!this.hasConflict(item)) {
        return true; // Non-conflicting items don't need resolution
      }
      const controlName = this.getItemControlName(item);
      const value = this.selectionForm.get(controlName)?.value;
      return value && value !== '';
    });
  }

  getConflictCount(): number {
    return this.allData.filter(item => this.hasConflict(item)).length;
  }

  getVisibleConflictCount(): number {
    return this.dataSource.data.filter(item => this.hasConflict(item)).length;
  }

  getUnresolvedCount(): number {
    const currentItems = this.getCurrentItems();
    return currentItems.filter(item => {
      if (!this.hasConflict(item)) return false;
      const controlName = this.getItemControlName(item);
      const value = this.selectionForm.get(controlName)?.value;
      return !value || value === '';
    }).length;
  }

  loadData(): void {
    this.isLoading = true;
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
      this.pageSize
    ).subscribe({
      next: response => {
        this.allData = response.data.map(item => ({
          ...item,
          selectedCoderResult: item.coderResults[0] // Default to first coder
        }));
        this.dataSource.data = this.allData;
        this.totalItems = response.total;

        // Apply conflict filter if enabled
        this.onFilterChange();

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

  onSelectionChange(item: DoubleCodedItem, coderId: string): void {
    const selectedResult = item.coderResults.find(cr => cr.coderId.toString() === coderId);
    if (selectedResult) {
      item.selectedCoderResult = selectedResult;
    }
  }

  getSelectedCoderResult(item: DoubleCodedItem): CoderResult | undefined {
    return item.selectedCoderResult || item.coderResults[0];
  }

  getSelectedCoderResultFromForm(index: number): CoderResult | undefined {
    const currentItems = this.getCurrentItems();
    const item = currentItems[index];
    if (!item) {
      return undefined;
    }
    const controlName = this.getItemControlName(item);
    const selectedCoderId = this.selectionForm.get(controlName)?.value;
    return item.coderResults.find(cr => cr.coderId.toString() === selectedCoderId);
  }

  applyReviewDecisions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.translateService.get('double-coded-review.errors.no-workspace-selected').subscribe(message => {
        this.showError(message);
      });
      return;
    }

    // Collect decisions from current (visible) items on the page
    const decisions: Array<{ responseId: number; selectedJobId: number; resolutionComment?: string }> = [];

    const currentItems = this.getCurrentItems();

    currentItems.forEach(item => {
      const controlName = this.getItemControlName(item);
      const selectedCoderId = this.selectionForm.get(controlName)?.value;

      if (selectedCoderId) {
        const selectedResult = item.coderResults.find(cr => cr.coderId.toString() === selectedCoderId);
        if (selectedResult) {
          const decision: { responseId: number; selectedJobId: number; resolutionComment?: string } = {
            responseId: item.responseId,
            selectedJobId: selectedResult.jobId
          };

          // Add comment if provided for conflicting items
          if (this.hasConflict(item)) {
            const commentControlName = this.getCommentControlName(item);
            const comment = this.selectionForm.get(commentControlName)?.value;
            if (comment && comment.trim()) {
              decision.resolutionComment = comment.trim();
            }
          }

          decisions.push(decision);
        }
      }
    });

    if (decisions.length === 0) {
      this.translateService.get('double-coded-review.errors.no-decisions').subscribe(message => {
        this.showError(message);
      });
      return;
    }

    this.isLoading = true;
    this.testPersonCodingService.applyDoubleCodedResolutions(workspaceId, { decisions }).subscribe({
      next: response => {
        this.translateService.get('double-coded-review.success.resolutions-applied', {
          count: response.appliedCount
        }).subscribe(message => {
          this.showSuccess(message);
        });

        // Reset to page 1 and reload data
        this.currentPage = 1;
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

  getCoderResultsDisplay(coderResults: DoubleCodedItem['coderResults']): string {
    return coderResults.map(cr => `${cr.coderName}: ${cr.code || 'N/A'}`).join(', ');
  }

  getSelectedValue(item: DoubleCodedItem): string {
    const selected = this.getSelectedCoderResult(item);
    return selected ? selected.coderId.toString() : '';
  }
}
