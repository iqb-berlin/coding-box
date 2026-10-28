import { inject, Injectable } from '@angular/core';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { mapDiscussionCodeForDisplay } from './training-discussion-values';
import { WithinTrainingComparison } from './comparison-view.models';

export interface TrainingDiscussionRecoveryEntry {
  responseId: number;
  codeValue: string;
  score: number | null;
  notes: string;
}

export interface TrainingDiscussionRecoveryDraft {
  workspaceId: number;
  trainingId: number;
  entries: TrainingDiscussionRecoveryEntry[];
}

export interface DiscussionDraftValues {
  codes: Readonly<Record<number, string>>;
  scores: Readonly<Record<number, number | null>>;
  notes: Readonly<Record<number, string>>;
  pendingNotes: Readonly<Record<number, string>>;
  saving: Readonly<Record<number, boolean>>;
  errors: Readonly<Record<number, string>>;
}

/** Recover unsaved discussion entries across pages without mixing training contexts. */
@Injectable()
export class TrainingDiscussionRecovery {
  private readonly recovery = inject(SessionRecoveryService);
  readonly key = 'training-discussion-active-state';

  peek(): TrainingDiscussionRecoveryDraft | null {
    return this.recovery.peekDraft<TrainingDiscussionRecoveryDraft>(this.key);
  }

  capture(workspaceId: number, trainingId: number, rows: WithinTrainingComparison[], values: DiscussionDraftValues): TrainingDiscussionRecoveryDraft | null {
    const entries = rows.map(row => this.createEntry(row, values))
      .filter((entry): entry is TrainingDiscussionRecoveryEntry => entry !== null);
    return entries.length ? { workspaceId, trainingId, entries } : null;
  }

  matches(draft: TrainingDiscussionRecoveryDraft, workspaceId: number, trainingId: number | null): boolean {
    return draft.workspaceId === workspaceId && draft.trainingId === trainingId;
  }

  save(draft: TrainingDiscussionRecoveryDraft): void {
    const previous = this.peek();
    const entries = new Map<number, TrainingDiscussionRecoveryEntry>();
    if (previous && this.matches(previous, draft.workspaceId, draft.trainingId)) {
      previous.entries.forEach(entry => entries.set(entry.responseId, entry));
    }
    draft.entries.forEach(entry => entries.set(entry.responseId, entry));
    this.recovery.saveDraft(this.key, { ...draft, entries: [...entries.values()] });
  }

  clearEntry(responseId: number, workspaceId: number, trainingId: number | null): void {
    const draft = this.peek();
    if (!draft || !this.matches(draft, workspaceId, trainingId)) return;
    const entries = draft.entries.filter(entry => entry.responseId !== responseId);
    if (entries.length === draft.entries.length) return;
    if (entries.length) this.recovery.saveDraft(this.key, { ...draft, entries });
    else this.recovery.clearDraft(this.key);
  }

  private createEntry(row: WithinTrainingComparison, values: DiscussionDraftValues): TrainingDiscussionRecoveryEntry | null {
    const responseId = row.responseId;
    const codeValue = Object.prototype.hasOwnProperty.call(values.codes, responseId) ?
      values.codes[responseId] :
      persistedDiscussionCode(row);
    const score = Object.prototype.hasOwnProperty.call(values.scores, responseId) ?
      values.scores[responseId] :
      row.discussionScore ?? null;
    const notes = Object.prototype.hasOwnProperty.call(values.notes, responseId) ?
      values.notes[responseId] :
      row.discussionNotes || '';

    const hasPendingNotes = Object.prototype.hasOwnProperty.call(values.pendingNotes, responseId);
    const isDirty = codeValue !== persistedDiscussionCode(row) ||
      score !== (row.discussionScore ?? null) ||
      notes !== (row.discussionNotes || '') ||
      hasPendingNotes ||
      !!values.saving[responseId] ||
      !!values.errors[responseId];
    if (!isDirty) {
      return null;
    }

    return {
      responseId,
      codeValue,
      score,
      notes: hasPendingNotes ? values.pendingNotes[responseId] : notes
    };
  }
}

function persistedDiscussionCode(row: WithinTrainingComparison): string {
  return row.discussionCode !== null && row.discussionCode !== undefined ?
    mapDiscussionCodeForDisplay(row.discussionCode) :
    '';
}
