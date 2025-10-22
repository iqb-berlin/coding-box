import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import {
  MatDialogActions, MatDialogContent, MatDialogTitle, MatDialogRef, MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { CoderTraining } from '../../models/coder-training.model';

@Component({
  selector: 'delete-confirmation-dialog',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogTitle, MatDialogContent, MatDialogActions, TranslateModule],
  template: `
    <h2 mat-dialog-title>{{ 'coding.trainings.delete.confirm.title' | translate }}</h2>
    <mat-dialog-content>
      <p>{{ 'coding.trainings.delete.confirm.message' | translate : { label: data.training.label, count: data.training.jobsCount, jobText: data.training.jobsCount === 1 ? 'Job' : 'Jobs' } }}</p>
      <p class="warning-text">{{ 'coding.trainings.delete.confirm.warning' | translate }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">{{ 'common.cancel' | translate }}</button>
      <button mat-raised-button color="warn" (click)="onConfirm()">{{ 'common.delete' | translate }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .warning-text {
      color: #f44336;
      font-weight: 500;
      margin-top: 16px !important;
    }
  `]
})
export class DeleteConfirmationDialog {
  constructor(
    public dialogRef: MatDialogRef<DeleteConfirmationDialog>,
    @Inject(MAT_DIALOG_DATA) public data: { training: CoderTraining }
  ) {}

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
