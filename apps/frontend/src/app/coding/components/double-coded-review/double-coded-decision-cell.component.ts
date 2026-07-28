import { CommonModule } from '@angular/common';
import {
  Component, inject, input, output
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DoubleCodedReviewCodeDto } from '../../../../../../../api-dto/coding/double-coded-review.dto';
import { DoubleCodedReviewFacade } from './double-coded-review.facade';
import {
  AppliedReviewResult,
  CatalogDecisionResult,
  CoderResult,
  DecisionResult,
  DoubleCodedItem,
  ReplayDecisionResult
} from './double-coded-review.models';

@Component({
  selector: 'coding-box-double-coded-decision-cell',
  templateUrl: './double-coded-decision-cell.component.html',
  styleUrls: ['./double-coded-decision-cell.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    ReactiveFormsModule,
    TranslateModule
  ]
})
export class DoubleCodedDecisionCellComponent {
  private readonly facade = inject(DoubleCodedReviewFacade);
  private readonly translateService = inject(TranslateService);

  readonly item = input.required<DoubleCodedItem>();
  readonly canApply = input(false);
  readonly isLoading = input(false);
  readonly selectionChanged = output<string>();
  readonly applyDecision = output<void>();

  get itemControl() {
    return this.facade.getItemControl(this.item());
  }

  get commentControl() {
    return this.facade.getCommentControl(this.item());
  }

  get selectedDecision(): DecisionResult | undefined {
    return this.facade.getSelectedDecisionResult(this.item());
  }

  get appliedResult(): AppliedReviewResult | null {
    return this.facade.getAppliedReviewResult(this.item());
  }

  get schemaCodes(): DoubleCodedReviewCodeDto[] {
    return this.item().availableCodes.filter(
      option => option.source === 'schema'
    );
  }

  get generalCodes(): DoubleCodedReviewCodeDto[] {
    return this.item().availableCodes.filter(
      option => option.source === 'general'
    );
  }

  get completionStates(): boolean[] {
    return this.facade.getCoderCompletionStates(this.item());
  }

  get statusClass(): string {
    const item = this.item();
    if (item.isResolved) return 'resolved';
    if (this.facade.getConflictType(item) !== 'none') return 'conflict';
    return this.completionStates.every(Boolean) ? 'match' : 'incomplete';
  }

  get statusIcon(): string {
    return (
      {
        resolved: 'check_circle',
        conflict: 'warning',
        match: 'task_alt',
        incomplete: 'pending'
      }[this.statusClass] || 'pending'
    );
  }

  get statusLabel(): string {
    if (this.statusClass === 'resolved') {
      return this.translateService.instant('double-coded-review.applied');
    }
    const conflictType = this.facade.getConflictType(this.item());
    return this.translateService.instant(
      conflictType === 'none' ?
        `double-coded-review.decision.status-${this.statusClass}` :
        `double-coded-review.decision.status-${conflictType}-conflict`
    );
  }

  get statusTooltip(): string {
    if (this.item().isResolved) {
      return this.translateService.instant('double-coded-review.applied');
    }
    const progress = `${this.completionStates.filter(Boolean).length}/${this.completionStates.length} ${this.translateService.instant('double-coded-review.coders-done')}`;
    const conflictType = this.facade.getConflictType(this.item());
    return conflictType === 'none' ?
      progress :
      `${this.translateService.instant(`double-coded-review.decision.tooltip-${conflictType}-conflict`)} - ${progress}`;
  }

  get showComment(): boolean {
    return (
      this.facade.getConflictType(this.item()) !== 'none' ||
      !!this.commentControl.value
    );
  }

  get appliedSourceLabel(): string {
    const matchingResult = this.getAppliedMatchingCoderResult();
    return matchingResult ?
      this.getDecisionSourceLabel(matchingResult) :
      this.translateService.instant(
        'double-coded-review.applied-result.final-source'
      );
  }

  get appliedTooltip(): string {
    const result = this.appliedResult;
    if (!result) return '';
    const code =
      this.getCodeDisplay(result.code) ||
      this.getCodeLabel(result.code) ||
      'N/A';
    const score = result.score !== null ? ` (${result.score})` : '';
    return `${this.translateService.instant('double-coded-review.applied-result.label')}: ${code}${score}`;
  }

  getDecisionSourceLabel(result: DecisionResult): string {
    if (this.isCatalogDecision(result)) return result.label;
    if (this.isReplayDecision(result)) {
      return this.translateService.instant(
        'double-coded-review.decision.replay-source'
      );
    }
    const sameCoderResults = this.item().coderResults.filter(
      candidate => candidate.coderId === result.coderId
    );
    const coderName = result.coderName?.trim() || `Coder ${result.coderId}`;
    return sameCoderResults.length > 1 ?
      `${coderName} - ${result.jobName ? `${result.jobName} (#${result.jobId})` : `#${result.jobId}`}` :
      coderName;
  }

  getDecisionDisplayCode(result: DecisionResult): string {
    return this.isCatalogDecision(result) && result.code < 0 ?
      '' :
      this.getCodeDisplay(result.code);
  }

  getCatalogControlValue(code: number): string {
    return this.facade.getCatalogDecisionControlValue(code);
  }

  getCodeDisplay(code: number | null): string {
    if (code === null || code === undefined) return 'N/A';
    return code === -1 || code === -2 ? '' : code.toString();
  }

  getCodeLabel(code: number | null): string {
    const keys: Record<number, string> = {
      [-1]: 'code-selector.coding-issue-options.code-assignment-uncertain',
      [-2]: 'code-selector.coding-issue-options.new-code-needed',
      [-3]: 'code-selector.coding-issue-options.invalid-joke-answer',
      [-4]: 'code-selector.coding-issue-options.technical-problems'
    };
    return code !== null && keys[code] ?
      this.translateService.instant(keys[code]) :
      '';
  }

  private getAppliedMatchingCoderResult(): CoderResult | undefined {
    return this.facade.getAppliedMatchingCoderResult(this.item());
  }

  private isReplayDecision(
    result: DecisionResult
  ): result is ReplayDecisionResult {
    return 'source' in result && result.source === 'replay';
  }

  private isCatalogDecision(
    result: DecisionResult
  ): result is CatalogDecisionResult {
    return 'source' in result && result.source === 'catalog';
  }
}
