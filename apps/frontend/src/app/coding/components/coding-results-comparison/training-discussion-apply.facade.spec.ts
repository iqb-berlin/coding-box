import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import {
  ApplyTrainingDiscussionResultsResultDto, TrainingDiscussionApplyPreviewDto
} from '../../../../../../../api-dto/coding/training-discussion-apply.dto';
import { DiscussionApplyContext, TrainingDiscussionApplyFacade } from './training-discussion-apply.facade';

describe('TrainingDiscussionApplyFacade', () => {
  let facade: TrainingDiscussionApplyFacade;
  let backend: jest.Mocked<Pick<CodingTrainingBackendService, 'previewApplyDiscussionResults' | 'applyDiscussionResults'>>;
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };
  let coding: { notifyTestResultsChanged: jest.Mock };
  let context: DiscussionApplyContext;
  const preview: TrainingDiscussionApplyPreviewDto = {
    trainingId: 5,
    source: 'manual',
    totalTrainingResponses: 3,
    sourceResultsCount: 3,
    applicableResultsCount: 3,
    missingResultsCount: 0,
    missingScoreCount: 0,
    existingFinalResultsCount: 0,
    productiveJobConflictCount: 0,
    removableProductiveJobUnitCount: 0,
    blockingProductiveJobUnitCount: 0,
    approvedJobDefinitionConflictCount: 0,
    staleTrainingJobCount: 0,
    affectedJobIds: [],
    affectedJobDefinitionIds: [],
    canApply: true
  };
  const result: ApplyTrainingDiscussionResultsResultDto = {
    ...preview,
    success: true,
    updatedResponsesCount: 1,
    skippedExistingResultsCount: 0,
    overwrittenExistingResultsCount: 0,
    skippedJobConflictCount: 0,
    skippedMissingScoreCount: 0,
    removedJobUnitCount: 0,
    messageKey: 'success'
  };

  beforeEach(() => {
    backend = {
      previewApplyDiscussionResults: jest.fn().mockReturnValue(of(preview)),
      applyDiscussionResults: jest.fn().mockReturnValue(of(result))
    };
    dialog = { open: jest.fn().mockReturnValue({ afterClosed: () => of({ existingResultStrategy: 'overwrite', jobConflictStrategy: 'removeFromJobs' }) }) };
    snackBar = { open: jest.fn() };
    coding = { notifyTestResultsChanged: jest.fn() };
    context = {
      workspaceId: 7, trainingId: 5, canApply: () => true, isCurrent: () => true, reload: jest.fn()
    };
    TestBed.configureTestingModule({
      providers: [
        TrainingDiscussionApplyFacade,
        { provide: CodingTrainingBackendService, useValue: backend },
        { provide: TestPersonCodingService, useValue: coding },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: TranslateService, useValue: { instant: (key: string) => key } }
      ]
    });
    facade = TestBed.inject(TrainingDiscussionApplyFacade);
  });

  it('applies the confirmed policy to the captured workspace and refreshes results', () => {
    facade.open('manual', context);
    expect(backend.applyDiscussionResults).toHaveBeenCalledWith(7, 5, {
      source: 'manual', existingResultStrategy: 'overwrite', jobConflictStrategy: 'removeFromJobs'
    });
    expect(coding.notifyTestResultsChanged).toHaveBeenCalledWith({ workspaceId: 7, statisticsVersion: 'v2' });
    expect(context.reload).toHaveBeenCalledTimes(1);
    expect(facade.isApplyingDiscussionResults()).toBe(false);
  });

  it('does not start a preview without permission', () => {
    context.canApply = () => false;
    facade.open('manual', context);
    expect(backend.previewApplyDiscussionResults).not.toHaveBeenCalled();
  });

  it('does not apply a cancelled confirmation', () => {
    dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
    facade.open('manual', context);
    expect(backend.applyDiscussionResults).not.toHaveBeenCalled();
  });

  it('rechecks permission after confirmation', () => {
    const closed = new Subject<{ existingResultStrategy: string; jobConflictStrategy: string }>();
    dialog.open.mockReturnValue({ afterClosed: () => closed });
    facade.open('manual', context);
    context.canApply = () => false;
    closed.next({ existingResultStrategy: 'overwrite', jobConflictStrategy: 'removeFromJobs' });
    expect(backend.applyDiscussionResults).not.toHaveBeenCalled();
  });

  it('ignores a preview that arrives after the training context changes', () => {
    const delayed = new Subject<TrainingDiscussionApplyPreviewDto>();
    backend.previewApplyDiscussionResults.mockReturnValue(delayed);
    facade.open('manual', context);
    expect(facade.isApplyingDiscussionResults()).toBe(true);
    context.isCurrent = () => false;
    delayed.next(preview);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(facade.isApplyingDiscussionResults()).toBe(false);
  });

  it('ignores a saved result after its context has been left', () => {
    const delayed = new Subject<ApplyTrainingDiscussionResultsResultDto>();
    backend.applyDiscussionResults.mockReturnValue(delayed);
    facade.open('manual', context);
    context.isCurrent = () => false;
    delayed.next(result);
    expect(context.reload).not.toHaveBeenCalled();
    expect(coding.notifyTestResultsChanged).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('does not let an older preview clear the busy state of a newer operation', () => {
    const previous = new Subject<TrainingDiscussionApplyPreviewDto>();
    const current = new Subject<TrainingDiscussionApplyPreviewDto>();
    backend.previewApplyDiscussionResults.mockReturnValueOnce(previous).mockReturnValueOnce(current);
    dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
    facade.open('manual', context);
    facade.open('manual', { ...context, trainingId: 6 });
    previous.next(preview);
    expect(facade.isApplyingDiscussionResults()).toBe(true);
    expect(dialog.open).not.toHaveBeenCalled();
    current.next({ ...preview, trainingId: 6 });
    expect(facade.isApplyingDiscussionResults()).toBe(false);
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it.each(['preview', 'apply'])('reports a failed %s and releases the busy state', stage => {
    const failure = throwError(() => new HttpErrorResponse({ status: 409, error: { message: ['Conflict', 'Retry'] } }));
    if (stage === 'preview') backend.previewApplyDiscussionResults.mockReturnValue(failure);
    else backend.applyDiscussionResults.mockReturnValue(failure);
    facade.open('manual', context);
    expect(snackBar.open.mock.calls.at(-1)?.[0]).toBe('Conflict Retry');
    expect(facade.isApplyingDiscussionResults()).toBe(false);
    expect(context.reload).not.toHaveBeenCalled();
  });

  it('cancels requests when its owning injector is destroyed', () => {
    const delayed = new Subject<TrainingDiscussionApplyPreviewDto>();
    backend.previewApplyDiscussionResults.mockReturnValue(delayed);
    facade.open('manual', context);
    expect(delayed.observed).toBe(true);
    TestBed.resetTestingModule();
    expect(delayed.observed).toBe(false);
    delayed.next(preview);
    expect(dialog.open).not.toHaveBeenCalled();
  });
});
