import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';

@Component({
  selector: 'coding-box-booklet-info-dialog',
  templateUrl: './booklet-info-dialog.component.html',
  styleUrls: ['./booklet-info-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatDividerModule,
    MatProgressSpinnerModule
  ]
})
export class BookletInfoDialogComponent implements OnInit {
  isLoading = true;
  errorMessage: string | null = null;

  constructor(
    public dialogRef: MatDialogRef<BookletInfoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: {
      bookletInfo: BookletInfoDto;
      bookletId: string;
    }
  ) {}

  ngOnInit(): void {
    if (this.data.bookletInfo) {
      this.isLoading = false;
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
