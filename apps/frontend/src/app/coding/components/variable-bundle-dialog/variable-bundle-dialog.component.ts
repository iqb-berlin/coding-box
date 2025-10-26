import {
  Component, Inject, OnInit, OnDestroy, inject, ViewChild, ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators
} from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';

import { MatSortModule } from '@angular/material/sort';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { SelectionModel } from '@angular/cdk/collections';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  takeUntil, fromEvent
} from 'rxjs';
import { VariableBundle, Variable } from '../../models/coding-job.model';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';

export interface VariableBundleGroupDialogData {
  bundleGroup?: VariableBundle;
  isEdit: boolean;
  preloadedIncompleteVariables?: Variable[];
}

@Component({
  selector: 'coding-box-variable-bundle-dialog',
  templateUrl: './variable-bundle-dialog.component.html',
  styleUrls: ['./variable-bundle-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatIconModule,
    MatChipsModule,
    MatTableModule,
    MatCheckboxModule,
    MatSortModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    TranslateModule,
    MatTooltipModule
  ]
})
export class VariableBundleDialogComponent implements OnInit, OnDestroy {
  @ViewChild('unitNameFilterInput') unitNameFilterInput!: ElementRef;
  @ViewChild('variableIdFilterInput') variableIdFilterInput!: ElementRef;

  private fb = inject(FormBuilder);
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private destroy$ = new Subject<void>();

  bundleGroupForm!: FormGroup;
  isLoading = false;

  // Variables
  availableVariables: Variable[] = [];
  selectedVariables = new SelectionModel<Variable>(true, []);
  displayedColumns: string[] = ['select', 'unitName', 'variableId'];
  dataSource = new MatTableDataSource<Variable>([]);

  isLoadingVariableAnalysis = false;

  // Filters
  unitNameFilter = '';
  variableIdFilter = '';
  private readonly debounceTimeMs = 300;

  constructor(
    public dialogRef: MatDialogRef<VariableBundleDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VariableBundleGroupDialogData
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.loadCodingIncompleteVariables();

    this.dataSource.filterPredicate = (row, filter: string): boolean => {
      try {
        const { unitName, variableId } = JSON.parse(filter || '{}');
        const unitMatch = unitName ? row.unitName?.toLowerCase().includes(String(unitName).toLowerCase()) : true;
        const varMatch = variableId ? row.variableId?.toLowerCase().includes(String(variableId).toLowerCase()) : true;
        return unitMatch && varMatch;
      } catch {
        return true;
      }
    };

    setTimeout(() => this.setupFilterDebounce(), 0);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupFilterDebounce(): void {
    if (!this.unitNameFilterInput || !this.variableIdFilterInput) {
      return;
    }
    fromEvent(this.unitNameFilterInput.nativeElement, 'input')
      .pipe(
        debounceTime(this.debounceTimeMs),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.unitNameFilter = this.unitNameFilterInput.nativeElement.value;
        this.applyFilter();
      });

    fromEvent(this.variableIdFilterInput.nativeElement, 'input')
      .pipe(
        debounceTime(this.debounceTimeMs),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.variableIdFilter = this.variableIdFilterInput.nativeElement.value;
        this.applyFilter();
      });
  }

  initForm(): void {
    this.bundleGroupForm = this.fb.group({
      name: [this.data.bundleGroup?.name || '', Validators.required],
      description: [this.data.bundleGroup?.description || '']
    });
  }

  loadCodingIncompleteVariables(unitNameFilter?: string): void {
    this.isLoadingVariableAnalysis = true;
    if (this.data.preloadedIncompleteVariables && !unitNameFilter) {
      this.availableVariables = this.data.preloadedIncompleteVariables;
      this.dataSource.data = this.availableVariables;
      this.processVariableSelection();
      this.isLoadingVariableAnalysis = false;
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.isLoadingVariableAnalysis = false;
      return;
    }

    this.backendService.getCodingIncompleteVariables(
      workspaceId,
      unitNameFilter || undefined
    ).subscribe({
      next: variables => {
        this.availableVariables = variables;
        this.dataSource.data = this.availableVariables;
        this.processVariableSelection();
        this.isLoadingVariableAnalysis = false;
      },
      error: () => {
        this.isLoadingVariableAnalysis = false;
      }
    });
  }

  private processVariableSelection(): void {
    if (this.data.bundleGroup?.variables) {
      this.data.bundleGroup.variables.forEach((variable: Variable) => {
        const foundVariable = this.availableVariables.find(
          v => v.unitName === variable.unitName && v.variableId === variable.variableId
        );
        if (foundVariable) {
          this.selectedVariables.select(foundVariable);
        }
      });
    }
  }

  applyFilter(): void {
    this.dataSource.filter = JSON.stringify({
      unitName: this.unitNameFilter || '',
      variableId: this.variableIdFilter || ''
    });
  }

  clearFilters(): void {
    this.unitNameFilter = '';
    this.variableIdFilter = '';

    if (this.unitNameFilterInput) {
      this.unitNameFilterInput.nativeElement.value = '';
    }
    if (this.variableIdFilterInput) {
      this.variableIdFilterInput.nativeElement.value = '';
    }

    this.applyFilter();
  }

  onSubmit(): void {
    if (this.bundleGroupForm.invalid) {
      return;
    }

    const selectedVars = this.selectedVariables.selected;

    const bundleGroup: VariableBundle = {
      id: this.data.bundleGroup?.id || 0,
      ...this.bundleGroupForm.value,
      createdAt: this.data.bundleGroup?.createdAt || new Date(),
      updatedAt: new Date(),
      variables: selectedVars
    };

    this.dialogRef.close(bundleGroup);
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
