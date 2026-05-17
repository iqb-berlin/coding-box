import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CodingManagementManualComponent } from './coding-management-manual.component';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';

describe('CodingManagementManualComponent', () => {
  let component: CodingManagementManualComponent;
  let fixture: ComponentFixture<CodingManagementManualComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: {} }
  } as ActivatedRoute;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        },
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        {
          provide: Router,
          useValue: { navigate: jest.fn() }
        },
        provideHttpClient()
      ],
      imports: [CodingManagementManualComponent, TranslateModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingManagementManualComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should flag duplicate findings as diagnostic when aggregation is disabled', () => {
    component.responseAnalysis = {
      emptyResponses: { total: 0, totalUncoded: 0, items: [] },
      duplicateValues: {
        total: 2,
        totalResponses: 5,
        groups: [],
        isAggregationApplied: false
      },
      aggregationSummary: {
        duplicateGroups: 2,
        duplicateResponses: 5,
        collapsedCases: 0,
        rawCases: 10,
        effectiveCases: 10,
        threshold: 2,
        aggregationActive: false
      },
      matchingFlags: ['NO_AGGREGATION'],
      analysisTimestamp: new Date().toISOString()
    };

    expect(component.hasDuplicateFindingsWithoutAggregation).toBe(true);
    expect(component.hasPreparationWarnings()).toBe(true);
  });

  it('should not block preparation for duplicates when aggregation is active', () => {
    component.responseAnalysis = {
      emptyResponses: { total: 0, totalUncoded: 0, items: [] },
      duplicateValues: {
        total: 2,
        totalResponses: 5,
        groups: [],
        isAggregationApplied: true
      },
      aggregationSummary: {
        duplicateGroups: 2,
        duplicateResponses: 5,
        collapsedCases: 3,
        rawCases: 10,
        effectiveCases: 7,
        threshold: 2,
        aggregationActive: true
      },
      matchingFlags: [],
      analysisTimestamp: new Date().toISOString()
    };

    expect(component.hasDuplicateFindingsWithoutAggregation).toBe(false);
    expect(component.hasPreparationWarnings()).toBe(false);
    expect(component.isPreparationReady()).toBe(true);
  });

  it('should describe completed coding jobs as ready to apply', () => {
    component.completedJobsReadyForApply = [
      {
        id: 1,
        workspace_id: 1,
        name: 'Job 1',
        status: 'completed',
        created_at: new Date(),
        updated_at: new Date(),
        assignedCoders: [],
        totalUnits: 5,
        codedUnits: 5
      }
    ];

    expect(component.hasCompletedJobsReadyForApply()).toBe(true);
    expect(component.getCompletionActionTitle()).toContain('1 abgeschlossene');
    expect(component.getCodingJobResultSummary(component.completedJobsReadyForApply[0])).toBe('5/5 Ergebnisse kodiert');
  });

  it('should not treat stale-source coding jobs as ready to apply', () => {
    const isCodingJobReadyForApply = (component as unknown as {
      isCodingJobReadyForApply(job: {
        status: string;
        freshnessStatus?: string;
        training?: { id?: number };
        training_id?: number;
      }): boolean;
    }).isCodingJobReadyForApply.bind(component);

    expect(isCodingJobReadyForApply({
      status: 'completed',
      freshnessStatus: 'review_required'
    })).toBe(true);
    expect(isCodingJobReadyForApply({
      status: 'completed',
      freshnessStatus: 'stale_source'
    })).toBe(false);
  });
});
