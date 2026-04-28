import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { ExportToastComponent } from './export-toast.component';
import { ExportJob, ExportJobService } from '../../shared/services/file/export-job.service';

describe('ExportToastComponent', () => {
  let fixture: ComponentFixture<ExportToastComponent>;
  let component: ExportToastComponent;
  let jobs$: BehaviorSubject<ExportJob[]>;
  let exportJobService: {
    jobs$: BehaviorSubject<ExportJob[]>;
    downloadFile: jest.Mock;
    removeJob: jest.Mock;
    cancelJob: jest.Mock;
  };

  const jobs = [
    {
      jobId: 'waiting', workspaceId: 1, exportType: 'aggregated', status: 'waiting'
    },
    {
      jobId: 'active', workspaceId: 1, exportType: 'by-coder', status: 'active'
    },
    {
      jobId: 'done', workspaceId: 1, exportType: 'detailed', status: 'completed'
    },
    {
      jobId: 'bad', workspaceId: 1, exportType: 'custom', status: 'failed'
    },
    {
      jobId: 'cancelled', workspaceId: 1, exportType: 'coding-times', status: 'cancelled'
    }
  ] as ExportJob[];

  beforeEach(async () => {
    jobs$ = new BehaviorSubject<ExportJob[]>(jobs);
    exportJobService = {
      jobs$,
      downloadFile: jest.fn(),
      removeJob: jest.fn(),
      cancelJob: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [ExportToastComponent, TranslateModule.forRoot()],
      providers: [{ provide: ExportJobService, useValue: exportJobService }]
    }).compileComponents();

    fixture = TestBed.createComponent(ExportToastComponent);
    component = fixture.componentInstance;
  });

  it('summarizes jobs and delegates user actions', () => {
    component.ngOnInit();

    expect(component.hasJobs).toBe(true);
    expect(component.activeJobCount).toBe(2);
    expect(component.completedJobCount).toBe(1);
    expect(component.failedJobCount).toBe(1);
    expect(component.getStatusIcon('waiting')).toBe('hourglass_empty');
    expect(component.getStatusIcon('active')).toBe('sync');
    expect(component.getStatusIcon('completed')).toBe('check_circle');
    expect(component.getStatusIcon('failed')).toBe('error');
    expect(component.getStatusIcon('cancelled')).toBe('cancel');
    expect(component.getStatusIcon('unknown' as never)).toBe('help');
    expect(component.getStatusClass('failed')).toBe('status-failed');
    expect(component.getExportTypeLabel('aggregated')).toBe('Aggregiert');
    expect(component.getExportTypeLabel('custom')).toBe('custom');

    component.toggleCollapse();
    expect(component.isCollapsed).toBe(true);
    component.downloadFile(jobs[0]);
    component.removeJob(jobs[0]);
    component.cancelJob(jobs[1]);
    component.clearCompleted();

    expect(exportJobService.downloadFile).toHaveBeenCalledWith(1, 'waiting', 'aggregated');
    expect(exportJobService.removeJob).toHaveBeenCalledWith('waiting');
    expect(exportJobService.cancelJob).toHaveBeenCalledWith(jobs[1]);
    expect(exportJobService.removeJob).toHaveBeenCalledWith('done');
    expect(exportJobService.removeJob).toHaveBeenCalledWith('bad');
    expect(exportJobService.removeJob).toHaveBeenCalledWith('cancelled');
  });

  it('updates from the jobs stream and tears down subscriptions', () => {
    component.ngOnInit();
    jobs$.next([]);

    expect(component.jobs).toEqual([]);
    expect(component.hasJobs).toBe(false);

    component.ngOnDestroy();
    jobs$.next(jobs);
    expect(component.jobs).toEqual([]);
  });
});
