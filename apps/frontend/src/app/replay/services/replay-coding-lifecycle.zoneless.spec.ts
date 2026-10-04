import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { ReplayCodingService, SavedCode } from './replay-coding.service';
import { CodingJobBackendService } from '../../coding/services/coding-job-backend.service';

function replies() {
  return {
    progress: new Subject<Record<string, SavedCode>>(),
    notes: new Subject<Record<string, string>>(),
    job: new Subject<{ status: string; comment: string; showScore: boolean }>()
  };
}

describe('Replay progress request ownership without ZoneJS', () => {
  let service: ReplayCodingService;
  let current: ReturnType<typeof replies>;

  beforeEach(() => {
    current = replies();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        {
          provide: CodingJobBackendService,
          useValue: {
            getCodingProgress: () => current.progress,
            getCodingNotes: () => current.notes,
            getCodingJob: () => current.job
          }
        }
      ]
    });
    service = TestBed.inject(ReplayCodingService);
  });

  function complete(reply: ReturnType<typeof replies>, label: string): void {
    reply.progress.next({ 'person:unit:var': { id: 7, label } });
    reply.progress.complete();
    reply.notes.next({ 'person:unit:var': label });
    reply.notes.complete();
    reply.job.next({ status: 'active', comment: label, showScore: true });
    reply.job.complete();
  }

  it('cancels all older requests and applies the latest job atomically', async () => {
    const oldReply = current;
    const oldLoad = service.loadSavedCodingProgress(5, 100);
    current = replies();
    const latestLoad = service.loadSavedCodingProgress(6, 101);
    expect(oldReply.progress.observed).toBe(false);
    expect(oldReply.notes.observed).toBe(false);
    expect(oldReply.job.observed).toBe(false);
    current.progress.next({ 'person:unit:var': { id: 7, label: 'LATEST' } });
    current.progress.complete();
    await Promise.resolve();
    expect(service.selectedCodes.size).toBe(0);
    expect(service.notes.size).toBe(0);
    current.notes.next({ 'person:unit:var': 'LATEST' });
    current.notes.complete();
    current.job.next({ status: 'active', comment: 'LATEST', showScore: true });
    current.job.complete();
    await latestLoad;
    complete(oldReply, 'STALE');
    await oldLoad;
    expect(service.selectedCodes.get('person:unit:var')?.label).toBe('LATEST');
    expect(service.notes.get('person:unit:var')).toBe('LATEST');
    expect(service.codingJobComment).toBe('LATEST');
  });

  it.each(['reset', 'destroy'])('settles a pending promise and ignores late results on %s', async reason => {
    const pending = service.loadSavedCodingProgress(5, 100);
    if (reason === 'reset') service.resetCodingData();
    if (reason === 'destroy') TestBed.resetTestingModule();
    expect(current.progress.observed).toBe(false);
    expect(current.notes.observed).toBe(false);
    expect(current.job.observed).toBe(false);
    complete(current, 'STALE');
    await pending;
    expect(service.selectedCodes.size).toBe(0);
    expect(service.notes.size).toBe(0);
    expect(service.codingJobComment).toBe('');
  });

  it('does not let an older progress load overwrite a newly applied replay session', async () => {
    const pending = service.loadSavedCodingProgress(5, 100);
    service.applyReplayCodingSession({
      progress: { 'person:unit:var': { id: 7, label: 'SESSION' } },
      notes: { 'person:unit:var': 'SESSION' },
      job: { status: 'active', comment: 'SESSION' }
    } as never);
    expect(current.progress.observed).toBe(false);
    complete(current, 'STALE');
    await pending;
    expect(service.selectedCodes.get('person:unit:var')?.label).toBe('SESSION');
    expect(service.notes.get('person:unit:var')).toBe('SESSION');
    expect(service.codingJobComment).toBe('SESSION');
  });
});
