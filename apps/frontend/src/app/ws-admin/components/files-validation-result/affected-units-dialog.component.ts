import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-affected-units-dialog',
  templateUrl: './affected-units-dialog.component.html',
  styleUrls: ['./affected-units-dialog.component.scss'],
  standalone: true,
  imports: [
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
  private dialogRef = inject<MatDialogRef<AffectedUnitsDialogComponent, AffectedUnitsDialogResult>>(MatDialogRef);
  protected data = inject<{
    title: string;
    units: string[];
  }>(MAT_DIALOG_DATA);

  protected filterText = '';

  protected get filteredUnits(): string[] {
    const all = (this.data?.units || []).slice();
    const q = (this.filterText || '').trim().toUpperCase();
    if (!q) {
      return all;
    }
    return all.filter(u => (u || '').toUpperCase().includes(q));
  }

  protected selectUnit(unitId: string): void {
    if (!unitId) {
      return;
    }
    this.dialogRef.close({ unitId });
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
