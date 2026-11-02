import { TestBed } from '@angular/core/testing';
import {
  BehaviorSubject, of, Subject, throwError
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { DistributedCodingService, DistributionCalculationResponse } from '../../services/distributed-coding.service';
import { JobDistributionPreviewFacade, JobDistributionPreviewRequest } from './job-distribution-preview.facade';

describe('JobDistributionPreviewFacade', () => {
  let facade: JobDistributionPreviewFacade;
  let calculate: jest.Mock;
  let workspace: BehaviorSubject<number>;
  const request: JobDistributionPreviewRequest = {
    variables: [{ unitName: 'UNIT', variableId: 'V', includeDeriveError: true }],
    coders: [{
      id: 1, name: 'Coder', username: 'Coder', capacityPercent: 150
    }],
    bundles: [{
      id: 2, name: 'Bundle', variables: [{ unitName: 'UNIT', variableId: 'B' }], caseOrderingMode: 'alternating'
    }],
    doubleCodingAbsolute: 2,
    doubleCodingPercentage: 0,
    caseOrderingMode: 'continuous',
    maxCodingCases: 6,
    distributionSeed: 'stable-seed'
  };
  const response: DistributionCalculationResponse = {
    distribution: {},
    aggregationInfo: {},
    matchingFlags: [],
    warnings: [],
    tasksPerCoder: { 1: 18 },
    doubleCodingInfo: {
      bundle: {
        totalCases: 18, distinctCases: 6, doubleCodedCases: 2, singleCodedCasesAssigned: 4, codingTasksTotal: 18, doubleCodedCasesPerCoder: {}
      }
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    workspace = new BehaviorSubject(5);
    calculate = jest.fn().mockReturnValue(of(response));
    TestBed.configureTestingModule({
      providers: [JobDistributionPreviewFacade,
        { provide: AppService, useValue: { selectedWorkspaceId: 5, selectedWorkspaceId$: workspace } },
        { provide: DistributedCodingService, useValue: { calculateDistribution: calculate } }]
    });
    facade = TestBed.inject(JobDistributionPreviewFacade);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('reads the latest selection after debouncing and forwards every distribution option', () => {
    const readRequest = jest.fn().mockReturnValue(request);
    facade.refresh(5, readRequest);
    jest.advanceTimersByTime(299);
    expect(readRequest).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
    readRequest.mockReturnValue({ ...request, maxCodingCases: 7 });
    jest.advanceTimersByTime(1);
    expect(calculate).toHaveBeenCalledWith(
      5, request.variables, request.coders, 2, 0, request.bundles, 'continuous', 7, 'stable-seed'
    );
    expect(facade.summary()).toEqual({
      totalCases: 6, doubleCodedCases: 2, totalCodingTasks: 18, tasksPerCoder: { 1: 18 }
    });
  });

  it('retains legacy totals when distinct cases and coding task totals are absent', () => {
    calculate.mockReturnValue(of({
      ...response,
      doubleCodingInfo: {
        first: { doubleCodedCases: 2, singleCodedCasesAssigned: 3 },
        second: { distinctCases: 4, doubleCodedCases: 0, codingTasksTotal: 4 }
      }
    }));
    facade.refresh(5, () => request);
    jest.advanceTimersByTime(300);
    expect(facade.summary()).toEqual({
      totalCases: 9, doubleCodedCases: 2, totalCodingTasks: 11, tasksPerCoder: { 1: 18 }
    });
  });

  it('cancels an old HTTP request immediately and debounces its replacement', () => {
    const first = new Subject<DistributionCalculationResponse>();
    calculate.mockReturnValueOnce(first);
    facade.refresh(5, () => request);
    jest.advanceTimersByTime(300);
    expect(first.observed).toBe(true);
    facade.refresh(5, () => ({ ...request, maxCodingCases: 3 }));
    expect(first.observed).toBe(false);
    first.next(response);
    expect(facade.summary()).toBeNull();
    expect(calculate).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(300);
    expect(calculate).toHaveBeenCalledTimes(2);
    expect(calculate.mock.calls[1][7]).toBe(3);
  });

  it('clears the authoritative summary immediately when another preview is scheduled', () => {
    facade.refresh(5, () => request);
    jest.advanceTimersByTime(300);
    expect(facade.summary()).not.toBeNull();
    facade.refresh(5, () => null);
    expect(facade.summary()).toBeNull();
    jest.advanceTimersByTime(300);
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it('falls back after a failed preview and permits the next preview to succeed', () => {
    calculate.mockReturnValueOnce(throwError(() => new Error('offline')));
    facade.refresh(5, () => request);
    jest.advanceTimersByTime(300);
    expect(facade.summary()).toBeNull();
    facade.refresh(5, () => request);
    jest.advanceTimersByTime(300);
    expect(facade.summary()?.totalCases).toBe(6);
  });

  it.each(['invalid', 'workspace'])('skips preview requests for an %s context', reason => {
    facade.refresh(reason === 'workspace' ? 0 : 5, () => (reason === 'invalid' ? null : request));
    jest.advanceTimersByTime(300);
    expect(calculate).not.toHaveBeenCalled();
    expect(facade.summary()).toBeNull();
  });

  it.each(['workspace', 'destroy'])('cancels debounced work on %s', reason => {
    const readRequest = jest.fn().mockReturnValue(request);
    facade.refresh(5, readRequest);
    if (reason === 'workspace') { workspace.next(6); workspace.next(5); }
    if (reason === 'destroy') TestBed.resetTestingModule();
    jest.advanceTimersByTime(300);
    expect(readRequest).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
  });

  it.each(['workspace', 'destroy'])('cancels an in-flight preview on %s and ignores late replies', reason => {
    const pending = new Subject<DistributionCalculationResponse>();
    calculate.mockReturnValue(pending);
    facade.refresh(5, () => request);
    jest.advanceTimersByTime(300);
    expect(pending.observed).toBe(true);
    if (reason === 'workspace') { workspace.next(6); workspace.next(5); }
    if (reason === 'destroy') TestBed.resetTestingModule();
    expect(pending.observed).toBe(false);
    pending.next(response);
    expect(facade.summary()).toBeNull();
  });
});
