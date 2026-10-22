import { TestBed } from '@angular/core/testing';
import { Injector } from '@angular/core';
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
  let facade: InstanceType<typeof TrainingReliabilityFacade>;
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
    facade.load(context, () => true); facade.downloads$.subscribe(({ blob }) => download(blob));
    facade.exportCsv(context, () => true);
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

  it('keeps an active CSV request while reloading statistics for the same context', () => {
    const pending = new Subject<Blob>();
    exportCsv.mockReturnValue(pending);
    const download = jest.fn();
    facade.load(context, () => true);
    facade.downloads$.subscribe(({ blob }) => download(blob));
    facade.exportCsv(context, () => true);
    facade.load(context, () => true);
    expect(facade.isExporting()).toBe(true);
    const csv = new Blob(['same context']);
    pending.next(csv);
    pending.complete();
    expect(download).toHaveBeenCalledWith(csv);
    expect(facade.isExporting()).toBe(false);
  });

  it('allows a single CSV request and releases it on failure so it can be retried', () => {
    const pending = new Subject<Blob>(); exportCsv.mockReturnValueOnce(pending);
    facade.exportCsv(context, () => true);
    facade.exportCsv(context, () => true);
    expect(exportCsv).toHaveBeenCalledTimes(1);
    pending.error(new Error('failed'));
    expect(facade.isExporting()).toBe(false);
    const download = jest.fn(); facade.downloads$.subscribe(({ blob }) => download(blob));
    facade.exportCsv(context, () => true);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('exposes read-only state and observable events, with options changed through commands', () => {
    for (const value of [facade.originalStatistics, facade.statistics, facade.isLoading, facade.isExporting, facade.useWeightedMean, facade.useCodeLevel]) {
      expect(Reflect.get(value, 'set')).toBeUndefined();
      expect(Reflect.get(value, 'update')).toBeUndefined();
    }
    expect(Reflect.get(facade.errors$, 'next')).toBeUndefined();
    expect(Reflect.get(facade.downloads$, 'next')).toBeUndefined();
    facade.setWeightingMethod(false);
    facade.setCalculationLevel(false);
    expect(facade.useWeightedMean()).toBe(false);
    expect(facade.useCodeLevel()).toBe(false);
  });

  it('keeps state local to an injector and clears accepted results on destruction', () => {
    const localInjector = Injector.create({ providers: [TrainingReliabilityFacade], parent: TestBed.inject(Injector) });
    const other = localInjector.get(TrainingReliabilityFacade);
    facade.setWeightingMethod(false);
    facade.load(context, () => true);
    expect(facade.originalStatistics()).toBe(empty);
    expect(other.originalStatistics()).toBeNull();
    expect(other.useWeightedMean()).toBe(true);
    localInjector.destroy();
    expect(facade.originalStatistics()).toBe(empty);
    TestBed.resetTestingModule();
    expect(facade.originalStatistics()).toBeNull();
    expect(facade.statistics()).toBeNull();
  });

  it('does not start requests captured for an obsolete workspace', () => {
    const otherWorkspace = { ...context, workspaceId: 6 };
    facade.load(otherWorkspace, () => true);
    facade.exportCsv(otherWorkspace, () => true);
    expect(load).not.toHaveBeenCalled();
    expect(exportCsv).not.toHaveBeenCalled();
    expect(facade.isLoading()).toBe(false);
    expect(facade.isExporting()).toBe(false);
  });
});
