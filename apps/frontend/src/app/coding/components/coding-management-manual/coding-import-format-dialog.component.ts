import { TranslateModule } from '@ngx-translate/core';
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';

export type CodingImportSourceFormat =
  | 'external-coding'
  | 'coding-list'
  | 'coding-results';

export type CodingImportDetectedFormat =
  | CodingImportSourceFormat
  | 'test-results'
  | 'test-logs'
  | 'unknown';

export type CodingImportExistingCodingMode =
  | 'skip-conflicts'
  | 'fill-empty'
  | 'overwrite';

export interface CodingImportFormatDialogData {
  fileName: string;
  detectedFormat: CodingImportDetectedFormat;
  title: string;
  description: string;
  canImport: boolean;
  headers: string[];
  helpItems: string[];
  availableVersions?: Array<'v1' | 'v2' | 'v3'>;
  selectedVersion?: 'v1' | 'v2' | 'v3';
}

export interface CodingImportFormatDialogResult {
  sourceFormat: CodingImportSourceFormat;
  sourceVersion?: 'v1' | 'v2' | 'v3';
  scoreMode: 'import';
  existingCodingMode: CodingImportExistingCodingMode;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-coding-import-format-dialog',
  standalone: true,
  imports: [TranslateModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatRadioModule,
    MatSelectModule
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      <mat-icon>{{ data.canImport ? 'fact_check' : 'help_outline' }}</mat-icon>
      {{ data.title }}
    </h2>

    <mat-dialog-content class="dialog-content">
      <p class="description">{{ data.description }}</p>

      <div class="format-summary" [class.warning]="!data.canImport">
        <div>
          <span class="label">{{ 'process-overview.details.fileName' | translate }}</span>
          <span class="value">{{ data.fileName }}</span>
        </div>
        <div>
          <span class="label">{{ 'ui-text.coding-import-format-dialog.detected-format' | translate }}</span>
          <span class="value">{{ getFormatLabel() }}</span>
        </div>
      </div>

      @if (data.canImport) {
        <div class="target-box">
          <mat-icon>input</mat-icon>
          <span>{{ 'ui-text.coding-import-format-dialog.import-target' | translate }}</span>
        </div>
      }

      @if (data.detectedFormat === 'coding-results' && data.availableVersions?.length) {
        <mat-form-field
          appearance="outline"
          class="version-field"
          >
          <mat-label>{{ 'ui-text.coding-import-format-dialog.file-version' | translate }}</mat-label>
          <mat-select [(ngModel)]="selectedVersion">
            @for (version of data.availableVersions; track version) {
              <mat-option [value]="version">
                {{ getVersionLabel(version) }}
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
      }

      @if (data.canImport) {
        <section class="mode-section">
          <h3>{{ 'ui-text.coding-import-format-dialog.existing-codings' | translate }}</h3>
          <mat-radio-group class="mode-options" [(ngModel)]="existingCodingMode">
            <mat-radio-button value="skip-conflicts">
              <span class="mode-title">{{ 'ui-text.coding-import-format-dialog.skip-conflicts' | translate }}</span>
              <span class="mode-description">
                {{ 'ui-text.coding-import-format-dialog.skip-conflicts-hint' | translate }}
              </span>
            </mat-radio-button>
            <mat-radio-button value="fill-empty">
              <span class="mode-title">{{ 'ui-text.coding-import-format-dialog.fill-empty-only' | translate }}</span>
              <span class="mode-description">
                {{ 'ui-text.coding-import-format-dialog.fill-empty-hint' | translate }}
              </span>
            </mat-radio-button>
            <mat-radio-button value="overwrite">
              <span class="mode-title">{{ 'ui-text.coding-import-format-dialog.overwrite' | translate }}</span>
              <span class="mode-description">
                {{ 'ui-text.coding-import-format-dialog.overwrite-hint' | translate }}
              </span>
            </mat-radio-button>
          </mat-radio-group>
        </section>
      }

      @if (data.helpItems.length > 0) {
        <section class="help-section">
          <h3>{{ data.canImport ? ('file-upload.failure-suggestions.title' | translate) : 'Was ist zu tun?' }}</h3>
          <ul>
            @for (item of data.helpItems; track item) {
              <li>{{ item }}</li>
            }
          </ul>
        </section>
      }

      <mat-divider></mat-divider>

      <section class="headers-section">
        <h3>{{ 'ui-text.coding-import-format-dialog.detected-columns' | translate }}</h3>
        @if (data.headers.length === 0) {
          <p class="muted">
            {{ 'ui-text.coding-import-format-dialog.no-headers' | translate }}
          </p>
        }
        @if (data.headers.length > 0) {
          <div class="header-list">
            @for (header of data.headers; track header) {
              <span>{{ header }}</span>
            }
          </div>
        }
      </section>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">
        {{ data.canImport ? ('cancel' | translate) : ('deferred-view.close' | translate) }}
      </button>
      @if (data.canImport) {
        <button mat-raised-button color="primary" (click)="confirm()">
          <mat-icon>preview</mat-icon>
          {{ 'ui-text.coding-import-format-dialog.start-preview' | translate }}
        </button>
      }
    </mat-dialog-actions>
    `,
  styles: [`
    .dialog-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0;
    }

    .dialog-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 520px;
      max-width: 720px;
    }

