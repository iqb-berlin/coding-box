import { Component} from '@angular/core';
import {
  ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet
} from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';

@Component({
  selector: 'coding-box-ws-admin',
  templateUrl: './ws-admin.component.html',
  styleUrls: ['./ws-admin.component.scss'],
  standalone: true,
  imports: [MatTabNav, MatTabLink, RouterLinkActive, RouterLink, MatTabNavPanel, RouterOutlet, TranslateModule]
})
export class WsAdminComponent {
  navLinks: string[] = ['users', 'test-files', 'settings'];
  constructor(
    private backendService: BackendService,
    private appService: AppService,
    private route: ActivatedRoute,
    private translateService: TranslateService
  ) {
  }
}
