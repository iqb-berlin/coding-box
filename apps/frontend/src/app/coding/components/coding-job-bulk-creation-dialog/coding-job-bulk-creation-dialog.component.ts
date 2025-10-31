import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslateModule } from '@ngx-translate/core';
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

interface DistributionMatrixRow {
  variable: { unitName: string; variableId: string };
  variableKey: string;
  totalCases: number;
  coderCases: Record<string, number>;
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
    MatCheckboxModule,
    TranslateModule
  ]
})
export class CodingJobBulkCreationDialogComponent {
  private fb = inject(FormBuilder);
  displayOptionsForm!: FormGroup;
  jobPreviews: JobPreview[] = [];
  distributionMatrix: DistributionMatrixRow[] = [];

  constructor(
    public dialogRef: MatDialogRef<CodingJobBulkCreationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BulkCreationData
  ) {
    this.jobPreviews = this.createJobPreviews();
    this.distributionMatrix = this.calculateDistribution();
    this.initForm();
  }

  private createJobPreviews(): JobPreview[] {
    const previews: JobPreview[] = [];
    // Sort coders alphabetically for deterministic job naming
    const sortedCoders = [...this.data.selectedCoders].sort((a, b) => a.name.localeCompare(b.name));

    // Create one job per coder-variable combination
    for (const variable of this.data.selectedVariables) {
      for (const coder of sortedCoders) {
        const caseCount = this.getCaseCountForCoder(variable, coder);
        const jobName = this.generateJobName(coder.name, variable.unitName, variable.variableId, caseCount);
        previews.push({
          name: jobName,
          variable
        });
      }
    }

    return previews;
  }

  private calculateDistribution(): DistributionMatrixRow[] {
    const matrix: DistributionMatrixRow[] = [];
    const sortedCoders = [...this.data.selectedCoders].sort((a, b) => a.name.localeCompare(b.name));

    for (const variable of this.data.selectedVariables) {
      const totalCases = variable.responseCount || 0;
      const baseCasesPerCoder = Math.floor(totalCases / sortedCoders.length);
      const remainder = totalCases % sortedCoders.length;

      const coderCases: Record<string, number> = {};

      // Assign cases to each coder
      for (let i = 0; i < sortedCoders.length; i++) {
        const coder = sortedCoders[i];
        coderCases[coder.name] = baseCasesPerCoder + (i < remainder ? 1 : 0);
      }

      matrix.push({
        variable: { unitName: variable.unitName, variableId: variable.variableId },
        variableKey: `${variable.unitName}::${variable.variableId}`,
        totalCases: totalCases,
        coderCases
      });
    }

    return matrix;
  }

  private generateJobName(coderName: string, unitName: string, variableId: string, caseCount: number): string {
    // Clean names to avoid issues with special characters
    const cleanCoderName = coderName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const cleanUnitName = unitName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const cleanVariableId = variableId.replace(/[^a-zA-Z0-9-_]/g, '_');

    return `${cleanCoderName}_${cleanUnitName}_${cleanVariableId}_${caseCount}`;
  }

  private getCaseCountForCoder(variable: Variable, coder: Coder): number {
    const sortedCoders = [...this.data.selectedCoders].sort((a, b) => a.name.localeCompare(b.name));
    const coderIndex = sortedCoders.findIndex(c => c.id === coder.id);

    if (coderIndex === -1) return 0;

    const totalCases = variable.responseCount || 0;
    const baseCasesPerCoder = Math.floor(totalCases / sortedCoders.length);
    const remainder = totalCases % sortedCoders.length;

    return baseCasesPerCoder + (coderIndex < remainder ? 1 : 0);
  }

  private initForm(): void {
    this.displayOptionsForm = this.fb.group({
      showScore: [true],
      allowComments: [true],
      suppressGeneralInstructions: [false]
    });
  }

  getVariableDisplayName(variable: { unitName: string; variableId: string }): string {
    return `${variable.unitName} → ${variable.variableId}`;
  }

  getCoderTotal(coderName: string): number {
    return this.distributionMatrix.reduce((total, row) => total + (row.coderCases[coderName] || 0), 0);
  }

  getGrandTotal(): number {
    return this.distributionMatrix.reduce((total, row) => total + row.totalCases, 0);
  }

  getJobCaseCount(job: JobPreview): number {
    if (!job.variable) return 0;

    // Extract coder name from beginning of job name
    const jobNameParts = job.name.split('_');
    if (jobNameParts.length < 3) return 0;

    // Case count is the last part
    const caseCountStr = jobNameParts[jobNameParts.length - 1];
    const caseCount = parseInt(caseCountStr, 10);
    return Number.isNaN(caseCount) ? 0 : caseCount;
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
