import { inject, Injectable } from '@angular/core';
import { FormBuilder, FormControl, FormGroup } from '@angular/forms';
import {
  catchError,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  map,
  Observable,
  of,
  Subject,
  takeUntil
} from 'rxjs';
import {
  DoubleCodedManagerDecisionDto,
  DoubleCodedResolutionDecisionDto,
  SaveDoubleCodedReviewDraftDto
} from '../../../../../../../api-dto/coding/double-coded-review.dto';
import { AppService } from '../../../core/services/app.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import {
  AppliedReviewResult,
  CatalogDecisionResult,
  ConflictType,
  CoderResult,
  DecisionResult,
  DoubleCodedItem,
  ReplayDecisionResult
} from './double-coded-review.models';

interface ReviewRecoveryEntry {
  responseId: number;
  selectedValue: string;
  comment: string;
  replayDecision?: ReplayDecisionResult;
}

interface ReviewRecoveryDraft {
  workspaceId: number;
  entries: ReviewRecoveryEntry[];
}

type ManagerDraftCommand =
  | {
    kind: 'save';
    workspaceId: number;
    item: DoubleCodedItem;
    draft: SaveDoubleCodedReviewDraftDto;
  }
  | {
    kind: 'delete';
    workspaceId: number;
    item: DoubleCodedItem;
  };

interface ManagerDraftCommandResult {
  command: ManagerDraftCommand;
  savedDraft: DoubleCodedManagerDecisionDto | null;
}

@Injectable()
export class DoubleCodedReviewFacade {
  private readonly fb = inject(FormBuilder);
  private readonly appService = inject(AppService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly sessionRecoveryService = inject(SessionRecoveryService);

  readonly selectionForm: FormGroup = this.fb.group({});

  private readonly replayDecisionByResponseId = new Map<
  number,
  ReplayDecisionResult
  >();

  private readonly defaultReviewValueByResponseId = new Map<
  number,
  { selectedValue: string; comment: string }
  >();

  private readonly managerDraftCommandQueues = new Map<
  number,
  Subject<ManagerDraftCommand>
  >();

  private readonly lastManagerDraftCommandSignatureByResponseId = new Map<
  number,
  string
  >();

  private readonly destroy$ = new Subject<void>();
  private unregisterRecoveryProvider: (() => void) | null = null;
  private recoveryItemsProvider: (() => DoubleCodedItem[]) | null = null;

  private readonly replayDecisionPrefix = 'replay:';
  private readonly catalogDecisionPrefix = 'code:';
  private readonly reviewRecoveryKey = 'double-coded-review-active-state';
  private readonly standaloneCodingIssueOptionIds = new Set([-3, -4]);

  connectRecovery(itemsProvider: () => DoubleCodedItem[]): void {
    this.recoveryItemsProvider = itemsProvider;
    this.unregisterRecoveryProvider =
      this.sessionRecoveryService.registerProvider({
        key: this.reviewRecoveryKey,
        capture: () => this.createRecoveryDraft(itemsProvider())
      });
    this.sessionRecoveryService.restore$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.restoreRecoveryDraft(itemsProvider()));
  }

  initialize(items: DoubleCodedItem[]): void {
    Object.keys(this.selectionForm.controls).forEach(key => {
      this.selectionForm.removeControl(key);
    });
    this.defaultReviewValueByResponseId.clear();

    items.forEach(item => {
      const ownDraft = this.getOwnManagerDraft(item);
      const modeCode = this.getModeCode(item);
      const defaultCode =
        ownDraft?.code ?? (item.isResolved ? item.appliedCode : modeCode);
      const selectedValue =
        defaultCode === null || defaultCode === undefined ?
          '' :
          this.getCatalogDecisionControlValue(defaultCode);
      const comment =
        ownDraft?.comment || (item.isResolved ? item.appliedComment || '' : '');

      const selectionControl = new FormControl({
        value: selectedValue,
        disabled: item.isResolved
      });
      const commentControl = new FormControl({
        value: comment,
        disabled: item.isResolved
      });
      this.selectionForm.addControl(
        this.getItemControlName(item),
        selectionControl
      );
      this.selectionForm.addControl(
        this.getCommentControlName(item),
        commentControl
      );
      this.defaultReviewValueByResponseId.set(item.responseId, {
        selectedValue,
        comment
      });
      this.setCurrentSelectionCode(item, defaultCode ?? null);

      commentControl.valueChanges
        .pipe(
          debounceTime(750),
          distinctUntilChanged(),
          takeUntil(this.destroy$)
        )
        .subscribe(() => this.persistManagerDraft(item));
    });
  }