    .description {
      margin: 0;
      line-height: 1.45;
    }

    .format-summary {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 12px;
      border: 1px solid #c8dfca;
      border-radius: 6px;
      background: #f5fbf6;
    }

    .format-summary.warning {
      border-color: #ffd59d;
      background: #fff8ed;
    }

    .label {
      display: block;
      font-size: 12px;
      color: rgba(0, 0, 0, 0.6);
      margin-bottom: 4px;
    }

    .value {
      font-weight: 600;
      word-break: break-word;
    }

    .target-box {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 6px;
      background: #eef5ff;
      color: #174a7c;
    }

    .version-field {
      width: 100%;
    }

    .mode-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .mode-options {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }

    .mode-options mat-radio-button {
      padding: 10px 12px;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
    }

    .mode-title,
    .mode-description {
      display: block;
      white-space: normal;
    }

    .mode-title {
      font-weight: 600;
    }

    .mode-description {
      margin-top: 2px;
      color: rgba(0, 0, 0, 0.6);
      font-size: 12px;
      line-height: 1.35;
    }

    h3 {
      margin: 0 0 8px;
      font-size: 14px;
      font-weight: 600;
    }

    ul {
      margin: 0;
      padding-left: 20px;
    }

    li {
      margin: 4px 0;
    }

    .headers-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .header-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      max-height: 120px;
      overflow: auto;
    }

    .header-list span {
      padding: 4px 8px;
      border-radius: 4px;
      background: #f0f0f0;
      font-size: 12px;
    }

    .muted {
      margin: 0;
      color: rgba(0, 0, 0, 0.6);
    }
  `]
})
export class CodingImportFormatDialogComponent {
  private readonly uiTranslate = injectUiTranslator();

  private dialogRef = inject<MatDialogRef<CodingImportFormatDialogComponent>>(MatDialogRef);
  protected data = inject<CodingImportFormatDialogData>(MAT_DIALOG_DATA);

  protected selectedVersion?: 'v1' | 'v2' | 'v3';
  protected existingCodingMode: CodingImportExistingCodingMode = 'skip-conflicts';

  constructor() {
    const data = this.data;

    this.selectedVersion = data.selectedVersion || data.availableVersions?.[0];
  }

  protected getFormatLabel(): string {
    switch (this.data.detectedFormat) {
      case 'external-coding':
        return this.uiTranslate('ui-text.coding-import-format-dialog.file-codings');
      case 'coding-list':
        return this.uiTranslate('coding-management.buttons.coding-list');
      case 'coding-results':
        return 'Kodierergebnis-Export';
      case 'test-results':
        return 'Testergebnisse-Export';
      case 'test-logs':
        return 'Testlogs-Export';
      default:
        return this.uiTranslate('process-overview.status.unknown');
    }
  }

  protected getVersionLabel(version: 'v1' | 'v2' | 'v3'): string {
    const labels = {
      v1: this.uiTranslate('ui-text.coding-import-format-dialog.first-auto-version'),
      v2: this.uiTranslate('ui-text.coding-import-format-dialog.manual-version'),
      v3: this.uiTranslate('ui-text.coding-import-format-dialog.second-auto-version')
    };
    return labels[version];
  }

  protected confirm(): void {
    if (!this.data.canImport) {
      return;
    }

    const sourceFormat = this.data.detectedFormat as CodingImportSourceFormat;
    this.dialogRef.close({
      sourceFormat,
      sourceVersion: sourceFormat === 'coding-results' ? this.selectedVersion : undefined,
      scoreMode: 'import',
      existingCodingMode: this.existingCodingMode
    } satisfies CodingImportFormatDialogResult);
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }
}
