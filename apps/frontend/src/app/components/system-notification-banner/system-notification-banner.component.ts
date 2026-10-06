import { AsyncPipe } from '@angular/common';
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import type { SystemNotificationDto } from '../../../../../../api-dto/system-notifications/system-notification.dto';
import { SystemNotificationService } from '../../core/services/system-notification.service';
import { SystemNotificationItemComponent } from './system-notification-item.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-system-notification-banner',
  imports: [AsyncPipe, SystemNotificationItemComponent],
  templateUrl: './system-notification-banner.component.html',
  styleUrl: './system-notification-banner.component.scss'
})
export class SystemNotificationBannerComponent {
  protected readonly notificationService = inject(SystemNotificationService);

  protected dismiss(notification: SystemNotificationDto): void {
    this.notificationService.dismiss(notification);
  }
}
