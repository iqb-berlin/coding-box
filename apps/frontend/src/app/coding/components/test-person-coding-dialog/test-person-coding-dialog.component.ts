import {
  Component,
  OnDestroy,
  ViewChild,
  inject
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';
import { TestPersonCodingComponent } from '../test-person-coding/test-person-coding.component';
import { JobStatus } from '../../services/test-person-coding.service';

export interface TestPersonCodingDialogData {
  initialJobId?: string;
  initialAutoCoderRun?: 1 | 2;
}

export interface TestPersonCodingDialogResult {
  initialJobId?: string;
  jobId?: string | null;
  jobStatus?: JobStatus['status'] | null;
}

@Component({
  selector: 'coding-box-test-person-coding-dialog',
  templateUrl: './test-person-coding-dialog.component.html',
  styleUrls: ['./test-person-coding-dialog.component.scss'],
  standalone: true,
  imports: [TestPersonCodingComponent, MatIconModule, MatButtonModule, TranslateModule]
})
export class TestPersonCodingDialogComponent implements OnDestroy {
  data = inject<TestPersonCodingDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  @ViewChild(TestPersonCodingComponent) testPersonCodingComponent?: TestPersonCodingComponent;

  private destroy$ = new Subject<void>();

  constructor(
    public dialogRef: MatDialogRef<TestPersonCodingDialogComponent>
  ) {
    this.dialogRef.backdropClick()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.closeDialog());

    this.dialogRef.keydownEvents()
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.closeDialog();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  closeDialog(): void {
    this.dialogRef.close(this.getDialogResult());
  }

  private getDialogResult(): TestPersonCodingDialogResult {
    const initialJobId = this.data?.initialJobId ?? null;

    return {
      initialJobId: initialJobId ?? undefined,
      jobId: initialJobId ?? this.testPersonCodingComponent?.lastObservedJobId ?? null,
      jobStatus: this.testPersonCodingComponent?.getLastObservedJobStatus(initialJobId) ?? null
    };
  }
}
