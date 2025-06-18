import { Component, OnInit, inject } from '@angular/core';
import {
  ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet
} from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import { AppService } from '../../../services/app.service';
import { CodingJobsComponent } from '../../../coding/coding-jobs/coding-jobs.component';
import { BackendService } from '../../../services/backend.service';
import {
  CodingManagementManualComponent
} from '../../../coding/coding-management-manual/coding-management-manual.component';

@Component({
  selector: 'coding-box-ws-admin',
  templateUrl: './ws-admin.component.html',
  styleUrls: ['./ws-admin.component.scss'],
  imports: [MatTabNav,
    MatTabLink,
    RouterLinkActive,
    RouterLink,
    MatTabNavPanel,
    RouterOutlet,
    TranslateModule,
    CodingJobsComponent,
    CodingManagementManualComponent]
})
export class WsAdminComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private appService = inject(AppService);
  private backendService = inject(BackendService);

  navLinks: string[] = ['test-files', 'test-results', 'coding', 'settings'];
  accessLevel:number = 0;
  authData = AppService.defaultAuthData;

  ngOnInit() {
    const routeKey = 'ws';
    this.appService.selectedWorkspaceId = Number(this.route.snapshot.params[routeKey]);
    this.appService.authData$.subscribe(authData => {
      this.authData = authData;
    });
    this.backendService.getUsers(this.appService.selectedWorkspaceId).subscribe(users => {
      setTimeout(() => {
        this.accessLevel = users.filter(user => user.id === this.authData.userId)[0]?.accessLevel;
      }, 200);
    });
  }
}
