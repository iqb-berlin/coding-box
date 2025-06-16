import {
  Component, EventEmitter, Output,
  input
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIconButton } from '@angular/material/button';
import { MatInput } from '@angular/material/input';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { WrappedIconComponent } from '../wrapped-icon/wrapped-icon.component';

@Component({
  selector: 'coding-box-search-filter',
  templateUrl: './search-filter.component.html',
  styleUrls: ['./search-filter.component.scss'],
  // eslint-disable-next-line max-len
  imports: [MatFormField, MatLabel, MatInput, MatIconButton, MatSuffix, MatTooltip, WrappedIconComponent, TranslateModule]
})
export class SearchFilterComponent {
  value: string = '';
  readonly title = input.required<string>();
  @Output() valueChange: EventEmitter<string> = new EventEmitter<string>();
}
