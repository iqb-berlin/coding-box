import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import type { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { BehaviorSubject, Observable } from 'rxjs';

export type TestResultsImportProgressPhase =
  | 'uploading'
  | 'processing'
  | 'refreshingOverview'
  | 'completed'
  | 'failed';

export interface TestResultsImportProgressState {
  title: string;
  icon: string;
  phase: TestResultsImportProgressPhase;
  phaseLabel: string;
  message: string;
  percent?: number;
  completed?: number;
  total?: number;
  currentItem?: string;
  mode?: 'determinate' | 'indeterminate';
}

export interface TestResultsImportProgressDialogData {
  state$: Observable<TestResultsImportProgressState>;
}

export interface TestResultsImportProgressHandle {
  dialogRef: MatDialogRef<TestResultsImportProgressDialogComponent>;
  state$: BehaviorSubject<TestResultsImportProgressState>;
}

@Component({
  selector: 'coding-box-test-results-import-progress-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinner
  ],
  templateUrl: './test-results-import-progress-dialog.component.html',
  styleUrls: ['./test-results-import-progress-dialog.component.scss']
})
export class TestResultsImportProgressDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: TestResultsImportProgressDialogData
  ) { }
}
