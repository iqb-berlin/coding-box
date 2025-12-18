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

export type TestResultsFlatTableSettingsDialogData = {
  audioLowThreshold: number;
  shortProcessingThresholdMs: number;
  longLoadingThresholdMs: number;
};

export type TestResultsFlatTableSettingsDialogResult = {
  audioLowThreshold: number;
  shortProcessingThresholdMs: number;
  longLoadingThresholdMs: number;
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
    MatInputModule
  ],
  templateUrl: './test-results-flat-table-settings-dialog.component.html'
})
export class TestResultsFlatTableSettingsDialogComponent {
  audioLowThreshold: number;
  shortProcessingThresholdMs: number;
  longLoadingThresholdMs: number;

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
      longLoadingThresholdMs: Number.isFinite(longParsed) ? longParsed : 5000
    });
  }
}
