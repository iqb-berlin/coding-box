import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SERVER_URL } from '../../injection-tokens';
import {
  SystemNotificationSeverity,
  SystemNotificationType
} from '../../../../../../api-dto/system-notifications/system-notification.types';
import type { SystemNotificationDto } from '../../../../../../api-dto/system-notifications/system-notification.dto';
import { SUPPRESS_GLOBAL_HTTP_ERROR } from '../interceptors/http-error-context';
import { SystemNotificationService } from './system-notification.service';

function notification(updatedAt = '2026-07-01T10:00:00Z'): SystemNotificationDto {
  return {
    id: 5,
    type: SystemNotificationType.Info,
    severity: SystemNotificationSeverity.Low,
    title: 'Info',
    message: 'Text',
    startsAt: null,
    endsAt: null,
    visibleFrom: null,
    visibleUntil: null,
    enabled: true,
    dismissible: true,
    createdAt: '2026-07-01T09:00:00Z',
    updatedAt
  };
}

describe('SystemNotificationService', () => {
  let service: SystemNotificationService;
  let httpMock: HttpTestingController;
  const serverUrl = '/api/';

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: serverUrl }
      ]
    });
    service = TestBed.inject(SystemNotificationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    service.stopPolling();
    httpMock.verify();
  });

  it('uses the public endpoint for active notifications', () => {
    service.getActive().subscribe();
    const request = httpMock.expectOne('/api/system-notifications/active');
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SUPPRESS_GLOBAL_HTTP_ERROR)).toBe(true);
    request.flush([]);
  });

  it('uses the admin CRUD endpoints', () => {
    const item = notification();
    service.getAll().subscribe();
    httpMock.expectOne('/api/admin/system-notifications').flush([]);

    service.create(item).subscribe();
    const create = httpMock.expectOne('/api/admin/system-notifications');
    expect(create.request.method).toBe('POST');
    create.flush(item);

    service.update(item.id, item).subscribe();
    const update = httpMock.expectOne('/api/admin/system-notifications/5');
    expect(update.request.method).toBe('PUT');
    update.flush(item);

    service.delete(item.id).subscribe();
    const remove = httpMock.expectOne('/api/admin/system-notifications/5');
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null);
  });

  it('hides a dismissed version and shows an edited version again', fakeAsync(() => {
    const visible: SystemNotificationDto[][] = [];
    service.visibleNotifications$.subscribe(items => visible.push(items));
    service.startPolling(60_000);
    tick();
    httpMock.expectOne('/api/system-notifications/active').flush([notification()]);
    expect(visible[visible.length - 1]).toHaveLength(1);

    service.dismiss(notification());
    expect(visible[visible.length - 1]).toHaveLength(0);

    service.stopPolling();
    service.startPolling(60_000);
    tick();
    httpMock.expectOne('/api/system-notifications/active').flush([
      notification('2026-07-02T10:00:00Z')
    ]);
    expect(visible[visible.length - 1]).toHaveLength(1);
    service.stopPolling();
  }));
});
