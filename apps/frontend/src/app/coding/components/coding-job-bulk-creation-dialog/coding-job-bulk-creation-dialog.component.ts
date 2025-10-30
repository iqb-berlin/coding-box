import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { VariableBundle, Variable } from '../../models/coding-job.model';
import { Coder } from '../../models/coder.model';

export interface BulkCreationData {
  baseName: string;
  description: string;
  selectedVariables: Variable[];
  selectedVariableBundles: VariableBundle[];
  selectedCoders: Coder[];
}

export interface JobPreview {
  name: string;
  variable: Variable;
}

@Component({
  selector: 'coding-box-coding-job-bulk-creation-dialog',
  templateUrl: './coding-job-bulk-creation-dialog.component.html',
  styleUrls: ['./coding-job-bulk-creation-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule
  ]
})
export class CodingJobBulkCreationDialogComponent {
  jobPreviews: JobPreview[] = [];

  constructor(
    public dialogRef: MatDialogRef<CodingJobBulkCreationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BulkCreationData
  ) {
    this.jobPreviews = this.createJobPreviews();
  }

  private createJobPreviews(): JobPreview[] {
    return this.data.selectedVariables.map(variable => ({
      name: `${this.data.baseName}_${variable.unitName}_${variable.variableId}`,
      variable
    }));
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
