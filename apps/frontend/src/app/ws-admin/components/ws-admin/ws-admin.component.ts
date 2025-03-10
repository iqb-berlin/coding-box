import { Component, OnInit } from '@angular/core';
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
  navLinks: string[] = ['select-unit-play', 'test-files', 'test-groups', 'coding', 'settings'];
  accessLevel:number = 0;
  constructor(
    private route: ActivatedRoute,
    private appService: AppService,
    private backendService: BackendService
  ) {
  }

  ngOnInit() {
    const routeKey = 'ws';
    this.appService.selectedWorkspaceId = Number(this.route.snapshot.params[routeKey]);
    this.backendService.getUsers(this.appService.selectedWorkspaceId).subscribe(users => {
      setTimeout(() => {
        this.accessLevel = users.filter(user => user.id === this.appService.authData.userId)[0]?.accessLevel;
      }, 200);
    });
  }
}
