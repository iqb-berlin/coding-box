import { CommonModule } from '@angular/common';
import {
  Component, Inject
} from '@angular/core';
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
  selector: 'coding-box-transfer-coding-cases-dialog',
  standalone: true,
  templateUrl: './transfer-coding-cases-dialog.component.html',
  styleUrls: ['./transfer-coding-cases-dialog.component.scss'],
  imports: [
    CommonModule,
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
  sourceCoderId: number | null = null;
  targetCoderId: number | null = null;

  readonly coders: Coder[];

  constructor(
    private readonly dialogRef: MatDialogRef<
    TransferCodingCasesDialogComponent,
    TransferCodingCasesDialogResult
    >,
    @Inject(MAT_DIALOG_DATA) public data: TransferCodingCasesDialogData
  ) {
    this.coders = [...(data.coders || [])].sort((a, b) => {
      const labelA = a.displayName || a.name || '';
      const labelB = b.displayName || b.name || '';
      return labelA.localeCompare(labelB);
    });
  }

  get submitDisabled(): boolean {
    return !this.sourceCoderId || !this.targetCoderId || this.sourceCoderId === this.targetCoderId;
  }

  submit(): void {
    if (this.submitDisabled) {
      return;
    }

    this.dialogRef.close({
      sourceCoderId: this.sourceCoderId!,
      targetCoderId: this.targetCoderId!
    });
  }
}
