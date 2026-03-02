import { Component, OnInit, inject } from '@angular/core';
import {
  ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet
} from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import { AppService } from '../../../core/services/app.service';
import { CodingJobsComponent } from '../../../coding/components/coding-jobs/coding-jobs.component';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';

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
    TranslateModule,
    CodingJobsComponent]
})
export class WsAdminComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  appService = inject(AppService);
  private userBackendService = inject(UserBackendService);

  private allNavLinks: string[] = ['test-files', 'test-results', 'coding', 'cleaning', 'export', 'settings'];
  navLinks: string[] = [];
  codingManagerLinks = [
    { path: 'coding/statistics', label: 'ws-admin.coding-statistics' },
    { path: 'coding/manual', label: 'ws-admin.manual-coding' },
    { path: 'coding/export', label: 'ws-admin.export' }
  ];

  accessLevel: number = 0;
  authData = AppService.defaultAuthData;

  ngOnInit() {
    // Subscribe to route parameter changes to handle workspace switching
    this.route.params.subscribe(params => {
      const routeKey = 'ws';
      this.appService.selectedWorkspaceId = Number(params[routeKey]);

      // Update access level for the new workspace
      this.updateAccessLevel();
    });
  }

  private updateAccessLevel(): void {
    this.appService.authData$.subscribe(authData => {
      this.authData = authData;

      if (authData.userId > 0) {
        this.userBackendService.getUsers(this.appService.selectedWorkspaceId).subscribe(users => {
          const currentUser = users.find(user => user.id === authData.userId);
          if (currentUser) {
            this.accessLevel = currentUser.accessLevel;
            this.updateNavLinks();
            this.handleDefaultNavigation();
          }
        });
      }
    });
  }

  private updateNavLinks(): void {
    if (this.accessLevel < 3) {
      this.navLinks = ['coding'];
    } else {
      this.navLinks = [...this.allNavLinks];
    }
  }

  private handleDefaultNavigation(): void {
    const currentUrl = this.router.url;
    const workspaceId = this.appService.selectedWorkspaceId;

    // If Coding Manager (level 2) is on the default coding route, redirect to statistics
    if (this.accessLevel === 2 && currentUrl.endsWith(`/workspace-admin/${workspaceId}/coding`)) {
      this.router.navigate([`/workspace-admin/${workspaceId}/coding/statistics`]);
    }
  }

  canAccessFeature(minLevel: number): boolean {
    return this.accessLevel >= minLevel || this.authData.isAdmin;
  }
}
