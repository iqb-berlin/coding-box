import { DatePipe } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import type { SystemNotificationDto } from '../../../../../../api-dto/system-notifications/system-notification.dto';

@Component({
  selector: 'coding-box-system-notification-item',
  imports: [DatePipe, MatButtonModule, MatIconModule, TranslateModule],
  templateUrl: './system-notification-item.component.html',
  styleUrl: './system-notification-item.component.scss'
})
export class SystemNotificationItemComponent {
  @Input({ required: true }) notification!: SystemNotificationDto;

  @Input() preview = false;

  @Output() dismissed = new EventEmitter<SystemNotificationDto>();

  icon(): string {
    return {
      outage: 'error',
      maintenance: 'build',
      update: 'system_update',
      info: 'info'
    }[this.notification.type];
  }
}
