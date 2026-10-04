import {
  Component, input, output, OnInit, AfterViewInit, OnDestroy, ElementRef, viewChild, ChangeDetectionStrategy, signal
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIconButton } from '@angular/material/button';
import { MatInput } from '@angular/material/input';
import {
  MatFormField,
  MatHint,
  MatLabel,
  MatSuffix
} from '@angular/material/form-field';
import {
  Subject,
  fromEvent,
  debounceTime,
  distinctUntilChanged,
  takeUntil
} from 'rxjs';
import { WrappedIconComponent } from '../wrapped-icon/wrapped-icon.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-search-filter',
  templateUrl: './search-filter.component.html',
  styleUrls: ['./search-filter.component.scss'],
  imports: [
    MatFormField,
    MatLabel,
    MatHint,
    MatInput,
    MatIconButton,
    MatSuffix,
    MatTooltip,
    WrappedIconComponent,
    TranslateModule
  ]
})
export class SearchFilterComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly filterInput = viewChild.required<ElementRef<HTMLInputElement>>('filterInput');

  readonly value = signal<string>('');
  readonly title = input.required<string>();
  readonly initialValue = input<string>('');
  readonly invalid = input<boolean>(false);
  readonly errorText = input<string>('search-filter.invalid-regex');
  readonly valueChange = output<string>();

  // Debounce time in milliseconds
  private readonly debounceTimeMs = 300;
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.value.set(this.initialValue());
  }

  ngAfterViewInit(): void {
    const filterInput = this.filterInput();
    // Set up debounced input event
    fromEvent(filterInput.nativeElement, 'keyup')
      .pipe(
        debounceTime(this.debounceTimeMs),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.value.set(this.filterInput().nativeElement.value);
        this.valueChange.emit(this.value());
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  clearFilter(): void {
    this.value.set('');
    this.filterInput().nativeElement.value = '';
    this.valueChange.emit(this.value());
  }
}
