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
  });
});
