import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenuItem } from '@angular/material/menu';

@Component({
  selector: 'coding-box-account-action',
  templateUrl: './account-action.component.html',
  styleUrls: ['./account-action.component.scss'],
  imports: [MatMenuItem, MatIcon, TranslateModule]
})
export class AccountActionComponent {
  @Input() type!: 'changePassword' | 'logout' | 'editMyData';
  @Input() iconName!: string;
}
