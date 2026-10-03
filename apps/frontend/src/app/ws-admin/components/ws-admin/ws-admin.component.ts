import {
  Component, DestroyRef, OnInit, inject, signal,
  computed
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet
} from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import {
  catchError, combineLatest, of, Subscription
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { getEffectiveCanCode } from '../../../shared/utils/workspace-access';
import { CodingJobBackendService } from '../../../coding/services/coding-job-backend.service';

interface WsAdminNavLink {
  path: string;
  label: string;
}

@Component({
  selector: 'coding-box-ws-admin',
  standalone: true,
  templateUrl: './ws-admin.component.html',
  styleUrls: ['./ws-admin.component.scss'],
  imports: [MatTabNav,
    MatTabLink,
    RouterLinkActive,
    RouterLink,
    MatTabNavPanel,
    RouterOutlet,
    TranslateModule]
})
export class WsAdminComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private workspaceAccessSubscription?: Subscription;
  private assignedJobsSubscription?: Subscription;
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  appService = inject(AppService);
  private userBackendService = inject(UserBackendService);
  private codingJobBackendService = inject(CodingJobBackendService);

  private allNavLinks: WsAdminNavLink[] = [
    { path: 'test-files', label: 'ws-admin.test-files' },
    { path: 'test-results', label: 'ws-admin.test-results' },
    { path: 'coding/management', label: 'ws-admin.coding-overview' },
    { path: 'coding/manual', label: 'ws-admin.manual-coding' },
    { path: 'export', label: 'ws-admin.export' },
    { path: 'settings', label: 'ws-admin.settings' }
  ];

  private myCodingJobsLink: WsAdminNavLink = { path: 'coding/my-jobs', label: 'ws-admin.my-coding-jobs' };

  private baseCodingManagerLinks: WsAdminNavLink[] = [
    { path: 'coding/statistics', label: 'ws-admin.coding-overview' },
    { path: 'coding/manual', label: 'ws-admin.manual-coding' },
    { path: 'coding/export', label: 'ws-admin.export' }
  ];

  readonly navLinks = signal<WsAdminNavLink[]>([]);
  readonly codingManagerLinks = signal<WsAdminNavLink[]>([...this.baseCodingManagerLinks]);

  readonly accessLevel = signal<number>(0);
  readonly canCode = signal(false);
  readonly hasAssignedCodingJobs = signal(false);
  readonly authData = signal(AppService.defaultAuthData);

  readonly hasCodingJobsAccess = computed<boolean>(() => this.canCode() || this.hasAssignedCodingJobs());

  ngOnInit() {
    combineLatest([this.route.params, this.appService.authData$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, authData]) => {
        const workspaceId = Number(params.ws);
        const contextChanged = workspaceId !== this.appService.selectedWorkspaceId ||
          authData.userId !== this.authData().userId || authData.isAdmin !== this.authData().isAdmin;
        this.appService.selectedWorkspaceId = workspaceId;
        this.updateAccessLevel(authData, contextChanged);
      });
  }

  private updateAccessLevel(authData: typeof AppService.defaultAuthData, contextChanged: boolean): void {
    this.workspaceAccessSubscription?.unsubscribe();
    this.assignedJobsSubscription?.unsubscribe();
    this.authData.set(authData);
    if (contextChanged) {
      this.accessLevel.set(authData.isAdmin ? 3 : 0);
      this.canCode.set(false);
      this.hasAssignedCodingJobs.set(false);
    }
    this.updateNavLinks();
    this.handleDefaultNavigation();
    if (authData.userId > 0) this.updateWorkspaceCodingAccess();
  }

  private updateWorkspaceCodingAccess(): void {
    if (this.authData().userId <= 0) {
      return;
    }

    this.workspaceAccessSubscription = this.userBackendService.getUsers(this.appService.selectedWorkspaceId)
      .pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef))
      .subscribe(users => {
        const currentUser = users.find(user => user.id === this.authData().userId);
        if (!currentUser) {
          if (this.authData().isAdmin) {
            this.updateAssignedCodingJobsAccess();
          } else {
            this.accessLevel.set(0);
            this.canCode.set(false);
            this.hasAssignedCodingJobs.set(false);
            this.updateNavLinks();
          }
          return;
        }

        this.accessLevel.set(this.authData().isAdmin ? 3 : currentUser.accessLevel);
        this.canCode.set(getEffectiveCanCode(currentUser));
        this.hasAssignedCodingJobs.set(false);
        this.updateNavLinks();
        this.handleDefaultNavigation();
        this.updateAssignedCodingJobsAccess();
      });
  }

  private updateNavLinks(): void {
    const showMyCodingJobs = this.hasCodingJobsAccess();
    this.codingManagerLinks.set(showMyCodingJobs ?
      [this.myCodingJobsLink, ...this.baseCodingManagerLinks] :
      [...this.baseCodingManagerLinks]);

    if (this.authData().isAdmin) {
      this.navLinks.set(showMyCodingJobs ?
        [this.myCodingJobsLink, ...this.allNavLinks] :
        [...this.allNavLinks]);
    } else if (this.accessLevel() < 2) {
      this.navLinks.set(showMyCodingJobs ? [this.myCodingJobsLink] : []);
    } else if (this.accessLevel() < 3) {
      this.navLinks.set(showMyCodingJobs ?
        [this.myCodingJobsLink, ...this.baseCodingManagerLinks] :
        [...this.baseCodingManagerLinks]);
    } else {
      this.navLinks.set(showMyCodingJobs ?
        [this.myCodingJobsLink, ...this.allNavLinks] :
        [...this.allNavLinks]);
    }
  }

  private updateAssignedCodingJobsAccess(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || this.authData().userId <= 0) {
      return;
    }

    this.assignedJobsSubscription?.unsubscribe();
    this.assignedJobsSubscription = this.codingJobBackendService.getCodingJobs(
      workspaceId,
      undefined,
      1,
      { assignedTo: 'me' }
    )
      .pipe(catchError(() => of({
        data: [],
        total: 0,
        page: 1,
        limit: 1
      })), takeUntilDestroyed(this.destroyRef))
      .subscribe(response => {
        this.hasAssignedCodingJobs.set((response.total ?? response.data.length) > 0);
        this.updateNavLinks();
        this.handleDefaultNavigation();
      });
  }

  private handleDefaultNavigation(): void {
    if (this.authData().isAdmin) {
      return;
    }

    const currentUrl = this.router.url;
    const workspaceId = this.appService.selectedWorkspaceId;
    const defaultCodingRoutes = [
      `/workspace-admin/${workspaceId}`,
      `/workspace-admin/${workspaceId}/coding`,
      `/workspace-admin/${workspaceId}/coding/management`
    ];

    // If Coding Manager (level 2) is on the default coding route, redirect to the accessible coding overview
    if (this.accessLevel() === 2 && defaultCodingRoutes.some(route => currentUrl.endsWith(route))) {
      this.router.navigate([`/workspace-admin/${workspaceId}/coding/statistics`]);
      return;
    }

    if (this.accessLevel() < 2 && this.hasCodingJobsAccess() && defaultCodingRoutes.some(route => currentUrl.endsWith(route))) {
      this.router.navigate([`/workspace-admin/${workspaceId}/coding/my-jobs`]);
    }
  }

  canAccessFeature(minLevel: number): boolean {
    return this.accessLevel() >= minLevel || this.authData().isAdmin;
  }
}
