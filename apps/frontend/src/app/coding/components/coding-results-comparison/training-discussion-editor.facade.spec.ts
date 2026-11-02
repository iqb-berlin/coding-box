import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { AuthRefreshUnavailableError } from '../../../core/interceptors/auth-refresh-unavailable.error';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { WithinTrainingComparison } from './comparison-view.models';
import { TrainingDiscussionRecovery, TrainingDiscussionRecoveryDraft } from './training-discussion-recovery.service';
import { DiscussionEditContext, TrainingDiscussionEditorFacade } from './training-discussion-editor.facade';

describe('TrainingDiscussionEditorFacade', () => {
  let editor: TrainingDiscussionEditorFacade;
  let save: jest.Mock;
  let feedback: jest.Mock;
  let row: WithinTrainingComparison;
  let draft: TrainingDiscussionRecoveryDraft | null;
  let generation: number;
  let canEdit: boolean;
  const result = {
    success: true,
    code: 1,
    score: 2,
    notes: null as string | null,
    source: 'manual' as const,
    managerUserId: 4,
    managerName: 'Discussion manager'
  };
  const context = (): DiscussionEditContext => {
    const currentGeneration = generation;
    return {
      workspaceId: 5,
      trainingId: 7,
      canEdit: () => canEdit,
      isCurrent: () => generation === currentGeneration,
      rows: () => [row]
    };
  };

  beforeEach(() => {
    generation = 0;
    canEdit = true;
    draft = null;
    row = {
      responseId: 501,
      unitName: 'UNIT',
      variableId: 'VAR',
      discussionCode: null,
      discussionScore: null,
      discussionNotes: null,
      coders: [{
        jobId: 11, coderName: 'Coder', code: '1', score: 2
      }]
    };
    save = jest.fn().mockReturnValue(of(result));
    feedback = jest.fn();
    TestBed.configureTestingModule({
      providers: [TrainingDiscussionEditorFacade, TrainingDiscussionRecovery,
        { provide: CodingTrainingBackendService, useValue: { saveDiscussionResult: save } },
        { provide: AppService, useValue: { needsReAuthentication: false } },
        { provide: MatSnackBar, useValue: { open: feedback } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
        {
          provide: SessionRecoveryService,
          useValue: {
            peekDraft: () => draft,
            saveDraft: (_key: string, value: TrainingDiscussionRecoveryDraft) => { draft = value; },
            clearDraft: () => { draft = null; }
          }
        }]
    });
    editor = TestBed.inject(TrainingDiscussionEditorFacade);
    editor.initialize([row]);
  });

  it('initializes persisted values without inventing a discussion from replay codes', () => {
    editor.setManagerLabel('Current manager');
    editor.initialize([{ ...row, replayCode: 1, replayScore: 2 }]);
    expect(editor.codes()[501]).toBe('');
    expect(editor.scores()[501]).toBeNull();
    expect(editor.managerLabel()).toBe('Current manager');
    editor.initialize([{
      ...row, discussionCode: 1, discussionScore: null, discussionNotes: 'saved', discussionManagerName: 'Saved manager'
    }]);
    expect(editor.codes()[501]).toBe('1');
    expect(editor.scores()[501]).toBe(2);
    expect(editor.notes()[501]).toBe('saved');
    expect(editor.managerLabel()).toBe('Saved manager');
  });

  it('derives the score while typing and rejects a non-integer code before writing', () => {
    editor.patchDraft(501, { error: 'old failure' });
    editor.inputCode(row, '1');
    expect(editor.scores()[501]).toBe(2);
    expect(editor.errors()[501]).toBe('');
    editor.inputCode(row, '1.5');
    editor.save(row, context());
    expect(save).not.toHaveBeenCalled();
    expect(editor.errors()[501]).toBe('coding.trainings.compare.discussion-integer-required');
    editor.inputCode(row, '');
    expect(editor.scores()[501]).toBeNull();
  });

  it('clears only the accepted recovery entry when unchanged values need no write', () => {
    row.discussionCode = 1;
    row.discussionScore = 2;
    row.discussionNotes = 'saved';
    editor.initialize([row]);
    editor.inputNotes(row, '  saved  ');
    draft = {
      workspaceId: 5,
      trainingId: 7,
      entries: [501, 999].map(responseId => ({
        responseId, codeValue: '1', score: 2, notes: 'saved'
      }))
    };
    editor.save(row, context());
    expect(save).not.toHaveBeenCalled();
    expect(editor.notes()[501]).toBe('saved');
    expect(draft?.entries.map(entry => entry.responseId)).toEqual([999]);
  });

  it.each([null, 4])('forwards an explicit replay score %s and trims notes', score => {
    save.mockReturnValue(of({ ...result, score, notes: 'replay' }));
    editor.selectReplayCode(row, { code: '1', score, notes: '  replay  ' }, context());
    expect(save).toHaveBeenCalledWith(5, 7, 501, 1, score, 'replay');
    expect(editor.scores()[501]).toBe(score);
    expect(row.discussionSource).toBe('manual');
    expect(editor.managerLabel()).toBe('Discussion manager');
    expect(editor.saving()[501]).toBe(false);
  });

  it('queues only the latest replay notes until the active code save returns', () => {
    const codeSave = new Subject<typeof result>();
    const notesSave = new Subject<typeof result>();
    save.mockReturnValueOnce(codeSave).mockReturnValueOnce(notesSave);
    const owner = context();
    editor.selectReplayCode(row, { code: '1', score: 4 }, owner);
    editor.commitReplayNotes(row, 'earlier note', owner);
    editor.commitReplayNotes(row, 'latest note', owner);
    expect(save).toHaveBeenCalledTimes(1);
    expect(editor.notes()[501]).toBe('latest note');
    codeSave.next({ ...result, score: 4 });
    expect(save).toHaveBeenLastCalledWith(5, 7, 501, 1, 4, 'latest note');
    expect(editor.notes()[501]).toBe('latest note');
    expect(editor.saving()[501]).toBe(true);
    notesSave.next({ ...result, score: 4, notes: 'latest note' });
    expect(editor.saving()[501]).toBe(false);
    expect(row.discussionNotes).toBe('latest note');
  });

  it('keeps notes without writing when no discussion code is selected', () => {
    editor.commitReplayNotes(row, 'note only', context());
    expect(editor.notes()[501]).toBe('note only');
    expect(save).not.toHaveBeenCalled();
  });

  it('retains the edited fields after a failed save and supports retry', () => {
    save.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'Unsupported code for variable' } })));
    editor.inputCode(row, '999');
    editor.inputNotes(row, 'edited note');
    editor.save(row, context());
    expect(editor.codes()[501]).toBe('999');
    expect(editor.notes()[501]).toBe('edited note');
    expect(editor.errors()[501]).toBe('coding.trainings.compare.discussion-code-unknown');
    expect(editor.saving()[501]).toBe(false);
    editor.inputCode(row, '1');
    editor.save(row, context());
    expect(save).toHaveBeenCalledTimes(2);
    expect(editor.errors()[501]).toBe('');
  });

  it.each([new AuthRefreshUnavailableError(), new HttpErrorResponse({ status: 401 })])('captures queued notes for recovery after %s', error => {
    const pending = new Subject<typeof result>();
    save.mockReturnValue(pending);
    editor.selectReplayCode(row, { code: '1', score: 4 }, context());
    editor.commitReplayNotes(row, 'recover this note', context());
    pending.error(error);
    expect(editor.saving()[501]).toBe(false);
    expect(editor.errors()[501]).not.toBe('');
    expect(draft).toEqual({
      workspaceId: 5,
      trainingId: 7,
      entries: [{
        responseId: 501, codeValue: '1', score: 4, notes: 'recover this note'
      }]
    });
  });

  it('restores the current page with an explicit score and preserves another page in recovery', () => {
    draft = {
      workspaceId: 5,
      trainingId: 7,
      entries: [501, 999].map(responseId => ({
        responseId, codeValue: '1', score: 4, notes: 'recovered'
      }))
    };
    expect(editor.restore(6, 7, [row], context())).toBe(false);
    expect(save).not.toHaveBeenCalled();
    save.mockReturnValue(of({ ...result, score: 4, notes: 'recovered' }));
    expect(editor.restore(5, 7, [row], context())).toBe(true);
    expect(save).toHaveBeenCalledWith(5, 7, 501, 1, 4, 'recovered');
    expect(draft?.entries.map(entry => entry.responseId)).toEqual([999]);
  });

  it.each(['success', 'error'])('ignores an old %s after returning to the same training in a new context', outcome => {
    const pending = new Subject<typeof result>();
    save.mockReturnValue(pending);
    editor.inputCode(row, '1');
    editor.save(row, context());
    generation += 2;
    editor.resetPending();
    editor.patchDraft(501, { codeValue: '9', notes: 'current draft' });
    if (outcome === 'success') pending.next(result);
    else pending.error(new Error('late failure'));
    expect(editor.codes()[501]).toBe('9');
    expect(editor.notes()[501]).toBe('current draft');
    expect(editor.saving()).toEqual({});
    expect(feedback).not.toHaveBeenCalled();
  });

  it('checks current editing permission before writing and before a queued follow-up', () => {
    editor.inputCode(row, '1');
    canEdit = false;
    editor.save(row, context());
    expect(save).not.toHaveBeenCalled();
    canEdit = true;
    const pending = new Subject<typeof result>();
    save.mockReturnValue(pending);
    const owner = context();
    editor.save(row, owner);
    editor.commitReplayNotes(row, 'latest', owner);
    canEdit = false;
    pending.next(result);
    expect(save).toHaveBeenCalledTimes(1);
    expect(editor.notes()[501]).toBe('latest');
  });

  it.each(['stop', 'destroy'])('cancels pending writes on %s and releases saving state', reason => {
    const pending = new Subject<typeof result>();
    save.mockReturnValue(pending);
    editor.inputCode(row, '1');
    editor.save(row, context());
    expect(pending.observed).toBe(true);
    if (reason === 'stop') editor.stop();
    else TestBed.resetTestingModule();
    expect(pending.observed).toBe(false);
    expect(editor.saving()).toEqual({});
    pending.next(result);
    expect(row.discussionCode).toBeNull();
  });
});
