import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { TranslateModule } from '@ngx-translate/core';
import { A11yModule } from '@angular/cdk/a11y';
import { firstValueFrom } from 'rxjs';
import { VariableBundle, Variable } from '../../models/coding-job.model';
import { Coder } from '../../models/coder.model';
import { CodingService } from '../../services/coding.service';
import { AppService } from '../../../core/services/app.service';

interface JobCreationWarning {
  unitName: string;
  variableId: string;
  message: string;
  casesInJobs: number;
  availableCases: number;
}

export interface BulkCreationData {
  selectedVariables: Variable[];
  selectedVariableBundles: VariableBundle[];
  selectedCoders: Coder[];
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  maxCodingCases?: number;
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
  warnings?: JobCreationWarning[];
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
  variable?: { unitName: string; variableId: string };
  bundle?: VariableBundle;
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
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatExpansionModule,
    TranslateModule,
    A11yModule
  ]
})
export class CodingJobBulkCreationDialogComponent {
  private fb = inject(FormBuilder);
  private codingService = inject(CodingService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  displayOptionsForm!: FormGroup;
  jobPreviews: JobPreview[] = [];
  distributionMatrix: DistributionMatrixRow[] = [];
  doubleCodingPreview?: DoubleCodingPreview;
  warnings: JobCreationWarning[] = [];
  showWarningsPanel = false;
  warningsConfirmed = false;
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
      this.calculateDistributionWithBackend().catch(() => { });
    }
  }

  private async calculateDistributionWithBackend(): Promise<void> {
    this.isLoading = true;
    try {
      const workspaceId = this.appService.selectedWorkspaceId;
      if (!workspaceId) {
        this.snackBar.open('No workspace selected', 'Close', { duration: 3000 });
        this.isLoading = false;
        return;
      }

      const result = await firstValueFrom(this.codingService.calculateDistribution(
        workspaceId,
        this.data.selectedVariables,
        this.data.selectedCoders.map(coder => ({ ...coder, username: coder.name })),
        this.data.doubleCodingAbsolute,
        this.data.doubleCodingPercentage,
        this.data.selectedVariableBundles,
        this.data.maxCodingCases
      ));

      this.data.distribution = result?.distribution || {};
      this.data.doubleCodingInfo = result?.doubleCodingInfo || {};
      this.warnings = result?.warnings || [];
      this.showWarningsPanel = this.warnings.length > 0;

      this.initializeFromData();

      if (!result || Object.keys(result.distribution || {}).length === 0) {
        this.snackBar.open('No distribution calculated', 'Close', { duration: 3000 });
        this.isLoading = false;
      } else {
        this.isLoading = false;
      }
    } catch (error) {
      this.snackBar.open(`Failed to calculate distribution: ${error instanceof Error ? error.message : error}`, 'Close', { duration: 5000 });
      this.isLoading = false;
    }
  }

  private initializeFromData(): void {
    if (!this.data.distribution || !this.data.doubleCodingInfo) return;

    this.distributionMatrix = [];
    for (const [variableKey, coderCases] of Object.entries(this.data.distribution)) {
      const totalCases = Object.values(coderCases).reduce((sum, count) => sum + count, 0);

      if (variableKey.includes('::')) {
        const [unitName, variableId] = variableKey.split('::');
        this.distributionMatrix.push({
          variable: { unitName, variableId },
          variableKey,
          totalCases,
          coderCases
        });
      } else {
        const bundle = this.data.selectedVariableBundles?.find(b => b.name === variableKey);
        this.distributionMatrix.push({
          bundle,
          variableKey,
          totalCases,
          coderCases
        });
      }
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
        const job = this.data.creationResults!.jobs.find(j => {
          if (variableKey.includes('::')) {
            return `${j.variable.unitName}::${j.variable.variableId}` === variableKey && j.coderId === coder.id;
          }
          return j.variable.unitName === variableKey && j.variable.variableId === '' && j.coderId === coder.id;
        });
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

    const items: (Variable | VariableBundle)[] = [];
    if (this.data.selectedVariableBundles) {
      items.push(...this.data.selectedVariableBundles);
    }
    items.push(...this.data.selectedVariables);

    for (const item of items) {
      for (const coder of sortedCoders) {
        const caseCount = this.getCaseCountForCoder(item, coder);
        let jobName = '';
        let preview: JobPreview;

        if ('variables' in item) { // bundle
          jobName = this.generateJobName(coder.name, item.name, '', caseCount);
          preview = { name: jobName, bundle: item };
        } else { // variable
          jobName = this.generateJobName(coder.name, item.unitName, item.variableId, caseCount);
          preview = { name: jobName, variable: item };
        }

        previews.push(preview);
      }
    }

    return previews;
  }

  private generateJobName(coderName: string, unitName: string, variableId: string, caseCount: number): string {
    // Clean names to avoid issues with special characters
    const cleanCoderName = coderName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const cleanUnitName = unitName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const cleanVariableId = variableId.replace(/[^a-zA-Z0-9-_]/g, '_');

    return `${cleanCoderName}_${cleanUnitName}_${cleanVariableId}_${caseCount}`;
  }

  private getCaseCountForCoder(item: Variable | VariableBundle, coder: Coder): number {
    let itemKey;
    let totalCases;

    if ('variables' in item) { // bundle
      itemKey = item.name;
      totalCases = item.variables.reduce((sum, v) => sum + (v.responseCount || 0), 0);
    } else { // variable
      itemKey = `${item.unitName}::${item.variableId}`;
      totalCases = item.responseCount || 0;
    }

    if (this.data.distribution && this.data.doubleCodingInfo) {
      const coderCases = this.data.distribution[itemKey];
      const coderName = this.data.selectedCoders.find(c => c.id === coder.id)?.name;
      if (coderCases && coderName) {
        return coderCases[coderName] || 0;
      }
    }

    // Fallback to calculation when backend data is not available
    const sortedCoders = [...this.data.selectedCoders].sort((a, b) => a.name.localeCompare(b.name));
    const coderIndex = sortedCoders.findIndex(c => c.id === coder.id);

    if (coderIndex === -1) return 0;

    // Calculate double coding requirements
    let doubleCodingCount = 0;
    if (this.data.doubleCodingAbsolute && this.data.doubleCodingAbsolute > 0) {
      doubleCodingCount = Math.min(this.data.doubleCodingAbsolute, totalCases);
    } else if (this.data.doubleCodingPercentage && this.data.doubleCodingPercentage > 0) {
      doubleCodingCount = Math.floor((this.data.doubleCodingPercentage / 100) * totalCases);
    }

    const singleCodingCases = totalCases - doubleCodingCount;
    const baseCasesPerCoder = Math.floor(singleCodingCases / sortedCoders.length);
    const remainder = singleCodingCases % sortedCoders.length;

    const singleCases = baseCasesPerCoder + (coderIndex < remainder ? 1 : 0);
    return singleCases + doubleCodingCount;
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
    if (this.data.creationResults?.jobs) {
      const resultJob = this.data.creationResults.jobs.find(j => {
        if (job.variable) {
          return j.variable.unitName === job.variable.unitName &&
            j.variable.variableId === job.variable.variableId &&
            j.jobName === job.name;
        } if (job.bundle) {
          return j.variable.unitName === job.bundle.name &&
            j.variable.variableId === '' &&
            j.jobName === job.name;
        }
        return false;
      });
      if (resultJob) {
        return resultJob.caseCount;
      }
    }

    const jobNameParts = job.name.split('_');
    if (jobNameParts.length < 3) return 0;

    const caseCountStr = jobNameParts[jobNameParts.length - 1];
    const caseCount = parseInt(caseCountStr, 10);
    return Number.isNaN(caseCount) ? 0 : caseCount;
  }

  objectKeys(obj: Record<string, unknown>): string[] {
    return Object.keys(obj);
  }

  getDoubleCodingGridTemplate(): string {
    const coderColumns = '80px '.repeat(this.data.selectedCoders.length);
    return `200px 80px 80px 80px ${coderColumns}`.trim();
  }

  getDistributionGridTemplate(): string {
    const coderColumns = '80px '.repeat(this.data.selectedCoders.length);
    return `200px ${coderColumns}60px`.trim();
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
    if (this.data.maxCodingCases !== undefined && this.data.maxCodingCases !== null && this.data.maxCodingCases > 0) {
      const totalCases = this.getGrandTotal();
      if (totalCases > this.data.maxCodingCases) {
        this.snackBar.open(
          `Die Gesamtzahl der Kodierfälle (${totalCases}) überschreitet das Maximum von ${this.data.maxCodingCases}.`,
          'Schließen',
          { duration: 5000 }
        );
        return;
      }
    }

    // If there are warnings and user hasn't confirmed, just mark warnings as confirmed and return
    if (this.warnings.length > 0 && !this.warningsConfirmed) {
      this.warningsConfirmed = true;
      return;
    }

    const result: BulkCreationResult = {
      confirmed: true,
      showScore: this.displayOptionsForm.value.showScore,
      allowComments: this.displayOptionsForm.value.allowComments,
      suppressGeneralInstructions: this.displayOptionsForm.value.suppressGeneralInstructions
    };
    this.dialogRef.close(result);
  }
}
