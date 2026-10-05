import { provideZonelessChangeDetection } from '@angular/core';
import {
  ComponentFixture, TestBed, fakeAsync, tick
} from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { CodebookExportComponent } from '@iqb/ngx-coding-components/codebook-export';
import { of, Subject } from 'rxjs';
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

  function loadUnits(): CodebookExportComponent {
    fixture.detectChanges();
    tick();
    units.next([{
      id: 1, unitId: 'UNIT', fileName: 'Aufgabe.vocs', data: '{}'
    }]);
    tick();
    return fixture.debugElement.query(By.directive(CodebookExportComponent)).componentInstance as CodebookExportComponent;
  }

  it('renders asynchronously loaded tasks and the common training filter without a manual refresh', fakeAsync(() => {
    const shared = loadUnits();
    expect(fixture.nativeElement.textContent).toContain('Aufgabe');
    expect(shared.loading).toBe(false);
    expect(shared.showGroupColumn).toBe(false);
    expect(fixture.nativeElement.querySelector('.codebook-training-filter')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('coding.variable-bundle-filter');
    expect(fixture.nativeElement.querySelector('mat-select[multiple]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.mat-column-group')).toBeNull();
  }));

  it('renders delayed progress and download errors and keeps exports locked until download ends', fakeAsync(() => {
    const shared = loadUnits();
    shared.toggleAll();
    shared.exportCodingBook();
    tick();
    expect(shared.busy).toBe(true);
    tick(1500);
    status.next({ status: 'processing', progress: 37 });
    tick();
    expect(fixture.nativeElement.querySelector('.progress-percentage').textContent).toContain('37%');
    status.next({ status: 'completed', progress: 100 });
    tick();
    expect(shared.busy).toBe(true);
    shared.exportCodingBook();
    expect(start).toHaveBeenCalledTimes(1);
    download.error(new Error('download failed'));
    tick();
    expect(fixture.nativeElement.querySelector('.failed').textContent).toContain('Failed to download');
    expect(shared.busy).toBe(false);
  }));

  it('renders loading errors and stops outstanding status requests when destroyed', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    units.error(new Error('load failed'));
    tick();
    const shared = fixture.debugElement.query(By.directive(CodebookExportComponent)).componentInstance as CodebookExportComponent;
    expect(shared.loading).toBe(false);
    fixture.componentInstance.unitList = [1];
    fixture.componentInstance.exportCodingBook();
    tick(1500);
    expect(status.observed).toBe(true);
    fixture.destroy();
    expect(status.observed).toBe(false);
    tick(3000);
    expect(getStatus).toHaveBeenCalledTimes(1);
  }));
});
