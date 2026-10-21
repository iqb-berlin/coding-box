import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BehaviorSubject, of, Subject, throwError
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { ExportJobService } from '../../../shared/services/file/export-job.service';
import { ManualCodingExportFacade, ManualExportDecision } from './manual-coding-export.facade';
import { createManualCodingExportConfig } from './manual-coding-export-plan';

@Component({ standalone: true, template: '<span>{{exports.isStarting()}}</span>', providers: [ManualCodingExportFacade] })
class ExportHost { readonly exports = inject(ManualCodingExportFacade); }

describe('ManualCodingExportFacade', () => {
  const config = createManualCodingExportConfig('execution', { exportType: 'aggregated', doubleCodingMethod: 'new-row-per-variable' }, 1, [3]);
  const warning = { unitVariableCount: 1200, worksheetLimit: 1000, exceedsWorksheetLimit: true };
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: BehaviorSubject<number> };
  let jobs: { startJob: jest.Mock; estimateJob: jest.Mock };
  beforeEach(() => {
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new BehaviorSubject(5) };
    jobs = { startJob: jest.fn().mockReturnValue(of({})), estimateJob: jest.fn().mockReturnValue(of(warning)) };
    TestBed.configureTestingModule({ imports: [ExportHost], providers: [{ provide: AppService, useValue: app }, { provide: ExportJobService, useValue: jobs }] });
  });

  it('waits for a decision and prevents duplicate startups throughout confirmation', () => {
    const host = TestBed.createComponent(ExportHost);
    const facade = host.componentInstance.exports;
    const decision = new Subject<ManualExportDecision>();
    const choose = jest.fn(() => decision);
    facade.start(5, config, choose).subscribe();
    facade.start(5, config, choose).subscribe();
    expect(choose).toHaveBeenCalledTimes(1);
    expect(jobs.startJob).not.toHaveBeenCalled();
    decision.next('compact');
    decision.complete();
    expect(jobs.startJob).toHaveBeenCalledTimes(1);
    expect(jobs.startJob).toHaveBeenCalledWith(5, expect.objectContaining({ exportType: 'by-variable-compact', jobDefinitionIds: [3] }));
    expect(facade.isStarting()).toBe(false);
  });

  it.each(['workspace', 'destroy'] as const)('cancels an outstanding estimate on %s and releases the zoneless loading state', async context => {
    const estimate = new Subject<typeof warning>();
    jobs.estimateJob.mockReturnValue(estimate);
    const host = TestBed.createComponent(ExportHost);
    const facade = host.componentInstance.exports;
    host.detectChanges();
    const choose = jest.fn(() => of(true as const));
    facade.start(5, config, choose).subscribe();
    await host.whenStable();
    expect(host.nativeElement.textContent).toBe('true');
    if (context === 'destroy') host.destroy();
    else {
      app.selectedWorkspaceId = 6; app.selectedWorkspaceId$.next(6);
      app.selectedWorkspaceId = 5; app.selectedWorkspaceId$.next(5);
      await host.whenStable();
      expect(host.nativeElement.textContent).toBe('false');
    }
    estimate.next(warning);
    expect(choose).not.toHaveBeenCalled();
    expect(jobs.startJob).not.toHaveBeenCalled();
    expect(facade.isStarting()).toBe(false);
  });

  it('discards a late confirmation after a workspace round trip', () => {
    const facade = TestBed.createComponent(ExportHost).componentInstance.exports;
    const decision = new Subject<ManualExportDecision>();
    facade.start(5, config, () => decision).subscribe();
    app.selectedWorkspaceId = 6; app.selectedWorkspaceId$.next(6);
    app.selectedWorkspaceId = 5; app.selectedWorkspaceId$.next(5);
    decision.next(true);
    expect(jobs.startJob).not.toHaveBeenCalled();
  });

  it('permits retry after estimate failure and does not repeat root startup error feedback', () => {
    const facade = TestBed.createComponent(ExportHost).componentInstance.exports;
    const outcomes: string[] = [];
    jobs.estimateJob.mockReturnValueOnce(throwError(() => new Error('estimate'))).mockReturnValue(of({ ...warning, exceedsWorksheetLimit: false }));
    facade.start(5, config, () => of(true)).subscribe(value => outcomes.push(value));
    expect(outcomes).toEqual(['estimate-failed']);
    jobs.startJob.mockReturnValueOnce(throwError(() => new Error('startup')));
    facade.start(5, config, () => of(true)).subscribe(value => outcomes.push(value));
    expect(facade.isStarting()).toBe(false);
    facade.start(5, config, () => of(true)).subscribe(value => outcomes.push(value));
    expect(outcomes).toEqual(['estimate-failed', 'started']);
  });
});
