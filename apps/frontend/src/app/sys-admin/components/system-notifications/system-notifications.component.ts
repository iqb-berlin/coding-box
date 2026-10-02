import { DatePipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  SystemNotificationSeverity,
  SystemNotificationType
} from '../../../../../../../api-dto/system-notifications/system-notification.types';
import type {
  CreateSystemNotificationDto,
  SystemNotificationDto
} from '../../../../../../../api-dto/system-notifications/system-notification.dto';
import { SystemNotificationService } from '../../../core/services/system-notification.service';
import { SystemNotificationItemComponent } from '../../../components/system-notification-banner/system-notification-item.component';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/dialogs/confirm-dialog.component';

function dateWindowValidator(control: AbstractControl): ValidationErrors | null {
  const startsAt = control.get('startsAt')?.value;
  const endsAt = control.get('endsAt')?.value;
  const visibleFrom = control.get('visibleFrom')?.value;
  const visibleUntil = control.get('visibleUntil')?.value;
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) return { eventWindow: true };
  if (visibleFrom && visibleUntil && new Date(visibleUntil) <= new Date(visibleFrom)) return { visibilityWindow: true };
  return null;
}

function trimmedRequiredValidator(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

@Component({
  selector: 'coding-box-system-notifications-admin',
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    ReactiveFormsModule,
    TranslateModule,
    SystemNotificationItemComponent
  ],
  templateUrl: './system-notifications.component.html',
  styleUrl: './system-notifications.component.scss'
})
export class SystemNotificationsComponent implements OnInit {
  private readonly service = inject(SystemNotificationService);

  private readonly snackBar = inject(MatSnackBar);

  private readonly translate = inject(TranslateService);

  private readonly formBuilder = inject(FormBuilder);

  private readonly dialog = inject(MatDialog);

  readonly types = Object.values(SystemNotificationType);

  readonly severities = Object.values(SystemNotificationSeverity);

  readonly columns = ['status', 'type', 'title', 'window', 'actions'];

  notifications: SystemNotificationDto[] = [];

  editingId: number | null = null;

  loading = false;

  readonly form = this.formBuilder.nonNullable.group({
    type: [SystemNotificationType.Info, Validators.required],
    severity: [SystemNotificationSeverity.Low, Validators.required],
    title: ['', [trimmedRequiredValidator, Validators.maxLength(160)]],
    message: ['', [trimmedRequiredValidator, Validators.maxLength(2000)]],
    startsAt: [''],
    endsAt: [''],
    visibleFrom: [''],
    visibleUntil: [''],
    enabled: [true],
    dismissible: [false]
  }, { validators: dateWindowValidator });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.service.getAll().subscribe({
      next: notifications => {
        this.notifications = notifications;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.showMessage('system-notifications.load-error');
      }
    });
  }

  edit(notification: SystemNotificationDto): void {
    this.editingId = notification.id;
    this.form.reset({
      type: notification.type,
      severity: notification.severity,
      title: notification.title,
      message: notification.message,
      startsAt: this.toLocalInput(notification.startsAt),
      endsAt: this.toLocalInput(notification.endsAt),
      visibleFrom: this.toLocalInput(notification.visibleFrom),
      visibleUntil: this.toLocalInput(notification.visibleUntil),
      enabled: notification.enabled,
      dismissible: notification.dismissible
    });
  }

  cancelEdit(): void {
    this.editingId = null;
    this.form.reset({
      type: SystemNotificationType.Info,
      severity: SystemNotificationSeverity.Low,
      title: '',
      message: '',
      startsAt: '',
      endsAt: '',
      visibleFrom: '',
      visibleUntil: '',
      enabled: true,
      dismissible: false
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const input: CreateSystemNotificationDto = {
      ...value,
      title: value.title.trim(),
      message: value.message.trim(),
      startsAt: this.toIso(value.startsAt),
      endsAt: this.toIso(value.endsAt),
      visibleFrom: this.toIso(value.visibleFrom),
      visibleUntil: this.toIso(value.visibleUntil)
    };
    const request = this.editingId === null ?
      this.service.create(input) :
      this.service.update(this.editingId, input);
    request.subscribe({
      next: () => {
        this.showMessage('system-notifications.saved');
        this.cancelEdit();
        this.load();
      },
      error: () => this.showMessage('system-notifications.save-error')
    });
  }

  delete(notification: SystemNotificationDto): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: <ConfirmDialogData>{
        title: this.translate.instant('system-notifications.delete-title'),
        content: this.translate.instant('system-notifications.delete-content', {
          title: notification.title
        }),
        confirmButtonLabel: this.translate.instant('delete'),
        showCancel: true
      }
    });
    dialogRef.afterClosed().subscribe((confirmed: boolean) => {
      if (confirmed) this.deleteConfirmed(notification);
    });
  }

  private deleteConfirmed(notification: SystemNotificationDto): void {
    this.service.delete(notification.id).subscribe({
      next: () => {
        this.showMessage('system-notifications.deleted');
        if (this.editingId === notification.id) this.cancelEdit();
        this.load();
      },
      error: () => this.showMessage('system-notifications.delete-error')
    });
  }

  status(notification: SystemNotificationDto, now = new Date()): string {
    if (!notification.enabled) return 'disabled';
    const from = notification.visibleFrom || notification.startsAt;
    const until = notification.visibleUntil || notification.endsAt;
    if (from && new Date(from) > now) return 'scheduled';
    if (until && new Date(until) < now) return 'expired';
    return 'active';
  }

  preview(): SystemNotificationDto {
    const value = this.form.getRawValue();
    return {
      id: this.editingId ?? 0,
      ...value,
      title: value.title || this.translate.instant('system-notifications.preview-title'),
      message: value.message || this.translate.instant('system-notifications.preview-message'),
      startsAt: this.toIso(value.startsAt),
      endsAt: this.toIso(value.endsAt),
      visibleFrom: this.toIso(value.visibleFrom),
      visibleUntil: this.toIso(value.visibleUntil),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  private toIso(value: string): string | null {
    return value ? new Date(value).toISOString() : null;
  }

  private toLocalInput(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  private showMessage(key: string): void {
    this.snackBar.open(this.translate.instant(key), '', { duration: 3000 });
  }
}
