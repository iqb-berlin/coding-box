import { inject, Injectable } from '@angular/core';
import { filter, map, Observable } from 'rxjs';
import { PostMessageService } from '../../../core/services/post-message.service';
import {
  ReplayCodeSelectedMessage,
  ReplayDecisionSelection
} from './double-coded-review.models';

export type ReplayDecisionBridgeEvent =
  | { kind: 'selection'; selection: ReplayDecisionSelection }
  | { kind: 'invalid' };

@Injectable()
export class ReplayDecisionBridgeService {
  private readonly postMessageService = inject(PostMessageService);

  readonly replayWindowByResponseId = new Map<number, MessageEventSource>();

  readonly events$: Observable<ReplayDecisionBridgeEvent> =
    this.postMessageService
      .getMessages<ReplayCodeSelectedMessage>('replayCodeSelected')
      .pipe(
        map(event => this.accept(event.message, event.source, event.origin)),
        filter((event): event is ReplayDecisionBridgeEvent => event !== null)
      );

  registerReplayWindow(
    responseId: number,
    replayWindow: MessageEventSource
  ): void {
    this.replayWindowByResponseId.set(responseId, replayWindow);
  }

  accept(
    message: ReplayCodeSelectedMessage,
    source: MessageEventSource | null,
    origin: string = window.location.origin
  ): ReplayDecisionBridgeEvent | null {
    if (!this.isAllowedSource(message, source, origin)) {
      return null;
    }

    const code = this.parseFiniteNumber(message.code);
    const score = this.parseScore(
      message.score,
      Object.prototype.hasOwnProperty.call(message, 'score')
    );
    if (code === null || !score.valid) {
      return { kind: 'invalid' };
    }

    return {
      kind: 'selection',
      selection: {
        responseId: message.responseId!,
        variableId: this.normalizeText(message.variableId).toLowerCase(),
        code,
        score: score.value,
        hasScore: score.hasScore,
        notes: this.normalizeText(message.notes),
        hasNotes: Object.prototype.hasOwnProperty.call(message, 'notes')
      }
    };
  }

  private isAllowedSource(
    message: ReplayCodeSelectedMessage,
    source: MessageEventSource | null,
    origin: string
  ): boolean {
    return !!(
      message.responseId &&
      source &&
      origin === window.location.origin &&
      this.replayWindowByResponseId.get(message.responseId) === source
    );
  }

  private parseFiniteNumber(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return null;
    }
    if (String(value).trim() === '') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseScore(
    value: unknown,
    hasScore: boolean
  ):
    | { valid: true; hasScore: boolean; value: number | null }
    | { valid: false } {
    if (!hasScore) {
      return { valid: true, hasScore: false, value: null };
    }
    if (value === null) {
      return { valid: true, hasScore: true, value: null };
    }
    const parsed = this.parseFiniteNumber(value);
    return parsed === null ?
      { valid: false } :
      { valid: true, hasScore: true, value: parsed };
  }

  private normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
