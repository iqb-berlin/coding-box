import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { CoderListComponent } from '../coder-list/coder-list.component';
import { BackendService } from '../../services/backend.service';
import { CodingJobsComponent } from '../coding-jobs/coding-jobs.component';

@Component({
    selector: 'coding-box-coding-management-manual',
    templateUrl: './coding-management-manual.component.html',
    styleUrls: ['./coding-management-manual.component.scss'],
    imports: [TranslateModule, CoderListComponent, MatAnchor, MatIcon, CodingJobsComponent]
})
export class CodingManagementManualComponent {
  constructor(
    private backendService: BackendService
  ) {
  }
}
