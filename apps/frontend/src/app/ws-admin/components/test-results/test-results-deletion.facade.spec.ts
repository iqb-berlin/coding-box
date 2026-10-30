import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  BehaviorSubject, NEVER, Subject, of, throwError
} from 'rxjs';
import de from '../../../../assets/i18n/de.json';
import { TestResultsDeletePreviewDto, TestResultsDeleteRequestDto } from '../../../../../../../api-dto/test-results/test-results-deletion.dto';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { UnitService } from '../../../shared/services/unit/unit.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { TestPersonCodingService } from '../../../coding/services/test-person-coding.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import { TestResultsDeletionFacade } from './test-results-deletion.facade';
import { Response, Unit } from './test-results.models';

@Component({ template: '{{deletion.deleteProgressMessage()}}', providers: [TestResultsDeletionFacade] })
class DeletionHost { readonly deletion = inject(TestResultsDeletionFacade); }
const request: TestResultsDeleteRequestDto = { scope: 'persons', personIds: [2] };
const preview: TestResultsDeletePreviewDto = {
  scope: 'persons', label: 'Personen', persons: 1, booklets: 1, units: 1, responses: 2, groups: [], bookletNames: [], unitNames: [], warnings: []
};
const task = (status: ValidationTaskDto['status'], progress = 0, id = 17): ValidationTaskDto => ({
  id, workspace_id: 5, validation_type: 'deleteTestResults', status, progress, created_at: new Date(), updated_at: new Date()
});

