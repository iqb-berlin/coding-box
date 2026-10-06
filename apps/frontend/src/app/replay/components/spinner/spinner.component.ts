import {
  Component, OnDestroy, OnInit, input, signal, ChangeDetectionStrategy
} from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'cb-spinner',
  templateUrl: './spinner.component.html',
  styleUrls: ['./spinner.component.scss'],
  imports: [
    MatProgressSpinner
  ]
})
export class SpinnerComponent implements OnInit, OnDestroy {
  readonly isLoaded = input.required<Subject<boolean>>();
  readonly isLoading = signal<boolean>(true);
  private ngUnsubscribe = new Subject<void>();

  ngOnInit(): void {
    this.isLoaded()
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(isLoaded => {
        if (isLoaded) {
          this.isLoading.set(false);
        }
      });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
