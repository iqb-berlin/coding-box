import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';
import {
  MatFormField,
  MatLabel,
  MatOption,
  MatSelect
} from '@angular/material/select';
import { MatButton } from '@angular/material/button';
import { Coder } from '../../../models/coder.model';

export interface TransferCodingCasesDialogData {
  coders: Coder[];
}

export interface TransferCodingCasesDialogResult {
  sourceCoderId: number;
  targetCoderId: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-transfer-coding-cases-dialog',
  standalone: true,
  templateUrl: './transfer-coding-cases-dialog.component.html',
  styleUrls: ['./transfer-coding-cases-dialog.component.scss'],
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption,
    MatButton
  ]
})
export class TransferCodingCasesDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<TransferCodingCasesDialogComponent, TransferCodingCasesDialogResult>>(MatDialogRef);
  data = inject<TransferCodingCasesDialogData>(MAT_DIALOG_DATA);

  protected sourceCoderId: number | null = null;
  protected targetCoderId: number | null = null;

  protected readonly coders: Coder[];

  constructor() {
    const data = this.data;

    this.coders = [...(data.coders || [])].sort((a, b) => {
      const labelA = a.displayName || a.name || '';
      const labelB = b.displayName || b.name || '';
      return labelA.localeCompare(labelB);
    });
  }

  protected get submitDisabled(): boolean {
    return !this.sourceCoderId || !this.targetCoderId || this.sourceCoderId === this.targetCoderId;
  }

  protected submit(): void {
    if (this.submitDisabled) {
      return;
    }

    this.dialogRef.close({
      sourceCoderId: this.sourceCoderId!,
      targetCoderId: this.targetCoderId!
    });
  }
}
