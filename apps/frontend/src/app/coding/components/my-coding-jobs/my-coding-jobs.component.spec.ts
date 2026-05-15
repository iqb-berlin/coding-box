import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
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
      imports: [
        MyCodingJobsComponent,
        TranslateModule.forRoot()
      ],
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
            createToken: jest.fn().mockReturnValue(of('token'))
          }
        },
        {
          provide: CodingJobBackendService,
          useValue: {
            getCodingJobs: jest.fn().mockReturnValue(of({
              data: [],
              total: 0,
              page: 1,
              limit: 100
            })),
            startCodingJob: jest.fn().mockReturnValue(of({
              total: 1,
              firstReplayUrl: 'https://example.test/replay'
            }))
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

  it.each(['completed', 'results_applied'])('renders %s coding jobs with a single review action', status => {
    const job = {
      ...completedJob,
      status
    };
    component.isAuthorized = true;
    component.isLoading = false;
    component.dataSource.data = [job];

    fixture.detectChanges();

    const actionCell: HTMLElement = fixture.nativeElement.querySelector('.actions-cell');
    const buttons = actionCell.querySelectorAll('button');

    expect(buttons).toHaveLength(1);
    expect(actionCell.textContent).toContain('visibility');
    expect(actionCell.textContent).not.toContain('check_circle');
    expect(component.getStartCodingJobLabel(job)).toBe('Review öffnen');
  });
});
