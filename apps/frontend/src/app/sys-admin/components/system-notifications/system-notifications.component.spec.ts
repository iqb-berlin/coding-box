import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateModule } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { SystemNotificationDto } from '../../../../../../../api-dto/system-notifications/system-notification.dto';
import {
  SystemNotificationSeverity,
  SystemNotificationType
} from '../../../../../../../api-dto/system-notifications/system-notification.types';
import { SystemNotificationService } from '../../../core/services/system-notification.service';
import { SystemNotificationsComponent } from './system-notifications.component';

describe('SystemNotificationsComponent', () => {
  let fixture: ComponentFixture<SystemNotificationsComponent>;
  let component: SystemNotificationsComponent;
  const snackBar = { open: jest.fn() };
  const service = {
    getAll: jest.fn(() => of<SystemNotificationDto[]>([])),
    create: jest.fn(input => of({ id: 1, ...input })),
    update: jest.fn((id, input) => of({ id, ...input })),
    delete: jest.fn(() => of(undefined))
  };
  const dialog = {
    open: jest.fn(() => ({ afterClosed: () => of(true) }))
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [
        SystemNotificationsComponent,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: SystemNotificationService, useValue: service },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MatDialog, useValue: dialog }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(SystemNotificationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe.each(['getAll', 'create', 'update', 'delete'] as const)('%s errors', operation => {
    const execute = () => {
      const notification = {
        id: 9,
        title: 'Notice',
        message: 'Pending text',
        type: SystemNotificationType.Info,
        severity: SystemNotificationSeverity.Low,
        enabled: true,
        dismissible: false,
        startsAt: null,
        endsAt: null,
        visibleFrom: null,
        visibleUntil: null,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z'
      } satisfies SystemNotificationDto;
      if (operation === 'getAll') {
        component.load();
      } else if (operation === 'delete') {
        component.delete(notification);
      } else {
        if (operation === 'update') {
          service.getAll.mockReturnValueOnce(of([notification]));
          component.load();
          fixture.detectChanges();
          fixture.nativeElement.querySelector('button[aria-label="system-notifications.edit"]').click();
        }
        component.form.patchValue({ title: 'Notice', message: 'Pending text' });
        component.save();
      }
    };

    it.each([401, 403])('preserves the central authentication/permission hint for HTTP %s', status => {
      service[operation].mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status })));

      execute();

      expect(snackBar.open).not.toHaveBeenCalled();
      if (operation === 'getAll') expect(component.loading()).toBe(false);
      if (operation === 'create' || operation === 'update') {
        expect(component.form.controls.message.value).toBe('Pending text');
      }
    });

    it('retains the operation-specific fallback for other failures', () => {
      service[operation].mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));

      execute();

      const key = {
        getAll: 'load',
        create: 'save',
        update: 'save',
        delete: 'delete'
      }[operation];
      expect(snackBar.open).toHaveBeenCalledWith(`system-notifications.${key}-error`, '', { duration: 3000 });
    });
  });

  it('rejects invalid event and visibility windows', () => {
    component.form.patchValue({
      title: 'Wartung',
      message: 'Text',
      startsAt: '2026-07-12T12:00',
      endsAt: '2026-07-12T11:00'
    });
    expect(component.form.hasError('eventWindow')).toBe(true);

    component.form.patchValue({
      endsAt: '2026-07-12T13:00',
      visibleFrom: '2026-07-13T12:00',
      visibleUntil: '2026-07-13T11:00'
    });
    expect(component.form.hasError('visibilityWindow')).toBe(true);
  });

  it('rejects titles and messages containing only whitespace', () => {
    component.form.patchValue({ title: '   ', message: '\n\t' });

    expect(component.form.controls.title.hasError('required')).toBe(true);
    expect(component.form.controls.message.hasError('required')).toBe(true);

    component.save();
    expect(service.create).not.toHaveBeenCalled();
  });

  it('classifies planned, active, expired and disabled notifications', () => {
    const base = {
      id: 1,
      type: SystemNotificationType.Info,
      severity: SystemNotificationSeverity.Low,
      title: 'Info',
      message: 'Text',
      startsAt: null,
      endsAt: null,
      visibleFrom: null,
      visibleUntil: null,
      enabled: true,
      dismissible: false,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z'
    };
    const now = new Date('2026-07-12T12:00:00Z');
    expect(component.status({ ...base, visibleFrom: '2026-07-13T00:00:00Z' }, now)).toBe('scheduled');
    expect(component.status(base, now)).toBe('active');
    expect(component.status({ ...base, visibleUntil: '2026-07-11T00:00:00Z' }, now)).toBe('expired');
    expect(component.status({ ...base, enabled: false }, now)).toBe('disabled');
  });

  it('creates a notification with UTC values', () => {
    component.form.patchValue({
      title: 'Wartung',
      message: 'Text',
      startsAt: '2026-07-12T12:00'
    });
    component.save();
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Wartung',
      startsAt: expect.stringMatching(/^2026-07-12T/)
    }));
  });

  it('does not offer dismissal from the preview', () => {
    component.form.patchValue({ dismissible: true });
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('coding-box-system-notification-item');
    expect(preview.querySelector('button[mat-icon-button]')).toBeNull();
  });

  it('deletes only after confirmation', () => {
    const item = {
      id: 9,
      type: SystemNotificationType.Info,
      severity: SystemNotificationSeverity.Low,
      title: 'Info',
      message: 'Text',
      startsAt: null,
      endsAt: null,
      visibleFrom: null,
      visibleUntil: null,
      enabled: true,
      dismissible: false,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z'
    };

    component.delete(item);

    expect(dialog.open).toHaveBeenCalled();
    expect(service.delete).toHaveBeenCalledWith(9);
  });

  it('keeps a notification when deletion is cancelled', () => {
    dialog.open.mockReturnValueOnce({ afterClosed: () => of(false) });
    const item = {
      id: 10,
      type: SystemNotificationType.Info,
      severity: SystemNotificationSeverity.Low,
      title: 'Info',
      message: 'Text',
      startsAt: null,
      endsAt: null,
      visibleFrom: null,
      visibleUntil: null,
      enabled: true,
      dismissible: false,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z'
    };

    component.delete(item);

    expect(service.delete).not.toHaveBeenCalled();
  });
});
