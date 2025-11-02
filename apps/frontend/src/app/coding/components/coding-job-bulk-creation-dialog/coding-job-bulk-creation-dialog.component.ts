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
import { BackendService } from '../../../services/backend.service';

export interface BulkCreationData {
  selectedVariables: Variable[];
  selectedVariableBundles: VariableBundle[];
  selectedCoders: Coder[];
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  creationResults?: {
    doubleCodingInfo: Record<string, {
      totalCases: number;
      doubleCodedCases: number;
      singleCodedCasesAssigned: number;
      doubleCodedCasesPerCoder: Record<string, number>;
    }>;
    jobs: Array<{
      coderId: number;
      coderName: string;
      variable: { unitName: string; variableId: string };
      jobId: number;
      jobName: string;
      caseCount: number;
    }>;
  };
  distribution?: Record<string, Record<string, number>>;
  doubleCodingInfo?: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
}

interface DoubleCodingPreview {
  doubleCodingInfo: Record<string, {
    totalCases: number;
    doubleCodedCases: number;
    singleCodedCasesAssigned: number;
    doubleCodedCasesPerCoder: Record<string, number>;
  }>;
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
  private backendService = inject(BackendService);
  displayOptionsForm!: FormGroup;
  jobPreviews: JobPreview[] = [];
  distributionMatrix: DistributionMatrixRow[] = [];
  doubleCodingPreview?: DoubleCodingPreview;
  isLoading = false;

  constructor(
    public dialogRef: MatDialogRef<CodingJobBulkCreationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BulkCreationData
  ) {
    this.initForm();

    if (this.data.distribution && this.data.doubleCodingInfo) {
      this.initializeFromData();
    } else if (this.data.creationResults) {
      this.initializeFromCreationResults();
    } else {
      this.calculateDistributionWithBackend();
    }
  }

  private async calculateDistributionWithBackend(): Promise<void> {
    this.isLoading = true;
    try {
      const workspaceId = (this.backendService as { appService?: { selectedWorkspaceId?: number } }).appService?.selectedWorkspaceId;
      if (!workspaceId) {
        this.distributionMatrix = this.calculateDistributionFrontend();
        this.doubleCodingPreview = this.calculateDoubleCodingPreviewFrontend();
        this.jobPreviews = this.createJobPreviews();
        return;
      }

      const result = await this.backendService.calculateDistribution(
        workspaceId,
        this.data.selectedVariables,
        this.data.selectedCoders.map(coder => ({ ...coder, username: coder.name })),
        this.data.doubleCodingAbsolute,
        this.data.doubleCodingPercentage
      ).toPromise();

      if (result) {
        this.data.distribution = result.distribution;
        this.data.doubleCodingInfo = result.doubleCodingInfo;
        this.initializeFromData();
      } else {
        this.distributionMatrix = this.calculateDistributionFrontend();
        this.doubleCodingPreview = this.calculateDoubleCodingPreviewFrontend();
        this.jobPreviews = this.createJobPreviews();
      }
    } catch (error) {
      this.distributionMatrix = this.calculateDistributionFrontend();
      this.doubleCodingPreview = this.calculateDoubleCodingPreviewFrontend();
      this.jobPreviews = this.createJobPreviews();
    } finally {
      this.isLoading = false;
    }
  }

  private initializeFromData(): void {
    if (!this.data.distribution || !this.data.doubleCodingInfo) return;

    this.distributionMatrix = [];
    for (const [variableKey, coderCases] of Object.entries(this.data.distribution)) {
      const [unitName, variableId] = variableKey.split('::');
      const totalCases = Object.values(coderCases).reduce((sum, count) => sum + count, 0);

      this.distributionMatrix.push({
        variable: { unitName, variableId },
        variableKey,
        totalCases,
        coderCases
      });
    }

    if (Object.keys(this.data.doubleCodingInfo).length > 0) {
      this.doubleCodingPreview = { doubleCodingInfo: this.data.doubleCodingInfo };
    }

    this.jobPreviews = this.createJobPreviews();
  }

  private initializeFromCreationResults(): void {
    if (!this.data.creationResults) return;

    const distribution: Record<string, Record<string, number>> = {};
    const doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }> = {};

    for (const [variableKey, info] of Object.entries(this.data.creationResults.doubleCodingInfo)) {
      doubleCodingInfo[variableKey] = info;
      distribution[variableKey] = {};

      this.data.selectedCoders.forEach(coder => {
        const job = this.data.creationResults!.jobs.find(j => `${j.variable.unitName}::${j.variable.variableId}` === variableKey &&
          j.coderId === coder.id
        );
        distribution[variableKey][coder.name] = job?.caseCount || 0;
      });
    }

    this.data.distribution = distribution;
    this.data.doubleCodingInfo = doubleCodingInfo;
    this.initializeFromData();
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

