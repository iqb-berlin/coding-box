import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import {
  BehaviorSubject, of, Subject, throwError
} from 'rxjs';
import { ItemMatrixDiagnosticsHistoryComponent } from './item-matrix-diagnostics-history.component';
import { AppService } from '../../../core/services/app.service';
import { ExportJobService } from '../../../shared/services/file/export-job.service';

describe('saved item matrix diagnoses', () => {
  const entry = {
    archiveId: 'saved-id',
    jobId: 'deleted-job',
    createdAt: 1000,
    total: 5480,
    version: 'v2' as const,
    matrixValue: 'score' as const,
    missingsProfileId: 4
  };
  const workspace$ = new BehaviorSubject(5);
  const app = { selectedWorkspaceId: 5, selectedWorkspaceId$: workspace$ };
  const backend = {
    listArchivedItemMatrixDiagnostics: jest.fn(),
    getArchivedItemMatrixDiagnostics: jest.fn(),
    downloadArchivedItemMatrixDiagnostics: jest.fn()
  };
  const dialog = { open: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    app.selectedWorkspaceId = 5;
    workspace$.next(5);
    backend.listArchivedItemMatrixDiagnostics.mockReturnValue(of([entry]));
    backend.getArchivedItemMatrixDiagnostics.mockReturnValue(of({ total: 5480, sampleLimit: 20, groups: [] }));
    await TestBed.configureTestingModule({
      imports: [ItemMatrixDiagnosticsHistoryComponent, TranslateModule.forRoot()],
      providers: [provideZonelessChangeDetection(), { provide: AppService, useValue: app },
        { provide: ExportJobService, useValue: backend }, { provide: MatDialog, useValue: dialog }]
    }).compileComponents();
  });

  it('loads and opens persisted diagnoses without a job or status request', () => {
    const fixture = TestBed.createComponent(ItemMatrixDiagnosticsHistoryComponent);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-cy="load-saved-diagnostics"]').click();
    fixture.detectChanges();
    expect(backend.listArchivedItemMatrixDiagnostics).toHaveBeenCalledWith(5);
    fixture.nativeElement.querySelector('[data-cy="open-saved-diagnostics"]').click();
    expect(backend.getArchivedItemMatrixDiagnostics).toHaveBeenCalledWith(5, 'saved-id');
    expect(dialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({ total: 5480, downloadFullCsv: expect.any(Function) })
    }));
  });

  it('offers the complete CSV download and reports failures', () => {
    const fixture = TestBed.createComponent(ItemMatrixDiagnosticsHistoryComponent);
    backend.downloadArchivedItemMatrixDiagnostics.mockReturnValue(throwError(() => new Error('offline')));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-cy="load-saved-diagnostics"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-cy="download-saved-diagnostics"]').click();
    fixture.detectChanges();
    expect(backend.downloadArchivedItemMatrixDiagnostics).toHaveBeenCalledWith(5, 'saved-id');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('discards late responses when switching workspaces and permits retry after errors', () => {
    const pending = new Subject<typeof entry[]>();
    backend.listArchivedItemMatrixDiagnostics.mockReturnValueOnce(pending);
    const fixture = TestBed.createComponent(ItemMatrixDiagnosticsHistoryComponent);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-cy="load-saved-diagnostics"]').click();
    app.selectedWorkspaceId = 6;
    workspace$.next(6);
    pending.next([entry]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-cy="download-saved-diagnostics"]')).toBeNull();
    backend.listArchivedItemMatrixDiagnostics.mockReturnValueOnce(throwError(() => new Error('offline')));
    fixture.nativeElement.querySelector('[data-cy="load-saved-diagnostics"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-cy="load-saved-diagnostics"]').disabled).toBe(false);
  });
});
