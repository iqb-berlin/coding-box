import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { DistributedCodingService } from '../../services/distributed-coding.service';
import { BulkCreationData } from '../coding-job-bulk-creation-dialog/coding-job-bulk-creation-dialog.component';
import { CodingJobDefinitionPersistence, CodingJobSaveResult } from './coding-job-definition-persistence.service';
import { CODING_JOB_DEFINITION_RECOVERY_KEY, CodingJobDefinitionDialogData, JobDefinition } from './coding-job-definition.models';
import { JobDefinitionSaveFacade } from './job-definition-save.facade';

describe('JobDefinitionSaveFacade', () => {
  let facade: JobDefinitionSaveFacade;
  let backend: { createJobDefinition: jest.Mock; updateJobDefinition: jest.Mock;
    previewJobDefinitionUpdateRefresh: jest.Mock; applyJobDefinitionUpdateRefresh: jest.Mock };
  let persistence: { createJob: jest.Mock; updateJob: jest.Mock };
  let distribution: { createDistributedCodingJobs: jest.Mock };
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: Subject<number> };
  let dialogs: { open: jest.Mock };
  let parent: { close: jest.Mock };
  let feedback: { open: jest.Mock };
  let recovery: { clearDraft: jest.Mock };
  const bulk: BulkCreationData = {
    selectedVariables: [{ unitName: 'UNIT', variableId: 'V1' }],
    selectedVariableBundles: [],
    selectedCoders: [{ id: 7, name: 'Coder' }],
    doubleCodingAbsolute: 2,
    doubleCodingPercentage: 0,
    caseOrderingMode: 'alternating',
    maxCodingCases: 10,
    distributionSeed: 'seed'
  };
  const updateData: CodingJobDefinitionDialogData = {
    isEdit: true,
    mode: 'definition',
    jobDefinitionId: 4,
    createdJobsCount: 1,
    codingJob: {
      id: 4, workspace_id: 1, name: 'Original', status: 'approved', created_at: new Date(), updated_at: new Date()
    }
  };

  beforeEach(() => {
    backend = {
      createJobDefinition: jest.fn().mockReturnValue(of({ id: 4 })),
      updateJobDefinition: jest.fn().mockReturnValue(of({ id: 4 })),
      previewJobDefinitionUpdateRefresh: jest.fn().mockReturnValue(of({ jobsToCreate: 2 })),
      applyJobDefinitionUpdateRefresh: jest.fn().mockReturnValue(of({ jobsCreated: 2 }))
    };
    persistence = { createJob: jest.fn(), updateJob: jest.fn() };
    distribution = {
      createDistributedCodingJobs: jest.fn().mockReturnValue(of({
        success: true, jobs: [], doubleCodingInfo: {}, message: 'Created'
      }))
    };
    app = { selectedWorkspaceId: 1, selectedWorkspaceId$: new Subject<number>() };
    dialogs = { open: jest.fn().mockReturnValue({ afterClosed: () => of(true), close: jest.fn() }) };
    parent = { close: jest.fn() };
    feedback = { open: jest.fn() };
    recovery = { clearDraft: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        JobDefinitionSaveFacade,
        { provide: CodingJobBackendService, useValue: backend },
        { provide: CodingJobDefinitionPersistence, useValue: persistence },
        { provide: DistributedCodingService, useValue: distribution },
        { provide: AppService, useValue: app },
        { provide: MatDialog, useValue: dialogs },
        { provide: MatDialogRef, useValue: parent },
        { provide: MatSnackBar, useValue: feedback },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
        { provide: SessionRecoveryService, useValue: recovery }
      ]
    });
    facade = TestBed.inject(JobDefinitionSaveFacade);
  });

  it('prevents duplicate writes and clears recovery only after a successful definition save', () => {
    const result = new Subject<JobDefinition>();
    backend.createJobDefinition.mockReturnValue(result);
    const payload = { name: 'Definition', status: 'draft' as const };
    facade.createDefinition(payload);
    facade.createDefinition(payload);
    expect(backend.createJobDefinition).toHaveBeenCalledTimes(1);
    expect(backend.createJobDefinition).toHaveBeenCalledWith(1, payload);
    expect(facade.isSaving()).toBe(true);
    expect(recovery.clearDraft).not.toHaveBeenCalled();
    result.next({ id: 4 });
    result.complete();
    expect(facade.isSaving()).toBe(false);
    expect(recovery.clearDraft).toHaveBeenCalledWith(CODING_JOB_DEFINITION_RECOVERY_KEY);
    expect(parent.close).toHaveBeenCalledWith({ id: 4 });
  });

  it('retains recovery and allows retry after a backend error', () => {
    backend.createJobDefinition.mockReturnValueOnce(throwError(() => ({ error: { message: 'Rejected' } })));
    facade.createDefinition({ status: 'pending_review' }, true);
    expect(facade.isSaving()).toBe(false);
    expect(recovery.clearDraft).not.toHaveBeenCalled();
    expect(parent.close).not.toHaveBeenCalled();
    expect(feedback.open).toHaveBeenCalledWith('coding-job-definition-dialog.snackbars.error-submitting-review', 'common.close', { duration: 5000 });
    facade.createDefinition({ status: 'pending_review' }, true);
    expect(parent.close).toHaveBeenCalledWith({ id: 4 });
  });

  it('preserves a saved job when coder assignment fails', () => {
    const job = {
      id: 4, workspace_id: 1, name: 'Job', status: 'pending', created_at: new Date(), updated_at: new Date()
    };
    persistence.updateJob.mockReturnValue(of({ job, assignmentFailed: true }));
    facade.saveJob(job, [7], true);
    expect(persistence.updateJob).toHaveBeenCalledWith(1, 4, job, [7]);
    expect(parent.close).toHaveBeenCalledWith(job);
    expect(feedback.open).toHaveBeenCalledWith('coding-job-definition-dialog.snackbars.job-updated-coder-failed', 'common.close', { duration: 5000 });
    expect(recovery.clearDraft).not.toHaveBeenCalled();
  });

  it.each(['workspace', 'destroy'])('ignores pending assignment replies after %s', end => {
    const result = new Subject<CodingJobSaveResult>();
    persistence.createJob.mockReturnValue(result);
    const job = {
      id: 4, workspace_id: 1, name: 'Job', status: 'pending', created_at: new Date(), updated_at: new Date()
    };
    facade.saveJob(job, [7], false);
    if (end === 'destroy') TestBed.resetTestingModule();
    else { app.selectedWorkspaceId = 2; app.selectedWorkspaceId$.next(2); }
    result.next({ job, assignmentFailed: false });
    expect(facade.isSaving()).toBe(false);
    expect(parent.close).not.toHaveBeenCalled();
    expect(feedback.open).not.toHaveBeenCalled();
  });

  it('limits direct updates of definitions with existing jobs to presentation fields', async () => {
    await facade.updateDefinition({ name: 'Renamed', status: 'approved', distributionSeed: 'kept' }, updateData);
    expect(backend.updateJobDefinition).toHaveBeenCalledWith(1, 4, expect.objectContaining({ name: 'Renamed' }));
    expect(backend.updateJobDefinition.mock.calls[0][2]).not.toHaveProperty('status');
    expect(backend.updateJobDefinition.mock.calls[0][2]).not.toHaveProperty('distributionSeed');
    expect(backend.previewJobDefinitionUpdateRefresh).not.toHaveBeenCalled();
  });

  it.each([false, true])('applies structural changes only after confirmation (%s)', async confirmed => {
    dialogs.open.mockReturnValue({ afterClosed: () => of(confirmed), close: jest.fn() });
    const payload = { maxCodingCases: 10 };
    await facade.updateDefinition(payload, updateData);
    expect(backend.previewJobDefinitionUpdateRefresh).toHaveBeenCalledWith(1, 4, payload);
    expect(backend.applyJobDefinitionUpdateRefresh).toHaveBeenCalledTimes(confirmed ? 1 : 0);
    expect(parent.close).toHaveBeenCalledTimes(confirmed ? 1 : 0);
    expect(recovery.clearDraft).toHaveBeenCalledTimes(confirmed ? 1 : 0);
    expect(facade.isSaving()).toBe(false);
  });

  it.each(['workspace', 'destroy', 'workspace-return'])('does not open a confirmation after %s in the await continuation', async end => {
    const saving = facade.updateDefinition({ maxCodingCases: 10 }, updateData);
    if (end === 'destroy') TestBed.resetTestingModule();
    else {
      app.selectedWorkspaceId = 2;
      app.selectedWorkspaceId$.next(2);
      if (end === 'workspace-return') { app.selectedWorkspaceId = 1; app.selectedWorkspaceId$.next(1); }
    }
    await saving;
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(backend.applyJobDefinitionUpdateRefresh).not.toHaveBeenCalled();
    expect(feedback.open).not.toHaveBeenCalled();
    expect(facade.isSaving()).toBe(false);
  });

  it('closes its confirmation without applying changes after a workspace switch', async () => {
    const confirmed = new Subject<boolean>();
    const confirmation = { afterClosed: () => confirmed, close: jest.fn() };
    dialogs.open.mockReturnValue(confirmation);
    const saving = facade.updateDefinition({ maxCodingCases: 10 }, updateData);
    await Promise.resolve();
    await Promise.resolve();
    app.selectedWorkspaceId = 2;
    app.selectedWorkspaceId$.next(2);
    await saving;
    expect(confirmation.close).toHaveBeenCalled();
    expect(backend.applyJobDefinitionUpdateRefresh).not.toHaveBeenCalled();
    expect(feedback.open).not.toHaveBeenCalled();
  });

  it('passes the bulk snapshot, capacities and confirmed display options to the backend', async () => {
    const options = {
      confirmed: true, showScore: false, allowComments: true, suppressGeneralInstructions: true
    };
    dialogs.open.mockReturnValueOnce({ afterClosed: () => of(options), close: jest.fn() })
      .mockReturnValueOnce({ afterClosed: () => of(undefined), close: jest.fn() });
    const coders = [{
      id: 7, name: 'Coder', username: 'Coder', capacityPercent: 150
    }];
    await facade.createBulkJobs(bulk, coders);
    expect(distribution.createDistributedCodingJobs).toHaveBeenCalledWith(1, bulk.selectedVariables, coders, 2, 0, [], 'alternating', 10, { showScore: false, allowComments: true, suppressGeneralInstructions: true }, 'seed');
    expect(dialogs.open.mock.calls[1][1].data).toEqual(expect.objectContaining({ ...bulk, creationResults: expect.any(Object) }));
    expect(parent.close).toHaveBeenCalledWith({ bulkJobCreation: true, distributedJobs: [] });
    expect(facade.isSaving()).toBe(false);
  });

  it('does not create distributed jobs after the bulk confirmation is canceled', async () => {
    dialogs.open.mockReturnValue({ afterClosed: () => of(false), close: jest.fn() });
    await facade.createBulkJobs(bulk, []);
    expect(distribution.createDistributedCodingJobs).not.toHaveBeenCalled();
    expect(parent.close).not.toHaveBeenCalled();
    expect(facade.isSaving()).toBe(false);
  });
});
