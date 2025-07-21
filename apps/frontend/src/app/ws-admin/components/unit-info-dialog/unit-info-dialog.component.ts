import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { UnitInfoDto } from '../../../../../../../api-dto/unit-info/unit-info.dto';

@Component({
  selector: 'coding-box-unit-info-dialog',
  templateUrl: './unit-info-dialog.component.html',
  styleUrls: ['./unit-info-dialog.component.scss'],
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
export class UnitInfoDialogComponent implements OnInit {
  isLoading = true;
  errorMessage: string | null = null;

  constructor(
    public dialogRef: MatDialogRef<UnitInfoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: {
      unitInfo: UnitInfoDto;
      unitId: string;
    }
  ) {}

  ngOnInit(): void {
    if (this.data.unitInfo) {
      this.isLoading = false;
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
