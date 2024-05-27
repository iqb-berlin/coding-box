import { Component, Input } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { MatAnchor } from '@angular/material/button';

@Component({
  selector: 'coding-box-app-info',
  templateUrl: './app-info.component.html',
  styleUrls: ['./app-info.component.scss'],
  standalone: true,
  imports: [MatAnchor, RouterLink, TranslateModule]
})
export class AppInfoComponent {
  @Input() appTitle!: string;
  @Input() introHtml!: SafeUrl | undefined;
  @Input() appName!: string;
  @Input() appVersion!: string;
  @Input() userName!: string | undefined;
  @Input() userLongName!: string | undefined;
  @Input() isUserLoggedIn!: boolean;
  @Input() isAdmin!: boolean;
}
