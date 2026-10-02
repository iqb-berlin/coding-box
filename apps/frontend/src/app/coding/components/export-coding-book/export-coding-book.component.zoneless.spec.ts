import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { ExportCodingBookComponent } from './export-coding-book.component';
import { CodingExportService } from '../../services/coding-export.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { ValidationStateService } from '../../services/validation-state.service';
import { FileService } from '../../../shared/services/file/file.service';
import { AppService } from '../../../core/services/app.service';

type ObservableValue<T> = T extends import('rxjs').Observable<infer V> ? V : never;
type JobStatus = ObservableValue<ReturnType<CodingExportService['getCodebookJobStatus']>>;
type JobStart = ObservableValue<ReturnType<CodingExportService['startCodebookJob']>>;
type Units = ObservableValue<ReturnType<FileService['getUnitsWithFileIds']>>;

describe('Codebook export with delayed responses without Zone', () => {
  let fixture: ComponentFixture<ExportCodingBookComponent>;
  let units: Subject<Units>;
  let start: Subject<JobStart>;
  let status: Subject<JobStatus>;
  let download: Subject<Blob>;
  let downloadCodebookFile: jest.Mock;

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    units = new Subject<Units>();
    start = new Subject<JobStart>();
    status = new Subject<JobStatus>();
    download = new Subject<Blob>();
    downloadCodebookFile = jest.fn(() => download);
    const progress = new BehaviorSubject({ status: 'idle', progress: 0, message: '' });
    await TestBed.configureTestingModule({
      imports: [ExportCodingBookComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: CodingExportService,
          useValue: {
            startCodebookJob: () => start,
            getCodebookJobStatus: () => status,
            downloadCodebookFile
          }
        },
        { provide: CodingJobBackendService, useValue: { getJobDefinitions: () => of([]), getVariableBundles: () => of([]) } },
        { provide: MissingsProfileService, useValue: { getMissingsProfiles: () => of([]) } },
        { provide: FileService, useValue: { getUnitsWithFileIds: () => units } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        {
          provide: ValidationStateService,
          useValue: {
            validationProgress$: progress,
            validationResults$: of(null),
            getValidationProgress: () => progress.value,
            getValidationResults: () => null
          }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ExportCodingBookComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    jest.useRealTimers();
  });

  function exportButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button[type="submit"]');
  }

  async function selectUnitAndExport(): Promise<void> {
    units.next([{
      id: 1, unitId: 'UNIT', fileName: 'UNIT.vocs', data: '{}'
    }]);
    await fixture.whenStable();
    const selectAll: HTMLInputElement = fixture.nativeElement.querySelector('.select-all-container input');
    selectAll.click();
    await fixture.whenStable();
    expect(exportButton().disabled).toBe(false);
    exportButton().click();
    await fixture.whenStable();
    start.next({ jobId: 'job-1', message: 'Started' });
    await fixture.whenStable();
    jest.advanceTimersByTime(1500);
  }

  it('ends loading and displays selectable units after a delayed response', async () => {
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
    units.next([{
      id: 1, unitId: 'UNIT', fileName: 'UNIT.vocs', data: '{}'
    }]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('table').textContent).toContain('UNIT');
    expect(fixture.nativeElement.querySelector('.selection-count').textContent).toContain('0 / 1');
  });

  it('ends loading after a delayed unit-list failure', async () => {
    units.error(new Error('Units failed'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(exportButton().disabled).toBe(true);
  });

  it('updates progress and enables export again when the job completes', async () => {
    await selectUnitAndExport();
    expect(exportButton().disabled).toBe(true);
    status.next({ status: 'processing', progress: 64 });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.progress-percentage').textContent).toContain('64%');
    expect(fixture.nativeElement.querySelector('mat-progress-bar').getAttribute('aria-valuenow')).toBe('64');

    jest.advanceTimersByTime(1500);
    status.next({ status: 'completed', progress: 100 });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.progress-container.completed')).not.toBeNull();
    expect(exportButton().disabled).toBe(false);
    expect(downloadCodebookFile).toHaveBeenCalledWith(1, 'job-1');
  });

  it('renders delayed polling errors and resets through the bound button', async () => {
    await selectUnitAndExport();
    status.error(new Error('Polling failed'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.progress-container.failed').textContent).toContain('Failed to get job status');
    expect(exportButton().disabled).toBe(false);
    const reset: HTMLButtonElement = fixture.nativeElement.querySelector('.progress-container.failed button');
    reset.click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.codebook-progress-section')).toBeNull();
  });

  it('renders a delayed start failure and enables retry', async () => {
    units.next([{
      id: 1, unitId: 'UNIT', fileName: 'UNIT.vocs', data: '{}'
    }]);
    await fixture.whenStable();
    const selectAll: HTMLInputElement = fixture.nativeElement.querySelector('.select-all-container input');
    selectAll.click();
    await fixture.whenStable();
    exportButton().click();
    await fixture.whenStable();
    start.error(new Error('Start failed'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.progress-container.failed').textContent).toContain('Failed to start codebook generation job');
    expect(exportButton().disabled).toBe(false);
  });

  it('renders a delayed download failure after job completion', async () => {
    await selectUnitAndExport();
    status.next({ status: 'completed', progress: 100 });
    await fixture.whenStable();
    download.error(new Error('Download failed'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.progress-container.failed').textContent).toContain('Failed to download codebook file');
    expect(exportButton().disabled).toBe(false);
  });
});
