import { Component, OnInit, inject } from '@angular/core';
import {
  ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet
} from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import { AppService } from '../../../services/app.service';
import { CodingJobsComponent } from '../../../coding/components/coding-jobs/coding-jobs.component';
import { BackendService } from '../../../services/backend.service';

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
  private backendService = inject(BackendService);

  private allNavLinks: string[] = ['test-files', 'test-results', 'coding', 'cleaning', 'export', 'settings'];
  navLinks: string[] = [];
  codingManagerLinks = [
    { path: 'coding/my-jobs', label: 'ws-admin.my-coding-jobs' },
    { path: 'coding/management', label: 'ws-admin.coding-management' },
    { path: 'coding/job-definitions', label: 'ws-admin.job-definitions' }
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

  navigateToTab(link: string): void {
    this.router.navigate(['/workspace-admin', this.appService.selectedWorkspaceId, link]);
  }

  private updateAccessLevel(): void {
    this.appService.authData$.subscribe(authData => {
      this.authData = authData;

      if (authData.userId > 0) {
        this.backendService.getUsers(this.appService.selectedWorkspaceId).subscribe(users => {
          const currentUser = users.find(user => user.id === authData.userId);
          if (currentUser) {
            this.accessLevel = currentUser.accessLevel;
            this.updateNavLinks();
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

  canAccessFeature(minLevel: number): boolean {
    return this.accessLevel >= minLevel || this.authData.isAdmin;
  }
}
