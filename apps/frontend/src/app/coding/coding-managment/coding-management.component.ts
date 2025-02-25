import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { CoderListComponent } from '../coder-list/coder-list.component';
import { BackendService } from '../../services/backend.service';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'coding-box-coding-management',
  templateUrl: './coding-management.component.html',
  styleUrls: ['./coding-management.component.scss'],
  standalone: true,
  imports: [TranslateModule, CoderListComponent, MatAnchor, MatIcon, RouterLink]
})
export class CodingManagementComponent {
  constructor(
    private backendService: BackendService
  ) {
  }

  autoCode():void {
  }
  manualCode():void {
  }
}
