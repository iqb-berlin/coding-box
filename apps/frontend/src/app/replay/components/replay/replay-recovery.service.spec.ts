import { TestBed } from '@angular/core/testing';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { ReplayCodingRecoverySnapshot, ReplayCodingService } from '../../services/replay-coding.service';
import { ReplayRecoveryContext, ReplayRecoveryService } from './replay-recovery.service';

describe('Replay draft acknowledgement', () => {
  let recovery: ReplayRecoveryService;
  let storage: SessionRecoveryService;
  let finishSave: (saved: boolean) => void;
  let failSave: (error: Error) => void;
  let coding: { createRecoverySnapshot: jest.Mock; restoreRecoverySnapshot: jest.Mock; saveRecoveredCodingState: jest.Mock };
  const snapshot: ReplayCodingRecoverySnapshot = {
    codingJobId: 77,
    currentVariableId: 'VAR',
    selectedCodes: [],
    pendingSelections: [],
    openUnitKeys: [],
    notes: [['person@code@booklet::booklet::UNIT::VAR', 'unsaved']],
    codingJobComment: ''
  };
  const context: ReplayRecoveryContext = {
    enabled: true,
    workspaceId: 5,
    codingJobId: 77,
    mode: 'coding',
    unitsData: null,
    currentUnitIndex: 0,
    testPerson: 'person@code@booklet',
    unitId: 'UNIT',
    originResponseId: null
  };

  beforeEach(() => {
    sessionStorage.clear();
    coding = {
      createRecoverySnapshot: jest.fn(() => snapshot),
      restoreRecoverySnapshot: jest.fn(() => true),
      saveRecoveredCodingState: jest.fn(() => new Promise<boolean>((resolve, reject) => { finishSave = resolve; failSave = reject; }))
    };
    TestBed.configureTestingModule({ providers: [ReplayRecoveryService, { provide: ReplayCodingService, useValue: coding }] });
    recovery = TestBed.inject(ReplayRecoveryService);
    storage = TestBed.inject(SessionRecoveryService);
    storage.saveDraft(recovery.key, recovery.capture(context));
  });

  afterEach(() => sessionStorage.clear());

  it('clears an accepted draft only after its recovered changes have been saved', async () => {
    const pending = recovery.restore(context, () => null);
    expect(storage.peekDraft(recovery.key)).not.toBeNull();
    finishSave(true);
    expect(await pending).toBe(true);
    expect(storage.peekDraft(recovery.key)).toBeNull();
  });

  it.each(['failure', 'rejected-save'])('retains the draft after %s', async action => {
    const draft = storage.peekDraft(recovery.key);
    const pending = recovery.restore(context, () => null);
    if (action === 'failure') failSave(new Error('unavailable'));
    else finishSave(false);
    expect(await pending).toBe(false);
    expect(storage.peekDraft(recovery.key)).toEqual(draft);
  });

  it.each(['workspace', 'destroy'])('does not acknowledge a late save after %s invalidation', async action => {
    const draft = storage.peekDraft(recovery.key);
    const pending = recovery.restore(context, () => null);
    if (action === 'workspace') { recovery.invalidate(); recovery.invalidate(); } else TestBed.resetTestingModule();
    finishSave(true);
    expect(await pending).toBe(false);
    expect(storage.peekDraft(recovery.key)).toEqual(draft);
  });

  it.each([true, false])('preserves a newer captured draft when the old save returns %s', async saved => {
    const pending = recovery.restore(context, () => null);
    const newer = { ...recovery.capture(context), unitId: 'NEW' };
    storage.saveDraft(recovery.key, newer);
    finishSave(saved);
    await pending;
    expect(storage.peekDraft(recovery.key)).toEqual(newer);
  });

  it.each([
    { workspaceId: 6 }, { codingJobId: 88 }, { enabled: false },
    { mode: 'coding-decision' as const, originResponseId: 12 }
  ])('keeps drafts for a different or unavailable context: %j', async change => {
    const apply = jest.fn();
    expect(await recovery.restore({ ...context, ...change }, apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(coding.restoreRecoverySnapshot).not.toHaveBeenCalled();
    expect(storage.peekDraft(recovery.key)).not.toBeNull();
  });
});
