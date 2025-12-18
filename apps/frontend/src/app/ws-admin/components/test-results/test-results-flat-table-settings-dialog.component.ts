import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

export type TestResultsFlatTableSettingsDialogData = {
  audioLowThreshold: number;
  shortProcessingThresholdMs: number;
  longLoadingThresholdMs: number;
  processingDurationMin: string;
  processingDurationMax: string;
  sessionBrowsersAllowlist: string[];
  sessionOsAllowlist: string[];
  sessionScreensAllowlist: string[];
  availableSessionBrowsers: string[];
  availableSessionOs: string[];
  availableSessionScreens: string[];
};

export type TestResultsFlatTableSettingsDialogResult = {
  audioLowThreshold: number;
  shortProcessingThresholdMs: number;
  longLoadingThresholdMs: number;
  processingDurationMin: string;
  processingDurationMax: string;
  sessionBrowsersAllowlist: string[];
  sessionOsAllowlist: string[];
  sessionScreensAllowlist: string[];
};

@Component({
  selector: 'coding-box-test-results-flat-table-settings-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule
  ],
  templateUrl: './test-results-flat-table-settings-dialog.component.html'
})
export class TestResultsFlatTableSettingsDialogComponent {
  audioLowThreshold: number;
  shortProcessingThresholdMs: number;
  longLoadingThresholdMs: number;
  processingDurationMin: string;
  processingDurationMax: string;
  sessionBrowsersAllowlist: string[];
  sessionOsAllowlist: string[];
  sessionScreensAllowlist: string[];
  availableSessionBrowsers: string[];
  availableSessionOs: string[];
  availableSessionScreens: string[];

  constructor(
    private dialogRef: MatDialogRef<
    TestResultsFlatTableSettingsDialogComponent,
    TestResultsFlatTableSettingsDialogResult | undefined
    >,
    @Inject(MAT_DIALOG_DATA) public data: TestResultsFlatTableSettingsDialogData
  ) {
    this.audioLowThreshold = Number(data.audioLowThreshold ?? 0.9);
    this.shortProcessingThresholdMs = Number(
      data.shortProcessingThresholdMs ?? 60000
    );
    this.longLoadingThresholdMs = Number(data.longLoadingThresholdMs ?? 5000);
    this.processingDurationMin = String(data.processingDurationMin ?? '00:00');
    this.processingDurationMax = String(data.processingDurationMax ?? '99:59');
    this.sessionBrowsersAllowlist = Array.isArray(data.sessionBrowsersAllowlist) ?
      data.sessionBrowsersAllowlist :
      [];
    this.sessionOsAllowlist = Array.isArray(data.sessionOsAllowlist) ?
      data.sessionOsAllowlist :
      [];
    this.sessionScreensAllowlist = Array.isArray(data.sessionScreensAllowlist) ?
      data.sessionScreensAllowlist :
      [];
    this.availableSessionBrowsers = Array.isArray(data.availableSessionBrowsers) ?
      data.availableSessionBrowsers :
      [];
    this.availableSessionOs = Array.isArray(data.availableSessionOs) ?
      data.availableSessionOs :
      [];
    this.availableSessionScreens = Array.isArray(data.availableSessionScreens) ?
      data.availableSessionScreens :
      [];
  }

  close(): void {
    this.dialogRef.close(undefined);
  }

  save(): void {
    const parsed = Number(this.audioLowThreshold);
    const shortParsed = Number(this.shortProcessingThresholdMs);
    const longParsed = Number(this.longLoadingThresholdMs);
    this.dialogRef.close({
      audioLowThreshold: Number.isFinite(parsed) ? parsed : 0.9,
      shortProcessingThresholdMs: Number.isFinite(shortParsed) ?
        shortParsed :
        60000,
      longLoadingThresholdMs: Number.isFinite(longParsed) ? longParsed : 5000,
      processingDurationMin: String(this.processingDurationMin ?? ''),
      processingDurationMax: String(this.processingDurationMax ?? ''),
      sessionBrowsersAllowlist: Array.isArray(this.sessionBrowsersAllowlist) ?
        this.sessionBrowsersAllowlist :
        [],
      sessionOsAllowlist: Array.isArray(this.sessionOsAllowlist) ?
        this.sessionOsAllowlist :
        [],
      sessionScreensAllowlist: Array.isArray(this.sessionScreensAllowlist) ?
        this.sessionScreensAllowlist :
        []
    });
  }
}
