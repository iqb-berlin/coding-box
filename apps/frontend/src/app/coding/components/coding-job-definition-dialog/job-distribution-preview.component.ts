import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { Variable, VariableBundle } from '../../models/coding-job.model';
import { CodingWorkloadSummary } from './coding-workload';

@Component({
  selector: 'coding-box-job-distribution-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, MatIconModule, MatExpansionModule],
  templateUrl: './job-distribution-preview.component.html',
  styleUrls: ['./job-distribution-preview.component.scss'],
  host: { style: 'display: block' }
})
export class JobDistributionPreviewComponent {
  readonly summary = input.required<CodingWorkloadSummary>();
  readonly variables = input.required<readonly Variable[]>();
  readonly bundles = input.required<readonly VariableBundle[]>();
  readonly coderCount = input(0);
}
