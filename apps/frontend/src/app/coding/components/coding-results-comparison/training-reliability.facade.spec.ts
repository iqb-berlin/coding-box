import { TestBed } from '@angular/core/testing';
import {
  BehaviorSubject, Subject, of, throwError
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { TrainingReliabilityContext, TrainingReliabilityFacade } from './training-reliability.facade';
import { KappaStatistics, withMeanAgreement } from './training-reliability';

describe('TrainingReliabilityFacade', () => {
  const context: TrainingReliabilityContext = {
    workspaceId: 5, trainingId: 2, coderIds: [10], weighted: true, level: 'code'
  };
  const empty: KappaStatistics = {
    variables: [],
    workspaceSummary: {
      totalDoubleCodedResponses: 0, totalCoderPairs: 0, averageKappa: null, averageBrennanPredigerKappa: null, variablesIncluded: 0, codersIncluded: 0, weightingMethod: 'weighted', calculationLevel: 'code'
    }
  };
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: BehaviorSubject<number> };
  let load: jest.Mock;
  let exportCsv: jest.Mock;
  let facade: TrainingReliabilityFacade;
  beforeEach(() => {
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new BehaviorSubject(5) };
    load = jest.fn().mockReturnValue(of(empty)); exportCsv = jest.fn().mockReturnValue(of(new Blob(['csv'])));
    TestBed.configureTestingModule({ providers: [TrainingReliabilityFacade, { provide: AppService, useValue: app }, { provide: CodingTrainingBackendService, useValue: { getTrainingCohensKappa: load, exportTrainingReliabilityAsCsv: exportCsv } }] });
    facade = TestBed.inject(TrainingReliabilityFacade);
  });

  it('cancels obsolete requests and retains a newer response and its precise backend means', () => {
    const older = new Subject<KappaStatistics>(); const latest = new Subject<KappaStatistics>();
    load.mockReturnValueOnce(older).mockReturnValueOnce(latest);
    facade.load(context, () => true);
    facade.load({
      ...context, trainingId: 3, level: 'score', coderIds: [20, 30]
    }, () => true);
    const result = { ...empty, workspaceSummary: { ...empty.workspaceSummary, averageKappa: 0.300502 } };
    latest.next(result); older.error(new Error('late failure'));
    expect(facade.originalStatistics()).toBe(result);
    expect(facade.statistics()?.workspaceSummary.averageKappa).toBe(0.300502);
    expect(load).toHaveBeenLastCalledWith(5, 3, true, 'score', [20, 30]);
    expect(facade.isLoading()).toBe(false);
  });

  it.each(['workspace', 'destroy', 'reset'] as const)('cancels load and export on %s without late data or feedback', reason => {
    const statistics = new Subject<KappaStatistics>(); const csv = new Subject<Blob>();
    load.mockReturnValue(statistics); exportCsv.mockReturnValue(csv);
    const download = jest.fn(); const error = jest.fn(); facade.errors$.subscribe(error);
    facade.load(context, () => true); facade.exportCsv(context, () => true).subscribe(download);
    if (reason === 'destroy') TestBed.resetTestingModule();
    else if (reason === 'reset') facade.reset();
    else {
      app.selectedWorkspaceId = 6; app.selectedWorkspaceId$.next(6);
      app.selectedWorkspaceId = 5; app.selectedWorkspaceId$.next(5);
    }
    statistics.next(empty); csv.error(new Error('late export'));
    expect(download).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(facade.statistics()).toBeNull(); expect(facade.isLoading()).toBe(false); expect(facade.isExporting()).toBe(false);
  });

  it('retries failures and ignores results when the UI context has changed', () => {
    load.mockReturnValueOnce(throwError(() => new Error('load')));
    const error = jest.fn(); facade.errors$.subscribe(error);
    facade.load(context, () => true);
    expect(error).toHaveBeenCalledWith('load'); expect(facade.isLoading()).toBe(false);
    facade.load(context, () => false);
    expect(facade.statistics()).toBeNull();
    facade.load(context, () => true);
    expect(facade.statistics()?.variables).toEqual([]);
    expect(withMeanAgreement(empty, true).workspaceSummary.meanAgreement).toBeNull();
  });

  it('allows a single CSV request and releases it on failure so it can be retried', () => {
    const pending = new Subject<Blob>(); exportCsv.mockReturnValueOnce(pending);
    facade.exportCsv(context, () => true).subscribe();
    facade.exportCsv(context, () => true).subscribe();
    expect(exportCsv).toHaveBeenCalledTimes(1);
    pending.error(new Error('failed'));
    expect(facade.isExporting()).toBe(false);
    const download = jest.fn(); facade.exportCsv(context, () => true).subscribe(download);
    expect(download).toHaveBeenCalledTimes(1);
  });
});
