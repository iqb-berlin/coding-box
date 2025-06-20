import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'coding-box-file-content-dialog',
  templateUrl: './file-content-dialog.component.html',
  styleUrls: ['./file-content-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule
  ]
})
export class FileContentDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: string) {}
}

