import {
  Component,
  input,
  output,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIconButton } from '@angular/material/button';
import { MatInput } from '@angular/material/input';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import {
  Subject,
  fromEvent,
  debounceTime,
  distinctUntilChanged,
  takeUntil
} from 'rxjs';
import { WrappedIconComponent } from '../wrapped-icon/wrapped-icon.component';

@Component({
  selector: 'coding-box-search-filter',
  templateUrl: './search-filter.component.html',
  styleUrls: ['./search-filter.component.scss'],
  imports: [
    MatFormField,
    MatLabel,
    MatInput,
    MatIconButton,
    MatSuffix,
    MatTooltip,
    WrappedIconComponent,
    TranslateModule
  ]
})
export class SearchFilterComponent implements OnInit, OnDestroy {
  @ViewChild('filterInput', { static: true }) filterInput!: ElementRef;

  value: string = '';
  readonly title = input.required<string>();
  readonly initialValue = input<string>('');
  readonly valueChange = output<string>();

  // Debounce time in milliseconds
  private readonly debounceTimeMs = 300;
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    // Set initial value if provided
    const initialVal = this.initialValue();
    if (initialVal) {
      this.value = initialVal;
      this.filterInput.nativeElement.value = initialVal;
    }

    // Set up debounced input event
    fromEvent(this.filterInput.nativeElement, 'keyup')
      .pipe(
        debounceTime(this.debounceTimeMs),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.value = this.filterInput.nativeElement.value;
        this.valueChange.emit(this.value);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  clearFilter(): void {
    this.value = '';
    this.filterInput.nativeElement.value = '';
    this.valueChange.emit(this.value);
  }
}
