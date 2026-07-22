import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MissingsProfileService } from '../../../services/missings-profile.service';

export type CodingResultsExportFormat = 'csv' | 'excel';

export interface DownloadCodingResultsDialogData {
  workspaceId: number;
  currentVersion: 'v1' | 'v2' | 'v3';
  hasGeoGebraResponses?: boolean;
}

@Component({
  selector: 'app-download-coding-results-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatRadioModule,
    MatFormFieldModule,
    MatSelectModule,
    MatCardModule,
    FormsModule,
    ReactiveFormsModule,
    MatCheckboxModule,
    TranslateModule
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      <mat-icon class="title-icon">download</mat-icon>
      {{ 'coding-management.download-dialog.title' | translate }}
    </h2>

    <mat-dialog-content class="dialog-content">
      <p class="info-text">
        {{ 'coding-management.download-dialog.info-message' | translate }}
      </p>

      <mat-card class="section-card version-card">
        <mat-card-header>
          <mat-card-title>{{ 'coding-management.download-dialog.select-version' | translate }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <mat-radio-group [(ngModel)]="selectedVersion" (ngModelChange)="onVersionChange()" class="radio-group">
            <mat-radio-button value="v1" class="radio-option">
              <div class="radio-content">
                <span class="option-title">{{ 'coding-management.statistics.first-autocode-run' | translate }}</span>
                <span class="option-description">{{ 'coding-management.download-dialog.v1-description' | translate }}</span>
              </div>
            </mat-radio-button>

            <mat-radio-button value="v2" class="radio-option">
              <div class="radio-content">
                <span class="option-title">{{ 'coding-management.statistics.manual-coding-run' | translate }}</span>
                <span class="option-description">{{ 'coding-management.download-dialog.v2-description' | translate }}</span>
              </div>
            </mat-radio-button>

            <mat-radio-button value="v3" class="radio-option">
              <div class="radio-content">
                <span class="option-title">{{ 'coding-management.statistics.second-autocode-run' | translate }}</span>
                <span class="option-description">{{ 'coding-management.download-dialog.v3-description' | translate }}</span>
              </div>
            </mat-radio-button>
          </mat-radio-group>
        </mat-card-content>
      </mat-card>

      @if (selectedVersion === 'v1') {
        <mat-card class="section-card">
          <mat-card-header>
            <mat-card-title>{{ 'coding-management.download-dialog.select-missings-profile' | translate }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <mat-form-field appearance="outline" class="profile-select">
              <mat-label>{{ 'coding-management.download-dialog.missings-profile' | translate }}</mat-label>
              <mat-select [(ngModel)]="selectedMissingsProfileId" [disabled]="isLoadingMissingsProfiles">
                @for (profile of missingsProfiles; track profile.id) {
                  <mat-option [value]="profile.id">{{ profile.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            @if (isLoadingMissingsProfiles) {
              <p class="profile-hint">{{ 'coding-management.download-dialog.loading-missings-profiles' | translate }}</p>
            } @else if (missingsProfilesError) {
              <p class="profile-error">{{ 'coding-management.download-dialog.missings-profiles-error' | translate }}</p>
            } @else if (!missingsProfiles.length) {
              <p class="profile-error">{{ 'coding-management.download-dialog.no-missings-profiles' | translate }}</p>
            }
          </mat-card-content>
        </mat-card>
      }

      <mat-card class="section-card format-card">
        <mat-card-header>
          <mat-card-title>{{ 'coding-management.download-dialog.select-format' | translate }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <mat-radio-group [(ngModel)]="selectedFormat" (ngModelChange)="onSelectedFormatChange()" class="radio-group format-group">
            <mat-radio-button value="csv" class="radio-option">
              <div class="radio-content">
                <mat-icon>table_chart</mat-icon>
                <span class="option-title">CSV</span>
              </div>
            </mat-radio-button>

            <mat-radio-button value="excel" class="radio-option">
              <div class="radio-content">
                <mat-icon>table_chart</mat-icon>
                <span class="option-title">Excel</span>
              </div>
            </mat-radio-button>
          </mat-radio-group>
        </mat-card-content>
      </mat-card>

      <mat-card class="section-card options-card">
        <mat-card-header>
          <mat-card-title>{{ 'coding-management.download-dialog.options-title' | translate }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="option-item">
            <mat-checkbox [(ngModel)]="includeReplayUrls" class="option-checkbox">
              {{ 'coding-management.download-dialog.include-replay-urls' | translate }}
            </mat-checkbox>
            <p class="option-description">
              {{ 'coding-management.download-dialog.replay-urls-description' | translate }}
            </p>
          </div>
          <div class="option-item">
            <mat-checkbox [(ngModel)]="includeResponseValues" (ngModelChange)="onIncludeResponseValuesChange()"
              class="option-checkbox">
              {{ 'coding-management.download-dialog.include-response-values' | translate }}
            </mat-checkbox>
            <p class="option-description">
              {{ 'coding-management.download-dialog.response-values-description' | translate }}
            </p>
          </div>
          @if (data.hasGeoGebraResponses) {
            <div class="option-item">
              <mat-checkbox [(ngModel)]="includeGeoGebraResponseValues"
                [disabled]="!includeResponseValues || includeGeoGebraFiles"
                class="option-checkbox">
                {{ 'coding-management.download-dialog.include-geogebra-response-values' | translate }}
              </mat-checkbox>
              <p class="option-description">
                {{ 'coding-management.download-dialog.geogebra-response-values-description' | translate }}
              </p>
            </div>
            <div class="option-item">
              <mat-checkbox [(ngModel)]="includeGeoGebraFiles"
                [disabled]="selectedFormat !== 'excel' || !includeResponseValues"
                (ngModelChange)="onIncludeGeoGebraFilesChange()"
                class="option-checkbox">
                {{ 'coding-management.download-dialog.include-geogebra-files' | translate }}
              </mat-checkbox>
              <p class="option-description">
                {{ 'coding-management.download-dialog.geogebra-files-description' | translate }}
              </p>
            </div>
          }
        </mat-card-content>
      </mat-card>

      <mat-card class="notice-card">
        <mat-card-content>
          <div class="notice-content">
            <mat-icon class="notice-icon">info</mat-icon>
            <div class="notice-text">
              <p class="notice-title">{{ 'coding-management.download-dialog.notice-title' | translate }}</p>
              <p class="notice-description">{{ 'coding-management.download-dialog.notice-message' | translate }}</p>
            </div>
          </div>
        </mat-card-content>
      </mat-card>
    </mat-dialog-content>

    <mat-dialog-actions align="end" class="dialog-actions">
      <button mat-button (click)="onCancel()">
        {{ 'common.cancel' | translate }}
      </button>
      <button mat-raised-button color="primary" (click)="onDownload()"
        [disabled]="isDownloadDisabled">
        <mat-icon>download</mat-icon>
        {{ 'coding-management.download-dialog.download-button' | translate }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    ::ng-deep .mat-mdc-dialog-container {
      padding: 0 !important;
    }

    .dialog-title {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0;
      padding: 24px 24px 16px 24px;
      font-size: 20px;
      font-weight: 500;

      .title-icon {
        color: var(--primary-color, #1976d2);
      }
    }

    .dialog-content {
      padding: 8px 24px 24px 24px;
      max-height: 60vh;
      overflow-y: auto;

      .info-text {
        margin: 0 0 20px 0;
        padding: 12px 16px;
        background-color: rgba(25, 118, 210, 0.08);
        border-left: 4px solid var(--primary-color, #1976d2);
        border-radius: 4px;
        color: rgba(0, 0, 0, 0.87);
        font-size: 14px;
        line-height: 1.5;
      }
    }

    .section-card,
    .notice-card {
      margin-bottom: 16px;
      box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.1);

      mat-card-header {
        padding: 16px 16px 12px 16px;
        margin: 0;

        mat-card-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0;
          color: rgba(0, 0, 0, 0.87);
        }
      }

      mat-card-content {
        padding: 8px 16px 16px 16px;
        margin: 0;
      }
    }

    .option-item {
      display: flex;
      flex-direction: column;
      gap: 8px;

      & + .option-item {
        margin-top: 14px;
      }

      .option-checkbox {
        margin: 0;

        ::ng-deep .mat-mdc-checkbox-label {
          font-size: 14px;
          font-weight: 500;
          color: rgba(0, 0, 0, 0.87);
        }
      }

      .option-description {
        margin: 0 0 0 32px;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.6);
        line-height: 1.4;
      }
    }

    .radio-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .format-group {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .radio-option {
      margin-bottom: 4px;

      .radio-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-left: 4px;

        .option-title {
          font-size: 14px;
          font-weight: 500;
          color: rgba(0, 0, 0, 0.87);
        }

        .option-description {
          font-size: 12px;
          color: rgba(0, 0, 0, 0.6);
          margin-left: 0;
        }

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          margin-right: 4px;
        }
      }
    }

    .notice-card {
      background-color: rgba(25, 118, 210, 0.04);
      border-left: 4px solid var(--primary-color, #1976d2);

      .notice-content {
        display: flex;
        gap: 12px;
        align-items: flex-start;

        .notice-icon {
          color: var(--primary-color, #1976d2);
          font-size: 20px;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .notice-text {
          flex: 1;

          .notice-title {
            margin: 0 0 4px 0;
            font-weight: 600;
            font-size: 13px;
            color: rgba(0, 0, 0, 0.87);
          }

          .notice-description {
            margin: 0;
            font-size: 12px;
            color: rgba(0, 0, 0, 0.6);
            line-height: 1.4;
          }
        }
      }
    }

    .dialog-actions {
      padding: 12px 24px;
      border-top: 1px solid rgba(0, 0, 0, 0.12);
      gap: 8px;

      button {
        min-width: 100px;

        mat-icon {
          margin-right: 6px;
        }
      }
    }

    .profile-select {
      width: 100%;
    }

    .profile-hint,
    .profile-error {
      margin: 0;
      font-size: 12px;
    }

    .profile-error {
      color: #b00020;
    }
  `]
})
export class DownloadCodingResultsDialogComponent implements OnInit {
  selectedVersion: 'v1' | 'v2' | 'v3' = 'v1';
  selectedFormat: CodingResultsExportFormat = 'csv';
  includeReplayUrls: boolean = false;
  includeResponseValues: boolean = true;
  includeGeoGebraFiles: boolean = false;
  includeGeoGebraResponseValues: boolean = false;
  missingsProfiles: { label: string; id: number }[] = [];
  selectedMissingsProfileId: number | null = null;
  isLoadingMissingsProfiles = false;
  missingsProfilesError = false;
  private hasLoadedMissingsProfiles = false;

  constructor(
    public dialogRef: MatDialogRef<DownloadCodingResultsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DownloadCodingResultsDialogData,
    private readonly missingsProfileService: MissingsProfileService
  ) {
    this.selectedVersion = data.currentVersion;
  }

  ngOnInit(): void {
    this.loadMissingsProfilesForV1();
  }

  get isDownloadDisabled(): boolean {
    return this.selectedVersion === 'v1' && (
      this.isLoadingMissingsProfiles ||
      this.missingsProfilesError ||
      this.selectedMissingsProfileId === null
    );
  }

  onVersionChange(): void {
    this.loadMissingsProfilesForV1();
  }

  private loadMissingsProfilesForV1(): void {
    if (
      this.selectedVersion !== 'v1' ||
      this.isLoadingMissingsProfiles ||
      this.hasLoadedMissingsProfiles
    ) {
      return;
    }

    this.missingsProfilesError = false;
    this.isLoadingMissingsProfiles = true;
    this.missingsProfileService
      .getExportMissingsProfilesOrThrow(this.data.workspaceId)
      .subscribe({
        next: profiles => {
          this.missingsProfiles = profiles.filter(profile => (
            Number.isSafeInteger(profile.id) && profile.id > 0
          ));
          const standard = this.missingsProfiles.find(profile => (
            profile.label === 'IQB-Standard'
          ));
          this.selectedMissingsProfileId = standard?.id ??
            this.missingsProfiles[0]?.id ?? null;
          this.hasLoadedMissingsProfiles = true;
          this.isLoadingMissingsProfiles = false;
        },
        error: () => {
          this.missingsProfilesError = true;
          this.isLoadingMissingsProfiles = false;
        }
      });
  }

  onIncludeResponseValuesChange(): void {
    this.clearUnsupportedGeoGebraOption();
  }

  onSelectedFormatChange(): void {
    this.clearUnsupportedGeoGebraOption();
  }

  onIncludeGeoGebraFilesChange(): void {
    this.clearUnsupportedGeoGebraOption();
  }

  private clearUnsupportedGeoGebraOption(): void {
    if (this.selectedFormat !== 'excel' || !this.includeResponseValues || !this.data.hasGeoGebraResponses) {
      this.includeGeoGebraFiles = false;
    }
    if (!this.includeResponseValues || !this.data.hasGeoGebraResponses || this.includeGeoGebraFiles) {
      this.includeGeoGebraResponseValues = false;
    }
  }

  onDownload(): void {
    this.clearUnsupportedGeoGebraOption();
    if (this.isDownloadDisabled) {
      return;
    }
    this.dialogRef.close({
      version: this.selectedVersion,
      format: this.selectedFormat,
      includeReplayUrls: this.includeReplayUrls,
      includeResponseValues: this.includeResponseValues,
      includeGeoGebraFiles: this.includeGeoGebraFiles,
      includeGeoGebraResponseValues: this.includeGeoGebraResponseValues,
      missingsProfileId: this.selectedVersion === 'v1' ?
        this.selectedMissingsProfileId : undefined
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
