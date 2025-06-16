import {
  ChangeDetectorRef, Component, Input, OnDestroy, OnInit
} from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MatProgressSpinner } from '@angular/material/progress-spinner';


@Component({
  selector: 'cb-spinner',
  templateUrl: './spinner.component.html',
  styleUrls: ['./spinner.component.scss'],
  imports: [
    MatProgressSpinner
]
})
export class SpinnerComponent implements OnInit, OnDestroy {
  @Input() isLoaded!: Subject<boolean>;
  isLoading: boolean = true;
  private ngUnsubscribe = new Subject<void>();

  constructor(private changeDetectionRef: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.isLoaded
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(isLoaded => {
        if (isLoaded) {
          this.isLoading = false;
          this.changeDetectionRef.detectChanges();
        }
      });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
