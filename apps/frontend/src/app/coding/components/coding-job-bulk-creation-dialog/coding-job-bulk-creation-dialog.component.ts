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
import { DistributedCodingService } from '../../services/distributed-coding.service';
import { AppService } from '../../../core/services/app.service';

interface JobCreationWarning {
  unitName: string;
  variableId: string;
  message: string;
  casesInJobs: number;
  availableCases: number;
}

type PreviewVariableBundle = Pick<VariableBundle, 'id' | 'name' | 'variables' | 'caseOrderingMode'> &
Partial<Pick<VariableBundle, 'description' | 'createdAt' | 'updatedAt'>>;

export interface BulkCreationData {
  selectedVariables: Variable[];
  selectedVariableBundles: PreviewVariableBundle[];
  selectedCoders: Coder[];
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  maxCodingCases?: number | null;
  distributionSeed?: string;
  creationResults?: {
    doubleCodingInfo: Record<string, {
      totalCases: number;
      distinctCases?: number;
      codingTasksTotal?: number;
      doubleCodedCases: number;
      singleCodedCasesAssigned: number;
      doubleCodedCasesPerCoder: Record<string, number>;
    }>;
    distributionByCoderId?: Record<string, Record<string, number>>;
    jobs: Array<{
      itemKey?: string;
      coderId: number;
      coderName: string;
      variable: { unitName: string; variableId: string };
      jobId: number;
      jobName: string;
      caseCount: number;
    }>;
  };
  distribution?: Record<string, Record<string, number>>;
  distributionByCoderId?: Record<string, Record<string, number>>;
  doubleCodingInfo?: Record<string, {
    totalCases: number;
    distinctCases?: number;
    codingTasksTotal?: number;
    doubleCodedCases: number;
    singleCodedCasesAssigned: number;
    doubleCodedCasesPerCoder: Record<string, number>;
  }>;
  warnings?: JobCreationWarning[];
  displayOptions?: {
    showScore?: boolean;
    allowComments?: boolean;
    suppressGeneralInstructions?: boolean;
  };
  displayOptionsLocked?: boolean;
}

interface DoubleCodingPreview {
  doubleCodingInfo: Record<string, {
    totalCases: number;
    distinctCases?: number;
    codingTasksTotal?: number;
    doubleCodedCases: number;
    singleCodedCasesAssigned: number;
    doubleCodedCasesPerCoder: Record<string, number>;
  }>;
}

export interface JobPreview {
  name: string;
  variable?: Variable;
  bundle?: PreviewVariableBundle;
  caseCount?: number;
  coderName?: string;
  jobId?: number;
}

export interface BulkCreationResult {
  confirmed: true;
  showScore: boolean;
  allowComments: boolean;
  suppressGeneralInstructions: boolean;
}

interface DistributionMatrixRow {
  variable?: { unitName: string; variableId: string };
  bundle?: PreviewVariableBundle;
  variableKey: string;
  totalCases: number;
  coderCases: Record<string, number>;
  coderCasesById?: Record<string, number>;
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
  private distributedCodingService = inject(DistributedCodingService);
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
  private readonly defaultCoderCapacityPercent = 100;
  private readonly minCoderCapacityPercent = 10;
  private readonly maxCoderCapacityPercent = 300;

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

      const result = await firstValueFrom(this.distributedCodingService.calculateDistribution(
        workspaceId,
        this.data.selectedVariables,
        this.data.selectedCoders.map(coder => ({
          ...coder,
          username: coder.name,
          capacityPercent: this.normalizeCoderCapacityPercent(coder.capacityPercent)
        })),
        this.data.doubleCodingAbsolute,
        this.data.doubleCodingPercentage,
        this.data.selectedVariableBundles,
        this.data.caseOrderingMode,
        this.data.maxCodingCases ?? undefined,
        this.data.distributionSeed
      ));

      this.data.distribution = result?.distribution || {};
      this.data.distributionByCoderId = result?.distributionByCoderId || {};
      this.data.doubleCodingInfo = result?.doubleCodingInfo || {};
      this.data.warnings = result?.warnings || [];

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

