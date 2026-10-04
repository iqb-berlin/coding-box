import { inject, Injectable, signal } from '@angular/core';
import { catchError, of, tap } from 'rxjs';
import { AppService } from '../../core/services/app.service';
import { UserService } from '../../shared/services/user/user.service';

@Injectable({ providedIn: 'root' })
export class CodingPermissionsService {
  private readonly appService = inject(AppService);
  private readonly userService = inject(UserService);
  private readonly access = signal({ workspaceId: 0, userId: 0, level: 0 });
  private loadVersion = 0;

  load(workspaceId: number): void {
    this.loadVersion += 1;
    const version = this.loadVersion;
    const userId = this.appService.authData.userId;
    this.access.set({ workspaceId, userId, level: 0 });
    this.userService.getUsers(workspaceId).pipe(
      catchError(() => of([])),
      tap(users => {
        if (version === this.loadVersion && workspaceId === this.appService.selectedWorkspaceId && userId === this.appService.authData.userId) {
          this.access.set({ workspaceId, userId, level: users.find(user => user.id === userId)?.accessLevel ?? 0 });
        }
      })
    ).subscribe();
  }

  private get level(): number {
    const access = this.access();
    return access.workspaceId === this.appService.selectedWorkspaceId && access.userId === this.appService.authData.userId ? access.level : 0;
  }

  get canCreate(): boolean {
    return this.appService.authData.isAdmin || this.level >= 2;
  }

  get canApply(): boolean {
    return this.appService.authData.isAdmin || this.level >= 3;
  }

  canEdit(resource: { creatorUserId?: number | null }): boolean {
    return this.canApply || (this.level === 2 && resource.creatorUserId != null &&
      resource.creatorUserId === this.appService.authData.userId);
  }
}
