import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { TestResultsOverviewResponse } from '../../../shared/services/test-result/test-result.service';
import { TestResultsStatisticsFacade } from './test-results-statistics.facade';
import { TestResultsSummaryFacade } from './test-results-summary.facade';

const overview = (sessionBrowserCounts: Record<string, number>): TestResultsOverviewResponse => ({
  testPersons: 0,
  testGroups: 0,
  uniqueBooklets: 0,
  uniqueUnits: 0,
  uniqueResponses: 0,
  responseStatusCounts: { VALUE_CHANGED: 3, NOT_REACHED: 1 },
  sessionBrowserCounts,
  sessionOsCounts: {},
  sessionScreenCounts: {}
});

describe('TestResultsSummaryFacade', () => {
  let state: WritableSignal<TestResultsOverviewResponse | null>;
  let summary: TestResultsSummaryFacade;

  beforeEach(() => {
    state = signal<TestResultsOverviewResponse | null>(null);
    TestBed.configureTestingModule({
      providers: [
        TestResultsSummaryFacade,
        {
          provide: TestResultsStatisticsFacade,
          useValue: {
            overview: state,
            logAnomalySummary: signal(null),
            codingFreshnessSummary: signal(null),
            manualAppliedResultsOverview: signal(null),
            manualAppliedResultsOverviewLoadFailed: signal(false),
            isLoadingManualAppliedResultsOverview: signal(false)
          }
        },
        { provide: TranslateService, useValue: { instant: (key: string) => key } }
      ]
    });
    summary = TestBed.inject(TestResultsSummaryFacade);
  });

  it('memoizes derived rows and invalidates them when the overview changes', () => {
    const browsers = { Firefox: 1, Chrome: 3, Unknown: 0 };
    state.set(overview(browsers));
    const rows = summary.overviewBrowserCounts();
    expect(rows).toEqual([{ key: 'Chrome', count: 3 }, { key: 'Firefox', count: 1 }]);
    expect(summary.overviewBrowserCounts()).toBe(rows);
    expect(browsers).toEqual({ Firefox: 1, Chrome: 3, Unknown: 0 });
    state.set(overview({ Safari: 2 }));
    expect(summary.overviewBrowserCounts()).toEqual([{ key: 'Safari', count: 2 }]);
    expect(summary.overviewBrowserCounts()).not.toBe(rows);
    expect(summary.getBrowserTotal()).toBe(2);
  });

  it('keeps totals and percentages consistent after delayed data and an empty overview', () => {
    expect(summary.overviewStatusCounts()).toEqual([]);
    expect(summary.getPercent(1, 0)).toBe(0);
    state.set(overview({}));
    expect(summary.overviewResponseStatusTotal()).toBe(4);
    expect(summary.overviewStatusCounts()).toEqual([
      { status: 'VALUE_CHANGED', count: 3, percent: 75 },
      { status: 'NOT_REACHED', count: 1, percent: 25 }
    ]);
    state.set(null);
    expect(summary.overviewResponseStatusTotal()).toBe(0);
    expect(summary.overviewStatusCounts()).toEqual([]);
  });
});