  private normalizeCoderCapacityPercent(value: unknown): number {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return this.defaultCoderCapacityPercent;
    }

    return Math.min(
      this.maxCoderCapacityPercent,
      Math.max(this.minCoderCapacityPercent, numericValue)
    );
  }

  private initializeFromData(): void {
    if (!this.data.distribution || !this.data.doubleCodingInfo) return;

    this.warnings = this.data.warnings || [];
    this.showWarningsPanel = this.warnings.length > 0;
    this.distributionMatrix = [];
    for (const [variableKey, coderCases] of Object.entries(this.data.distribution)) {
      const coderCasesById = this.data.distributionByCoderId?.[variableKey];
      const totalCases = Object.values(coderCasesById || coderCases).reduce((sum, count) => sum + count, 0);

      if (this.isVariableItemKey(variableKey)) {
        const [unitName, variableId] = variableKey.split('::');
        this.distributionMatrix.push({
          variable: { unitName, variableId },
          variableKey,
          totalCases,
          coderCases,
          coderCasesById
        });
      } else {
        const bundle = this.findBundleForItemKey(variableKey);
        this.distributionMatrix.push({
          bundle,
          variableKey,
          totalCases,
          coderCases,
          coderCasesById
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
    const doubleCodingInfo: NonNullable<BulkCreationData['doubleCodingInfo']> = {};
    const distributionByCoderId: Record<string, Record<string, number>> = {};

    for (const [variableKey, info] of Object.entries(this.data.creationResults.doubleCodingInfo)) {
      doubleCodingInfo[variableKey] = info;
      distribution[variableKey] = {};
      distributionByCoderId[variableKey] = {};

      this.data.selectedCoders.forEach(coder => {
        const job = this.data.creationResults!.jobs.find(j => {
          if (j.itemKey) {
            return j.itemKey === variableKey && j.coderId === coder.id;
          }
          if (this.isVariableItemKey(variableKey)) {
            return `${j.variable.unitName}::${j.variable.variableId}` === variableKey && j.coderId === coder.id;
          }
          return j.variable.unitName === variableKey && j.variable.variableId === '' && j.coderId === coder.id;
        });
        distribution[variableKey][coder.name] = job?.caseCount || 0;
        distributionByCoderId[variableKey][String(coder.id)] = job?.caseCount || 0;
      });
    }

    this.data.distribution = distribution;
    this.data.distributionByCoderId = this.data.creationResults.distributionByCoderId || distributionByCoderId;
    this.data.doubleCodingInfo = doubleCodingInfo;
    this.initializeFromData();
  }

  private createJobPreviews(): JobPreview[] {
    if (this.data.creationResults?.jobs) {
      return this.data.creationResults.jobs
        .filter(job => job.caseCount > 0)
        .map(job => {
          const bundle = job.itemKey ? this.findBundleForItemKey(job.itemKey) : undefined;
          return {
            name: job.jobName,
            variable: bundle ? undefined : job.variable,
            bundle,
            caseCount: job.caseCount,
            coderName: job.coderName,
            jobId: job.jobId
          };
        });
    }

    const previews: JobPreview[] = [];
    // Sort coders alphabetically for deterministic job naming
    const sortedCoders = [...this.data.selectedCoders].sort((a, b) => a.name.localeCompare(b.name));

    const items: (Variable | PreviewVariableBundle)[] = [];
    if (this.data.selectedVariableBundles) {
      items.push(...this.data.selectedVariableBundles);
    }
    items.push(...this.data.selectedVariables);

    for (const item of items) {
      for (const coder of sortedCoders) {
        const caseCount = this.getCaseCountForCoder(item, coder);
        if (caseCount <= 0) {
          continue;
        }

        let jobName = '';
        let preview: JobPreview;

        if ('variables' in item) { // bundle
          jobName = this.generateJobName(coder.name, this.getBundleDisplayName(item), '');
          preview = {
            name: jobName, bundle: item, caseCount, coderName: coder.name
          };
        } else { // variable
          jobName = this.generateJobName(coder.name, item.unitName, item.variableId);
          preview = {
            name: jobName, variable: item, caseCount, coderName: coder.name
          };
        }

        previews.push(preview);
      }
    }

    return previews;
  }

  private generateJobName(coderName: string, unitName: string, variableId: string): string {
    if (variableId) {
      return `Job ${unitName} - ${variableId} (${coderName})`;
    }

    return `Job ${unitName} (${coderName})`;
  }

  private getBundleItemKey(bundle: Pick<PreviewVariableBundle, 'id'>): string {
    return `bundle:${bundle.id}`;
  }

  private isVariableItemKey(itemKey: string): boolean {
    return !itemKey.startsWith('bundle:') && itemKey.includes('::');
  }

  private findBundleForItemKey(itemKey: string): PreviewVariableBundle | undefined {
    if (itemKey.startsWith('bundle:')) {
      const bundleId = Number(itemKey.slice('bundle:'.length));
      return this.data.selectedVariableBundles?.find(bundle => bundle.id === bundleId);
    }

    return this.data.selectedVariableBundles?.find(bundle => bundle.name === itemKey);
  }

  getBundleDisplayName(bundle: PreviewVariableBundle): string {
    const sameNameCount = (this.data.selectedVariableBundles || [])
      .filter(selectedBundle => selectedBundle.name === bundle.name)
      .length;

    return sameNameCount > 1 ? `${bundle.name} (#${bundle.id})` : bundle.name;
  }

  private getCaseCountForCoder(item: Variable | PreviewVariableBundle, coder: Coder): number {
    let itemKey;
    let totalCases;
    let variableCaseCounts: number[];

    if ('variables' in item) { // bundle
      itemKey = this.getBundleItemKey(item);
      variableCaseCounts = item.variables.map(variable => variable.responseCount || 0);
      totalCases = variableCaseCounts.reduce((sum, count) => sum + count, 0);
    } else { // variable
      itemKey = `${item.unitName}::${item.variableId}`;
      totalCases = item.responseCount || 0;
      variableCaseCounts = [totalCases];
    }

    if (this.data.distribution && this.data.doubleCodingInfo) {
      const coderCasesById = this.data.distributionByCoderId?.[itemKey] ||
        ('variables' in item ? this.data.distributionByCoderId?.[item.name] : undefined);
      if (coderCasesById) {
        return coderCasesById[String(coder.id)] || 0;
      }
      const coderCases = this.data.distribution[itemKey] ||
        ('variables' in item ? this.data.distribution[item.name] : undefined);
      const coderName = this.data.selectedCoders.find(c => c.id === coder.id)?.name;
      if (coderCases && coderName) {
        return coderCases[coderName] || 0;
      }
    }

    // Fallback to calculation when backend data is not available
    const sortedCoders = [...this.data.selectedCoders].sort((a, b) => a.name.localeCompare(b.name));
    const coderIndex = sortedCoders.findIndex(c => c.id === coder.id);

    if (coderIndex === -1) return 0;

    const doubleCodingCount = variableCaseCounts
      .reduce((sum, count) => sum + this.getDoubleCodingCountForVariable(count), 0);

    const singleCodingCases = totalCases - doubleCodingCount;
    const baseCasesPerCoder = Math.floor(singleCodingCases / sortedCoders.length);
    const remainder = singleCodingCases % sortedCoders.length;

    const singleCases = baseCasesPerCoder + (coderIndex < remainder ? 1 : 0);
    return singleCases + doubleCodingCount;
  }

  private getDoubleCodingCountForVariable(totalCases: number): number {
    if (this.data.doubleCodingAbsolute && this.data.doubleCodingAbsolute > 0) {
      return Math.min(this.data.doubleCodingAbsolute, totalCases);
    }
    if (this.data.doubleCodingPercentage && this.data.doubleCodingPercentage > 0) {
      return Math.min(
        Math.ceil((this.data.doubleCodingPercentage / 100) * totalCases),
        totalCases
      );
    }
    return 0;
  }

  private initForm(): void {
    this.displayOptionsForm = this.fb.group({
      showScore: [this.data.displayOptions?.showScore ?? true],
      allowComments: [this.data.displayOptions?.allowComments ?? true],
      suppressGeneralInstructions: [this.data.displayOptions?.suppressGeneralInstructions ?? false]
    });
  }

  getVariableDisplayName(variable: { unitName: string; variableId: string }): string {
    return `${variable.unitName} → ${variable.variableId}`;
  }

  getCoderTotal(coderName: string): number {
    return this.distributionMatrix.reduce((total, row) => total + (row.coderCases[coderName] || 0), 0);
  }

  getCaseCountForCoderInRow(row: DistributionMatrixRow, coder: Coder): number {
    return row.coderCasesById?.[String(coder.id)] ?? row.coderCases[coder.name] ?? 0;
  }

  getCoderTotalById(coder: Coder): number {
    return this.distributionMatrix.reduce((total, row) => total + this.getCaseCountForCoderInRow(row, coder), 0);
  }

  getDoubleCodedCasesForCoder(
    info: { doubleCodedCasesPerCoder: Record<string, number> },
    coder: Coder
  ): number {
    if (info.doubleCodedCasesPerCoder[coder.name] !== undefined) {
      return info.doubleCodedCasesPerCoder[coder.name];
    }

    const duplicateSafeKey = `${coder.name} (#${coder.id})`;
    return info.doubleCodedCasesPerCoder[duplicateSafeKey] || 0;
  }

  getGrandTotal(): number {
    return this.distributionMatrix.reduce((total, row) => total + row.totalCases, 0);
  }

  private getActiveDoubleCodingInfo(): BulkCreationData['doubleCodingInfo'] | undefined {
    return this.data.creationResults?.doubleCodingInfo ||
      this.doubleCodingPreview?.doubleCodingInfo ||
      this.data.doubleCodingInfo;
  }

  getUniqueCaseTotal(): number {
    const doubleCodingInfo = this.getActiveDoubleCodingInfo();
    if (!doubleCodingInfo || Object.keys(doubleCodingInfo).length === 0) {
      return this.getGrandTotal();
    }

    return Object.values(doubleCodingInfo).reduce(
      (total, info) => total + info.doubleCodedCases + info.singleCodedCasesAssigned,
      0
    );
  }

  getJobCaseCount(job: JobPreview): number {
    if (job.caseCount !== undefined) {
      return job.caseCount;
    }

    if (this.data.creationResults?.jobs) {
      const resultJob = this.data.creationResults.jobs.find(j => {
        if (job.variable) {
          return j.variable.unitName === job.variable.unitName &&
            j.variable.variableId === job.variable.variableId &&
            j.jobName === job.name;
        } if (job.bundle) {
          if (j.itemKey) {
            return j.itemKey === this.getBundleItemKey(job.bundle) &&
              j.jobName === job.name;
          }
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
    const coderColumns = 'minmax(88px, 1fr) '.repeat(this.data.selectedCoders.length);
    return `minmax(180px, 1.6fr) minmax(88px, 1fr) minmax(88px, 1fr) minmax(88px, 1fr) ${coderColumns}`.trim();
  }

  getDistributionGridTemplate(): string {
    const coderColumns = 'minmax(88px, 1fr) '.repeat(this.data.selectedCoders.length);
    return `minmax(180px, 1.6fr) ${coderColumns}minmax(70px, .8fr)`.trim();
  }

  getVariableDisplayNameFromKey(variableKey: string): string {
    const bundle = this.findBundleForItemKey(variableKey);
    if (bundle) {
      return this.getBundleDisplayName(bundle);
    }

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
      const uniqueCases = this.getUniqueCaseTotal();
      if (uniqueCases > this.data.maxCodingCases) {
        this.snackBar.open(
          `Die Zahl der eindeutigen Kodierfälle (${uniqueCases}) überschreitet das Maximum von ${this.data.maxCodingCases}.`,
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
