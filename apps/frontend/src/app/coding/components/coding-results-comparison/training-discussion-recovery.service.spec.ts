import { TestBed } from '@angular/core/testing';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { DiscussionDraftValues, TrainingDiscussionRecovery, TrainingDiscussionRecoveryDraft } from './training-discussion-recovery.service';
import { WithinTrainingComparison } from './comparison-view.models';

describe('TrainingDiscussionRecovery', () => {
  let recovery: TrainingDiscussionRecovery;
  let saved: TrainingDiscussionRecoveryDraft | null;
  const row: WithinTrainingComparison = {
    responseId: 1, unitName: 'UNIT', variableId: 'V', discussionCode: 1, discussionScore: 2, discussionNotes: 'saved', coders: []
  };
  const empty: DiscussionDraftValues = {
    codes: {}, scores: {}, notes: {}, pendingNotes: {}, saving: {}, errors: {}
  };

  beforeEach(() => {
    saved = null;
    TestBed.configureTestingModule({
      providers: [TrainingDiscussionRecovery, {
        provide: SessionRecoveryService,
        useValue: {
          peekDraft: () => saved,
          saveDraft: (_key: string, draft: TrainingDiscussionRecoveryDraft) => { saved = draft; },
          clearDraft: () => { saved = null; }
        }
      }]
    });
    recovery = TestBed.inject(TrainingDiscussionRecovery);
  });

  it('captures pending notes and explicit null scores without losing blank edits', () => {
    expect(recovery.capture(5, 7, [row], empty)).toBeNull();
    const draft = recovery.capture(5, 7, [row], {
      ...empty, codes: { 1: '' }, scores: { 1: null }, pendingNotes: { 1: 'latest' }
    });
    expect(draft?.entries).toEqual([{
      responseId: 1, codeValue: '', score: null, notes: 'latest'
    }]);
  });

  it('does not invent edits for persisted uncertain codes', () => {
    expect(recovery.capture(5, 7, [{ ...row, discussionCode: -1 }], { ...empty, codes: { 1: '' } })).toBeNull();
  });

  it.each(['saving', 'errors'] as const)('retains an otherwise unchanged entry while %s', field => {
    const values = field === 'saving' ? { ...empty, saving: { 1: true } } : { ...empty, errors: { 1: 'offline' } };
    expect(recovery.capture(5, 7, [row], values)?.entries).toHaveLength(1);
  });

  it('merges pages, replaces newer entries and clears only the accepted response in the same context', () => {
    const entry = {
      responseId: 1, codeValue: '1', score: 2, notes: 'old'
    };
    recovery.save({ workspaceId: 5, trainingId: 7, entries: [entry] });
    recovery.save({ workspaceId: 5, trainingId: 7, entries: [{ ...entry, notes: 'new' }, { ...entry, responseId: 2 }] });
    expect(recovery.peek()?.entries.map(value => value.notes)).toEqual(['new', 'old']);
    recovery.clearEntry(1, 6, 7);
    expect(recovery.peek()?.entries).toHaveLength(2);
    recovery.clearEntry(1, 5, 7);
    expect(recovery.peek()?.entries.map(value => value.responseId)).toEqual([2]);
    recovery.clearEntry(2, 5, 7);
    expect(recovery.peek()).toBeNull();
  });

  it('replaces drafts from other trainings or workspaces', () => {
    const entry = {
      responseId: 1, codeValue: '1', score: 2, notes: ''
    };
    recovery.save({ workspaceId: 5, trainingId: 7, entries: [entry] });
    recovery.save({ workspaceId: 5, trainingId: 8, entries: [{ ...entry, responseId: 2 }] });
    expect(recovery.peek()?.entries.map(value => value.responseId)).toEqual([2]);
    recovery.save({ workspaceId: 6, trainingId: 8, entries: [entry] });
    expect(recovery.peek()?.entries.map(value => value.responseId)).toEqual([1]);
  });
});
