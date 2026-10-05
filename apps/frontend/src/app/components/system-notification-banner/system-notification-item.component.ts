import { DatePipe } from '@angular/common';
import {
  Component, input, output, ChangeDetectionStrategy
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import type { SystemNotificationDto } from '../../../../../../api-dto/system-notifications/system-notification.dto';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-system-notification-item',
  imports: [DatePipe, MatButtonModule, MatIconModule, TranslateModule],
  templateUrl: './system-notification-item.component.html',
  styleUrl: './system-notification-item.component.scss'
})
export class SystemNotificationItemComponent {
  readonly notification = input.required<SystemNotificationDto>();

  readonly preview = input(false);

  readonly dismissed = output<SystemNotificationDto>();

  protected icon(): string {
    return {
      outage: 'error',
      maintenance: 'build',
      update: 'system_update',
      info: 'info'
    }[this.notification().type];
  }
}
