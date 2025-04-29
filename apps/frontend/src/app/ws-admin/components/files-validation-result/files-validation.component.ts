import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NgForOf, NgIf } from '@angular/common';

type DataValidation = {
  complete: boolean;
  missing: string[];
};

type FilesValidation = {
  booklets: DataValidation;
  units: DataValidation;
  schemes: DataValidation;
  definitions: DataValidation;
};

@Component({
  selector: 'files-validation-dialog',
  templateUrl: './files-validation.component.html',
  imports: [
    NgIf,
    NgForOf
  ],
  styleUrls: ['./files-validation.component.scss']
})
export class FilesValidationDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<FilesValidationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: FilesValidation
  ) {
    console.log('Dialog Data', data);
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
