import { Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';

import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'coding-box-coding-job-comment-dialog',
  template: `
    <h1 mat-dialog-title>{{ 'coding.comment-dialog.title' | translate }}</h1>

    <div mat-dialog-content>
      <mat-form-field appearance="outline" class="comment-input">
        <mat-label>{{ 'coding.comment-dialog.label' | translate }}</mat-label>
        <textarea matInput [(ngModel)]="commentText" [placeholder]="'coding.comment-dialog.placeholder' | translate" rows="5"></textarea>
      </mat-form-field>
    </div>

    <div mat-dialog-actions align="end">
      <button mat-stroked-button (click)="closeDialog()">{{ 'coding.comment-dialog.cancel' | translate }}</button>
      <button mat-raised-button color="primary" (click)="saveComment()">{{ 'coding.comment-dialog.save' | translate }}</button>
    </div>
  `,
  styles: [`
    .comment-input {
      width: 100%;
      margin-top: 16px;
    }

    mat-dialog-content {
      min-width: 400px;
    }

    mat-dialog-actions {
      margin-top: 16px;
      padding: 8px 16px;
    }
  `],
  imports: [
    MatDialogContent,
    MatDialogTitle,
    MatDialogActions,
    MatButton,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    TranslateModule
  ],
  standalone: true
})
export class CodingJobCommentDialogComponent {
  dialogRef = inject<MatDialogRef<CodingJobCommentDialogComponent>>(MatDialogRef);
  data = inject<{
    comment: string;
  }>(MAT_DIALOG_DATA);

  commentText: string;

  constructor() {
    this.commentText = this.data.comment || '';
  }

  saveComment(): void {
    this.dialogRef.close(this.commentText);
  }

  closeDialog(): void {
    this.dialogRef.close();
  }
}
