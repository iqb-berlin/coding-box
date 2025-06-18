import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'coding-box-wrapped-icon',
  templateUrl: './wrapped-icon.component.html',
  styleUrls: ['./wrapped-icon.component.scss'],
  imports: [MatIcon]
})
export class WrappedIconComponent {
  readonly icon = input.required<string>();
}