  destroy(items: DoubleCodedItem[]): void {
    items.forEach(item => {
      if (this.createRecoveryEntry(item)) {
        this.persistManagerDraft(item);
      }
    });
    this.managerDraftCommandQueues.forEach(queue => queue.complete());
    this.managerDraftCommandQueues.clear();
    this.unregisterRecoveryProvider?.();
    this.unregisterRecoveryProvider = null;
    this.recoveryItemsProvider = null;
    this.destroy$.next();
    this.destroy$.complete();
  }

  getItemControlName(item: DoubleCodedItem): string {
    return `item_${item.responseId}`;
  }

  getCommentControlName(item: DoubleCodedItem): string {
    return `comment_${item.responseId}`;
  }

  getItemControl(item: DoubleCodedItem): FormControl {
    return this.getOrCreateFormControl(this.getItemControlName(item));
  }

  getCommentControl(item: DoubleCodedItem): FormControl {
    return this.getOrCreateFormControl(this.getCommentControlName(item));
  }

  getCatalogDecisionControlValue(code: number): string {
    return `${this.catalogDecisionPrefix}${code}`;
  }

  getSelectedDecisionResult(item: DoubleCodedItem): DecisionResult | undefined {
    const selectedValue = this.getItemControl(item).value;
    const catalogDecision = this.getCatalogDecision(item, selectedValue);
    if (catalogDecision) return catalogDecision;

    const replayDecision = this.getReplayDecision(item, selectedValue);
    if (replayDecision) return replayDecision;

    const selectedResult = selectedValue ?
      item.coderResults.find(
        result => result.jobId.toString() === selectedValue
      ) :
      undefined;
    return selectedResult?.code !== null ? selectedResult : undefined;
  }

  getAppliedReviewResult(item: DoubleCodedItem): AppliedReviewResult | null {
    if (!item.isResolved) return null;
    const comment =
      item.appliedComment?.trim() ||
      item.coderResults
        .find(result => !!result.supervisorComment)
        ?.supervisorComment?.trim() ||
      null;
    if (item.appliedCode === null && item.appliedScore === null && !comment) {
      return null;
    }
    return {
      code: item.appliedCode ?? null,
      score: item.appliedScore ?? null,
      comment
    };
  }

  getAppliedMatchingCoderResult(
    item: DoubleCodedItem
  ): CoderResult | undefined {
    const applied = this.getAppliedReviewResult(item);
    if (!applied || applied.code === null) return undefined;
    return (
      item.coderResults.find(
        result => result.code === applied.code &&
          (result.score ?? null) === (applied.score ?? null)
      ) || item.coderResults.find(result => result.code === applied.code)
    );
  }

  isAppliedCodeMatch(item: DoubleCodedItem, result: CoderResult): boolean {
    const applied = this.getAppliedReviewResult(item);
    return !!applied && applied.code !== null && result.code === applied.code;
  }

  isCurrentCodeMatch(item: DoubleCodedItem, result: CoderResult): boolean {
    if (item.isResolved || item.currentSelectionCode == null) return false;
    return item.currentSelectionCode === this.getReviewSelectionCode(result);
  }

  select(item: DoubleCodedItem, selectedValue: string): void {
    this.replayDecisionByResponseId.delete(item.responseId);
    const selectedResult = item.coderResults.find(
      result => result.jobId.toString() === selectedValue
    );
    item.selectedCoderResult =
      selectedResult?.code !== null ? selectedResult : undefined;
    this.updateCurrentSelectionCode(item);
    this.persistManagerDraft(item);
  }

  applyReplaySelection(
    item: DoubleCodedItem,
    code: number,
    score: number | null,
    hasScore: boolean,
    notes: string,
    hasNotes: boolean
  ): void {
    const matchingResults = item.coderResults.filter(
      result => result.code === code
    );
    const selectedResult = hasScore ?
      matchingResults.find(result => result.score === score) :
      matchingResults[0];

    if (selectedResult) {
      const selectedValue = selectedResult.jobId.toString();
      this.getItemControl(item).setValue(selectedValue);
      this.select(item, selectedValue);
      if (hasNotes) {
        this.getCommentControl(item).setValue(notes);
      }
    } else {
      const replayDecision: ReplayDecisionResult = {
        source: 'replay',
        code,
        score,
        ...(notes ? { notes } : {})
      };
      this.replayDecisionByResponseId.set(item.responseId, replayDecision);
      item.selectedCoderResult = undefined;
      this.getItemControl(item).setValue(
        this.getReplayDecisionControlValue(item)
      );
      if (hasNotes) {
        this.getCommentControl(item).setValue(notes);
      }
      this.updateCurrentSelectionCode(item);
      this.persistManagerDraft(item);
    }
  }

