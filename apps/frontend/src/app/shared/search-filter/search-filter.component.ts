import {
  Component,
  effect,
  input,
  model,
  OnDestroy,
  OnInit
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIconButton } from '@angular/material/button';
import { MatInput } from '@angular/material/input';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, Subscription } from 'rxjs';
import { WrappedIconComponent } from '../wrapped-icon/wrapped-icon.component';

@Component({
  selector: 'coding-box-search-filter',
  templateUrl: './search-filter.component.html',
  styleUrls: ['./search-filter.component.scss'],
  imports: [
    MatFormField, MatLabel, MatInput, MatIconButton, MatSuffix, MatTooltip,
    WrappedIconComponent, TranslateModule, ReactiveFormsModule
  ]
})
export class SearchFilterComponent implements OnInit, OnDestroy {
  value = model('');
  readonly title = input.required<string>();
  searchControl = new FormControl('');
  private controlSubscription: Subscription | undefined;

  constructor() {
    effect(() => {
      this.searchControl.setValue(this.value(), { emitEvent: false });
    });
  }

  ngOnInit(): void {
    this.controlSubscription = this.searchControl.valueChanges
      .pipe(debounceTime(500))
      .subscribe(value => {
        this.value.set(value || '');
      });
  }

  ngOnDestroy(): void {
    if (this.controlSubscription) {
      this.controlSubscription.unsubscribe();
    }
  }
}
