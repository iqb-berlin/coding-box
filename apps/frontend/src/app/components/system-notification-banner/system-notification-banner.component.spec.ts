import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
  SystemNotificationSeverity,
  SystemNotificationType
} from '../../../../../../api-dto/system-notifications/system-notification.types';
import type { SystemNotificationDto } from '../../../../../../api-dto/system-notifications/system-notification.dto';
import { SystemNotificationService } from '../../core/services/system-notification.service';
import { SystemNotificationBannerComponent } from './system-notification-banner.component';

describe('SystemNotificationBannerComponent', () => {
  let fixture: ComponentFixture<SystemNotificationBannerComponent>;
  const item: SystemNotificationDto = {
    id: 8,
    type: SystemNotificationType.Outage,
    severity: SystemNotificationSeverity.Critical,
    title: 'Geplanter Ausfall',
    message: 'Die Anwendung ist nicht erreichbar.',
    startsAt: '2026-07-12T20:00:00Z',
    endsAt: '2026-07-12T21:00:00Z',
    visibleFrom: null,
    visibleUntil: null,
    enabled: true,
    dismissible: true,
    createdAt: '2026-07-01T09:00:00Z',
    updatedAt: '2026-07-01T10:00:00Z'
  };
  const service = {
    visibleNotifications$: of([item]),
    dismiss: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [SystemNotificationBannerComponent, TranslateModule.forRoot()],
      providers: [{ provide: SystemNotificationService, useValue: service }]
    }).compileComponents();
    fixture = TestBed.createComponent(SystemNotificationBannerComponent);
    fixture.detectChanges();
  });

  it('renders an active notification with its window and severity', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Geplanter Ausfall');
    expect(element.textContent).toContain('Die Anwendung ist nicht erreichbar.');
    expect(element.querySelector('.severity-critical')).not.toBeNull();
    expect(element.querySelector('.time-window')).not.toBeNull();
  });

  it('dismisses a dismissible notification', () => {
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();
    expect(service.dismiss).toHaveBeenCalledWith(item);
  });
});