  getDecisionForItem(
    item: DoubleCodedItem
  ): DoubleCodedResolutionDecisionDto | null {
    const selectedValue = this.getItemControl(item).value;
    const catalogDecision = this.getCatalogDecision(item, selectedValue);
    if (catalogDecision) {
      return this.withComment(item, {
        responseId: item.responseId,
        sourceUnitId: item.sourceUnitId,
        code: catalogDecision.code,
        score: catalogDecision.score
      });
    }

    const replayDecision = this.getReplayDecision(item, selectedValue);
    if (replayDecision) {
      return this.withComment(item, {
        responseId: item.responseId,
        sourceUnitId: item.sourceUnitId,
        code: replayDecision.code,
        score: replayDecision.score
      });
    }

    const selectedResult = selectedValue ?
      item.coderResults.find(
        result => result.jobId.toString() === selectedValue
      ) :
      undefined;
    return selectedResult?.code !== null && selectedResult ?
      this.withComment(item, {
        responseId: item.responseId,
        sourceUnitId: item.sourceUnitId,
        selectedJobId: selectedResult.jobId
      }) :
      null;
  }

  getConflictType(item: DoubleCodedItem): ConflictType {
    const validResults = item.coderResults
      .map(result => ({
        coderId: result.coderId,
        signature: this.getCoderResultSignature(result)
      }))
      .filter(
        (result): result is { coderId: number; signature: string } => result.signature !== null
      );
    if (validResults.length < 2) return 'none';

    const signaturesByCoderId = new Map<number, Set<string>>();
    validResults.forEach(result => {
      const signatures =
        signaturesByCoderId.get(result.coderId) || new Set<string>();
      signatures.add(result.signature);
      signaturesByCoderId.set(result.coderId, signatures);
    });
    const hasSameCoderConflict = Array.from(signaturesByCoderId.values()).some(
      signatures => signatures.size > 1
    );
    const hasInterCoderConflict = validResults.some((result, index) => validResults
      .slice(index + 1)
      .some(
        otherResult => otherResult.coderId !== result.coderId &&
            otherResult.signature !== result.signature
      )
    );
    if (hasSameCoderConflict && hasInterCoderConflict) return 'mixed';
    if (hasSameCoderConflict) return 'same-coder';
    return hasInterCoderConflict ? 'inter-coder' : 'none';
  }

  getCoderCompletionStates(item: DoubleCodedItem): boolean[] {
    const resultsByCoderId = new Map<number, CoderResult[]>();
    item.coderResults.forEach(result => {
      const results = resultsByCoderId.get(result.coderId) || [];
      results.push(result);
      resultsByCoderId.set(result.coderId, results);
    });
    return Array.from(resultsByCoderId.values()).map(results => results.every(result => result.code !== null)
    );
  }

  restoreRecoveryDraft(items: DoubleCodedItem[]): boolean {
    const draft = this.sessionRecoveryService.peekDraft<ReviewRecoveryDraft>(
      this.reviewRecoveryKey
    );
    if (!draft || draft.workspaceId !== this.appService.selectedWorkspaceId) {
      return false;
    }
    if (items.length === 0) return false;

    const remainingEntries: ReviewRecoveryEntry[] = [];
    draft.entries.forEach(entry => {
      const item = items.find(
        candidate => candidate.responseId === entry.responseId
      );
      if (!item) {
        remainingEntries.push(entry);
        return;
      }

      if (entry.replayDecision) {
        this.replayDecisionByResponseId.set(
          entry.responseId,
          entry.replayDecision
        );
        item.selectedCoderResult = undefined;
      } else {
        this.replayDecisionByResponseId.delete(entry.responseId);
      }
      const selectedValue =
        entry.selectedValue ||
        (entry.replayDecision ? this.getReplayDecisionControlValue(item) : '');
      this.getItemControl(item).setValue(selectedValue);
      if (selectedValue && !entry.replayDecision) {
        this.select(item, selectedValue);
      } else {
        this.updateCurrentSelectionCode(item);
      }
      this.getCommentControl(item).setValue(entry.comment);
    });

    if (remainingEntries.length > 0) {
      this.sessionRecoveryService.saveDraft(this.reviewRecoveryKey, {
        ...draft,
        entries: remainingEntries
      });
    } else {
      this.sessionRecoveryService.clearDraft(this.reviewRecoveryKey);
    }
    return remainingEntries.length !== draft.entries.length;
  }

