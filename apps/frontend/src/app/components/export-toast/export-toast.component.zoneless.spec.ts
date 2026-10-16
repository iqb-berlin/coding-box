import { provideZonelessChangeDetection } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { ExportToastComponent } from './export-toast.component';
import { ExportJob, ExportJobService } from '../../shared/services/file/export-job.service';

describe('Export job signals without Zone', () => {
  it('renders the current job immediately, updates delayed progress and cleans up on destruction', async () => {
    const job: ExportJob = {
      jobId: 'one', workspaceId: 5, status: 'active', progress: 25, exportType: 'aggregated'
    };
    const jobs = new BehaviorSubject<ExportJob[]>([job]);
    const removed = new Subject<boolean>();
    await TestBed.configureTestingModule({
      imports: [ExportToastComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: ExportJobService, useValue: { jobs$: jobs.asObservable(), removeJob: () => removed } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(ExportToastComponent);
    expect(fixture.componentInstance.jobs()).toEqual([job]);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-progress-bar').getAttribute('aria-valuenow')).toBe('25');

    jobs.next([{ ...job, progress: 64 }]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-progress-bar').getAttribute('aria-valuenow')).toBe('64');
    fixture.componentInstance.removeJob(job);
    expect(removed.observed).toBe(true);
    fixture.destroy();
    expect(jobs.observed).toBe(false);
    expect(removed.observed).toBe(false);
    jobs.next([]);
    expect(fixture.componentInstance.jobs()[0].progress).toBe(64);
  });
});
