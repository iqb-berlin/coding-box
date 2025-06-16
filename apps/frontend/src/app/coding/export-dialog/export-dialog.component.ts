import { Component } from '@angular/core';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { FormsModule } from '@angular/forms';


export type ExportFormat = 'json' | 'csv' | 'excel';

@Component({
  selector: 'app-export-dialog',
  templateUrl: './export-dialog.component.html',
  styleUrls: ['./export-dialog.component.scss'],
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatRadioModule
]
})
export class ExportDialogComponent {
  selectedFormat: ExportFormat = 'json';

  constructor(
    public dialogRef: MatDialogRef<ExportDialogComponent>
  ) {}

  onCancel(): void {
    this.dialogRef.close();
  }

  onExport(): void {
    this.dialogRef.close(this.selectedFormat);
  }
}
