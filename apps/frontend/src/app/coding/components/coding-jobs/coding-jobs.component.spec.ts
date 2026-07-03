import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick,
  flush
} from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { of, throwError } from 'rxjs';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CodingJobsComponent } from './coding-jobs.component';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { AppService } from '../../../core/services/app.service';
import { CoderService } from '../../services/coder.service';
import { CodingJob } from '../../models/coding-job.model';
import { Coder } from '../../models/coder.model';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';

describe('CodingJobsComponent', () => {
  let component: CodingJobsComponent;
  let fixture: ComponentFixture<CodingJobsComponent>;
  let codingJobBackendServiceMock: Partial<CodingJobBackendService>;
  let codingTrainingBackendServiceMock: Partial<CodingTrainingBackendService>;
  let appServiceMock: Partial<AppService>;
  let coderServiceMock: Partial<CoderService>;
  let matSnackBarMock: Partial<MatSnackBar>;
  let matDialogMock: Partial<MatDialog>;
  let userBackendServiceMock: Partial<UserBackendService>;
  let overlayContainer: OverlayContainer;

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
    codingJobBackendServiceMock = {
      getCodingIncompleteVariables: jest.fn().mockReturnValue(of([])),
      getCodingJobs: jest.fn().mockReturnValue(
        of({
          data: mockCodingJobs,
          total: mockCodingJobs.length,
          page: 1,
          limit: 50
        })
      ),
      getBulkCodingProgress: jest.fn().mockReturnValue(of({})),
      deleteCodingJob: jest.fn().mockReturnValue(of({ success: true })),
      startCodingJob: jest.fn().mockReturnValue(of({ items: [], total: 0 })),
      prepareCodingJobReview: jest
        .fn()
        .mockReturnValue(of({ total: 0, firstReplayUrl: '' })),
      restartCodingJobWithOpenUnits: jest.fn().mockReturnValue(of({})),
      transferCodingCases: jest.fn().mockReturnValue(
        of({
          sourceCoderId: 1,
          targetCoderId: 2,
          affectedJobs: 2,
          updatedAssignments: 2,
          removedDuplicateAssignments: 0,
          transferredCases: 10
        })
      ),
      applyCodingResults: jest.fn().mockReturnValue(
        of({
          success: true,
          updatedResponsesCount: 1,
          skippedReviewCount: 0,
          skippedAlreadyCodedCount: 0,
          overwrittenExistingCount: 0,
          messageKey: 'coding-results.apply.success.bulk'
        })
      ),
      bulkApplyCodingResults: jest.fn().mockReturnValue(
        of({
          success: true,
          jobsProcessed: 0,
          totalUpdatedResponses: 0,
          totalSkippedReview: 0,
          totalSkippedAlreadyCoded: 0,
          totalOverwrittenExisting: 0,
          results: []
        })
      )
    };

    codingTrainingBackendServiceMock = {
      getCoderTrainings: jest.fn().mockReturnValue(of([]))
    };

    appServiceMock = {
      selectedWorkspaceId: 1,
      authData: {
        userId: 1,
        isAdmin: false,
        userName: '',
        email: '',
        firstName: '',
        lastName: '',
        workspaces: []
      },
      loggedUser: { sub: 'user-1' },
      createOwnToken: jest.fn().mockReturnValue(of('token'))
    };

    userBackendServiceMock = {
      getUsers: jest.fn().mockReturnValue(of([{ id: 1, accessLevel: 3 }]))
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
      imports: [TranslateModule.forRoot(), CodingJobsComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: CodingJobBackendService,
          useValue: codingJobBackendServiceMock
        },
        {
          provide: CodingTrainingBackendService,
          useValue: codingTrainingBackendServiceMock
        },
        { provide: AppService, useValue: appServiceMock },
        { provide: UserBackendService, useValue: userBackendServiceMock },
        { provide: CoderService, useValue: coderServiceMock },
        { provide: MatSnackBar, useValue: matSnackBarMock },
        { provide: MatDialog, useValue: matDialogMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: {} } }
        }
      ]
    })
      .overrideComponent(CodingJobsComponent, {
        add: {
          providers: [
            {
              provide: CodingJobBackendService,
              useValue: codingJobBackendServiceMock
            },
            {
              provide: CodingTrainingBackendService,
              useValue: codingTrainingBackendServiceMock
            },
            { provide: AppService, useValue: appServiceMock },
            { provide: UserBackendService, useValue: userBackendServiceMock },
            { provide: CoderService, useValue: coderServiceMock },
            { provide: MatSnackBar, useValue: matSnackBarMock },
            { provide: MatDialog, useValue: matDialogMock }
          ]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(CodingJobsComponent);
    component = fixture.componentInstance;
    overlayContainer = TestBed.inject(OverlayContainer);
    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      coding: {
        jobs: {
          'issue-tooltip': {
            'no-review-issues': 'Keine prüfpflichtigen Kodierungsprobleme',
            'open-no-review-issues-singular':
              '{{count}} offene Aufgabe, keine prüfpflichtigen Kodierungsprobleme',
            'open-no-review-issues-plural':
              '{{count}} offene Aufgaben, keine prüfpflichtigen Kodierungsprobleme',
            'code-assignment-uncertain': '{{count}}x Code-Vergabe unsicher',
            'new-code-needed': '{{count}}x neuer Code benötigt'
          }
        }
      }
    });
    translateService.use('de');
    fixture.detectChanges();
  });

  afterEach(() => {
    overlayContainer.ngOnDestroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load coding jobs and coders on init', () => {
    expect(codingJobBackendServiceMock.getCodingJobs).toHaveBeenCalledWith(
      1,
      1,
      50,
      expect.objectContaining({
        scope: 'all',
        includeIssueSummary: true
      })
    );
    expect(coderServiceMock.getCoders).toHaveBeenCalled();
    expect(component.dataSource.data.length).toBe(2);
    expect(component.allCoders.length).toBe(2);
    expect(component.jobsTotal).toBe(2);
  });

  it('should not emit jobsChanged for a plain reload', fakeAsync(() => {
    const jobsChangedSpy = jest.spyOn(component.jobsChanged, 'emit');

    component.loadCodingJobs();
    tick();
    flush();

    expect(jobsChangedSpy).not.toHaveBeenCalled();
  }));

  it('should remove the window focus listener on destroy', () => {
    const removeListenerSpy = jest.spyOn(window, 'removeEventListener');

    component.ngOnDestroy();

    expect(removeListenerSpy).toHaveBeenCalledWith(
      'focus',
      expect.any(Function)
    );
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

  it('does not flag open progress entries as coding issues', async () => {
    await fixture.whenStable();
    (codingJobBackendServiceMock.getCodingJobs as jest.Mock).mockReturnValue(
      of({
        data: [
          {
            ...mockCodingJobs[0],
            hasIssues: false,
            issueSummary: {
              total: 0,
              open: 1,
              codeAssignmentUncertain: 0,
              newCodeNeeded: 0
            }
          }
        ],
        total: 1,
        page: 1,
        limit: 50
      })
    );

    component.loadCodingJobs();
    await fixture.whenStable();

    const job = component.originalData.find(item => item.id === 1);
    expect(job).toBeDefined();
    const loadedJob = job as CodingJob;
    expect(loadedJob.hasIssues).toBe(false);
    expect(loadedJob.issueSummary).toEqual({
      total: 0,
      open: 1,
      codeAssignmentUncertain: 0,
      newCodeNeeded: 0
    });
    expect(component.getCodingIssueTooltip(loadedJob)).toContain(
      '1 offene Aufgabe'
    );
  });

  it('builds specific coding issue summaries for review issues', async () => {
    await fixture.whenStable();
    (codingJobBackendServiceMock.getCodingJobs as jest.Mock).mockReturnValue(
      of({
        data: [
          {
            ...mockCodingJobs[0],
            hasIssues: true,
            issueSummary: {
              total: 2,
              open: 0,
              codeAssignmentUncertain: 1,
              newCodeNeeded: 1
            }
          }
        ],
        total: 1,
        page: 1,
        limit: 50
      })
    );

    component.loadCodingJobs();
    await fixture.whenStable();

    const job = component.originalData.find(item => item.id === 1);
    expect(job).toBeDefined();
    const loadedJob = job as CodingJob;
    expect(loadedJob.hasIssues).toBe(true);
    expect(loadedJob.issueSummary).toEqual({
      total: 2,
      open: 0,
      codeAssignmentUncertain: 1,
      newCodeNeeded: 1
    });
    expect(component.getCodingIssueTooltip(loadedJob)).toBe(
      '1x Code-Vergabe unsicher, 1x neuer Code benötigt'
    );
  });

  it('should reload jobs with server-side status, coder, and job name filters', fakeAsync(() => {
    const getCodingJobs =
      codingJobBackendServiceMock.getCodingJobs as jest.Mock;

    component.selectedCoderId = 1;
    component.onCoderFilterChange();
    expect(getCodingJobs).toHaveBeenLastCalledWith(
      1,
      1,
      50,
      expect.objectContaining({ coderId: 1 })
    );

    component.selectedCoderId = null;
    component.selectedJobName = 'Job 2';
    component.onJobNameFilterChange();
    tick(300);
    expect(getCodingJobs).toHaveBeenLastCalledWith(
      1,
      1,
      50,
      expect.objectContaining({ jobName: 'Job 2' })
    );

    component.selectedJobName = null;
    component.selectedStatus = 'active';
    component.onStatusFilterChange();
    expect(getCodingJobs).toHaveBeenLastCalledWith(
      1,
      1,
      50,
      expect.objectContaining({ status: 'active' })
    );
  }));

  it('should handle loading coding jobs failure', fakeAsync(() => {
    (
      codingJobBackendServiceMock.getCodingJobs as jest.Mock
    ).mockReturnValueOnce(throwError(() => new Error('Error')));

    component.loadCodingJobs();
    tick();

    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      'Fehler beim Laden der Kodierjobs',
      'Schließen',
      expect.objectContaining({})
    );
  }));

  it('should view coding results', () => {
    const job = mockCodingJobs[0] as CodingJob;
    const dialogRefSpyObj = {
      afterClosed: jest.fn().mockReturnValue(of({ resultsApplied: true })),
      backdropClick: jest.fn().mockReturnValue(of(undefined)),
      keydownEvents: jest.fn().mockReturnValue(of()),
      componentInstance: {
        closeDialog: jest.fn()
      }
    };
    (matDialogMock.open as jest.Mock).mockReturnValue(dialogRefSpyObj);
    const loadSpy = jest.spyOn(component, 'loadCodingJobs');

    component.viewCodingResults(job);

    expect(matDialogMock.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        disableClose: true,
        data: expect.objectContaining({ codingJob: job })
      })
    );
    expect(loadSpy).toHaveBeenCalled();
    expect(dialogRefSpyObj.componentInstance.closeDialog).toHaveBeenCalled();
  });

  it('should not delete if confirmation cancelled', () => {
    const job = mockCodingJobs[0] as CodingJob;
    (matDialogMock.open as jest.Mock).mockReturnValue({
      afterClosed: () => of(false)
    });

    component.deleteCodingJob(job);
    expect(codingJobBackendServiceMock.deleteCodingJob).not.toHaveBeenCalled();
  });

  it('should format variable lists correctly', () => {
    const jobWithManyVars = {
      assignedVariables: [
        { unitName: 'U1', variableId: 'V1' },
        { unitName: 'U2', variableId: 'V2' },
        { unitName: 'U3', variableId: 'V3' },
        { unitName: 'U4', variableId: 'V4' }
      ]
    } as CodingJob;

    const formatted = component.getVariables(jobWithManyVars);
    expect(formatted).toContain('U1_V1');
    expect(formatted).toContain('U2_V2');
    expect(formatted).toContain('U3_V3');
    expect(formatted).toContain('+1 weitere');
  });

  it('should format bundle lists correctly', () => {
    const jobWithManyBundles = {
      assignedVariableBundles: [{ name: 'B1' }, { name: 'B2' }, { name: 'B3' }]
    } as CodingJob;

    const formatted = component.getVariableBundles(jobWithManyBundles);
    expect(formatted).toContain('3 (B1, B2, +1 weitere)');
  });

  it('should return correct progress string', () => {
    const job = mockCodingJobs[0] as CodingJob;
    const progress = component.getProgress(job);
    expect(progress).toContain('50%');
    expect(progress).toContain('5/10');
    expect(progress).toContain('5 offen');

    const completedJob = mockCodingJobs[1] as CodingJob;
    expect(component.getProgress(completedJob)).toBe('100% (20/20)');

    expect(
      component.getProgress({
        totalUnits: 10,
        codedUnits: 0,
        openUnits: 10,
        progress: 0
      } as CodingJob)
    ).toBe('0% (0/10, 10 offen)');

    expect(component.getProgress(null as unknown as CodingJob)).toBe(
      'Keine Daten'
    );
    expect(
      component.getProgress({ totalUnits: 0 } as unknown as CodingJob)
    ).toBe('Keine Aufgaben');
  });

  it('shows an explicit empty state when there are no coding jobs', () => {
    component.dataSource.data = [];
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.no-data-message')?.textContent
    ).toContain('Keine Kodierjobs vorhanden');
  });

  it('shows the refresh action by default', () => {
    expect(
      fixture.nativeElement.querySelector('.utility-actions')?.textContent
    ).toContain('Aktualisieren');
  });

  it('hides the refresh action when manual refresh is not available', () => {
    component.showRefreshAction = false;
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.utility-actions')?.textContent
    ).not.toContain('Aktualisieren');
  });

  it('should choose a single primary row action by job state', () => {
    component.canApplyResults = true;

    expect(component.getPrimaryJobAction(mockCodingJobs[0] as CodingJob)).toBe(
      'start'
    );
    expect(component.getPrimaryJobAction(mockCodingJobs[1] as CodingJob)).toBe(
      'apply'
    );

    component.showApplyActions = false;
    expect(component.getPrimaryJobAction(mockCodingJobs[1] as CodingJob)).toBe(
      'review'
    );

    component.showApplyActions = true;
    component.canApplyResults = false;
    expect(component.getPrimaryJobAction(mockCodingJobs[1] as CodingJob)).toBe(
      'review'
    );
    expect(
      component.getPrimaryJobAction({
        ...mockCodingJobs[0],
        assignedCoders: [2]
      } as CodingJob)
    ).toBe('review');
  });

  it('does not offer reviews for unassigned jobs without management access', () => {
    component.canApplyResults = false;
    component.canReviewCodingJobs = false;

    const job = {
      ...mockCodingJobs[0],
      assignedCoders: [2]
    } as CodingJob;

    expect(component.canReviewCodingJob(job)).toBe(false);
    expect(component.getPrimaryJobAction(job)).toBe('notAssigned');
  });

  it('does not offer review actions to assigned coders without management access', () => {
    component.canApplyResults = false;
    component.canReviewCodingJobs = false;

    expect(component.getPrimaryJobAction(mockCodingJobs[0] as CodingJob)).toBe(
      'start'
    );
    expect(
      component.getPrimaryJobAction({
        ...mockCodingJobs[1],
        assignedCoders: [1]
      } as CodingJob)
    ).toBe('results');
    expect(
      component.getPrimaryJobAction({
        ...mockCodingJobs[1],
        status: 'review',
        assignedCoders: [1]
      } as CodingJob)
    ).toBe('results');
  });

  it('does not start coding jobs that are assigned to another coder', () => {
    const job = {
      ...mockCodingJobs[0],
      assignedCoders: [2]
    } as CodingJob;

    component.startCodingJob(job);

    expect(codingJobBackendServiceMock.startCodingJob).not.toHaveBeenCalled();
    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      'Dieser Kodierjob ist Ihnen nicht als Kodierer zugewiesen.',
      'Schließen',
      { duration: 4000 }
    );
  });

  it('should only allow applying results for completed or review non-training jobs', () => {
    component.canApplyResults = true;

    expect(
      component.canApplyCodingResults(mockCodingJobs[1] as CodingJob)
    ).toBe(true);
    expect(
      component.canApplyCodingResults({
        ...mockCodingJobs[1],
        status: 'review'
      } as CodingJob)
    ).toBe(true);
    expect(
      component.canApplyCodingResults(mockCodingJobs[0] as CodingJob)
    ).toBe(false);
    expect(
      component.canApplyCodingResults({
        ...mockCodingJobs[1],
        training_id: 1
      } as CodingJob)
    ).toBe(false);
    expect(
      component.canApplyCodingResults({
        ...mockCodingJobs[1],
        freshnessStatus: 'review_required'
      } as CodingJob)
    ).toBe(true);
    expect(
      component.canApplyCodingResults({
        ...mockCodingJobs[1],
        freshnessStatus: 'stale_source'
      } as CodingJob)
    ).toBe(false);
  });

  it('separates coding-manager and study-manager permissions', () => {
    (userBackendServiceMock.getUsers as jest.Mock).mockReturnValue(
      of([{ id: 1, accessLevel: 2 }])
    );

    (
      component as unknown as { updateCodingJobPermissions: () => void }
    ).updateCodingJobPermissions();

    expect(component.canManageCodingJobs).toBe(true);
    expect(component.canReviewCodingJobs).toBe(true);
    expect(component.canApplyResults).toBe(false);
  });

  it('should only show restart for non-training jobs with open units', () => {
    expect(component.canRestartCodingJob(mockCodingJobs[0] as CodingJob)).toBe(
      true
    );
    expect(component.canRestartCodingJob(mockCodingJobs[1] as CodingJob)).toBe(
      false
    );
    expect(
      component.canRestartCodingJob({
        ...mockCodingJobs[0],
        training_id: 1
      } as CodingJob)
    ).toBe(false);
  });

  it('hides job management actions without coding-manager access', async () => {
    component.canManageCodingJobs = false;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.bulk-delete-button')).toBeNull();
    expect(component.canRestartCodingJob(mockCodingJobs[0] as CodingJob)).toBe(false);

    const trigger = fixture.nativeElement.querySelector(
      '.more-actions-button'
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const overlayElement = overlayContainer.getContainerElement();
    expect(overlayElement.querySelector('.danger-menu-item')).toBeNull();
  });

  it('separates deleting a coding job from regular row actions', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const trigger = fixture.nativeElement.querySelector(
      '.more-actions-button'
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const overlayElement = overlayContainer.getContainerElement();

    expect(overlayElement.querySelector('.menu-section-divider')).toBeTruthy();
    expect(
      overlayElement.querySelector('.danger-menu-item')?.textContent
    ).toContain('Kodierjob löschen');
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
    expect(codingJobBackendServiceMock.deleteCodingJob).toHaveBeenCalledWith(
      1,
      job.id
    );
    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      expect.stringContaining('erfolgreich gelöscht'),
      'Schließen',
      expect.objectContaining({})
    );
  });

  it('blocks direct management actions without coding-manager access', fakeAsync(() => {
    component.canManageCodingJobs = false;
    component.selection.select(component.dataSource.data[0]);

    component.deleteCodingJob(mockCodingJobs[0] as CodingJob);
    component.bulkDeleteCodingJobs();
    component.openTransferCodingCasesDialog();
    tick();

    expect(matDialogMock.open).not.toHaveBeenCalled();
    expect(codingJobBackendServiceMock.deleteCodingJob).not.toHaveBeenCalled();
    expect(codingJobBackendServiceMock.transferCodingCases).not.toHaveBeenCalled();
    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      'Keine Berechtigung zum Verwalten von Kodierjobs.',
      'Schließen',
      { duration: 4000 }
    );
  }));

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

    expect(codingJobBackendServiceMock.deleteCodingJob).toHaveBeenCalledTimes(
      1
    );
    expect(matSnackBarMock.open).toHaveBeenCalled();
  }));

  it('should ignore window focus by default', () => {
    const loadSpy = jest.spyOn(component, 'loadCodingJobs');
    window.dispatchEvent(new Event('focus'));
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('should handle window focus when auto reload is enabled', () => {
    component.autoReloadOnFocus = true;
    const loadSpy = jest.spyOn(component, 'loadCodingJobs');
    window.dispatchEvent(new Event('focus'));
    expect(loadSpy).toHaveBeenCalled();
  });

  it('should handle start coding job', () => {
    const job = mockCodingJobs[0] as CodingJob;
    (codingJobBackendServiceMock.startCodingJob as jest.Mock).mockReturnValue(
      of({
        total: 1,
        firstReplayUrl: 'http://replay.url',
        items: [
          {
            unitName: 'Unit 1',
            variableId: 'Var 1',
            personLogin: 'Person 1',
            personCode: 'Code 1',
            bookletName: 'Booklet 1',
            replayUrl: 'http://replay.url'
          }
        ]
      })
    );
    jest.spyOn(window, 'open').mockImplementation(() => null);

    component.startCodingJob(job);

    expect(codingJobBackendServiceMock.startCodingJob).toHaveBeenCalledWith(
      1,
      job.id
    );
    expect(appServiceMock.createOwnToken).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalled();
  });

  it('opens backend-generated replay URLs on the current frontend origin', () => {
    const job = mockCodingJobs[0] as CodingJob;
    (codingJobBackendServiceMock.startCodingJob as jest.Mock).mockReturnValue(
      of({
        total: 1,
        firstReplayUrl: 'http://localhost:3333/#/replay/person/unit/0/var'
      })
    );
    jest.spyOn(window, 'open').mockImplementation(() => null);

    component.startCodingJob(job);

    expect(window.open).toHaveBeenCalledWith(
      'http://localhost/#/replay/person/unit/0/var?mode=coding&codingJobId=1&workspaceId=1',
      '_blank'
    );
  });

  it('opens coding job reviews read-only without starting the job', () => {
    const job = {
      ...mockCodingJobs[0],
      assignedCoders: [2]
    } as CodingJob;
    (
      codingJobBackendServiceMock.prepareCodingJobReview as jest.Mock
    ).mockReturnValue(
      of({
        total: 1,
        firstReplayUrl: 'http://localhost:3333/#/replay/person/unit/0/var'
      })
    );
    jest.spyOn(window, 'open').mockImplementation(() => null);

    component.openCodingJobReview(job);

    expect(codingJobBackendServiceMock.startCodingJob).not.toHaveBeenCalled();
    expect(
      codingJobBackendServiceMock.prepareCodingJobReview
    ).toHaveBeenCalledWith(1, job.id);
    expect(window.open).toHaveBeenCalledWith(
      'http://localhost/#/replay/person/unit/0/var?mode=coding-review&codingJobId=1&workspaceId=1',
      '_blank'
    );
  });

  it('should handle restart coding job', fakeAsync(() => {
    const job = mockCodingJobs[0] as CodingJob;
    (matDialogMock.open as jest.Mock).mockReturnValue({
      afterClosed: () => of(true)
    });
    (
      codingJobBackendServiceMock.restartCodingJobWithOpenUnits as jest.Mock
    ).mockReturnValue(of(job));
    (codingJobBackendServiceMock.startCodingJob as jest.Mock).mockReturnValue(
      of({
        total: 1,
        firstReplayUrl: 'http://replay.url',
        items: [
          {
            unitName: 'Unit 1',
            variableId: 'Var 1',
            personLogin: 'Person 1',
            personCode: 'Code 1',
            bookletName: 'Booklet 1',
            replayUrl: 'http://replay.url'
          }
        ]
      })
    );
    window.open = jest.fn();

    component.restartCodingJob(job);
    tick();

    expect(matDialogMock.open).toHaveBeenCalled();
    expect(
      codingJobBackendServiceMock.restartCodingJobWithOpenUnits
    ).toHaveBeenCalledWith(1, job.id);
    expect(codingJobBackendServiceMock.startCodingJob).toHaveBeenCalledWith(
      1,
      job.id
    );
    expect(window.open).toHaveBeenCalled();
    expect((window.open as jest.Mock).mock.calls[0][0]).toContain(
      'onlyOpen=true'
    );
  }));

  it('should calculate next id correctly', () => {
    expect(
      (component as unknown as { getNextId: () => number }).getNextId()
    ).toBe(3);

    component.dataSource.data = [];
    expect(
      (component as unknown as { getNextId: () => number }).getNextId()
    ).toBe(1);
  });

  it('should handle apply coding results', () => {
    const job = mockCodingJobs[0] as CodingJob;
    (matDialogMock.open as jest.Mock).mockReturnValue({
      afterClosed: () => of({ overwriteExisting: false })
    });

    component.applyCodingResults(job);

    expect(codingJobBackendServiceMock.applyCodingResults).toHaveBeenCalledWith(
      1,
      job.id,
      {
        overwriteExisting: false
      }
    );
    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      expect.stringContaining('Ergebnisse erfolgreich angewendet'),
      'Schließen',
      expect.objectContaining({})
    );
  });

  it('should handle bulk apply coding results', () => {
    const staleBulkApplySkipMessage = [
      'Jobs mit Problemen',
      'werden übersprungen'
    ].join(' ');
    (
      codingJobBackendServiceMock.bulkApplyCodingResults as jest.Mock
    ).mockReturnValueOnce(
      of({
        success: true,
        jobsProcessed: 1,
        totalUpdatedResponses: 2,
        totalSkippedReview: 2,
        totalSkippedAlreadyCoded: 0,
        totalOverwrittenExisting: 0,
        results: [
          {
            jobId: 2,
            jobName: 'Job 2',
            hasIssues: true,
            skipped: false,
            result: {
              success: true,
              updatedResponsesCount: 2,
              skippedReviewCount: 2,
              skippedAlreadyCodedCount: 0,
              overwrittenExistingCount: 0,
              messageKey: 'coding-results.apply.success.partial'
            }
          }
        ]
      })
    );
    (matDialogMock.open as jest.Mock).mockReturnValue({
      afterClosed: () => of(true)
    });

    component.bulkApplyCodingResults();

    expect(matDialogMock.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          message: expect.stringContaining('offenen Kodierungshinweisen')
        })
      })
    );
    expect(matDialogMock.open).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          message: expect.stringContaining(staleBulkApplySkipMessage)
        })
      })
    );
    expect(
      codingJobBackendServiceMock.bulkApplyCodingResults
    ).toHaveBeenCalledWith(1);
    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      expect.stringContaining('Massenanwendung abgeschlossen'),
      'Schließen',
      expect.objectContaining({})
    );
    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      expect.stringContaining('2 Ergebnisse zur manuellen Prüfung offen'),
      'Schließen',
      expect.objectContaining({})
    );
  });

  it('should transfer coding cases between coders', () => {
    (matDialogMock.open as jest.Mock).mockReturnValue({
      afterClosed: () => of({
        sourceCoderId: 1,
        targetCoderId: 2
      })
    });

    component.openTransferCodingCasesDialog();

    expect(
      codingJobBackendServiceMock.transferCodingCases
    ).toHaveBeenCalledWith(1, 1, 2);
    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      expect.stringContaining('Übertragung erfolgreich'),
      'Schließen',
      expect.objectContaining({})
    );
  });

  it('should handle API errors when loading jobs', () => {
    (
      codingJobBackendServiceMock.getCodingIncompleteVariables as jest.Mock
    ).mockReturnValue(throwError(() => new Error('API Error')));
    (codingJobBackendServiceMock.getCodingJobs as jest.Mock).mockReturnValue(
      throwError(() => new Error('API Error'))
    );

    component.loadCodingJobs();

    expect(matSnackBarMock.open).toHaveBeenCalledWith(
      'Fehler beim Laden der Kodierjobs',
      'Schließen',
      expect.objectContaining({})
    );
  });
});
