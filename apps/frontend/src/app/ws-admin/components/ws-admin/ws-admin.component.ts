import { Component, OnInit } from '@angular/core';
import {
  ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet
} from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import { AppService } from '../../../services/app.service';

@Component({
  selector: 'coding-box-ws-admin',
  templateUrl: './ws-admin.component.html',
  styleUrls: ['./ws-admin.component.scss'],
  standalone: true,
  imports: [MatTabNav, MatTabLink, RouterLinkActive, RouterLink, MatTabNavPanel, RouterOutlet, TranslateModule]
})
export class WsAdminComponent implements OnInit {
  navLinks: string[] = ['select-unit-play', 'test-files', 'test-groups', 'settings'];
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
