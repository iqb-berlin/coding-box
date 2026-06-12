import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodingJob } from '../../models/coding-job.model';
import { MyCodingJobsComponent } from './my-coding-jobs.component';

describe('MyCodingJobsComponent', () => {
  let fixture: ComponentFixture<MyCodingJobsComponent>;
  let component: MyCodingJobsComponent;

  const completedJob: CodingJob = {
    id: 10,
    workspace_id: 1,
    name: 'Completed job',
    status: 'completed',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-02T00:00:00.000Z'),
    assignedCoders: [7],
    progress: 100,
    codedUnits: 3,
    totalUnits: 3
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyCodingJobsComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        {
          provide: AppService,
          useValue: {
            authData$: of({
              userId: 7,
              workspaces: []
            }),
            loggedUser: { sub: 'user-7' },
            createOwnToken: jest.fn().mockReturnValue(of('token'))
          }
        },
        {
          provide: CodingJobBackendService,
          useValue: {
            getCodingJobs: jest.fn().mockReturnValue(
              of({
                data: [],
                total: 0,
                page: 1,
                limit: 100
              })
            ),
            startCodingJob: jest.fn().mockReturnValue(
              of({
                total: 1,
                firstReplayUrl: 'https://example.test/replay'
              })
            ),
            prepareCodingJobReview: jest.fn().mockReturnValue(
              of({
                total: 1,
                firstReplayUrl: 'https://example.test/review'
              })
            ),
            submitCodingJobForReview: jest.fn().mockReturnValue(
              of({
                ...completedJob,
                status: 'review'
              })
            )
          }
        },
        {
          provide: MatSnackBar,
          useValue: {
            open: jest.fn().mockReturnValue({ dismiss: jest.fn() })
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(MyCodingJobsComponent);
    component = fixture.componentInstance;
  });

  it('renders completed coding jobs with start and submit-for-review actions', () => {
    component.isAuthorized = true;
    component.isLoading = false;
    component.dataSource.data = [completedJob];
    component.jobsTotal = 1;

    fixture.detectChanges();

    const actionCell: HTMLElement =
      fixture.nativeElement.querySelector('.actions-cell');
    const buttons = actionCell.querySelectorAll('button');

    expect(buttons).toHaveLength(2);
    expect(actionCell.textContent).toContain('play_arrow');
    expect(actionCell.textContent).toContain('send');
    expect(component.getStartCodingJobLabel(completedJob)).toBe(
      'coding.my-coding-jobs.restart-coding'
    );
  });

  it.each(['review', 'results_applied'])(
    'renders %s coding jobs with a single read-only review action',
    status => {
      const job = {
        ...completedJob,
        status
      };
      component.isAuthorized = true;
      component.isLoading = false;
      component.dataSource.data = [job];
      component.jobsTotal = 1;

      fixture.detectChanges();

      const actionCell: HTMLElement =
        fixture.nativeElement.querySelector('.actions-cell');
      const buttons = actionCell.querySelectorAll('button');

      expect(buttons).toHaveLength(1);
      expect(actionCell.textContent).toContain('visibility');
      expect(actionCell.textContent).not.toContain('send');
      expect(component.getStartCodingJobLabel(job)).toBe(
        'coding.my-coding-jobs.open-review'
      );
    }
  );

  it('submits completed coding jobs for review after confirmation', () => {
    const codingJobBackendService = TestBed.inject(
      CodingJobBackendService
    ) as unknown as {
      submitCodingJobForReview: jest.Mock;
    };
    const dialog = {
      open: jest.fn().mockReturnValue({ afterClosed: () => of(true) })
    };
    const snackBar = TestBed.inject(MatSnackBar) as unknown as {
      open: jest.Mock;
    };
    (component as unknown as { dialog: typeof dialog }).dialog = dialog;

    component.submitCodingJobForReview(completedJob);

    expect(dialog.open).toHaveBeenCalled();
    expect(codingJobBackendService.submitCodingJobForReview).toHaveBeenCalledWith(
      1,
      10
    );
    expect(snackBar.open).toHaveBeenCalledWith(
      'coding.my-coding-jobs.submit-for-review-success',
      'close',
      { duration: 3000 }
    );
  });

  it('loads only the selected workspace through the own-jobs backend filter', () => {
    const codingJobBackendService = TestBed.inject(
      CodingJobBackendService
    ) as unknown as {
      getCodingJobs: jest.Mock;
    };
    component.workspaceId = 5;

    component.loadMyCodingJobs([
      { id: 1, name: 'Other workspace' },
      { id: 5, name: 'Target workspace' }
    ]);

    expect(codingJobBackendService.getCodingJobs).toHaveBeenCalledTimes(1);
    expect(codingJobBackendService.getCodingJobs).toHaveBeenCalledWith(
      5,
      1,
      50,
      expect.objectContaining({
        assignedTo: 'me'
      })
    );
    expect(codingJobBackendService.getCodingJobs.mock.calls[0][3])
      .not.toHaveProperty('excludeStatus');
  });

  it('loads all matching jobs when multiple workspaces are selected', () => {
    const codingJobBackendService = TestBed.inject(
      CodingJobBackendService
    ) as unknown as {
      getCodingJobs: jest.Mock;
    };

    component.loadMyCodingJobs([
      { id: 1, name: 'Workspace 1' },
      { id: 2, name: 'Workspace 2' }
    ]);

    expect(component.serverPagingEnabled).toBe(false);
    expect(codingJobBackendService.getCodingJobs).toHaveBeenCalledWith(
      1,
      undefined,
      undefined,
      expect.objectContaining({
        assignedTo: 'me'
      })
    );
    expect(codingJobBackendService.getCodingJobs.mock.calls[0][3])
      .not.toHaveProperty('excludeStatus');
    expect(codingJobBackendService.getCodingJobs).toHaveBeenCalledWith(
      2,
      undefined,
      undefined,
      expect.objectContaining({
        assignedTo: 'me'
      })
    );
    expect(codingJobBackendService.getCodingJobs.mock.calls[1][3])
      .not.toHaveProperty('excludeStatus');
  });

  it('uses the table paginator when multiple workspaces are selected', () => {
    const codingJobBackendService = TestBed.inject(
      CodingJobBackendService
    ) as unknown as {
      getCodingJobs: jest.Mock;
    };
    codingJobBackendService.getCodingJobs.mockReturnValue(
      of({
        data: [completedJob],
        total: 1,
        page: 1
      })
    );
    component.isAuthorized = true;

    component.loadMyCodingJobs([
      { id: 1, name: 'Workspace 1' },
      { id: 2, name: 'Workspace 2' }
    ]);
    fixture.detectChanges();

    expect(component.serverPagingEnabled).toBe(false);
    expect(component.dataSource.paginator).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mat-paginator')).toBeTruthy();
  });

  it('counts review jobs as completed without adding them to total progress', () => {
    const codingJobBackendService = TestBed.inject(
      CodingJobBackendService
    ) as unknown as {
      getCodingJobs: jest.Mock;
    };
    const activeJob: CodingJob = {
      ...completedJob,
      id: 11,
      status: 'active',
      progress: 50,
      codedUnits: 1,
      totalUnits: 2
    };
    const reviewJob: CodingJob = {
      ...completedJob,
      id: 12,
      status: 'review',
      progress: 100,
      codedUnits: 3,
      totalUnits: 3
    };
    codingJobBackendService.getCodingJobs.mockReturnValueOnce(
      of({
        data: [activeJob, reviewJob],
        total: 2,
        page: 1
      })
    );

    component.loadMyCodingJobs([{ id: 1, name: 'Workspace 1' }]);

    expect(component.dataSource.data).toEqual([activeJob, reviewJob]);
    expect(component.totalProgress).toBe(50);
    expect(component.totalCodedUnits).toBe(1);
    expect(component.totalUnits).toBe(2);
    expect(component.incompleteJobs).toBe(1);
    expect(component.completedJobs).toBe(1);
  });

  it('keeps all workspaces deselected without reloading jobs', () => {
    const codingJobBackendService = TestBed.inject(
      CodingJobBackendService
    ) as unknown as {
      getCodingJobs: jest.Mock;
    };
    const workspaces = [
      { id: 1, name: 'Workspace 1' },
      { id: 2, name: 'Workspace 2' }
    ];
    (component as unknown as { authWorkspaces: typeof workspaces })
      .authWorkspaces = workspaces;

    component.loadMyCodingJobs(workspaces);
    codingJobBackendService.getCodingJobs.mockClear();

    component.toggleAllWorkspaces();

    expect(component.selectedWorkspaceIds).toEqual([]);
    expect(component.dataSource.data).toEqual([]);
    expect(component.jobsTotal).toBe(0);
    expect(codingJobBackendService.getCodingJobs).not.toHaveBeenCalled();
  });

  it('ignores stale coding job loads after a newer workspace request starts', () => {
    const codingJobBackendService = TestBed.inject(
      CodingJobBackendService
    ) as unknown as {
      getCodingJobs: jest.Mock;
    };
    const firstLoad = new Subject<{
      data: CodingJob[];
      total: number;
      page: number;
    }>();
    const secondLoad = new Subject<{
      data: CodingJob[];
      total: number;
      page: number;
    }>();
    const oldJob = {
      ...completedJob,
      id: 1,
      workspace_id: 1,
      name: 'Old workspace job'
    };
    const newJob = {
      ...completedJob,
      id: 5,
      workspace_id: 5,
      name: 'New workspace job'
    };

    codingJobBackendService.getCodingJobs
      .mockReturnValueOnce(firstLoad.asObservable())
      .mockReturnValueOnce(secondLoad.asObservable());

    component.loadMyCodingJobs([{ id: 1, name: 'Old workspace' }]);
    component.loadMyCodingJobs([{ id: 5, name: 'New workspace' }]);

    firstLoad.next({ data: [oldJob], total: 1, page: 1 });
    firstLoad.complete();
    expect(component.dataSource.data).toEqual([]);

    secondLoad.next({ data: [newJob], total: 1, page: 1 });
    secondLoad.complete();
    expect(component.dataSource.data).toEqual([newJob]);
  });

  it('clears stale jobs when loading the current workspace fails', () => {
    const codingJobBackendService = TestBed.inject(
      CodingJobBackendService
    ) as unknown as {
      getCodingJobs: jest.Mock;
    };
    codingJobBackendService.getCodingJobs.mockReturnValueOnce(
      throwError(() => new Error('load failed'))
    );
    component.dataSource.data = [completedJob];
    component.originalData = [completedJob];
    component.selectedWorkspaceIds = [1];
    component.totalProgress = 100;
    component.totalCodedUnits = 3;
    component.totalUnits = 3;
    component.incompleteJobs = 1;
    component.completedJobs = 1;

    component.loadMyCodingJobs([{ id: 5, name: 'Target workspace' }]);

    expect(component.dataSource.data).toEqual([]);
    expect(component.originalData).toEqual([]);
    expect(component.selectedWorkspaceIds).toEqual([]);
    expect(component.totalProgress).toBe(0);
    expect(component.totalCodedUnits).toBe(0);
    expect(component.totalUnits).toBe(0);
    expect(component.incompleteJobs).toBe(0);
    expect(component.completedJobs).toBe(0);
    expect(component.isLoading).toBe(false);
  });

  it('opens backend-generated replay URLs on the current frontend origin', () => {
    const codingJobBackendService = TestBed.inject(
      CodingJobBackendService
    ) as unknown as {
      startCodingJob: jest.Mock;
    };
    codingJobBackendService.startCodingJob.mockReturnValueOnce(
      of({
        total: 1,
        firstReplayUrl: 'http://localhost:3333/#/replay/person/unit/0/var'
      })
    );
    jest.spyOn(window, 'open').mockImplementation(() => null);

    component.startCodingJob(completedJob);

    expect(window.open).toHaveBeenCalledWith(
      'http://localhost/#/replay/person/unit/0/var?mode=coding&codingJobId=10&workspaceId=1',
      '_blank'
    );
  });
});