  private calculateDistributionFrontend(): DistributionMatrixRow[] {
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

  private calculateDoubleCodingPreviewFrontend(): DoubleCodingPreview | undefined {
    if ((!this.data.doubleCodingAbsolute || this.data.doubleCodingAbsolute <= 0) &&
        (!this.data.doubleCodingPercentage || this.data.doubleCodingPercentage <= 0)) {
      return undefined;
    }

    const sortedCoders = [...this.data.selectedCoders].sort((a, b) => a.name.localeCompare(b.name));
    const doubleCodingInfo: Record<string, {
      totalCases: number;
      doubleCodedCases: number;
      singleCodedCasesAssigned: number;
      doubleCodedCasesPerCoder: Record<string, number>;
    }> = {};

    for (const variable of this.data.selectedVariables) {
      const variableKey = `${variable.unitName}::${variable.variableId}`;
      const totalCases = variable.responseCount || 0;

      // Calculate double coding requirements
      let doubleCodingCount = 0;
      if (this.data.doubleCodingAbsolute && this.data.doubleCodingAbsolute > 0) {
        doubleCodingCount = Math.min(this.data.doubleCodingAbsolute, totalCases);
      } else if (this.data.doubleCodingPercentage && this.data.doubleCodingPercentage > 0) {
        doubleCodingCount = Math.floor((this.data.doubleCodingPercentage / 100) * totalCases);
      }

      const singleCodedCasesAssigned = Math.max(0, totalCases - doubleCodingCount);

      // Initialize tracking
      const doubleCodedCasesPerCoder: Record<string, number> = {};
      sortedCoders.forEach(coder => {
        doubleCodedCasesPerCoder[coder.name] = 0;
      });

      // Simulate distribution of double coding cases evenly among coders
      // Each double coding case goes to 2 coders, so we track how many double coding assignments each coder gets
      if (doubleCodingCount > 0) {
        const assignments = this.distributeDoubleCodingEvenlyFrontend(doubleCodingCount, sortedCoders);
        assignments.forEach(assignment => {
          doubleCodedCasesPerCoder[assignment.coder.name] += assignment.count;
        });
      }

      doubleCodingInfo[variableKey] = {
        totalCases,
        doubleCodedCases: doubleCodingCount,
        singleCodedCasesAssigned,
        doubleCodedCasesPerCoder
      };
    }

    return { doubleCodingInfo };
  }

  private distributeDoubleCodingEvenlyFrontend(
    totalDoubleCodingCases: number,
    sortedCoders: Coder[]
  ): Array<{ coder: Coder; count: number }> {
    const assignments: Array<{ coder: Coder; count: number }> = [];

    // Track how many assignments each coder has received
    const assignmentCounts = new Map<Coder, number>();
    sortedCoders.forEach(coder => assignmentCounts.set(coder, 0));

    // For preview purposes, we'll evenly distribute the double coding assignments
    // In reality, each case gets assigned to 2 coders, but here we calculate the expected count per coder
    for (let i = 0; i < totalDoubleCodingCases; i++) {
      // Find the coder with the least assignments so far
      let minCount = Infinity;
      let selectedCoder: Coder | null = null;

      for (const coder of sortedCoders) {
        const currentCount = assignmentCounts.get(coder) || 0;
        if (currentCount < minCount) {
          minCount = currentCount;
          selectedCoder = coder;
        } else if (currentCount === minCount && selectedCoder) {
          // Break ties by name for consistency
          if (coder.name.localeCompare(selectedCoder.name) < 0) {
            selectedCoder = coder;
          }
        }
      }

      if (selectedCoder) {
        assignmentCounts.set(selectedCoder, (assignmentCounts.get(selectedCoder) || 0) + 1);
      }
    }

    // Convert to array format
    for (const coder of sortedCoders) {
      assignments.push({
        coder,
        count: assignmentCounts.get(coder) || 0
      });
    }

    return assignments;
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

    if (this.data.creationResults?.jobs) {
      const resultJob = this.data.creationResults.jobs.find(j => j.variable.unitName === job.variable?.unitName &&
        j.variable.variableId === job.variable.variableId &&
        j.jobName === job.name
      );
      if (resultJob) {
        return resultJob.caseCount;
      }
    }

    // Extract coder name from beginning of job name
    const jobNameParts = job.name.split('_');
    if (jobNameParts.length < 3) return 0;

    // Case count is the last part
    const caseCountStr = jobNameParts[jobNameParts.length - 1];
    const caseCount = parseInt(caseCountStr, 10);
    return Number.isNaN(caseCount) ? 0 : caseCount;
  }

  objectKeys(obj: Record<string, unknown>): string[] {
    return Object.keys(obj);
  }

  getVariableDisplayNameFromKey(variableKey: string): string {
    // Convert "unitName::variableId" format to display format
    const parts = variableKey.split('::');
    if (parts.length === 2) {
      return `${parts[0]} → ${parts[1]}`;
    }
    return variableKey;
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
