import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { TranslateModule } from '@ngx-translate/core';
import { Coder } from '../../models/coder.model';
import { CoderTraining } from '../../models/coder-training.model';

export type ManualCodingExportContext = 'training' | 'execution';
export type ManualCodingExportMode = 'review' | 'report';
export type ManualCodingExportType = 'aggregated' | 'detailed' | 'coding-times';

export interface ManualCodingJobDefinitionOption {
  id: number;
  label: string;
}

export interface ManualCodingExportDialogData {
  context: ManualCodingExportContext;
  coders: Coder[];
  jobDefinitions?: ManualCodingJobDefinitionOption[];
  coderTrainings?: CoderTraining[];
}

export interface ManualCodingExportDialogResult {
  exportType: ManualCodingExportType;
  outputCommentsInsteadOfCodes?: boolean;
  doubleCodingMethod?: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent';
  includeComments?: boolean;
  includeModalValue?: boolean;
  includeReplayUrl?: boolean;
  includeResponseValues?: boolean;
  anonymizeCoders?: boolean;
  usePseudoCoders?: boolean;
  jobDefinitionIds?: number[];
  coderTrainingIds?: number[];
  coderIds?: number[];
}

@Component({
  selector: 'coding-box-manual-coding-export-dialog',
  templateUrl: './manual-coding-export-dialog.component.html',
  styleUrls: ['./manual-coding-export-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatRadioModule,
    MatSelectModule,
    TranslateModule
  ]
})
export class ManualCodingExportDialogComponent {
  readonly selectAllOptionId = -1;

  exportMode: ManualCodingExportMode = 'review';
  reportExportType: Exclude<ManualCodingExportType, 'aggregated'> = 'detailed';
  doubleCodingMethod: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent' = 'most-frequent';
  outputCommentsInsteadOfCodes = false;
  includeComments = true;
  includeModalValue = true;
  includeReplayUrl = false;
  includeResponseValues = false;
  anonymizeCoders = false;
  usePseudoCoders = false;
  selectedJobDefinitionIds: number[] = [];
  selectedCoderTrainingIds: number[] = [];
  selectedCoderIds: number[] = [];

  constructor(
    public dialogRef: MatDialogRef<ManualCodingExportDialogComponent, ManualCodingExportDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: ManualCodingExportDialogData
  ) { }

  get contextSubtitleKey(): string {
    return this.data.context === 'training' ?
      'manual-coding-export.subtitle-training' :
      'manual-coding-export.subtitle-execution';
  }

  get canConfirm(): boolean {
    if (this.data.context === 'execution' && this.data.jobDefinitions?.length) {
      return this.selectedJobDefinitionIds.length > 0;
    }

    if (this.data.context === 'training' && this.data.coderTrainings?.length) {
      return this.selectedCoderTrainingIds.length > 0;
    }

    return true;
  }

  get canIncludeResponseData(): boolean {
    return (this.exportMode === 'review' && this.doubleCodingMethod === 'new-row-per-variable') ||
      (this.exportMode === 'report' && this.reportExportType === 'detailed');
  }

  get areAllJobDefinitionsSelected(): boolean {
    return !!this.data.jobDefinitions?.length &&
      this.data.jobDefinitions.every(
        jobDefinition => this.selectedJobDefinitionIds.includes(jobDefinition.id)
      );
  }

  get areAllCoderTrainingsSelected(): boolean {
    return !!this.data.coderTrainings?.length &&
      this.data.coderTrainings.every(
        training => this.selectedCoderTrainingIds.includes(training.id)
      );
  }

  toggleAllJobDefinitions(): void {
    this.selectedJobDefinitionIds = this.areAllJobDefinitionsSelected ?
      [] :
      this.data.jobDefinitions?.map(jobDefinition => jobDefinition.id) ?? [];
  }

  removeJobDefinitionToggleOption(): void {
    this.selectedJobDefinitionIds = this.selectedJobDefinitionIds.filter(
      id => id !== this.selectAllOptionId
    );
  }

  toggleAllCoderTrainings(): void {
    this.selectedCoderTrainingIds = this.areAllCoderTrainingsSelected ?
      [] :
      this.data.coderTrainings?.map(training => training.id) ?? [];
  }

  removeCoderTrainingToggleOption(): void {
    this.selectedCoderTrainingIds = this.selectedCoderTrainingIds.filter(
      id => id !== this.selectAllOptionId
    );
  }

  confirm(): void {
    if (!this.canConfirm) {
      return;
    }

    const coderIds = this.selectedCoderIds.length ? this.selectedCoderIds : undefined;
    const jobDefinitionIds = this.selectedJobDefinitionIds.length ? this.selectedJobDefinitionIds : undefined;
    const coderTrainingIds = this.selectedCoderTrainingIds.length ? this.selectedCoderTrainingIds : undefined;

    if (this.exportMode === 'review') {
      this.dialogRef.close({
        exportType: 'aggregated',
        outputCommentsInsteadOfCodes: this.outputCommentsInsteadOfCodes,
        doubleCodingMethod: this.doubleCodingMethod,
        includeComments: this.includeComments,
        includeModalValue: this.includeModalValue,
        includeReplayUrl: this.canIncludeResponseData && this.includeReplayUrl,
        includeResponseValues: this.canIncludeResponseData && this.includeResponseValues,
        anonymizeCoders: this.anonymizeCoders,
        usePseudoCoders: this.anonymizeCoders && this.usePseudoCoders,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds
      });
      return;
    }

    this.dialogRef.close({
      exportType: this.reportExportType,
      outputCommentsInsteadOfCodes: this.outputCommentsInsteadOfCodes,
      includeReplayUrl: this.canIncludeResponseData && this.includeReplayUrl,
      includeResponseValues: this.canIncludeResponseData && this.includeResponseValues,
      anonymizeCoders: this.anonymizeCoders,
      usePseudoCoders: this.anonymizeCoders && this.usePseudoCoders,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    });
  }
}
