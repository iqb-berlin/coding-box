import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { ExportComponent } from './export.component';
import { ExportJobService } from '../../../shared/services/file/export-job.service';
import { CodingJobBackendService } from '../../../coding/services/coding-job-backend.service';
import { WorkspaceSettingsService } from '../../services/workspace-settings.service';
import { AppService } from '../../../core/services/app.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { MissingsProfileService } from '../../../coding/services/missings-profile.service';

describe('Background export startup feedback without ZoneJS', () => {
  let fixture: ComponentFixture<ExportComponent>;
  let response: Subject<{ jobId: string; message: string }>;
  let snackOpen: jest.Mock;
  let startExportJob: jest.Mock;

  beforeEach(async () => {
    response = new Subject();
    snackOpen = jest.fn();
    startExportJob = jest.fn().mockReturnValue(response);
    await TestBed.configureTestingModule({
      imports: [ExportComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        ExportJobService,
        { provide: CodingJobBackendService, useValue: { startExportJob } },
        { provide: WorkspaceSettingsService, useValue: {} },
        { provide: AppService, useValue: { selectedWorkspaceId: 5, selectedWorkspaceId$: new Subject(), userId: 2 } },
        { provide: ResponseService, useValue: { hasGeogebraResponses: () => of(false) } },
        { provide: MissingsProfileService, useValue: { getExportMissingsProfilesOrThrow: () => of([{ id: 4, label: 'IQB-Standard' }]) } },
        { provide: MatSnackBar, useValue: { open: snackOpen } }
      ]
    }).compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', {
      close: 'Schließen',
      'ws-admin': { 'export.errors.start-failed': 'Datenexport konnte nicht gestartet werden' }
    });
    translate.use('de');
    fixture = TestBed.createComponent(ExportComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it.each([false, true])('reports a rejected start exactly once after leaving = %s', async leftView => {
    const service = TestBed.inject(ExportJobService);
    fixture.componentInstance.onExport();
    expect(fixture.componentInstance.isStartingExport()).toBe(true);
    expect(response.observed).toBe(true);
    if (leftView) fixture.destroy();
    expect(response.observed).toBe(true);

    response.error(new HttpErrorResponse({ status: 503 }));

    expect(snackOpen).toHaveBeenCalledTimes(1);
    expect(snackOpen).toHaveBeenCalledWith(
      'Datenexport konnte nicht gestartet werden',
      'Schließen',
      { duration: 5000, panelClass: ['error-snackbar'] }
    );
    expect(startExportJob).toHaveBeenCalledTimes(1);
    expect(service.activeJobs).toHaveLength(0);
    if (!leftView) {
      await fixture.whenStable();
      expect(fixture.componentInstance.isStartingExport()).toBe(false);
      expect(fixture.nativeElement.querySelector('[data-cy="start-export"]').disabled).toBe(false);
    }
  });

  it('cancels pending startup silently on root teardown', () => {
    fixture.componentInstance.onExport();
    expect(response.observed).toBe(true);
    TestBed.resetTestingModule();
    expect(response.observed).toBe(false);
    response.error(new HttpErrorResponse({ status: 503 }));
    expect(snackOpen).not.toHaveBeenCalled();
  });
});
