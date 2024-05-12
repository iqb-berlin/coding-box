import { Component} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet
} from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';


@Component({
  selector: 'coding-box-ws-admin',
  templateUrl: './ws-admin.component.html',
  styleUrls: ['./ws-admin.component.scss'],
  standalone: true,
  imports: [MatTabNav, MatTabLink, RouterLinkActive, RouterLink, MatTabNavPanel, RouterOutlet, TranslateModule]
})
export class WsAdminComponent {
  navLinks: string[] = ['users', 'test-files', 'settings'];
}
