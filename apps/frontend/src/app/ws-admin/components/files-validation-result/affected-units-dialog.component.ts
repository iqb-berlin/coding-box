import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ScrollingModule } from '@angular/cdk/scrolling';

export type AffectedUnitsDialogResult = {
  unitId: string;
};

@Component({
  selector: 'coding-box-affected-units-dialog',
  templateUrl: './affected-units-dialog.component.html',
  styleUrls: ['./affected-units-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    ScrollingModule
  ]
})
export class AffectedUnitsDialogComponent {
  filterText = '';

  constructor(
    private dialogRef: MatDialogRef<AffectedUnitsDialogComponent, AffectedUnitsDialogResult>,
    @Inject(MAT_DIALOG_DATA)
    public data: { title: string; units: string[] }
  ) {}

  get filteredUnits(): string[] {
    const all = (this.data?.units || []).slice();
    const q = (this.filterText || '').trim().toUpperCase();
    if (!q) {
      return all;
    }
    return all.filter(u => (u || '').toUpperCase().includes(q));
  }

  selectUnit(unitId: string): void {
    if (!unitId) {
      return;
    }
    this.dialogRef.close({ unitId });
  }

  close(): void {
    this.dialogRef.close();
  }
}
