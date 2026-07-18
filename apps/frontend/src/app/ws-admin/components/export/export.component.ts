import { Component, inject } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AppService } from '../../../core/services/app.service';
import {
  ExportJobConfig,
  ExportJobService
} from '../../../shared/services/file/export-job.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { MissingsProfileService } from '../../../coding/services/missings-profile.service';
import type {
  PsychometricDomainCandidateDto,
  PsychometricDomainSelection
} from '../../../../../../../api-dto/coding/psychometric-discrimination.dto';

export type ExportFormat =
  'results-by-version' | 'item-matrix' | 'psychometrics';
type ResultsVersion = 'v1' | 'v2' | 'v3';
type ResultsExportFormat = 'csv' | 'excel';
type MatrixValue = 'code' | 'score';

@Component({
  selector: 'coding-box-export',
  templateUrl: './export.component.html',
  styleUrls: ['./export.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatCheckboxModule,
    MatTooltipModule,
    MatSelectModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    FormsModule,
    CommonModule
  ]
})
export class ExportComponent {
  private appService = inject(AppService);
  private exportJobService = inject(ExportJobService);
  private translateService = inject(TranslateService);
  private snackBar = inject(MatSnackBar);
  private responseService = inject(ResponseService);
  private missingsProfileService = inject(MissingsProfileService);

  selectedFormat: ExportFormat = 'results-by-version';
  isStartingExport = false;
  includeResponseValues = true;
  includeGeoGebraResponseValues = false;
  includeGeoGebraFiles = false;
  hasGeoGebraResponses = false;
  resultsVersion: ResultsVersion = 'v2';
  resultsFormat: ResultsExportFormat = 'csv';
  matrixValue: MatrixValue = 'score';
  psychometricDomainCandidates: PsychometricDomainCandidateDto[] = [];
  psychometricMappingIssueCount = 0;
  missingsProfiles: Array<{ label: string; id: number }> = [];
  selectedPsychometricDomain = 'workspace';
  selectedMissingsProfileId: number | null = null;
  partWholeCorrection = true;
  maxCategoryCount = 10;
  isLoadingPsychometricOptions = false;
  psychometricOptionsLoadFailed = false;

  constructor() {
    this.loadOptions();
  }

  private loadOptions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.responseService
      .hasGeogebraResponses(workspaceId)
      .subscribe(hasGeoGebraResponses => {
        this.hasGeoGebraResponses = hasGeoGebraResponses;
        this.clearUnsupportedResultsOptions();
      });

