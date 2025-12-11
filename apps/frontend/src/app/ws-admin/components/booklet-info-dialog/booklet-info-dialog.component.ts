import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';
import { BookletUnitDto } from '../../../../../../../api-dto/booklet-info/booklet-unit.dto';
import { BookletTestletDto } from '../../../../../../../api-dto/booklet-info/booklet-testlet.dto';

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

  get unitsOutsideTestlets(): BookletUnitDto[] {
    const info = this.data.bookletInfo;

    if (!info || !info.units || info.units.length === 0) {
      return [];
    }

    // If there are no testlets, all units are considered outside of testlets
    if (!info.testlets || info.testlets.length === 0) {
      return info.units;
    }

    const unitsInTestlets = new Set(
      info.testlets
        .flatMap((testlet: BookletTestletDto) => testlet.units || [])
        .map((unit: BookletUnitDto) => unit.id)
    );

    return info.units.filter((unit: BookletUnitDto) => !unitsInTestlets.has(unit.id));
  }

  get hasUnitsTab(): boolean {
    return this.unitsOutsideTestlets.length > 0;
  }

  close(): void {
    this.dialogRef.close();
  }
}
