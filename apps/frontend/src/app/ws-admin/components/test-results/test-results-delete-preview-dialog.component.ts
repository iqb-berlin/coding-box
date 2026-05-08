import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TestResultsDeletePreviewDto } from '../../../../../../../api-dto/test-results/test-results-deletion.dto';

export interface TestResultsDeletePreviewDialogData {
  preview: TestResultsDeletePreviewDto;
}

interface DeleteMetric {
  label: string;
  value: number;
  hint?: string;
}

@Component({
  selector: 'coding-box-test-results-delete-preview-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatIconModule
  ],
  templateUrl: './test-results-delete-preview-dialog.component.html',
  styleUrls: ['./test-results-delete-preview-dialog.component.scss']
})
export class TestResultsDeletePreviewDialogComponent {
  acknowledged = false;

  constructor(
    private dialogRef: MatDialogRef<TestResultsDeletePreviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TestResultsDeletePreviewDialogData
  ) {}

  get preview(): TestResultsDeletePreviewDto {
    return this.data.preview;
  }

  get metrics(): DeleteMetric[] {
    return [
      { label: 'Testpersonen', value: this.preview.persons },
      {
        label: 'Testhefte',
        value: this.preview.booklets,
        hint: 'einzigartig'
      },
      {
        label: 'Aufgaben',
        value: this.preview.units,
        hint: 'einzigartig'
      },
      {
        label: 'Antworten',
        value: this.preview.responses,
        hint: 'einzigartig'
      }
    ];
  }

  get hasTargets(): boolean {
    return this.preview.persons > 0 ||
      this.preview.booklets > 0 ||
      this.preview.units > 0 ||
      this.preview.responses > 0;
  }

  get requiresAcknowledgement(): boolean {
    return this.preview.scope === 'filteredPersons' ||
      this.preview.scope === 'groups' ||
      this.preview.persons > 1 ||
      this.preview.responses >= 100;
  }

  get canConfirm(): boolean {
    return this.hasTargets &&
      (!this.requiresAcknowledgement || this.acknowledged);
  }

  get visibleGroups(): string[] {
    return this.preview.groups.slice(0, 6);
  }

  get visibleBooklets(): string[] {
    return this.preview.bookletNames.slice(0, 6);
  }

  get visibleUnits(): string[] {
    return this.preview.unitNames.slice(0, 6);
  }

  get hasDetails(): boolean {
    return this.preview.groups.length > 0 ||
      this.preview.bookletNames.length > 0 ||
      this.preview.unitNames.length > 0;
  }

  onAcknowledgementChange(event: MatCheckboxChange): void {
    this.acknowledged = event.checked;
  }

  confirm(): void {
    if (this.canConfirm) {
      this.dialogRef.close(true);
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