    this.isLoadingPsychometricOptions = true;
    this.missingsProfileService
      .getMissingsProfilesOrThrow(workspaceId)
      .subscribe({
        next: profiles => {
          this.missingsProfiles = profiles;
          if (this.selectedMissingsProfileId === null && profiles.length > 0) {
            const standardProfile = profiles.find(profile => /iqb[\s-]*standard/i.test(profile.label)
            );
            this.selectedMissingsProfileId =
              standardProfile?.id || profiles[0].id;
          }
          this.finishLoadingPsychometricOptions();
        },
        error: () => {
          this.missingsProfiles = [];
          this.selectedMissingsProfileId = null;
          this.psychometricOptionsLoadFailed = true;
          this.snackBar.open(
            this.translateService.instant(
              'ws-admin.export.errors.psychometric-options-failed'
            ),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
          this.finishLoadingPsychometricOptions();
        }
      });
    this.exportJobService
      .getPsychometricDomainCandidates(workspaceId)
      .subscribe({
        next: result => {
          this.psychometricDomainCandidates = result.candidates;
          this.psychometricMappingIssueCount = result.mappingIssueCount;
          this.finishLoadingPsychometricOptions();
        },
        error: () => {
          this.psychometricDomainCandidates = [];
          this.psychometricOptionsLoadFailed = true;
          this.snackBar.open(
            this.translateService.instant(
              'ws-admin.export.errors.psychometric-domain-options-failed'
            ),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
          this.finishLoadingPsychometricOptions();
        }
      });
  }

  onResultsFormatChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  onSelectedFormatChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  onIncludeResponseValuesChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  onIncludeGeoGebraFilesChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  private clearUnsupportedResultsOptions(): void {
    if (
      this.selectedFormat !== 'results-by-version' ||
      this.resultsFormat !== 'excel' ||
      !this.includeResponseValues ||
      !this.hasGeoGebraResponses
    ) {
      this.includeGeoGebraFiles = false;
    }

    if (
      this.selectedFormat !== 'results-by-version' ||
      !this.includeResponseValues ||
      !this.hasGeoGebraResponses ||
      this.includeGeoGebraFiles
    ) {
      this.includeGeoGebraResponseValues = false;
    }
  }

  onExport(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(
        this.translateService.instant('ws-admin.export.errors.no-workspace'),
        this.translateService.instant('close'),
        { duration: 5000 }
      );
      return;
    }

    if (this.isExportDisabled) {
      return;
    }

    this.isStartingExport = true;

    this.exportJobService
      .startJob(workspaceId, this.buildExportConfig())
      .subscribe({
        next: () => {
          this.snackBar.open(
            this.translateService.instant('ws-admin.export.job-started'),
            this.translateService.instant('close'),
            { duration: 3000 }
          );
          this.isStartingExport = false;
        },
        error: () => {
          this.snackBar.open(
            this.translateService.instant(
              'ws-admin.export.errors.start-failed'
            ),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
          this.isStartingExport = false;
        }
      });
  }

  private buildExportConfig(): ExportJobConfig {
    if (this.selectedFormat === 'item-matrix') {
      return {
        exportType: 'item-matrix',
        userId: this.appService.userId,
        version: this.resultsVersion,
        format: this.resultsFormat,
        matrixValue: this.matrixValue
      };
    }

    if (this.selectedFormat === 'psychometrics') {
      return {
        exportType: 'psychometrics',
        userId: this.appService.userId,
        version: this.resultsVersion,
        format: this.resultsFormat,
        partWholeCorrection: this.partWholeCorrection,
        missingsProfileId: this.selectedMissingsProfileId || undefined,
        domain: this.getPsychometricDomainSelection(),
        maxCategoryCount: this.maxCategoryCount
      };
    }

    return {
      exportType: this.selectedFormat,
      userId: this.appService.userId,
      includeReplayUrl: false,
      version: this.resultsVersion,
      format: this.resultsFormat,
      includeResponseValues: this.includeResponseValues,
      includeGeoGebraResponseValues: this.includeGeoGebraResponseValues,
      includeGeoGebraFiles: this.includeGeoGebraFiles
    };
  }

  get isExportDisabled(): boolean {
    if (this.isStartingExport) {
      return true;
    }
    if (this.selectedFormat !== 'psychometrics') {
      return false;
    }
    if (
      this.isLoadingPsychometricOptions ||
      this.psychometricOptionsLoadFailed ||
      this.selectedMissingsProfileId === null ||
      !Number.isSafeInteger(this.maxCategoryCount) ||
      this.maxCategoryCount < 1 ||
      this.maxCategoryCount > 100
    ) {
      return true;
    }
    if (this.psychometricMappingIssueCount > 0) {
      return true;
    }
    if (this.selectedPsychometricDomain === 'workspace') {
      return false;
    }
    return !this.getSelectedDomainCandidate()?.selectable;
  }

  getPsychometricDomainKey(candidate: PsychometricDomainCandidateDto): string {
    return [candidate.scope, candidate.profileId, candidate.entryId].join(
      '\u001F'
    );
  }

  private getSelectedDomainCandidate():
  PsychometricDomainCandidateDto | undefined {
    return this.psychometricDomainCandidates.find(
      candidate => this.getPsychometricDomainKey(candidate) ===
        this.selectedPsychometricDomain
    );
  }

  private getPsychometricDomainSelection(): PsychometricDomainSelection {
    const candidate = this.getSelectedDomainCandidate();
    if (this.selectedPsychometricDomain === 'workspace' || !candidate) {
      return { mode: 'workspace' };
    }
    return {
      mode: 'vomd-field',
      scope: candidate.scope,
      profileId: candidate.profileId,
      entryId: candidate.entryId
    };
  }

  private psychometricOptionLoadsRemaining = 2;

  private finishLoadingPsychometricOptions(): void {
    this.psychometricOptionLoadsRemaining -= 1;
    if (this.psychometricOptionLoadsRemaining <= 0) {
      this.isLoadingPsychometricOptions = false;
    }
  }
}
