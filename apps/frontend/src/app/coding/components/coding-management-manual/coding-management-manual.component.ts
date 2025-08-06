import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { CodingJobsComponent } from '../coding-jobs/coding-jobs.component';
import { VariableBundleManagerComponent } from '../variable-bundle-manager/variable-bundle-manager.component';

@Component({
  selector: 'coding-box-coding-management-manual',
  templateUrl: './coding-management-manual.component.html',
  styleUrls: ['./coding-management-manual.component.scss'],
  imports: [
    TranslateModule,
    MatAnchor,
    CodingJobsComponent,
    MatIcon,
    MatButton,
    VariableBundleManagerComponent
  ]
})
export class CodingManagementManualComponent {
  // Component simplified to remove coder management functionality
}
