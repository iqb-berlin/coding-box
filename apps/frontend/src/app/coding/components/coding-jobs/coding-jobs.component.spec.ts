import {
  ComponentFixture, TestBed, fakeAsync, tick, flush
} from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CodingJobsComponent } from './coding-jobs.component';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { CoderService } from '../../services/coder.service';
import { CodingJob } from '../../models/coding-job.model';
import { Coder } from '../../models/coder.model';

describe('CodingJobsComponent', () => {
  let component: CodingJobsComponent;
  let fixture: ComponentFixture<CodingJobsComponent>;
  let backendServiceMock: Partial<BackendService>;
  let appServiceMock: Partial<AppService>;
  let coderServiceMock: Partial<CoderService>;
  let matSnackBarMock: Partial<MatSnackBar>;
  let matDialogMock: Partial<MatDialog>;

  const mockCodingJobs: Partial<CodingJob>[] = [
    {
      id: 1,
      name: 'Job 1',
      status: 'active',
      created_at: new Date('2023-01-01T00:00:00Z'),
      updated_at: new Date('2023-01-01T00:00:00Z'),
      assignedCoders: [1],
      totalUnits: 10,
      codedUnits: 5,
      openUnits: 5,
      progress: 50
    },
    {
      id: 2,
      name: 'Job 2',
      status: 'completed',
      created_at: new Date('2023-01-02T00:00:00Z'),
      updated_at: new Date('2023-01-02T00:00:00Z'),
      assignedCoders: [],
      totalUnits: 20,
      codedUnits: 20,
      openUnits: 0,
      progress: 100
    }
  ];

  const mockCoders: Coder[] = [
    { id: 1, name: 'Coder 1', displayName: 'Coder One' },
    { id: 2, name: 'Coder 2', displayName: 'Coder Two' }
  ] as Coder[];

  beforeEach(async () => {
    backendServiceMock = {
      getCodingIncompleteVariables: jest.fn().mockReturnValue(of([])),
      getCodingJobs: jest.fn().mockReturnValue(of({ data: mockCodingJobs })),
      getBulkCodingProgress: jest.fn().mockReturnValue(of({})),
      getCoderTrainings: jest.fn().mockReturnValue(of([])),
      deleteCodingJob: jest.fn().mockReturnValue(of({ success: true })),
      startCodingJob: jest.fn().mockReturnValue(of({ items: [], total: 0 })),
      restartCodingJobWithOpenUnits: jest.fn().mockReturnValue(of({})),
      applyCodingResults: jest.fn().mockReturnValue(of({ success: true })),
      bulkApplyCodingResults: jest.fn().mockReturnValue(of({
        success: true, jobsProcessed: 0, totalUpdatedResponses: 0, results: []
      }))
    };

    appServiceMock = {
      selectedWorkspaceId: 1,
      loggedUser: { sub: 'user-1' },
      createToken: jest.fn().mockReturnValue(of('token'))
    };

    coderServiceMock = {
      getCoders: jest.fn().mockReturnValue(of(mockCoders))
    };

    matSnackBarMock = {
      open: jest.fn().mockReturnValue({ dismiss: jest.fn() })
    };

    matDialogMock = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot(),
        CodingJobsComponent
      ],
      providers: [
        provideNoopAnimations(),
        { provide: BackendService, useValue: backendServiceMock },
        { provide: AppService, useValue: appServiceMock },
        { provide: CoderService, useValue: coderServiceMock },
        { provide: MatSnackBar, useValue: matSnackBarMock },
        { provide: MatDialog, useValue: matDialogMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: {} } }
        }
      ]
    }).overrideComponent(CodingJobsComponent, {
      add: {
        providers: [
          { provide: BackendService, useValue: backendServiceMock },
          { provide: AppService, useValue: appServiceMock },
          { provide: CoderService, useValue: coderServiceMock },
          { provide: MatSnackBar, useValue: matSnackBarMock },
          { provide: MatDialog, useValue: matDialogMock }
        ]
      }
    }).compileComponents();

    fixture = TestBed.createComponent(CodingJobsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load coding jobs and coders on init', () => {
    expect(backendServiceMock.getCodingJobs).toHaveBeenCalledWith(1);
    expect(coderServiceMock.getCoders).toHaveBeenCalled();
    expect(component.dataSource.data.length).toBe(2);
    expect(component.allCoders.length).toBe(2);
  });

  it('should return correct status text', () => {
    expect(component.getStatusText('active')).toBe('Aktiv');
    expect(component.getStatusText('completed')).toBe('Abgeschlossen');
    expect(component.getStatusText('unknown')).toBe('unknown');
  });

  it('should return correct status class', () => {
    expect(component.getStatusClass('active')).toBe('status-active');
    expect(component.getStatusClass('completed')).toBe('status-completed');
    expect(component.getStatusClass('unknown')).toBe('');
  });

  it('should filter jobs by status', () => {
    component.selectedStatus = 'active';
    component.onStatusFilterChange();
    expect(component.dataSource.data.length).toBe(1);
    expect(component.dataSource.data[0].id).toBe(1);

    component.selectedStatus = 'all';
    component.onStatusFilterChange();
    expect(component.dataSource.data.length).toBe(2);
  });

  it('should return correct progress string', () => {
    const job = mockCodingJobs[0] as CodingJob;
    const progress = component.getProgress(job);
    expect(progress).toContain('50%');
    expect(progress).toContain('5/10');
    expect(progress).toContain('5 offen');

    const completedJob = mockCodingJobs[1] as CodingJob;
    expect(component.getProgress(completedJob)).toBe('100% (20/20)');

    expect(component.getProgress(null as unknown as CodingJob)).toBe('Keine Daten');
    expect(component.getProgress({ totalUnits: 0 } as unknown as CodingJob)).toBe('Keine Aufgaben');
  });

  it('should return correct coder names', () => {
    const job = mockCodingJobs[0] as CodingJob;
    const names = component.getAssignedCoderNames(job);
    expect(names).toBe('Coder One');

    const jobNoCoders = mockCodingJobs[1] as CodingJob;
    expect(component.getAssignedCoderNames(jobNoCoders)).toBe('Keine');
  });

  it('should handle coding job deletion', () => {
    const job = mockCodingJobs[0] as CodingJob;
    (matDialogMock.open as jest.Mock).mockReturnValue({
      afterClosed: () => of(true)
    });

    component.deleteCodingJob(job);

    expect(matDialogMock.open).toHaveBeenCalled();
    expect(backendServiceMock.deleteCodingJob).toHaveBeenCalledWith(1, job.id);
    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      expect.stringContaining('erfolgreich gelöscht'),
      'Schließen',
      expect.objectContaining({})
    );
  });

  it('should handle bulk delete', fakeAsync(() => {
    const jobs = [component.dataSource.data[0]];
    component.selection.select(...jobs);
    expect(component.selection.selected.length).toBe(1);

    (matDialogMock.open as jest.Mock).mockReturnValue({
      afterClosed: () => of(true)
    });

    component.bulkDeleteCodingJobs();
    tick(); // Dialog afterClosed
    flush(); // All deletions

    expect(backendServiceMock.deleteCodingJob).toHaveBeenCalledTimes(1);
    expect(matSnackBarMock.open).toHaveBeenCalled();
  }));

  it('should handle window focus', () => {
    const loadSpy = jest.spyOn(component, 'loadCodingJobs');
    window.dispatchEvent(new Event('focus'));
    expect(loadSpy).toHaveBeenCalled();
  });

  it('should handle start coding job', () => {
    const job = mockCodingJobs[0] as CodingJob;
    (backendServiceMock.startCodingJob as jest.Mock).mockReturnValue(of({
      total: 1,
      items: [{
        unitName: 'Unit 1',
        variableId: 'Var 1',
        personLogin: 'Person 1',
        personCode: 'Code 1',
        bookletName: 'Booklet 1',
        replayUrl: 'http://replay.url'
      }]
    }));
    window.open = jest.fn();
    const localStorageSpy = jest.spyOn(Storage.prototype, 'setItem');

    component.startCodingJob(job);

    expect(backendServiceMock.startCodingJob).toHaveBeenCalledWith(1, job.id);
    expect(appServiceMock.createToken).toHaveBeenCalled();
    expect(localStorageSpy).toHaveBeenCalledWith(
      `replay_booklet_${job.id}`,
      expect.stringContaining('Coding-Job: Job 1')
    );
    expect(window.open).toHaveBeenCalled();
    localStorageSpy.mockRestore();
  });

  it('should handle restart coding job', fakeAsync(() => {
    const job = mockCodingJobs[0] as CodingJob;
    (matDialogMock.open as jest.Mock).mockReturnValue({
      afterClosed: () => of(true)
    });
    (backendServiceMock.restartCodingJobWithOpenUnits as jest.Mock).mockReturnValue(of(job));
    (backendServiceMock.startCodingJob as jest.Mock).mockReturnValue(of({
      total: 1,
      items: [{
        unitName: 'Unit 1',
        variableId: 'Var 1',
        personLogin: 'Person 1',
        personCode: 'Code 1',
        bookletName: 'Booklet 1',
        replayUrl: 'http://replay.url'
      }]
    }));
    window.open = jest.fn();

    component.restartCodingJob(job);
    tick();

    expect(matDialogMock.open).toHaveBeenCalled();
    expect(backendServiceMock.restartCodingJobWithOpenUnits).toHaveBeenCalledWith(1, job.id);
    expect(backendServiceMock.startCodingJob).toHaveBeenCalledWith(1, job.id);
    expect(window.open).toHaveBeenCalled();
  }));

  it('should calculate next id correctly', () => {
    expect((component as unknown as { getNextId: () => number }).getNextId()).toBe(3);

    component.dataSource.data = [];
    expect((component as unknown as { getNextId: () => number }).getNextId()).toBe(1);
  });

  it('should handle apply coding results', () => {
    const job = mockCodingJobs[0] as CodingJob;
    component.applyCodingResults(job);

    expect(backendServiceMock.applyCodingResults).toHaveBeenCalledWith(1, job.id);
    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      expect.stringContaining('Ergebnisse erfolgreich angewendet'),
      'Schließen',
      expect.objectContaining({})
    );
  });

  it('should handle bulk apply coding results', () => {
    (matDialogMock.open as jest.Mock).mockReturnValue({
      afterClosed: () => of(true)
    });

    component.bulkApplyCodingResults();

    expect(matDialogMock.open).toHaveBeenCalled();
    expect(backendServiceMock.bulkApplyCodingResults).toHaveBeenCalledWith(1);
    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      expect.stringContaining('Massenanwendung abgeschlossen'),
      'Schließen',
      expect.objectContaining({})
    );
  });

  it('should handle API errors when loading jobs', () => {
    (backendServiceMock.getCodingIncompleteVariables as jest.Mock).mockReturnValue(throwError(() => new Error('API Error')));
    (backendServiceMock.getCodingJobs as jest.Mock).mockReturnValue(throwError(() => new Error('API Error')));

    component.loadCodingJobs();

    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      'Fehler beim Laden der Kodierjobs',
      'Schließen',
      expect.objectContaining({})
    );
  });
});
