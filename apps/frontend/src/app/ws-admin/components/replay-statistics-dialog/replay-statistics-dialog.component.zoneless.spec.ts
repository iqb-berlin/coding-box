import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { Chart } from 'chart.js';
import { ReplayStatisticsDialogComponent } from './replay-statistics-dialog.component';
import { ReplayBackendService, ReplaySourceSummaryResponse } from '../../../replay/services/replay-backend.service';

describe('Replay statistics with delayed responses without Zone', () => {
  let fixture: ComponentFixture<ReplayStatisticsDialogComponent>;
  let summary: Subject<ReplaySourceSummaryResponse>;
  let frequency: Subject<Record<string, number>>;
  let finalResponse: Subject<Record<string, number>>;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  beforeEach(async () => {
    summary = new Subject<ReplaySourceSummaryResponse>();
    frequency = new Subject<Record<string, number>>();
    finalResponse = new Subject<Record<string, number>>();
    await TestBed.configureTestingModule({
      imports: [ReplayStatisticsDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 1 } },
        {
          provide: ReplayBackendService,
          useValue: {
            getReplaySourceSummary: () => summary,
            getReplayFrequencyByUnit: () => frequency,
            getReplayDistributionByDay: () => of({ '2026-10-02': 3, '2026-10-01': 1 }),
            getReplayDistributionByHour: () => of({ 12: 3, 9: 1 }),
            getReplayDurationStatistics: () => of({
              min: 1000,
              max: 3000,
              average: 2000,
              distribution: { '2000-3000': 3, '1000-2000': 1 }
            }),
            getReplayErrorStatistics: () => of({
              successRate: 75,
              totalReplays: 4,
              successfulReplays: 3,
              failedReplays: 1,
              commonErrors: []
            }),
            getFailureDistributionByUnit: () => of({ UNIT: 1 }),
            getFailureDistributionByDay: () => of({}),
            getFailureDistributionByHour: () => finalResponse
          }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ReplayStatisticsDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
  });

  it('renders statistics and ends loading after delayed successful responses', async () => {
    summary.next({ internal: 3, external: 1, total: 4 });
    frequency.next({ UNIT: 4 });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
    finalResponse.next({});
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    const values = Array.from(fixture.nativeElement.querySelectorAll('.source-summary .stat-value'))
      .map(element => (element as HTMLElement).textContent?.trim());
    expect(values).toEqual(['4', '3', '1']);
    const canvas = fixture.nativeElement.querySelector('coding-box-vertical-bar-chart canvas');
    expect(Chart.getChart(canvas)?.data.datasets[0].data).toEqual([4]);
    expect(fixture.nativeElement.querySelector('coding-box-vertical-bar-chart tbody tr').textContent).toBe('UNIT4');
  });

  it('ends loading after a delayed frequency request fails', async () => {
    summary.next({ internal: 3, external: 1, total: 4 });
    await fixture.whenStable();
    frequency.error(new Error('Frequency request failed'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
  });

  it('renders the available statistics after the final request fails', async () => {
    summary.next({ internal: 3, external: 1, total: 4 });
    frequency.next({ UNIT: 4 });
    await fixture.whenStable();
    finalResponse.error(new Error('Failure distribution request failed'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.source-summary').textContent).toContain('4');
  });
});