describe('TestResultsDeletionFacade', () => {
  let fixture: ComponentFixture<DeletionHost>;
  let facade: TestResultsDeletionFacade;
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: BehaviorSubject<number> };
  let results: { previewDeleteTestResults: jest.Mock; previewDeleteTestResultResponses: jest.Mock; createDeleteTestResultsJob: jest.Mock; createDeleteTestResultResponsesJob: jest.Mock; invalidateCache: jest.Mock };
  let validation: { getValidationTask: jest.Mock; getValidationResults: jest.Mock };
  let units: { deleteUnit: jest.Mock };
  let responses: { deleteResponse: jest.Mock };
  let dialog: { open: jest.Mock };
  let ref: { afterClosed: jest.Mock; close: jest.Mock };
  let changed: jest.Mock;
  let cleared: jest.Mock;
  let reset: jest.Mock;
  let notify: jest.Mock;
  let invalidateValidation: jest.Mock;
  let snack: { open: jest.Mock };
  const changeWorkspace = (id: number): void => { app.selectedWorkspaceId = id; app.selectedWorkspaceId$.next(id); };

  beforeEach(() => {
    jest.useFakeTimers();
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new BehaviorSubject(5) };
    results = {
      previewDeleteTestResults: jest.fn().mockReturnValue(of(preview)),
      previewDeleteTestResultResponses: jest.fn().mockReturnValue(of(preview)),
      createDeleteTestResultsJob: jest.fn().mockReturnValue(of(task('pending'))),
      createDeleteTestResultResponsesJob: jest.fn().mockReturnValue(of(task('pending'))),
      invalidateCache: jest.fn()
    };
    validation = { getValidationTask: jest.fn().mockReturnValue(NEVER), getValidationResults: jest.fn().mockReturnValue(of({ ...preview, deletedTargetCount: 1 })) };
    units = { deleteUnit: jest.fn().mockReturnValue(of({ success: true, report: { deletedUnit: 7, warnings: [] } })) };
    responses = { deleteResponse: jest.fn().mockReturnValue(of({ success: true, report: { deletedResponse: 13, warnings: [] } })) };
    ref = { afterClosed: jest.fn().mockReturnValue(of(true)), close: jest.fn() };
    dialog = { open: jest.fn().mockReturnValue(ref) }; snack = { open: jest.fn() };
    notify = jest.fn(); invalidateValidation = jest.fn(); changed = jest.fn(); cleared = jest.fn(); reset = jest.fn();
    TestBed.configureTestingModule({
      imports: [DeletionHost, TranslateModule.forRoot()],
      providers: [
        { provide: AppService, useValue: app }, { provide: TestResultService, useValue: results }, { provide: ValidationService, useValue: validation },
        { provide: UnitService, useValue: units }, { provide: ResponseService, useValue: responses },
        { provide: MatDialog, useValue: dialog }, { provide: MatSnackBar, useValue: snack },
        { provide: TestPersonCodingService, useValue: { notifyTestResultsChanged: notify } },
        { provide: ValidationTaskStateService, useValue: { invalidateWorkspace: invalidateValidation } }
      ]
    });
    const translate = TestBed.inject(TranslateService); translate.setTranslation('de', de); translate.use('de');
    fixture = TestBed.createComponent(DeletionHost); facade = fixture.componentInstance.deletion; fixture.detectChanges();
    facade.changed$.subscribe(changed); facade.selectionCleared$.subscribe(cleared); facade.resetDetails$.subscribe(reset);
  });
  afterEach(() => { fixture.destroy(); jest.useRealTimers(); });

  it('keeps the confirmation exclusive and snapshots the request before previewing', () => {
    const confirmation = new Subject<boolean>(); ref.afterClosed.mockReturnValue(confirmation);
    const selected = { scope: 'persons' as const, personIds: [2] };
    facade.confirmAndStartDelete(selected); selected.personIds.push(99);
    facade.confirmAndStartDelete(request); facade.deleteUnit({ id: 7 } as Unit, { id: 3 });
    expect(results.previewDeleteTestResults).toHaveBeenCalledTimes(1); expect(dialog.open).toHaveBeenCalledTimes(1);
    confirmation.next(true);
    expect(results.createDeleteTestResultsJob).toHaveBeenCalledWith(5, { scope: 'persons', personIds: [2] });
    expect(units.deleteUnit).not.toHaveBeenCalled();
  });

  it.each([false, undefined])('leaves selection and server data untouched after confirmation cancellation (%s)', confirmation => {
    ref.afterClosed.mockReturnValue(of(confirmation)); facade.confirmAndStartDelete(request);
    expect(results.createDeleteTestResultsJob).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled(); expect(cleared).not.toHaveBeenCalled(); expect(facade.isDeleteJobRunning()).toBe(false);
    expect(ref.close).toHaveBeenCalled();
    ref.afterClosed.mockReturnValue(of(true)); facade.confirmAndStartDelete(request);
    expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(1);
  });

  it.each(['null', 'http'] as const)('permits a fresh preview after a %s preview failure', failure => {
    results.previewDeleteTestResults.mockReturnValueOnce(failure === 'null' ? of(null) : throwError(() => new Error('offline')));
    facade.confirmAndStartDelete(request); expect(facade.canRetry()).toBe(true); expect(facade.isDeleteJobRunning()).toBe(false);
    facade.retry(); expect(results.previewDeleteTestResults).toHaveBeenCalledTimes(2);
    expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(1);
  });

  it('requires another preview and confirmation after failure to enqueue a job', () => {
    results.createDeleteTestResultsJob.mockReturnValueOnce(throwError(() => new Error('offline')));
    facade.confirmAndStartDelete(request);
    const confirmation = new Subject<boolean>(); ref.afterClosed.mockReturnValue(confirmation); facade.retry();
    expect(results.previewDeleteTestResults).toHaveBeenCalledTimes(2); expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(1);
    confirmation.next(true); expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(2);
  });

  it('retries the same job after a polling failure without posting a second delete', () => {
    validation.getValidationTask.mockReturnValueOnce(throwError(() => new Error('offline'))).mockReturnValue(of(task('completed', 100)));
    facade.confirmAndStartDelete(request); jest.advanceTimersByTime(0);
    expect(facade.activeDeleteTask()?.id).toBe(17); expect(facade.isDeleteJobRunning()).toBe(true); expect(facade.canRetry()).toBe(true);
    facade.confirmAndStartDelete(request); expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(1);
    facade.retry(); facade.retry(); jest.advanceTimersByTime(0);
    expect(validation.getValidationTask.mock.calls).toEqual([[5, 17], [5, 17]]);
    expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledTimes(1);
    expect(facade.canRetry()).toBe(false); expect(facade.deleteProgress()).toBe(100);
  });

  it.each(['http', 'invalid'] as const)('refreshes committed changes even if its result report is %s, then only reloads that report', failure => {
    validation.getValidationTask.mockReturnValue(of(task('completed', 100)));
    validation.getValidationResults.mockReturnValueOnce(failure === 'http' ? throwError(() => new Error('offline')) : of(null))
      .mockReturnValue(of({ ...preview, deletedTargetCount: 1 }));
    facade.confirmAndStartDelete(request); jest.advanceTimersByTime(0);
    expect(results.invalidateCache).toHaveBeenCalledWith(5); expect(invalidateValidation).toHaveBeenCalledWith(5);
    expect(notify).toHaveBeenCalledWith({ workspaceId: 5 }); expect(changed).toHaveBeenCalledTimes(1); expect(cleared).toHaveBeenCalledTimes(1);
    expect(facade.canRetry()).toBe(true); facade.retry();
    expect(validation.getValidationResults.mock.calls).toEqual([[5, 17], [5, 17]]);
    expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(1); expect(validation.getValidationTask).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1); expect(facade.canRetry()).toBe(false);
  });

  it('refreshes all dependent state after a partially committed job failure and previews the remaining targets for retry', () => {
    validation.getValidationTask.mockReturnValue(of({ ...task('failed', 40), error: 'Stapel 2 fehlgeschlagen' }));
    facade.confirmAndStartDelete(request); jest.advanceTimersByTime(0);
    expect(changed).toHaveBeenCalledWith({ scope: 'workspace' }); expect(cleared).toHaveBeenCalledTimes(1);
    expect(results.invalidateCache).toHaveBeenCalledWith(5); expect(invalidateValidation).toHaveBeenCalledWith(5);
    expect(notify).toHaveBeenCalledWith({ workspaceId: 5 }); expect(validation.getValidationResults).not.toHaveBeenCalled();
    expect(facade.deleteProgressMessage()).toContain('Teilschritte'); expect(facade.deleteProgressMessage()).toContain('Stapel 2');
    const confirmation = new Subject<boolean>(); ref.afterClosed.mockReturnValue(confirmation); facade.retry();
    expect(results.previewDeleteTestResults).toHaveBeenCalledTimes(2); expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(1);
    confirmation.next(false); expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(1);
  });

  it('shows completion warnings rather than reporting an unconditional clean success', () => {
    validation.getValidationTask.mockReturnValue(of(task('completed', 100)));
    validation.getValidationResults.mockReturnValue(of({ ...preview, deletedTargetCount: 1, warnings: ['Nicht alle Ressourcen bereinigt'] }));
    facade.confirmAndStartDelete(request); jest.advanceTimersByTime(0);
    expect(snack.open).toHaveBeenLastCalledWith(expect.stringContaining('Nicht alle Ressourcen bereinigt'), 'OK', expect.anything());
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('uses the response cleanup endpoints throughout preview, confirmation, and completion', () => {
    const cleanup = { unitNames: ['U1'], variableIds: ['V1'], answeredBefore: 1000 };
    validation.getValidationTask.mockReturnValue(of(task('completed', 100)));
    facade.confirmAndStartResponseCleanup(cleanup); jest.advanceTimersByTime(0);
    expect(results.previewDeleteTestResultResponses).toHaveBeenCalledWith(5, cleanup);
    expect(results.createDeleteTestResultResponsesJob).toHaveBeenCalledWith(5, cleanup);
    expect(results.createDeleteTestResultsJob).not.toHaveBeenCalled(); expect(changed).toHaveBeenCalledTimes(1);
  });

  describe.each(['workspace', 'destroy'] as const)('cancellation by %s', cancellation => {
    it.each(['preview', 'confirmation', 'start', 'poll', 'result'] as const)('cancels a pending %s and ignores a late response', stage => {
      const pending = new Subject<unknown>();
      if (stage === 'preview') results.previewDeleteTestResults.mockReturnValue(pending);
      if (stage === 'confirmation') ref.afterClosed.mockReturnValue(pending);
      if (stage === 'start') results.createDeleteTestResultsJob.mockReturnValue(pending);
      if (stage === 'poll') validation.getValidationTask.mockReturnValueOnce(pending).mockReturnValue(NEVER);
      if (stage === 'result') { validation.getValidationTask.mockReturnValue(of(task('completed', 100))); validation.getValidationResults.mockReturnValue(pending); }
      facade.confirmAndStartDelete(request); jest.advanceTimersByTime(0);
      expect(pending.observed).toBe(true);
      const notifications = changed.mock.calls.length; const posts = results.createDeleteTestResultsJob.mock.calls.length;
      if (cancellation === 'workspace') { changeWorkspace(6); changeWorkspace(5); } else fixture.destroy();
      expect(pending.observed).toBe(false);
      const lateValue = {
        confirmation: true, preview, result: { deletedTargetCount: 5 }, start: task('completed', 100), poll: task('completed', 100)
      }[stage];
      pending.next(lateValue); pending.complete();
      jest.advanceTimersByTime(5000);
      expect(changed).toHaveBeenCalledTimes(notifications); expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(posts);
      if (stage === 'confirmation') expect(ref.close).toHaveBeenCalled();
      if (cancellation === 'workspace') {
        expect(facade.isDeleteJobRunning()).toBe(stage === 'poll'); expect(facade.canRetry()).toBe(false); expect(facade.deleteProgress()).toBe(0);
        if (stage !== 'poll') expect(facade.deleteProgressMessage()).toBe('');
      }
    });
  });

  it.each(['workspace', 'destroy'] as const)('closes cleanup options on %s and never previews a late confirmation', cancellation => {
    const pending = new Subject<unknown>(); ref.afterClosed.mockReturnValue(pending);
    facade.openResponseCleanupDialog();
    expect(dialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { workspaceId: 5 } }));
    if (cancellation === 'workspace') { changeWorkspace(6); changeWorkspace(5); } else fixture.destroy();
    expect(pending.observed).toBe(false); expect(ref.close).toHaveBeenCalled();
    pending.next({ unitNames: ['U1'] });
    expect(results.previewDeleteTestResultResponses).not.toHaveBeenCalled();
  });

  it('previews cleanup options only after they are confirmed and uses a separate deletion confirmation', () => {
    const cleanup = { unitNames: ['U1'] };
    ref.afterClosed.mockReturnValueOnce(of(cleanup)).mockReturnValue(of(false)); facade.openResponseCleanupDialog();
    expect(results.previewDeleteTestResultResponses).toHaveBeenCalledWith(5, cleanup);
    expect(results.createDeleteTestResultResponsesJob).not.toHaveBeenCalled(); expect(facade.isDeleteJobRunning()).toBe(false);
  });

  it('does not restart a stale operation when a terminal change synchronously switches workspaces', () => {
    changed.mockImplementation(() => changeWorkspace(6)); validation.getValidationTask.mockReturnValue(of(task('completed', 100)));
    facade.confirmAndStartDelete(request); jest.advanceTimersByTime(0);
    expect(validation.getValidationResults).not.toHaveBeenCalled(); expect(facade.isDeleteJobRunning()).toBe(false);
    expect(facade.deleteProgressMessage()).toBe('');
  });

  it('resumes the same accepted job after destroying and recreating the view', () => {
    const pending = new Subject<ValidationTaskDto>(); validation.getValidationTask.mockReturnValueOnce(pending).mockReturnValue(of(task('completed', 100)));
    facade.confirmAndStartDelete(request); jest.advanceTimersByTime(0); fixture.destroy(); expect(pending.observed).toBe(false);
    fixture = TestBed.createComponent(DeletionHost); facade = fixture.componentInstance.deletion; facade.changed$.subscribe(changed);
    expect(facade.activeDeleteTask()?.id).toBe(17); expect(facade.isDeleteJobRunning()).toBe(true); jest.advanceTimersByTime(0);
    expect(validation.getValidationTask.mock.calls).toEqual([[5, 17], [5, 17]]); expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    fixture.destroy(); fixture = TestBed.createComponent(DeletionHost); facade = fixture.componentInstance.deletion;
    jest.advanceTimersByTime(1000); expect(facade.isDeleteJobRunning()).toBe(false); expect(validation.getValidationTask).toHaveBeenCalledTimes(2);
  });

  it('keeps accepted jobs separate across workspaces and ignores old replies when resuming the first job', () => {
    const old = new Subject<ValidationTaskDto>(); const other = new Subject<ValidationTaskDto>(); const resumed = new Subject<ValidationTaskDto>();
    validation.getValidationTask.mockReturnValueOnce(old).mockReturnValueOnce(other).mockReturnValueOnce(resumed);
    facade.confirmAndStartDelete(request); jest.advanceTimersByTime(0); changeWorkspace(6);
    expect(facade.isDeleteJobRunning()).toBe(false); expect(old.observed).toBe(false);
    results.createDeleteTestResultsJob.mockReturnValueOnce(of({ ...task('pending', 0, 18), workspace_id: 6 }));
    facade.confirmAndStartDelete(request); jest.advanceTimersByTime(0); expect(facade.activeDeleteTask()?.id).toBe(18);
    changeWorkspace(5); jest.advanceTimersByTime(0); expect(other.observed).toBe(false); expect(facade.activeDeleteTask()?.id).toBe(17);
    old.next(task('completed', 100)); other.next({ ...task('completed', 100, 18), workspace_id: 6 });
    expect(changed).not.toHaveBeenCalled(); resumed.next(task('completed', 100)); resumed.complete();
    expect(validation.getValidationTask.mock.calls).toEqual([[5, 17], [6, 18], [5, 17]]);
    expect(results.createDeleteTestResultsJob).toHaveBeenCalledTimes(2); expect(notify).toHaveBeenLastCalledWith({ workspaceId: 5 });
  });

  it('invalidates the originating cache when an enqueue request is canceled before returning its job ID', () => {
    const pending = new Subject<ValidationTaskDto>(); results.createDeleteTestResultsJob.mockReturnValue(pending);
    facade.confirmAndStartDelete(request); results.invalidateCache.mockClear(); invalidateValidation.mockClear(); changeWorkspace(6);
    expect(pending.observed).toBe(false); expect(results.invalidateCache).toHaveBeenCalledWith(5); expect(invalidateValidation).toHaveBeenCalledWith(5);
    pending.next(task('pending')); expect(facade.activeDeleteTask()).toBeNull(); expect(changed).not.toHaveBeenCalled();
  });

  it('does not expose a previous workspace retry and uses the new workspace for its next deletion', () => {
    validation.getValidationTask.mockReturnValue(throwError(() => new Error('offline')));
    facade.confirmAndStartDelete(request); jest.advanceTimersByTime(0); changeWorkspace(6); facade.retry();
    expect(validation.getValidationTask).toHaveBeenCalledTimes(1); expect(facade.canRetry()).toBe(false);
    facade.confirmAndStartDelete(request); expect(results.createDeleteTestResultsJob).toHaveBeenLastCalledWith(6, request);
  });

  describe.each(['unit', 'response'] as const)('single %s deletion', kind => {
    const remove = (): void => { if (kind === 'unit') facade.deleteUnit({ id: 7, alias: 'U7' } as Unit, { id: 3 }); else facade.deleteResponse({ id: 13, variableid: 'V1' } as Response); };
    it('emits a targeted change and invalidates dependent caches on success', () => {
      remove(); expect(changed).toHaveBeenCalledWith(kind === 'unit' ? { scope: 'unit', unitId: 7, bookletId: 3 } : { scope: 'response', responseId: 13 });
      expect(results.invalidateCache).toHaveBeenCalledWith(5); expect(invalidateValidation).toHaveBeenCalledWith(5); expect(notify).toHaveBeenCalledWith({ workspaceId: 5 });
      expect(cleared).not.toHaveBeenCalled(); expect(facade.isDeleteJobRunning()).toBe(false);
    });
    it('allows cancellation without sending a mutation', () => {
      ref.afterClosed.mockReturnValue(of(false)); remove();
      expect(units.deleteUnit).not.toHaveBeenCalled(); expect(responses.deleteResponse).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
    });
    it.each(['report', 'http'] as const)('reconciles an uncertain %s failure instead of optimistically removing a row', failure => {
      (kind === 'unit' ? units.deleteUnit : responses.deleteResponse).mockReturnValueOnce(failure === 'http' ? throwError(() => new Error('offline')) : of({ success: false, report: { warnings: ['nicht gelöscht'] } }));
      remove(); expect(changed).toHaveBeenCalledWith({ scope: 'workspace' }); expect(facade.isDeleteJobRunning()).toBe(false);
      remove(); expect(changed).toHaveBeenCalledTimes(2);
    });
    it.each(['workspace', 'destroy'] as const)('cancels an in-flight request on %s and ignores late success', cancellation => {
      const pending = new Subject<unknown>(); (kind === 'unit' ? units.deleteUnit : responses.deleteResponse).mockReturnValue(pending);
      remove(); if (cancellation === 'workspace') { changeWorkspace(6); changeWorkspace(5); } else fixture.destroy();
      expect(pending.observed).toBe(false); pending.next({ success: true, report: { warnings: [] } });
      expect(changed).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
    });
  });
});
