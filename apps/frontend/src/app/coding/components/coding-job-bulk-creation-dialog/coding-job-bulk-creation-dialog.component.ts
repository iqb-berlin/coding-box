import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
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

export interface BulkCreationResult {
  confirmed: true;
  showScore: boolean;
  allowComments: boolean;
  suppressGeneralInstructions: boolean;
}

@Component({
  selector: 'coding-box-coding-job-bulk-creation-dialog',
  templateUrl: './coding-job-bulk-creation-dialog.component.html',
  styleUrls: ['./coding-job-bulk-creation-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule,
    MatCheckboxModule
  ]
})
export class CodingJobBulkCreationDialogComponent {
  private fb = inject(FormBuilder);
  displayOptionsForm!: FormGroup;
  jobPreviews: JobPreview[] = [];

  constructor(
    public dialogRef: MatDialogRef<CodingJobBulkCreationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BulkCreationData
  ) {
    this.jobPreviews = this.createJobPreviews();
    this.initForm();
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

  private initForm(): void {
    this.displayOptionsForm = this.fb.group({
      showScore: [true],
      allowComments: [true],
      suppressGeneralInstructions: [false]
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    const result: BulkCreationResult = {
      confirmed: true,
      showScore: this.displayOptionsForm.value.showScore,
      allowComments: this.displayOptionsForm.value.allowComments,
      suppressGeneralInstructions: this.displayOptionsForm.value.suppressGeneralInstructions
    };
    this.dialogRef.close(result);
  }
}
