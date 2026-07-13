import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import type { SystemNotificationDto } from '../../../../../../api-dto/system-notifications/system-notification.dto';
import { SystemNotificationService } from '../../core/services/system-notification.service';
import { SystemNotificationItemComponent } from './system-notification-item.component';

@Component({
  selector: 'coding-box-system-notification-banner',
  imports: [AsyncPipe, SystemNotificationItemComponent],
  templateUrl: './system-notification-banner.component.html',
  styleUrl: './system-notification-banner.component.scss'
})
export class SystemNotificationBannerComponent {
  readonly notificationService = inject(SystemNotificationService);

  dismiss(notification: SystemNotificationDto): void {
    this.notificationService.dismiss(notification);
  }
}
