import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import { TestPersonCodingComponent } from '../test-person-coding/test-person-coding.component';

@Component({
  selector: 'coding-box-test-person-coding-dialog',
  templateUrl: './test-person-coding-dialog.component.html',
  styleUrls: ['./test-person-coding-dialog.component.scss'],
  standalone: true,
  imports: [TestPersonCodingComponent, MatIconModule, MatButtonModule, TranslateModule]
})
export class TestPersonCodingDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<TestPersonCodingDialogComponent>
  ) {}

  closeDialog(): void {
    this.dialogRef.close();
  }
}
