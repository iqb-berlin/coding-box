import { Component, OnInit } from '@angular/core';
import {
  ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet
} from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import { AppService } from '../../../services/app.service';
import { CodingJobsComponent } from '../../../coding/coding-jobs/coding-jobs.component';
import { CodingManagementComponent } from '../../../coding/coding-managment/coding-management.component';

@Component({
  selector: 'coding-box-ws-admin',
  templateUrl: './ws-admin.component.html',
  styleUrls: ['./ws-admin.component.scss'],
  standalone: true,
  imports: [MatTabNav, MatTabLink, RouterLinkActive, RouterLink, MatTabNavPanel, RouterOutlet, TranslateModule, CodingJobsComponent, CodingManagementComponent]
})
export class WsAdminComponent implements OnInit {
  navLinks: string[] = ['select-unit-play', 'test-files', 'test-groups', 'coding', 'settings'];
  constructor(
    private route: ActivatedRoute,
    private appService: AppService
  ) {
  }

  ngOnInit() {
    const routeKey = 'ws';
    this.appService.selectedWorkspaceId = Number(this.route.snapshot.params[routeKey]);
  }
}
