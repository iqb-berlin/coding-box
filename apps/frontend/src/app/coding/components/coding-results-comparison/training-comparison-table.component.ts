import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  TrainingComparison, WithinTrainingComparison, ComparisonStatus, ModalValueDisplay
} from './comparison-view.models';
import { TrainingDiscussionEditorComponent, TrainingDiscussionView } from './training-discussion-editor.component';

@Component({
  selector: 'coding-box-training-comparison-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, MatButtonModule, MatIconModule, MatTableModule, MatSortModule, MatPaginatorModule, MatTooltipModule, TrainingDiscussionEditorComponent],
  templateUrl: './training-comparison-table.component.html',
  styleUrls: ['./training-comparison-table.component.scss']
})
export class TrainingComparisonTableComponent {
  readonly rows = input.required<ComparisonTableRow[]>();
  // View projections are rebuilt when a draft changes. Keep the existing row
  // and editor DOM alive so typing does not blur and save the input.
  protected readonly trackRow = (_index: number, row: ComparisonTableRow): number => row.source.responseId;
  readonly columns = input.required<string[]>();
  readonly coderColumns = input.required<{ id: string; label: string }[]>();
  readonly total = input(0);
  readonly pageIndex = input(0);
  readonly pageSize = input(50);
  readonly sortBy = input('unitName');
  readonly sortDirection = input<'asc' | 'desc'>('asc');
  readonly managerLabel = input('');
  readonly pageChanged = output<PageEvent>();
  readonly sortChanged = output<Sort>();
  readonly replayRequested = output<TrainingComparison | WithinTrainingComparison>();
  readonly discussionCodeChanged = output<{ row: TrainingComparison | WithinTrainingComparison; value: string }>();
  readonly discussionNotesChanged = output<{ row: TrainingComparison | WithinTrainingComparison; value: string }>();
  readonly discussionCommitted = output<TrainingComparison | WithinTrainingComparison>();
}

export interface ComparisonCoderCell {
  code: string;
  score: number | null;
  showScore: boolean;
  issueLabel: string;
  issueClass: string;
  issueTooltip: string;
  noteTooltip: string;
}

export interface ComparisonTableRow {
  source: TrainingComparison | WithinTrainingComparison;
  status: ComparisonStatus;
  statusIcon: string;
  statusTooltip: string;
  modalValue: ModalValueDisplay;
  discussion: TrainingDiscussionView;
  coders: Record<string, ComparisonCoderCell | null>;
}
