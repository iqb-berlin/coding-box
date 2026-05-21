import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
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
  selector: 'coding-box-coding-import-format-dialog',
  standalone: true,
  imports: [
    CommonModule,
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
          <span class="label">Datei</span>
          <span class="value">{{ data.fileName }}</span>
        </div>
        <div>
          <span class="label">Erkanntes Format</span>
          <span class="value">{{ getFormatLabel() }}</span>
        </div>
      </div>

      <div *ngIf="data.canImport" class="target-box">
        <mat-icon>input</mat-icon>
        <span>Importziel: manuelle Kodierung (v2) mit Status, Code und Score aus der Datei.</span>
      </div>

      <mat-form-field
        *ngIf="data.detectedFormat === 'coding-results' && data.availableVersions?.length"
        appearance="outline"
        class="version-field"
      >
        <mat-label>Version aus Datei</mat-label>
        <mat-select [(ngModel)]="selectedVersion">
          <mat-option *ngFor="let version of data.availableVersions" [value]="version">
            {{ getVersionLabel(version) }}
          </mat-option>
        </mat-select>
      </mat-form-field>

      <section *ngIf="data.canImport" class="mode-section">
        <h3>Vorhandene Kodierungen</h3>
        <mat-radio-group class="mode-options" [(ngModel)]="existingCodingMode">
          <mat-radio-button value="skip-conflicts">
            <span class="mode-title">Konflikte überspringen</span>
            <span class="mode-description">
              Leere Kodierungen werden gefüllt, abweichende vorhandene manuelle Kodierungen bleiben unverändert.
            </span>
          </mat-radio-button>
          <mat-radio-button value="fill-empty">
            <span class="mode-title">Nur leere Kodierungen füllen</span>
            <span class="mode-description">
              Sobald in v2 bereits Status, Code oder Score vorhanden ist, wird der Fall übersprungen.
            </span>
          </mat-radio-button>
          <mat-radio-button value="overwrite">
            <span class="mode-title">Bestehende Kodierungen überschreiben</span>
            <span class="mode-description">
              Vorhandene manuelle Kodierungen in v2 werden durch die Werte aus der Datei ersetzt.
            </span>
          </mat-radio-button>
        </mat-radio-group>
      </section>

      <section class="help-section" *ngIf="data.helpItems.length > 0">
        <h3>{{ data.canImport ? 'Hinweise' : 'Was ist zu tun?' }}</h3>
        <ul>
          <li *ngFor="let item of data.helpItems">{{ item }}</li>
        </ul>
      </section>

      <mat-divider></mat-divider>

      <section class="headers-section">
        <h3>Erkannte Spalten</h3>
        <p *ngIf="data.headers.length === 0" class="muted">
          Keine Spaltenüberschriften gefunden.
        </p>
        <div *ngIf="data.headers.length > 0" class="header-list">
          <span *ngFor="let header of data.headers">{{ header }}</span>
        </div>
      </section>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">
        {{ data.canImport ? 'Abbrechen' : 'Schließen' }}
      </button>
      <button *ngIf="data.canImport" mat-raised-button color="primary" (click)="confirm()">
        <mat-icon>preview</mat-icon>
        Vorschau starten
      </button>
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
  selectedVersion?: 'v1' | 'v2' | 'v3';
  existingCodingMode: CodingImportExistingCodingMode = 'skip-conflicts';

  constructor(
    private dialogRef: MatDialogRef<CodingImportFormatDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CodingImportFormatDialogData
  ) {
    this.selectedVersion = data.selectedVersion || data.availableVersions?.[0];
  }

  getFormatLabel(): string {
    switch (this.data.detectedFormat) {
      case 'external-coding':
        return 'Kodierungen aus Datei';
      case 'coding-list':
        return 'Kodierliste';
      case 'coding-results':
        return 'Kodierergebnis-Export';
      case 'test-results':
        return 'Testergebnisse-Export';
      case 'test-logs':
        return 'Testlogs-Export';
      default:
        return 'Unbekannt';
    }
  }

  getVersionLabel(version: 'v1' | 'v2' | 'v3'): string {
    const labels = {
      v1: 'v1 - erster Autocoder-Lauf',
      v2: 'v2 - manuelle Kodierung',
      v3: 'v3 - zweiter Autocoder-Lauf'
    };
    return labels[version];
  }

  confirm(): void {
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

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
