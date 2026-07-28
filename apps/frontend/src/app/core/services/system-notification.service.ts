import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  BehaviorSubject,
  Observable,
  Subscription,
  catchError,
  map,
  of,
  switchMap,
  timer
} from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import type {
  CreateSystemNotificationDto,
  SystemNotificationDto,
  UpdateSystemNotificationDto
} from '../../../../../../api-dto/system-notifications/system-notification.dto';
import { suppressGlobalHttpErrorContext } from '../interceptors/http-error-context';

@Injectable({ providedIn: 'root' })
export class SystemNotificationService {
  private readonly http = inject(HttpClient);

  private readonly serverUrl = inject(SERVER_URL);

  private readonly notificationsSubject = new BehaviorSubject<SystemNotificationDto[]>([]);

  private pollingSubscription: Subscription | null = null;

  readonly visibleNotifications$ = this.notificationsSubject.pipe(
    map(notifications => notifications.filter(notification => !this.isDismissed(notification)))
  );

  getActive(): Observable<SystemNotificationDto[]> {
    return this.http.get<SystemNotificationDto[]>(
      `${this.serverUrl}system-notifications/active`,
      { context: suppressGlobalHttpErrorContext() }
    );
  }

  getAll(): Observable<SystemNotificationDto[]> {
    return this.http.get<SystemNotificationDto[]>(`${this.serverUrl}admin/system-notifications`);
  }

  create(input: CreateSystemNotificationDto): Observable<SystemNotificationDto> {
    return this.http.post<SystemNotificationDto>(`${this.serverUrl}admin/system-notifications`, input);
  }

  update(id: number, input: UpdateSystemNotificationDto): Observable<SystemNotificationDto> {
    return this.http.put<SystemNotificationDto>(`${this.serverUrl}admin/system-notifications/${id}`, input);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.serverUrl}admin/system-notifications/${id}`);
  }

  startPolling(intervalMs = 300_000): void {
    if (this.pollingSubscription) return;
    this.pollingSubscription = timer(0, intervalMs).pipe(
      switchMap(() => this.getActive().pipe(
        catchError(() => of(this.notificationsSubject.value))
      ))
    ).subscribe(notifications => this.notificationsSubject.next(notifications));
  }

  stopPolling(): void {
    this.pollingSubscription?.unsubscribe();
    this.pollingSubscription = null;
  }

  dismiss(notification: SystemNotificationDto): void {
    if (!notification.dismissible) return;
    localStorage.setItem(this.dismissalKey(notification.id), notification.updatedAt);
    this.notificationsSubject.next([...this.notificationsSubject.value]);
  }

  private isDismissed(notification: SystemNotificationDto): boolean {
    if (!notification.dismissible) return false;
    return localStorage.getItem(this.dismissalKey(notification.id)) === notification.updatedAt;
  }

  private dismissalKey(id: number): string {
    return `system-notification-dismissed-${id}`;
  }
}
