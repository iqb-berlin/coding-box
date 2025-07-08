import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { CodingManualNavigationComponent } from '../coding-manual-navigation/coding-manual-navigation.component';
import { ReplayComponent } from '../../../replay/components/replay/replay.component';
import { CodingJobsComponent } from '../coding-jobs/coding-jobs.component';

@Component({
  selector: 'coding-box-coding-manual',
  templateUrl: './coding-manual.component.html',
  styleUrls: ['./coding-manual.component.scss'],
  standalone: true,
  imports: [TranslateModule, CodingManualNavigationComponent, ReplayComponent, CodingJobsComponent]
})
export class CodingManualComponent {

}