  private getOrCreateFormControl(controlName: string): FormControl {
    const control = this.selectionForm.get(controlName);
    if (control instanceof FormControl) return control;
    const created = new FormControl('');
    this.selectionForm.addControl(controlName, created);
    return created;
  }

  private getCatalogDecision(
    item: DoubleCodedItem,
    controlValue: string | null | undefined
  ): CatalogDecisionResult | undefined {
    if (!controlValue?.startsWith(this.catalogDecisionPrefix)) return undefined;
    const code = Number(controlValue.slice(this.catalogDecisionPrefix.length));
    const option = item.availableCodes.find(
      candidate => candidate.code === code
    );
    if (option) {
      return {
        source: 'catalog',
        code: option.code,
        score: option.score,
        label: option.label
      };
    }
    if (item.isResolved && item.appliedCode === code) {
      return {
        source: 'catalog',
        code,
        score: item.appliedScore,
        label: String(code)
      };
    }
    return undefined;
  }

  private getReplayDecision(
    item: DoubleCodedItem,
    controlValue: string | null | undefined
  ): ReplayDecisionResult | undefined {
    return controlValue === this.getReplayDecisionControlValue(item) ?
      this.replayDecisionByResponseId.get(item.responseId) :
      undefined;
  }

  private getReplayDecisionControlValue(item: DoubleCodedItem): string {
    return `${this.replayDecisionPrefix}${item.responseId}`;
  }

  private updateCurrentSelectionCode(item: DoubleCodedItem): void {
    const selected = this.getSelectedDecisionResult(item);
    this.setCurrentSelectionCode(
      item,
      selected ? this.getReviewSelectionCode(selected) : null
    );
  }

  private setCurrentSelectionCode(
    item: DoubleCodedItem,
    code: number | null
  ): void {
    item.currentSelectionCode = code;
    item.coderResults.forEach(result => {
      result.currentSelectionMatch =
        !item.isResolved &&
        code !== null &&
        code === this.getReviewSelectionCode(result);
    });
  }

  private getReviewSelectionCode(result: DecisionResult): number | null {
    if (!('source' in result)) {
      const issue = result.codingIssueOption;
      if (
        issue !== null &&
        issue !== undefined &&
        this.standaloneCodingIssueOptionIds.has(issue)
      ) {
        return issue;
      }
    }
    return result.code;
  }

  private getOwnManagerDraft(
    item: DoubleCodedItem
  ): DoubleCodedManagerDecisionDto | undefined {
    return item.managerDrafts.find(
      decision => decision.managerUserId === this.appService.userId
    );
  }

