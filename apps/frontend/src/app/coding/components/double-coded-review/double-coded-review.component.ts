import {
  Component, OnInit, Inject, Optional, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
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
import { AppService } from '../../../services/app.service';

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
  private appService = inject(AppService);
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

  data: DoubleCodedItem[] = [];
  totalItems = 0;
  currentPage = 1;
  pageSize = 10;
  isLoading = false;

  selectionForm!: FormGroup;

  ngOnInit(): void {
    this.initializeForm();
    this.loadData();
  }

  private initializeForm(): void {
    this.selectionForm = this.fb.group({});
  }

  private updateForm(): void {
    // Clear existing form controls
    Object.keys(this.selectionForm.controls).forEach(key => {
      this.selectionForm.removeControl(key);
    });

    // Add form controls for each item
    this.data.forEach((item, index) => {
      const controlName = `item_${index}`;
      const defaultValue = item.coderResults.length > 0 ? item.coderResults[0].coderId.toString() : '';
      this.selectionForm.addControl(controlName, new FormControl(defaultValue));
    });
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
        this.data = response.data.map(item => ({
          ...item,
          selectedCoderResult: item.coderResults[0] // Default to first coder
        }));
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
    const controlName = `item_${index}`;
    const selectedCoderId = this.selectionForm.get(controlName)?.value;
    const item = this.data[index];
    return item.coderResults.find(cr => cr.coderId.toString() === selectedCoderId);
  }

  applyReviewDecisions(): void {
    // TODO: Implement applying review decisions
    this.translateService.get('double-coded-review.errors.review-applied').subscribe(message => {
      this.showSuccess(message);
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
