import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor } from '@angular/material/button';
import {
  MatCard, MatCardContent, MatCardHeader, MatCardTitle
} from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { CoderListComponent } from '../coder-list/coder-list.component';
import { CodingJobsComponent } from '../coding-jobs/coding-jobs.component';

@Component({
  selector: 'coding-box-coding-management-manual',
  templateUrl: './coding-management-manual.component.html',
  styleUrls: ['./coding-management-manual.component.scss'],
  imports: [TranslateModule, CoderListComponent, MatAnchor, CodingJobsComponent, MatCardContent, MatCardTitle, MatCardHeader, MatCard, MatIcon]
})
export class CodingManagementManualComponent {
}