  private getModeCode(item: DoubleCodedItem): number | null {
    const availableCodes = new Set(
      item.availableCodes.map(option => option.code)
    );
    const counts = new Map<number, number>();
    item.coderResults.forEach(result => {
      const code =
        result.codingIssueOption !== null &&
        result.codingIssueOption !== undefined &&
        this.standaloneCodingIssueOptionIds.has(result.codingIssueOption) ?
          result.codingIssueOption :
          result.code;
      if (
        code === null ||
        code === undefined ||
        code === -1 ||
        code === -2 ||
        !availableCodes.has(code)
      ) return;
      counts.set(code, (counts.get(code) || 0) + 1);
    });
    if (counts.size === 0) return null;
    const highestCount = Math.max(...counts.values());
    const candidates = [...counts.entries()]
      .filter(([, count]) => count === highestCount)
      .map(([code]) => code);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private withComment(
    item: DoubleCodedItem,
    decision: DoubleCodedResolutionDecisionDto
  ): DoubleCodedResolutionDecisionDto {
    const comment = this.getCommentControl(item).value;
    if (comment?.trim()) decision.resolutionComment = comment.trim();
    return decision;
  }

  private persistManagerDraft(item: DoubleCodedItem): void {
    if (item.isResolved) return;
    const workspaceId = this.appService.selectedWorkspaceId;
    const selectedValue = this.getItemControl(item).value;
    const selected =
      this.getCatalogDecision(item, selectedValue) ||
      this.getReplayDecision(item, selectedValue) ||
      item.coderResults.find(
        result => result.jobId.toString() === selectedValue
      );
    if (
      !workspaceId ||
      !selected ||
      selected.code === null ||
      selected.code === -1 ||
      selected.code === -2
    ) {
      if (workspaceId && !selectedValue) {
        this.enqueueManagerDraftCommand({ kind: 'delete', workspaceId, item });
      }
      return;
    }
    this.enqueueManagerDraftCommand({
      kind: 'save',
      workspaceId,
      item,
      draft: {
        sourceUnitId: item.sourceUnitId,
        code: selected.code,
        score: selected.score,
        comment: this.getCommentControl(item).value?.trim() || null
      }
    });
  }

  private enqueueManagerDraftCommand(command: ManagerDraftCommand): void {
    const signature = this.getManagerDraftCommandSignature(command);
    if (
      this.lastManagerDraftCommandSignatureByResponseId.get(
        command.item.responseId
      ) === signature
    ) return;
    this.lastManagerDraftCommandSignatureByResponseId.set(
      command.item.responseId,
      signature
    );
    let queue = this.managerDraftCommandQueues.get(command.item.responseId);
    if (!queue) {
      queue = this.createManagerDraftCommandQueue();
      this.managerDraftCommandQueues.set(command.item.responseId, queue);
    }
    queue.next(command);
  }

  private getManagerDraftCommandSignature(
    command: ManagerDraftCommand
  ): string {
    return command.kind === 'delete' ?
      'delete' :
      JSON.stringify({
        code: command.draft.code,
        score: command.draft.score ?? null,
        comment: command.draft.comment ?? null
      });
  }

  private createManagerDraftCommandQueue(): Subject<ManagerDraftCommand> {
    const queue = new Subject<ManagerDraftCommand>();
    queue
      .pipe(
        concatMap(command => {
          let request: Observable<ManagerDraftCommandResult>;
          if (command.kind === 'save') {
            request = this.testPersonCodingService
              .saveDoubleCodedReviewDraft(
                command.workspaceId,
                command.item.responseId,
                command.draft
              )
              .pipe(map(savedDraft => ({ command, savedDraft })));
          } else {
            request = this.testPersonCodingService
              .deleteDoubleCodedReviewDraft(
                command.workspaceId,
                command.item.responseId
              )
              .pipe(map(() => ({ command, savedDraft: null })));
          }
          return request.pipe(
            catchError(() => {
              const signature = this.getManagerDraftCommandSignature(command);
              if (
                this.lastManagerDraftCommandSignatureByResponseId.get(
                  command.item.responseId
                ) === signature
              ) {
                this.lastManagerDraftCommandSignatureByResponseId.delete(
                  command.item.responseId
                );
              }
              this.storeCurrentRecoveryDraft();
              return of(null);
            })
          );
        })
      )
      .subscribe(result => this.applyManagerDraftCommandResult(result));
    return queue;
  }

  private applyManagerDraftCommandResult(
    result: ManagerDraftCommandResult | null
  ): void {
    if (!result) return;
    const { command, savedDraft } = result;
    const managerDrafts = command.item.managerDrafts || [];
    const retainedDrafts = managerDrafts.filter(
      decision => decision.managerUserId !== this.appService.userId
    );
    if (savedDraft) retainedDrafts.push(savedDraft);
    managerDrafts.splice(0, managerDrafts.length, ...retainedDrafts);
    command.item.managerDrafts = managerDrafts;
  }

  private createRecoveryDraft(
    items: DoubleCodedItem[]
  ): ReviewRecoveryDraft | null {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || items.length === 0) return null;
    const entries = items
      .map(item => this.createRecoveryEntry(item))
      .filter((entry): entry is ReviewRecoveryEntry => entry !== null);
    return entries.length > 0 ? { workspaceId, entries } : null;
  }

  private createRecoveryEntry(
    item: DoubleCodedItem
  ): ReviewRecoveryEntry | null {
    if (item.isResolved) return null;
    const selectedValue = this.getItemControl(item).value || '';
    const comment = this.getCommentControl(item).value || '';
    const replayDecision = this.replayDecisionByResponseId.get(item.responseId);
    const defaults = this.defaultReviewValueByResponseId.get(
      item.responseId
    ) || {
      selectedValue: '',
      comment: ''
    };
    if (
      !replayDecision &&
      selectedValue === defaults.selectedValue &&
      comment === defaults.comment
    ) return null;
    return {
      responseId: item.responseId,
      selectedValue,
      comment,
      ...(replayDecision ? { replayDecision } : {})
    };
  }

  private storeCurrentRecoveryDraft(): void {
    const recoveryDraft = this.recoveryItemsProvider ?
      this.createRecoveryDraft(this.recoveryItemsProvider()) :
      null;
    if (recoveryDraft) {
      this.sessionRecoveryService.saveDraft(
        this.reviewRecoveryKey,
        recoveryDraft
      );
    }
  }

  private getCoderResultSignature(
    result: Pick<CoderResult, 'code' | 'score'>
  ): string | null {
    return result.code === null || result.code === undefined ?
      null :
      `${result.code}:${result.score ?? 'NULL'}`;
  }
}
