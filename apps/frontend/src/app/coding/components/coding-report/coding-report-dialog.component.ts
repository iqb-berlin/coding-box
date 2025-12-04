import { Component, Inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { CodingReportComponent } from './src/lib/coding-report.component';
import { CodingReportDto } from './src/lib/coding-report-dto';

@Component({
  selector: 'coding-box-coding-report-dialog',
  template: `
    <h1 mat-dialog-title>{{ 'coding-report.title' | translate }}</h1>
    <div mat-dialog-content>
      <coding-box-coding-report [codingReport]="data.codingReport"></coding-box-coding-report>
    </div>
    <div mat-dialog-actions align="end">
      <button mat-raised-button color="primary" (click)="close()">{{ 'coding-report.close' | translate }}</button>
    </div>
  `,
  standalone: true,
  imports: [
    CodingReportComponent,
    TranslateModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton
  ]
})
export class CodingReportDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<CodingReportDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { codingReport: CodingReportDto[] }
  ) {}

  close(): void {
    this.dialogRef.close();
  }
}
