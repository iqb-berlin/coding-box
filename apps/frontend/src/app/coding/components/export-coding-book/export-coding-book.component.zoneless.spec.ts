import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { CodebookExportComponent } from '@iqb/ngx-coding-components/codebook-export';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { ExportCodingBookComponent } from './export-coding-book.component';
import { CodingExportService } from '../../services/coding-export.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { FileService } from '../../../shared/services/file/file.service';
import { AppService } from '../../../core/services/app.service';
import { ValidationStateService } from '../../services/validation-state.service';

describe('shared codebook with zoneless change detection', () => {
  let fixture: ComponentFixture<ExportCodingBookComponent>;
  let units: Subject<{ id: number; unitId: string; fileName: string; data: string }[]>;
  let status: Subject<{ status: string; progress: number }>;
  let download: Subject<Blob>;
  const start = jest.fn();
  const getStatus = jest.fn();
  const downloadFile = jest.fn();

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    units = new Subject();
    status = new Subject();
    download = new Subject();
    start.mockReset().mockReturnValue(of({ jobId: 'job-1' }));
    getStatus.mockReset().mockReturnValue(status);
    downloadFile.mockReset().mockReturnValue(download);
    await TestBed.configureTestingModule({
      imports: [ExportCodingBookComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        { provide: FileService, useValue: { getUnitsWithFileIds: () => units } },
        {
          provide: CodingJobBackendService,
          useValue: { getJobDefinitions: () => of([]), getVariableBundles: () => of([]) }
        },
        { provide: MissingsProfileService, useValue: { getMissingsProfiles: () => of([]) } },
        {
          provide: CodingExportService,
          useValue: { startCodebookJob: start, getCodebookJobStatus: getStatus, downloadCodebookFile: downloadFile }
        },
        {
          provide: ValidationStateService,
          useValue: {
            validationProgress$: of({ status: 'idle', progress: 0, message: '' }),
            validationResults$: of(null),
            getValidationProgress: () => ({ status: 'idle', progress: 0, message: '' }),
            getValidationResults: () => null
          }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ExportCodingBookComponent);
  });

  afterEach(() => {
    fixture?.destroy();
    jest.useRealTimers();
  });

  async function loadUnits(): Promise<CodebookExportComponent> {
    fixture.detectChanges();
    await fixture.whenStable();
    units.next([{
      id: 1, unitId: 'UNIT', fileName: 'Aufgabe.vocs', data: '{}'
    }]);
    await fixture.whenStable();
    return fixture.debugElement.query(By.directive(CodebookExportComponent)).componentInstance as CodebookExportComponent;
  }

  it('renders asynchronously loaded tasks and the common training filter without a manual refresh', async () => {
    const shared = await loadUnits();
    expect(fixture.nativeElement.textContent).toContain('Aufgabe');
    expect(shared.loading).toBe(false);
    expect(shared.showGroupColumn).toBe(false);
    expect(fixture.nativeElement.querySelector('.codebook-training-filter')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('coding.variable-bundle-filter');
    expect(fixture.nativeElement.querySelector('mat-select[multiple]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.mat-column-group')).toBeNull();
  });

  it.each(['job filter', 'delayed missing profiles'])('preserves chosen export settings after %s changes', async change => {
    const profiles = new Subject<{ id: number; label: string }[]>();
    jest.spyOn(TestBed.inject(MissingsProfileService), 'getMissingsProfiles').mockReturnValue(profiles);
    const shared = await loadUnits();
    const element = fixture.nativeElement as HTMLElement;
    const scoreCheckbox = Array.from(element.querySelectorAll<HTMLElement>('mat-checkbox'))
      .find(checkbox => checkbox.textContent?.includes('codebook.coding.show-score'))
      ?.querySelector<HTMLInputElement>('input');
    expect(scoreCheckbox).toBeDefined();
    scoreCheckbox?.click();
    element.querySelector<HTMLInputElement>('input[type="radio"][value="json"]')?.click();
    await fixture.whenStable();
    const chosenOptions = { ...shared.contentOptions };
    expect(chosenOptions).toMatchObject({ exportFormat: 'json', showScore: false });

    if (change === 'job filter') {
      fixture.componentInstance.onJobDefinitionFilterChange(10);
    } else {
      profiles.next([{ id: 7, label: 'Profil' }]);
    }
    await fixture.whenStable();
    expect(shared.contentOptions).toEqual(chosenOptions);

    shared.toggleAll();
    await fixture.whenStable();
    element.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await fixture.whenStable();
    expect(start).toHaveBeenCalledWith(1, '0', expect.objectContaining({
      ...chosenOptions,
      missingsProfile: '0',
      jobDefinitionId: change === 'job filter' ? 10 : null
    }), [1]);
  });

  it('renders delayed progress and download errors and keeps exports locked until download ends', async () => {
    const shared = await loadUnits();
    shared.toggleAll();
    shared.exportCodingBook();
    await fixture.whenStable();
    expect(shared.busy).toBe(true);
    jest.advanceTimersByTime(1500);
    status.next({ status: 'processing', progress: 37 });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.progress-percentage').textContent).toContain('37%');
    status.next({ status: 'completed', progress: 100 });
    await fixture.whenStable();
    expect(shared.busy).toBe(true);
    shared.exportCodingBook();
    expect(start).toHaveBeenCalledTimes(1);
    download.error(new Error('download failed'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.failed').textContent).toContain('Failed to download');
    expect(shared.busy).toBe(false);
  });

  it('renders loading errors and stops outstanding status requests when destroyed', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    units.error(new Error('load failed'));
    await fixture.whenStable();
    const shared = fixture.debugElement.query(By.directive(CodebookExportComponent)).componentInstance as CodebookExportComponent;
    expect(shared.loading).toBe(false);
    fixture.componentInstance.unitList.set([1]);
    fixture.componentInstance.exportCodingBook();
    jest.advanceTimersByTime(1500);
    expect(status.observed).toBe(true);
    fixture.destroy();
    expect(status.observed).toBe(false);
    jest.advanceTimersByTime(3000);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });
});

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
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MatDialog, useValue: { open: jest.fn() } },
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
    const shared = fixture.debugElement.query(By.directive(CodebookExportComponent)).componentInstance as CodebookExportComponent;
    shared.toggleAll();
    await fixture.whenStable();
    expect(exportButton().disabled).toBe(false);
    exportButton().click();
    await fixture.whenStable();
    start.next({ jobId: 'job-1', message: 'Started' });
    await fixture.whenStable();
    jest.advanceTimersByTime(1500);
  }

  it('ends loading and displays selectable units after a delayed response', async () => {
    expect(fixture.nativeElement.querySelector('mat-header-cell input').disabled).toBe(true);
    units.next([{
      id: 1, unitId: 'UNIT', fileName: 'UNIT.vocs', data: '{}'
    }]);
    await fixture.whenStable();
    expect(fixture.debugElement.query(By.directive(CodebookExportComponent)).componentInstance.loading).toBe(false);
    expect(fixture.nativeElement.querySelector('mat-table').textContent).toContain('UNIT');
    expect(fixture.nativeElement.querySelectorAll('mat-row')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('mat-header-cell input').disabled).toBe(false);
  });

  it('ends loading after a delayed unit-list failure', async () => {
    units.error(new Error('Units failed'));
    await fixture.whenStable();
    expect(fixture.debugElement.query(By.directive(CodebookExportComponent)).componentInstance.loading).toBe(false);
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
    expect(fixture.nativeElement.querySelector('.progress-container.completed')).toBeNull();
    expect(exportButton().disabled).toBe(true);
    expect(downloadCodebookFile).toHaveBeenCalledWith(1, 'job-1');
    window.URL.createObjectURL = jest.fn(() => 'blob:codebook');
    window.URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    download.next(new Blob(['codebook']));
    await fixture.whenStable();
    expect(exportButton().disabled).toBe(false);
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
    const shared = fixture.debugElement.query(By.directive(CodebookExportComponent)).componentInstance as CodebookExportComponent;
    shared.toggleAll();
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
