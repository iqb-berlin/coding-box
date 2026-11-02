import { DestroyRef, Injectable, inject } from '@angular/core';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { ReplayCodingRecoverySnapshot, ReplayCodingService, SavedCode } from '../../services/replay-coding.service';
import { UnitsReplay } from '../../services/units-replay.service';

export type ReplayRecoveryMode = 'coding' | 'coding-decision';

export interface ReplayRecoveryDraft {
  workspaceId: number;
  codingJobId: number | null;
  mode?: ReplayRecoveryMode;
  currentUnitIndex: number;
  testPerson: string;
  unitId: string;
  page?: string;
  anchor?: string;
  originResponseId: number | null;
  coding: ReplayCodingRecoverySnapshot;
}

export interface ReplayRecoveryContext {
  enabled: boolean;
  workspaceId: number;
  codingJobId: number | null;
  mode: ReplayRecoveryMode;
  unitsData: UnitsReplay | null;
  currentUnitIndex: number;
  testPerson: string;
  unitId: string;
  page?: string;
  anchor?: string;
  originResponseId: number | null;
}

/** Captures and acknowledges unsaved coding drafts; it owns no route or player view. */
@Injectable()
export class ReplayRecoveryService {
  private readonly storage = inject(SessionRecoveryService);
  private readonly coding = inject(ReplayCodingService);
  private generation = 0;
  private destroyed = false;
  readonly key = 'replay-active-coding-state';

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.invalidate();
    });
  }

  invalidate(): void {
    this.generation += 1;
  }

  capture(context: ReplayRecoveryContext): ReplayRecoveryDraft | null {
    if (!context.enabled || this.destroyed) return null;
    const coding = this.coding.createRecoverySnapshot();
    if (!coding) return null;
    return {
      workspaceId: context.workspaceId,
      codingJobId: context.codingJobId,
      mode: context.mode,
      currentUnitIndex: context.unitsData?.currentUnitIndex ?? context.currentUnitIndex,
      testPerson: context.testPerson,
      unitId: context.unitId,
      page: context.page,
      anchor: context.anchor,
      originResponseId: context.originResponseId,
      coding
    };
  }

  async restore(
    context: ReplayRecoveryContext,
    applyLocation: (draft: ReplayRecoveryDraft) => UnitsReplay | null
  ): Promise<boolean> {
    if (!context.enabled || this.destroyed) return false;
    const draft = this.storage.peekDraft<ReplayRecoveryDraft>(this.key);
    if (!draft || !this.matches(draft, context)) return false;
    const generation = this.generation;
    const units = applyLocation(draft);
    if (!this.coding.restoreRecoverySnapshot(draft.coding)) return false;
    if (context.mode === 'coding-decision') {
      const notified = this.notifyDecisionReplayRecovery(draft);
      if (notified) this.clearAcceptedDraft(draft);
      return notified;
    }
    try {
      const saved = await this.coding.saveRecoveredCodingState(context.workspaceId, units);
      if (this.destroyed || generation !== this.generation || !saved) return false;
      this.clearAcceptedDraft(draft);
      return true;
    } catch {
      // The existing draft remains available. Do not overwrite one captured during the save.
      return false;
    }
  }

  private clearAcceptedDraft(draft: ReplayRecoveryDraft): void {
    if (JSON.stringify(this.storage.peekDraft(this.key)) === JSON.stringify(draft)) {
      this.storage.clearDraft(this.key);
    }
  }

  private matches(draft: ReplayRecoveryDraft, context: ReplayRecoveryContext): boolean {
    if (draft.workspaceId && draft.workspaceId !== context.workspaceId) return false;
    const mode = draft.mode ?? 'coding';
    if (mode !== context.mode) return false;
    if (mode === 'coding-decision') {
      return !!draft.originResponseId && draft.originResponseId === context.originResponseId;
    }
    const job = context.codingJobId || context.unitsData?.id || null;
    return !draft.codingJobId || (!!job && draft.codingJobId === job);
  }

  private notifyDecisionReplayRecovery(draft: ReplayRecoveryDraft): boolean {
    if (!window.opener || !draft.originResponseId) {
      return false;
    }

    const selectedCodes = this.getEffectiveRecoverySelectedCodes(draft.coding);
    const notesByCompositeKey = new Map(draft.coding.notes || []);
    let notified = false;

    selectedCodes.forEach((selectedCode, compositeKey) => {
      const keyParts = this.parseRecoveryCompositeKey(compositeKey);
      if (!keyParts) {
        return;
      }

      const notes = notesByCompositeKey.get(compositeKey) || '';
      window.opener.postMessage({
        type: 'replayCodeSelected',
        testPerson: keyParts.testPerson,
        unitId: keyParts.unitId,
        variableId: keyParts.variableId,
        code: selectedCode.code ?? String(selectedCode.id),
        score: selectedCode.score ?? null,
        notes,
        responseId: draft.originResponseId
      }, '*');
      notesByCompositeKey.delete(compositeKey);
      notified = true;
    });

    notesByCompositeKey.forEach((notes, compositeKey) => {
      const keyParts = this.parseRecoveryCompositeKey(compositeKey);
      if (!keyParts) {
        return;
      }

      window.opener.postMessage({
        type: 'replayNotesCommitted',
        testPerson: keyParts.testPerson,
        unitId: keyParts.unitId,
        variableId: keyParts.variableId,
        notes,
        responseId: draft.originResponseId
      }, '*');
      notified = true;
    });

    return notified;
  }

  private getEffectiveRecoverySelectedCodes(snapshot: ReplayCodingRecoverySnapshot): Map<string, SavedCode> {
    const selectedCodes = new Map<string, SavedCode>(snapshot.selectedCodes || []);
    (snapshot.pendingSelections || []).forEach(([compositeKey, selectedCode]) => {
      if (selectedCode === null) {
        selectedCodes.delete(compositeKey);
      } else {
        selectedCodes.set(compositeKey, selectedCode);
      }
    });
    return selectedCodes;
  }

  private parseRecoveryCompositeKey(compositeKey: string): { testPerson: string; unitId: string; variableId: string } | null {
    const parts = compositeKey.split('::');
    if (parts.length < 4) {
      return null;
    }

    return {
      testPerson: parts[0],
      unitId: parts[2],
      variableId: parts[3]
    };
  }
}
