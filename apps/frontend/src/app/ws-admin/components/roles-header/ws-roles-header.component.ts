import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIconButton } from '@angular/material/button';

@Component({
  selector: 'coding-box-ws-roles-header',
  imports: [CommonModule, MatIcon, TranslateModule, MatTooltip, MatIconButton],
  templateUrl: './ws-roles-header.component.html',
  styleUrl: './ws-roles-header.component.scss'
})
export class WsRolesHeaderComponent {}
