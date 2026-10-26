import { DestroyRef, inject, Injectable } from '@angular/core';
import { filter } from 'rxjs';
import { PostMessage, PostMessageEvent, PostMessageService } from '../../../core/services/post-message.service';

interface ReplayResponseMessage extends PostMessage {
  testPerson: string;
  unitId: string;
  variableId: string;
  responseId: number;
  notes?: string | null;
}

export interface ReplayCodeSelectedMessage extends ReplayResponseMessage {
  type: 'replayCodeSelected';
  code: string;
  score?: number | null;
}

export interface ReplayNotesCommittedMessage extends ReplayResponseMessage {
  type: 'replayNotesCommitted';
}

type TrainingReplayMessage = ReplayCodeSelectedMessage | ReplayNotesCommittedMessage;

/** Only a window opened for this editing context may update its registered response. */
@Injectable()
export class TrainingReplayBridge {
  private readonly messages = inject(PostMessageService);
  private readonly windows = new Map<number, { source: Window; variableId: string }>();

  readonly messages$ = this.messages.messages$.pipe(
    filter((event): event is PostMessageEvent<TrainingReplayMessage> => this.accepts(event))
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.reset());
  }

  register(responseId: number, variableId: string, source: Window): void {
    this.windows.set(responseId, { source, variableId: variableId.toLowerCase() });
  }

  reset(): void {
    this.windows.clear();
  }

  private accepts(event: PostMessageEvent): boolean {
    if (event.origin !== window.location.origin || !event.source) return false;
    const value = event.message as unknown as Record<string, unknown>;
    if (value.type !== 'replayCodeSelected' && value.type !== 'replayNotesCommitted') return false;
    if (typeof value.responseId !== 'number' || !Number.isSafeInteger(value.responseId) || value.responseId <= 0 ||
      typeof value.variableId !== 'string' || typeof value.unitId !== 'string' || typeof value.testPerson !== 'string') return false;
    const registered = this.windows.get(value.responseId);
    if (!registered || registered.source !== event.source || registered.variableId !== value.variableId.toLowerCase()) return false;
    if (value.notes !== undefined && value.notes !== null && typeof value.notes !== 'string') return false;
    if (value.type === 'replayNotesCommitted') return true;
    return typeof value.code === 'string' && /^-?\d+$/.test(value.code) && Number.isSafeInteger(Number(value.code)) &&
      (value.score === undefined || value.score === null || (typeof value.score === 'number' && Number.isFinite(value.score)));
  }
}
