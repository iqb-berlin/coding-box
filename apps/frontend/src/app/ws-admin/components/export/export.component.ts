import { Component, inject } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AppService } from '../../../core/services/app.service';
import { ExportJobService } from '../../../shared/services/file/export-job.service';
import { CodingFacadeService } from '../../../services/facades/coding-facade.service';
import { CoderService } from '../../../coding/services/coder.service';
import { JobDefinition } from '../../../coding/services/coding-job-backend.service';
import { CoderTraining } from '../../../coding/models/coder-training.model';
import { Coder } from '../../../coding/models/coder.model';

export type ExportFormat = 'aggregated' | 'by-coder' | 'by-variable' | 'detailed' | 'coding-times';

@Component({
  selector: 'coding-box-export',
  templateUrl: './export.component.html',
  styleUrls: ['./export.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    MatCardModule,
    MatButtonModule,
    MatRadioModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatCheckboxModule,
    MatTooltipModule,
    MatSelectModule,
    MatFormFieldModule,
    FormsModule,
    CommonModule
  ]
})
export class ExportComponent {
  private appService = inject(AppService);
  private exportJobService = inject(ExportJobService);
  private translateService = inject(TranslateService);
  private snackBar = inject(MatSnackBar);
  private codingFacadeService = inject(CodingFacadeService);
  private coderService = inject(CoderService);

  selectedFormat: ExportFormat = 'aggregated';
  isStartingExport = false;
  includeModalValue = false;
  includeDoubleCoded = false;
  includeComments = false;
  includeReplayUrl = false;
  outputCommentsInsteadOfCodes = false;
  anonymizeCoders = false;
  usePseudoCoders = false;
  doubleCodingMethod: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent' = 'most-frequent';
  excludeAutoCoded = true;

  jobDefinitions: JobDefinition[] = [];
  coderTrainings: CoderTraining[] = [];
  coders: Coder[] = [];

  selectedJobDefinitionIds: number[] = [];
  selectedCoderTrainingIds: number[] = [];
  selectedCoderIds: number[] = [];
  selectedCombinedJobIds: string[] = [];

  exportFormats = [
    {
      value: 'aggregated' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.aggregated'),
      description: this.translateService.instant('ws-admin.export-formats.aggregated-description')
    },
    {
      value: 'by-coder' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.by-coder'),
      description: this.translateService.instant('ws-admin.export-formats.by-coder-description')
    },
    {
      value: 'by-variable' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.by-variable'),
      description: this.translateService.instant('ws-admin.export-formats.by-variable-description')
    },
    {
      value: 'detailed' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.detailed'),
      description: this.translateService.instant('ws-admin.export-formats.detailed-description')
    },
    {
      value: 'coding-times' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.coding-times'),
      description: this.translateService.instant('ws-admin.export-formats.coding-times-description')
    }
  ];

  constructor() {
    this.loadOptions();
  }

  getJobDefinitionLabel(def: JobDefinition): string {
    const idPart = def.id != null ? `Definition #${def.id}` : 'Definition';
    const statusPart = def.status ? `(${def.status})` : '';
    const varsCount = def.assignedVariables?.length ?? 0;
    const bundlesCount = def.assignedVariableBundles?.length ?? 0;
    const codersCount = def.assignedCoders?.length ?? 0;
    return `${idPart} ${statusPart} – ${varsCount} Variablen, ${bundlesCount} Bündel, ${codersCount} Kodierer`;
  }

  private loadOptions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.codingFacadeService.getJobDefinitions(workspaceId).subscribe(defs => {
      this.jobDefinitions = defs;
    });

    this.codingFacadeService.getCoderTrainings(workspaceId).subscribe(trainings => {
      this.coderTrainings = trainings;
    });

    this.coderService.getCoders().subscribe(coders => {
      this.coders = coders;
    });
  }

  onFormatChange(): void {
    this.clearReplayUrlIfNeeded();
  }

  onDoubleCodingMethodChange(): void {
    this.clearReplayUrlIfNeeded();
  }

  private clearReplayUrlIfNeeded(): void {
    if (this.selectedFormat === 'coding-times' ||
      (this.selectedFormat === 'aggregated' && this.doubleCodingMethod === 'new-column-per-coder')) {
      this.includeReplayUrl = false;
    }
  }

  get finalJobDefinitionIds(): number[] {
    return this.selectedCombinedJobIds
      .filter(id => id.startsWith('job_'))
      .map(id => parseInt(id.replace('job_', ''), 10));
  }

  get finalCoderTrainingIds(): number[] {
    return this.selectedCombinedJobIds
      .filter(id => id.startsWith('training_'))
      .map(id => parseInt(id.replace('training_', ''), 10));
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

    this.isStartingExport = true;

    const loggedUser = this.appService.loggedUser;
    const tokenObservable = this.includeReplayUrl && loggedUser?.sub ?
      this.appService.createToken(workspaceId, loggedUser.sub, 60).pipe(catchError(() => {
        this.snackBar.open(
          this.translateService.instant('ws-admin.export.errors.token-failed'),
          this.translateService.instant('close'),
          { duration: 5000 }
        );
        this.isStartingExport = false;
        throw new Error('Token generation failed');
      })) :
      new Observable<string>(subscriber => {
        subscriber.next('');
        subscriber.complete();
      });

    tokenObservable.subscribe(authToken => {
      // Prepare export configuration
      const exportConfig = {
        exportType: this.selectedFormat,
        userId: this.appService.userId,
        outputCommentsInsteadOfCodes: this.outputCommentsInsteadOfCodes,
        includeReplayUrl: this.includeReplayUrl,
        anonymizeCoders: this.anonymizeCoders,
        usePseudoCoders: this.usePseudoCoders,
        doubleCodingMethod: this.doubleCodingMethod,
        includeComments: this.includeComments,
        includeModalValue: this.includeModalValue,
        includeDoubleCoded: this.includeDoubleCoded,
        excludeAutoCoded: this.excludeAutoCoded,
        jobDefinitionIds: this.finalJobDefinitionIds,
        coderTrainingIds: this.finalCoderTrainingIds,
        coderIds: this.selectedCoderIds,
        authToken
      };

      this.exportJobService.startJob(workspaceId, exportConfig);

      this.snackBar.open(
        this.translateService.instant('ws-admin.export.job-started'),
        this.translateService.instant('close'),
        { duration: 3000 }
      );

      this.isStartingExport = false;
    });
  }
}
