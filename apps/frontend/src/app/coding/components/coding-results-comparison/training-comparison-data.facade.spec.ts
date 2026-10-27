import { TestBed } from '@angular/core/testing';
import {
  BehaviorSubject, of, Subject, throwError
} from 'rxjs';
import type { WithinTrainingCodingComparisonPageDto } from '../../../../../../../api-dto/coding/training-comparison.dto';
import { AppService } from '../../../core/services/app.service';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { TrainingComparisonDataFacade } from './training-comparison-data.facade';
import type { TrainingComparisonRequest } from './training-comparison-data.facade';

describe('TrainingComparisonDataFacade', () => {
  const page: WithinTrainingCodingComparisonPageDto = {
    data: [],
    availableCoders: [],
    total: 0,
    totalPages: 0,
    page: 1,
    limit: 50,
    summary: {
      visibleRows: 0,
      comparableRows: 0,
      matchingRows: 0,
      matchingPercentage: 0,
      incompleteRows: 0,
      notComparableRows: 0,
      deviationRows: 0,
      completionRate: 0
    }
  };
  let facade: TrainingComparisonDataFacade;
  let api: jest.Mock;
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: BehaviorSubject<number> };
  const request = (trainingId = 7): TrainingComparisonRequest => ({
    mode: 'within-training', workspaceId: 5, trainingId, options: { page: 1 }, isCurrent: () => true
  });

  beforeEach(() => {
    api = jest.fn();
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new BehaviorSubject(5) };
    TestBed.configureTestingModule({
      providers: [TrainingComparisonDataFacade, { provide: AppService, useValue: app },
        { provide: CodingTrainingBackendService, useValue: { getCachedWithinTrainingCodingResults: api } }]
    });
    facade = TestBed.inject(TrainingComparisonDataFacade);
  });

  it('cancels obsolete pages and settles loading on the response even before completion', () => {
    const stale = new Subject<WithinTrainingCodingComparisonPageDto>();
    const current = new Subject<WithinTrainingCodingComparisonPageDto>();
    api.mockReturnValueOnce(stale).mockReturnValueOnce(current);
    const loaded = jest.fn(); facade.loaded$.subscribe(loaded);
    facade.load(request()); facade.load(request(8));
    expect(stale.observed).toBe(false);
    expect(facade.isLoading()).toBe(true);
    current.next(page);
    expect(facade.isLoading()).toBe(false);
    stale.error(new Error('late'));
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(loaded).toHaveBeenCalledWith({ mode: 'within-training', page });
  });

  it.each(['workspace', 'destroy', 'cancel'] as const)('cancels a request on %s without late feedback', reason => {
    const pending = new Subject<WithinTrainingCodingComparisonPageDto>();
    api.mockReturnValue(pending);
    const failed = jest.fn(); facade.failed$.subscribe(failed);
    facade.load(request());
    if (reason === 'workspace') { app.selectedWorkspaceId = 6; app.selectedWorkspaceId$.next(6); }
    if (reason === 'destroy') TestBed.resetTestingModule();
    if (reason === 'cancel') facade.cancel();
    expect(pending.observed).toBe(false);
    expect(facade.isLoading()).toBe(false);
    pending.error(new Error('late'));
    expect(failed).not.toHaveBeenCalled();
  });

  it('retries a failure and keeps a reentrant reload in the loading state', () => {
    api.mockReturnValueOnce(throwError(() => new Error('offline')));
    const failed = jest.fn(); facade.failed$.subscribe(failed);
    facade.load(request());
    expect(failed).toHaveBeenCalledTimes(1);
    const pending = new Subject<WithinTrainingCodingComparisonPageDto>();
    api.mockReturnValueOnce(of(page)).mockReturnValueOnce(pending);
    facade.loaded$.subscribe(() => facade.load(request(8)));
    facade.load(request());
    expect(facade.isLoading()).toBe(true);
    facade.cancel();
    expect(facade.isLoading()).toBe(false);
  });
});
