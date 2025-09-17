import { Component } from '@angular/core';

import { MatIcon } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';

@Component({
  selector: 'coding-box-ws-roles-header',
  imports: [MatIcon, TranslateModule, MatTooltip],
  templateUrl: './ws-roles-header.component.html',
  styleUrl: './ws-roles-header.component.scss'
})
export class WsRolesHeaderComponent {}
