import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NgClass, NgForOf, NgIf } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { ResponseValidationResult } from '../../../services/backend.service';

@Component({
  selector: 'kodierbox-response-validation-result-dialog',
  templateUrl: './response-validation-result-dialog.component.html',
  styleUrls: ['./response-validation-result-dialog.component.scss'],
  standalone: true,
  imports: [
    MatDialogModule,
    MatIconModule,
    NgIf,
    NgClass,
    NgForOf,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatDividerModule
  ]
})
export class ResponseValidationResultDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ResponseValidationResult | null
  ) {}
}
