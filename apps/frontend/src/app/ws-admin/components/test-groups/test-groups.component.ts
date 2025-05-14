import {
  Component
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { TestResultsComponent } from '../test-results/test-results.component';

@Component({
  selector: 'coding-box-test-groups',
  templateUrl: './test-groups.component.html',
  styleUrls: ['./test-groups.component.scss'],
  standalone: true,
  imports: [FormsModule, TranslateModule, TestResultsComponent]
})
export class TestGroupsComponent {

}
