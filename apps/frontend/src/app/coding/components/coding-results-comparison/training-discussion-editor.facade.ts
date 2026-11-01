import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { AuthRefreshUnavailableError } from '../../../core/interceptors/auth-refresh-unavailable.error';
import { getAuthProviderFailureCode } from '../../../core/interceptors/auth-provider-failure';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { WithinTrainingComparison } from './comparison-view.models';
import {
  TrainingDiscussionRecovery, TrainingDiscussionRecoveryDraft, TrainingDiscussionRecoveryEntry
} from './training-discussion-recovery.service';
import {
  discussionScoreFromKnownCodes, parseDiscussionCode, isUnchangedDiscussionValue, mapDiscussionCodeForDisplay
} from './training-discussion-values';

export interface DiscussionEditContext {
  workspaceId: number;
  trainingId: number;
  canEdit: () => boolean;
  isCurrent: () => boolean;
  rows: () => WithinTrainingComparison[];
}

type DiscussionDraftPatch = Partial<Omit<TrainingDiscussionRecoveryEntry, 'responseId'>> & { error?: string };

/** Drafts, writes and recovery for the discussion editor of one comparison dialog. */
@Injectable()
export class TrainingDiscussionEditorFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly codingTrainingBackendService = inject(CodingTrainingBackendService);
  private readonly translate = inject(TranslateService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly appService = inject(AppService);
  private readonly recovery = inject(TrainingDiscussionRecovery);
  private readonly cancelRequests = new Subject<void>();
  private readonly codeState = signal<Record<number, string>>({});
  private readonly scoreState = signal<Record<number, number | null>>({});
  private readonly notesState = signal<Record<number, string>>({});
  private readonly errorState = signal<Record<number, string>>({});
  private readonly savingState = signal<Record<number, boolean>>({});
  private readonly managerState = signal('');
  private pendingDiscussionNotesByResponseId: Record<number, string> = {};

  readonly codes = this.codeState.asReadonly();
  readonly scores = this.scoreState.asReadonly();
  readonly notes = this.notesState.asReadonly();
  readonly errors = this.errorState.asReadonly();
  readonly saving = this.savingState.asReadonly();
  readonly managerLabel = this.managerState.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.resetPending();
      this.cancelRequests.complete();
    });
  }

  setManagerLabel(label: string): void { this.managerState.set(label); }

  patchDraft(responseId: number, patch: DiscussionDraftPatch): void {
    if ('codeValue' in patch) this.codeState.update(current => ({ ...current, [responseId]: patch.codeValue ?? '' }));
    if ('score' in patch) this.scoreState.update(current => ({ ...current, [responseId]: patch.score ?? null }));
    if ('notes' in patch) this.notesState.update(current => ({ ...current, [responseId]: patch.notes ?? '' }));
    if ('error' in patch) this.errorState.update(current => ({ ...current, [responseId]: patch.error ?? '' }));
  }

  resetPending(): void {
    this.savingState.set({});
    this.pendingDiscussionNotesByResponseId = {};
  }

  stop(): void {
    this.cancelRequests.next();
    this.resetPending();
  }

  inputCode(comparison: WithinTrainingComparison, value: string): void {
    const responseId = comparison.responseId;
    this.codeState.update(current => ({ ...current, [responseId]: value }));
    this.errorState.update(current => ({ ...current, [responseId]: '' }));

    const codeAsNumber = parseInt(value, 10);
    if (Number.isNaN(codeAsNumber)) {
      this.scoreState.update(current => ({ ...current, [responseId]: null }));
      return;
    }

    this.scoreState.update(current => ({
      ...current,
      [responseId]: discussionScoreFromKnownCodes(
        comparison,
        codeAsNumber
      )
    }));
  }

  inputNotes(comparison: WithinTrainingComparison, value: string): void {
    const responseId = comparison.responseId;
    this.notesState.update(current => ({ ...current, [responseId]: value }));
    this.errorState.update(current => ({ ...current, [responseId]: '' }));
  }

  save(
    comparison: WithinTrainingComparison,
    context: DiscussionEditContext,
    scoreOverride?: number | null
  ): void {
    if (!context.isCurrent() || !context.canEdit()) return;

    const responseId = comparison.responseId;
    const rawValue = this.codeState()[responseId] || '';
    const parsedCode = parseDiscussionCode(rawValue);

    if (parsedCode === undefined) {
      this.errorState.update(current => ({ ...current, [responseId]: this.translate.instant('coding.trainings.compare.discussion-integer-required') }));
      this.snackBar.open(this.translate.instant('coding.trainings.compare.discussion-integer-required'), this.translate.instant('common.close'), { duration: 3000 });
      return;
    }

    const notes = (this.notesState()[responseId] || '').trim() || null;
    const trainingId = context.trainingId;

    let score: number | null = null;
    if (parsedCode !== null) {
      score = scoreOverride !== undefined ?
        scoreOverride :
        discussionScoreFromKnownCodes(comparison, parsedCode);
    }
    this.errorState.update(current => ({ ...current, [responseId]: '' }));

    if (isUnchangedDiscussionValue(comparison, parsedCode, score, notes, scoreOverride)) {
      this.codeState.update(current => ({ ...current, [responseId]: parsedCode !== null ? parsedCode.toString() : '' }));
      this.scoreState.update(current => ({ ...current, [responseId]: comparison.discussionScore ?? null }));
      this.notesState.update(current => ({ ...current, [responseId]: comparison.discussionNotes || '' }));
      this.recovery.clearEntry(responseId, context.workspaceId, trainingId);
      return;
    }

    this.savingState.update(current => ({ ...current, [responseId]: true }));

    this.codingTrainingBackendService.saveDiscussionResult(
      context.workspaceId,
      trainingId,
      responseId,
      parsedCode,
      score,
      notes
    ).pipe(takeUntil(this.cancelRequests), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          if (!context.isCurrent()) return;
          const hasPendingNotes = Object.prototype.hasOwnProperty.call(
            this.pendingDiscussionNotesByResponseId,
            responseId
          );
          const pendingNotes = hasPendingNotes ?
            this.pendingDiscussionNotesByResponseId[responseId] :
            '';

          this.codeState.update(current => ({ ...current, [responseId]: result.code !== null ? result.code.toString() : '' }));
          this.scoreState.update(current => ({ ...current, [responseId]: result.score }));
          this.notesState.update(current => ({ ...current, [responseId]: hasPendingNotes ? pendingNotes : result.notes || '' }));
          comparison.discussionCode = result.code;
          comparison.discussionScore = result.score;
          comparison.discussionNotes = result.notes;
          comparison.discussionManagerUserId = result.managerUserId;
          comparison.discussionManagerName = result.managerName;
          comparison.discussionSource = result.source;
          this.errorState.update(current => ({ ...current, [responseId]: '' }));
          if (result.managerName) {
            this.managerState.set(result.managerName);
          }
          this.savingState.update(current => ({ ...current, [responseId]: false }));

          if (hasPendingNotes) {
            delete this.pendingDiscussionNotesByResponseId[responseId];
            const normalizedPendingNotes = pendingNotes.trim() || null;
            const normalizedSavedNotes = (result.notes || '').trim() || null;
            if (normalizedPendingNotes !== normalizedSavedNotes) {
              this.save(comparison, context, result.score);
              return;
            }
          }
          this.recovery.clearEntry(responseId, context.workspaceId, trainingId);
        },
        error: error => {
          if (!context.isCurrent()) return;
          this.savingState.update(current => ({ ...current, [responseId]: false }));
          if (this.isRecoverableDiscussionAuthError(error)) {
            const message = error instanceof AuthRefreshUnavailableError || getAuthProviderFailureCode(error) ?
              this.translate.instant('error.auth_refresh_pending_save_message') :
              this.translate.instant('coding.trainings.compare.discussion-requires-login');
            this.errorState.update(current => ({ ...current, [responseId]: message }));
            const draft = this.capture(context.workspaceId, trainingId, context.rows());
            if (draft) {
              this.recovery.save(draft);
            }
            this.snackBar.open(message, this.translate.instant('common.close'), { duration: 4000 });
            return;
          }
          delete this.pendingDiscussionNotesByResponseId[responseId];
          const message = this.getDiscussionSaveErrorMessage(error);
          this.errorState.update(current => ({ ...current, [responseId]: message }));
          this.snackBar.open(message, this.translate.instant('common.close'), { duration: 4000 });
        }
      });
  }

  private getDiscussionSaveErrorMessage(error: unknown): string {
    const fallbackMessage = this.translate.instant('coding.trainings.compare.discussion-save-error');
    if (!(error instanceof HttpErrorResponse)) {
      return fallbackMessage;
    }

    const responseMessage = error.error?.message;
    const message = Array.isArray(responseMessage) ?
      responseMessage.join(' ') :
      responseMessage || error.message;

    if (typeof message !== 'string' || !message.trim()) {
      return fallbackMessage;
    }

    if (message.includes('Unsupported code for variable')) {
      return this.translate.instant('coding.trainings.compare.discussion-code-unknown');
    }

    if (message.includes('Unsupported missing code')) {
      return this.translate.instant('coding.trainings.compare.discussion-missing-code-unknown');
    }

    if (message.includes('Conflicting missing profiles')) {
      return this.translate.instant('coding.trainings.compare.discussion-conflicting-profiles');
    }

    if (message.includes('Missing profile') && message.includes('not found')) {
      return this.translate.instant('coding.trainings.compare.discussion-profile-unavailable');
    }

    if (message.includes('Coding scheme not found') || message.includes('Coding scheme variable not found')) {
      return this.translate.instant('coding.trainings.compare.discussion-score-unavailable');
    }

    if (message.includes('Discussion code must be an integer')) {
      return this.translate.instant('coding.trainings.compare.discussion-integer-required');
    }

    return message;
  }

  initialize(data: WithinTrainingComparison[]): void {
    const codes: Record<number, string> = {};
    const scores: Record<number, number | null> = {};
    const notes: Record<number, string> = {};
    this.errorState.set({});
    this.savingState.set({});
    this.pendingDiscussionNotesByResponseId = {};

    const persistedManager = data.find(item => !!item.discussionManagerName)?.discussionManagerName;
    if (persistedManager) {
      this.managerState.set(persistedManager);
    }

    data.forEach(item => {
      if (item.discussionCode !== null && item.discussionCode !== undefined) {
        codes[item.responseId] = mapDiscussionCodeForDisplay(item.discussionCode.toString());
        scores[item.responseId] = item.discussionScore ?? discussionScoreFromKnownCodes(item, item.discussionCode);
        notes[item.responseId] = item.discussionNotes || '';
      } else {
        codes[item.responseId] = '';
        scores[item.responseId] = null;
        notes[item.responseId] = '';
      }
    });
    this.codeState.set(codes);
    this.scoreState.set(scores);
    this.notesState.set(notes);
  }

  private isRecoverableDiscussionAuthError(error: unknown): boolean {
    return error instanceof AuthRefreshUnavailableError || !!getAuthProviderFailureCode(error) || this.appService.needsReAuthentication ||
      (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403));
  }

  selectReplayCode(row: WithinTrainingComparison, data: { code: string; score?: number | null; notes?: string | null }, context: DiscussionEditContext | null): void {
    this.patchDraft(row.responseId, {
      codeValue: mapDiscussionCodeForDisplay(data.code),
      score: data.score !== undefined ? data.score : discussionScoreFromKnownCodes(row, parseInt(data.code, 10)),
      ...(Object.prototype.hasOwnProperty.call(data, 'notes') ? { notes: data.notes || '' } : {})
    });
    if (context) this.save(row, context, data.score);
  }

  commitReplayNotes(row: WithinTrainingComparison, notes: string, context: DiscussionEditContext | null): void {
    const responseId = row.responseId;
    this.patchDraft(responseId, { notes, error: '' });
    const code = (this.codes()[responseId] || '').trim() ||
      (row.discussionCode !== null && row.discussionCode !== undefined ? row.discussionCode.toString() : '');
    if (!code) return;
    this.patchDraft(responseId, { codeValue: code });
    if (this.saving()[responseId]) {
      this.pendingDiscussionNotesByResponseId[responseId] = notes;
      return;
    }
    const scoreOverride = Object.prototype.hasOwnProperty.call(this.scores(), responseId) ? this.scores()[responseId] : undefined;
    if (context) this.save(row, context, scoreOverride);
  }

  capture(workspaceId: number, trainingId: number, rows: WithinTrainingComparison[]): TrainingDiscussionRecoveryDraft | null {
    return this.recovery.capture(workspaceId, trainingId, rows, {
      codes: this.codes(),
      scores: this.scores(),
      notes: this.notes(),
      pendingNotes: this.pendingDiscussionNotesByResponseId,
      saving: this.saving(),
      errors: this.errors()
    });
  }

  restore(workspaceId: number, trainingId: number, rows: WithinTrainingComparison[], context: DiscussionEditContext | null): boolean {
    const draft = this.recovery.peek();
    if (!draft || !this.recovery.matches(draft, workspaceId, trainingId) || rows.length === 0) return false;
    let restored = false;
    draft.entries.forEach(entry => {
      const row = rows.find(item => item.responseId === entry.responseId);
      if (!row) return;
      restored = true;
      this.patchDraft(entry.responseId, { ...entry, error: '' });
      if (context) this.save(row, context, entry.score);
    });
    return restored;
  }
}
