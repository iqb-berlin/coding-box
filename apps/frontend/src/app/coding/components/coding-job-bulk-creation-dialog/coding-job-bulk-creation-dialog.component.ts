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
  selectedVariables: Variable[];
  selectedVariableBundles: VariableBundle[];
  selectedCoders: Coder[];
}

export interface JobPreview {
  name: string;
  variable?: Variable;
  bundle?: VariableBundle;
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
    const previews: JobPreview[] = [];
    this.data.selectedVariables.forEach(variable => {
      previews.push({
        name: `${variable.unitName}_${variable.variableId}`,
        variable
      });
    });
    this.data.selectedVariableBundles.forEach(bundle => {
      previews.push({
        name: bundle.name,
        bundle
      });
    });

    return previews;
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
