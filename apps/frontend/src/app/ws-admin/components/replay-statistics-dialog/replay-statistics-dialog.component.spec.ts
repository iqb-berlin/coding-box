import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { of, Subject, throwError } from 'rxjs';
import { ReplayBackendService } from '../../../replay/services/replay-backend.service';
import { ReplayStatisticsDialogComponent } from './replay-statistics-dialog.component';

describe('ReplayStatisticsDialogComponent', () => {
  let component: ReplayStatisticsDialogComponent;
  let backend: {
    getReplaySourceSummary: jest.Mock;
    getReplayFrequencyByUnit: jest.Mock;
    getReplayDistributionByDay: jest.Mock;
    getReplayDistributionByHour: jest.Mock;
    getReplayDurationStatistics: jest.Mock;
    getReplayErrorStatistics: jest.Mock;
    getFailureDistributionByUnit: jest.Mock;
    getFailureDistributionByDay: jest.Mock;
    getFailureDistributionByHour: jest.Mock;
  };

  beforeEach(() => {
    backend = {
      getReplaySourceSummary: jest.fn(() => of({ total: 10, internal: 7, external: 3 })),
      getReplayFrequencyByUnit: jest.fn(() => of({ UNIT1: 8, UNIT2: 2 })),
      getReplayDistributionByDay: jest.fn(() => of({ '2026-01-02': 3, '2026-01-01': 7 })),
      getReplayDistributionByHour: jest.fn(() => of({ 12: 3, 2: 7 })),
      getReplayDurationStatistics: jest.fn(() => of({
        min: 100,
        max: 3000,
        average: 1500,
        distribution: { '1000-2000': 3, '0-1000': 7 },
        unitAverages: { UNIT2: 1000, UNIT1: 2000 }
      })),
      getReplayErrorStatistics: jest.fn(() => of({
        successRate: 80,
        totalReplays: 10,
        successfulReplays: 8,
        failedReplays: 2,
        commonErrors: [{ message: 'Missing unit', count: 2 }]
      })),
      getFailureDistributionByUnit: jest.fn(() => of({ UNIT1: 2 })),
      getFailureDistributionByDay: jest.fn(() => of({ '2026-01-02': 1, '2026-01-01': 1 })),
      getFailureDistributionByHour: jest.fn(() => of({ 12: 1, 2: 1 }))
    };
    TestBed.configureTestingModule({
      providers: [
        ReplayStatisticsDialogComponent,
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 5 } },
        { provide: ReplayBackendService, useValue: backend }
      ]
    });
    component = TestBed.inject(ReplayStatisticsDialogComponent);
  });

  afterEach(() => component.ngOnDestroy());

  it('loads the selected workspace and orders chart data without losing statistics', () => {
    component.ngOnInit();
    expect(backend.getReplaySourceSummary).toHaveBeenCalledWith(5, { lastDays: 30, limit: 25 });
    expect(backend.getReplayDurationStatistics).toHaveBeenCalledWith(
      5, undefined, { lastDays: 30, limit: 25 }
    );
    expect(component.sourceSummary).toEqual({ total: 10, internal: 7, external: 3 });
    expect(component.frequencyData).toEqual([
      { name: 'UNIT1', value: 8 }, { name: 'UNIT2', value: 2 }
    ]);
    expect(component.dayDistributionData.map(row => row.name)).toEqual(['2026-01-01', '2026-01-02']);
    expect(component.hourDistributionData.map(row => row.name)).toEqual(['2:00', '12:00']);
    expect(component.durationDistributionData.map(row => row.name)).toEqual(['0-1000', '1000-2000']);
    expect(component.durationStats).toEqual({ min: 100, max: 3000, average: 1500 });
    expect(component.errorStats.failedReplays).toBe(2);
    expect(component.failureByHourData).toEqual([{ name: '2:00', value: 1 }, { name: '12:00', value: 1 }]);
    expect(component.loading).toBe(false);
  });

  it('keeps the top 25 units and aggregates remaining frequency counts', () => {
    const frequencies = Object.fromEntries(Array.from({ length: 27 }, (_, index) => [`UNIT${index}`, index + 1]));
    backend.getReplayFrequencyByUnit.mockReturnValue(of(frequencies));
    component.ngOnInit();
    expect(component.frequencyData).toHaveLength(26);
    expect(component.frequencyData[0]).toEqual({ name: 'UNIT26', value: 27 });
    expect(component.frequencyData[24]).toEqual({ name: 'UNIT2', value: 3 });
    expect(component.frequencyData[25]).toEqual({ name: 'Other', value: 3 });
    expect(component.frequencyData.reduce((sum, row) => sum + row.value, 0)).toBe(378);
  });

  it('continues loading other statistics after source and day requests fail', () => {
    backend.getReplaySourceSummary.mockReturnValue(throwError(() => new Error('summary unavailable')));
    backend.getReplayDistributionByDay.mockReturnValue(throwError(() => new Error('day unavailable')));
    component.ngOnInit();
    expect(component.sourceSummary).toEqual({ total: 0, internal: 0, external: 0 });
    expect(component.dayDistributionData).toEqual([]);
    expect(backend.getReplayDurationStatistics).toHaveBeenCalledTimes(1);
    expect(component.errorStats.failedReplays).toBe(2);
    expect(component.loading).toBe(false);
  });

  it('ends loading when frequency cannot be retrieved', () => {
    backend.getReplayFrequencyByUnit.mockReturnValue(throwError(() => new Error('frequency unavailable')));
    component.ngOnInit();
    expect(component.loading).toBe(false);
    expect(component.frequencyData).toEqual([]);
    expect(backend.getReplayDurationStatistics).not.toHaveBeenCalled();
  });

  it('keeps loading until the last request finishes and releases it on failure', () => {
    const pendingHours = new Subject<Record<string, number>>();
    backend.getFailureDistributionByHour.mockReturnValue(pendingHours.asObservable());
    component.ngOnInit();
    expect(component.loading).toBe(true);
    pendingHours.error(new Error('failure distribution unavailable'));
    expect(component.loading).toBe(false);
    expect(component.failureByHourData).toEqual([]);
    expect(component.errorStats.successRate).toBe(80);
  });
});
