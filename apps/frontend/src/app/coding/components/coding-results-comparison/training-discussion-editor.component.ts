import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'coding-box-training-discussion-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, MatFormFieldModule, MatInputModule],
  templateUrl: './training-discussion-editor.component.html',
  styleUrls: ['./training-discussion-editor.component.scss']
})
export class TrainingDiscussionEditorComponent {
  readonly view = input.required<TrainingDiscussionView>();
  readonly codeChanged = output<string>();
  readonly notesChanged = output<string>();
  readonly committed = output<void>();
}

export interface TrainingDiscussionView {
  editable: boolean;
  code: string;
  score: number | null;
  notes: string;
  saving: boolean;
  error: string;
  source: 'manual' | 'auto_agreement' | null;
}
