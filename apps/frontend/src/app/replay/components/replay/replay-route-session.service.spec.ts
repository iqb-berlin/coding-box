import { TestBed } from '@angular/core/testing';
import { utf8ToBase64 } from '../../../shared/utils/common-utils';
import { ReplayCodingService } from '../../services/replay-coding.service';
import { ReplaySessionLoaderService, ReplaySessionLoadResult } from '../../services/replay-session-loader.service';
import { ReplayAttemptContext } from '../../utils/replay-attempt-context';
import { ReplayRouteSessionService } from './replay-route-session.service';

describe('Replay route session initialization', () => {
  const units = {
    id: 77, name: 'Coding job', units: [], currentUnitIndex: 0
  };
  const query = { workspaceId: '47', codingJobId: '77' };
  let service: ReplayRouteSessionService;
  let loader: { load: jest.Mock; discard: jest.Mock; getRequestKey: jest.Mock; retainOnly: jest.Mock; clear: jest.Mock };
  let coding: {
    loadSavedCodingProgress: jest.Mock; applyReplayCodingSession: jest.Mock; updateCodingJobStatus: jest.Mock;
    isCompletedJobReview: boolean; isCodingJobFinalized: boolean;
  };

  beforeEach(() => {
    loader = {
      load: jest.fn(),
      discard: jest.fn(),
      clear: jest.fn(),
      getRequestKey: jest.fn().mockReturnValue('47:77:false'),
      retainOnly: jest.fn().mockReturnValue('47:77:false')
    };
    coding = {
      loadSavedCodingProgress: jest.fn().mockResolvedValue(undefined),
      applyReplayCodingSession: jest.fn(),
      updateCodingJobStatus: jest.fn(),
      isCompletedJobReview: false,
      isCodingJobFinalized: false
    };
    TestBed.configureTestingModule({
      providers: [ReplayRouteSessionService,
        { provide: ReplaySessionLoaderService, useValue: loader },
        { provide: ReplayCodingService, useValue: coding }]
    });
    service = TestBed.inject(ReplayRouteSessionService);
  });

  afterEach(() => localStorage.clear());

  it('prefers embedded units over job requests and booklet storage', async () => {
    localStorage.setItem('booklet', JSON.stringify({ ...units, id: 88 }));
    expect(await service.load({ ...query, bookletKey: 'booklet', unitsData: utf8ToBase64(JSON.stringify(units)) },
      'token',
      new ReplayAttemptContext(),
      () => true)).toEqual(units);
    expect(loader.load).not.toHaveBeenCalled();
    expect(coding.loadSavedCodingProgress).not.toHaveBeenCalled();
  });

  it('reads booklet storage and tolerates malformed stored data', async () => {
    localStorage.setItem('booklet', JSON.stringify(units));
    expect(await service.load({ bookletKey: 'booklet' }, '', new ReplayAttemptContext(), () => true)).toEqual(units);
    localStorage.setItem('booklet', '{broken');
    expect(await service.load({ bookletKey: 'booklet' }, '', new ReplayAttemptContext(), () => true)).toBeNull();
  });

  it('does not apply session replies after the route has changed', async () => {
    let resolve!: (value: ReplaySessionLoadResult) => void;
    loader.load.mockReturnValue(new Promise<ReplaySessionLoadResult>(done => { resolve = done; }));
    let current = true;
    const pending = service.load(query, 'token', new ReplayAttemptContext(), () => current);
    current = false;
    resolve({
      unitsData: units,
      source: 'session',
      session: {
        units: [],
        progress: {},
        notes: {},
        serverTimings: {},
        job: {
          status: 'active', comment: null, showScore: true, allowComments: true, suppressGeneralInstructions: false
        }
      },
      timings: { requestStartedAt: 0, responseReceivedAt: 1, serverTimings: null }
    });
    expect(await pending).toBeNull();
    expect(coding.applyReplayCodingSession).not.toHaveBeenCalled();
    expect(service.hasLoadedProgress(47, 77)).toBe(false);
    expect(loader.discard).not.toHaveBeenCalled();
  });

  it('keeps failed progress loads retryable and does not load successful progress twice', async () => {
    coding.loadSavedCodingProgress.mockRejectedValueOnce(new Error('unavailable'));
    service.unitsData.set(units);
    await expect(service.restoreProgress(47, 77, () => true)).rejects.toThrow('unavailable');
    expect(service.unitsData()).toBeNull();
    expect(service.hasLoadedProgress(47, 77)).toBe(false);
    expect(await service.restoreProgress(47, 77, () => true)).toBe(true);
    expect(await service.restoreProgress(47, 77, () => true)).toBe(true);
    expect(coding.loadSavedCodingProgress).toHaveBeenCalledTimes(2);
  });

  it('does not remember progress completed for an abandoned route', async () => {
    let resolve!: () => void;
    coding.loadSavedCodingProgress.mockReturnValue(new Promise<void>(done => { resolve = done; }));
    const pending = service.restoreProgress(47, 77, () => false);
    resolve();
    expect(await pending).toBe(false);
    expect(service.hasLoadedProgress(47, 77)).toBe(false);
  });

  it('activates editable jobs once and resets that ownership when cleared', () => {
    service.activate(47, 77, true);
    expect(coding.updateCodingJobStatus).not.toHaveBeenCalled();
    service.activate(47, 77, false);
    service.activate(47, 77, false);
    expect(coding.updateCodingJobStatus).toHaveBeenCalledTimes(1);
    service.clear();
    service.activate(47, 77, false);
    expect(coding.updateCodingJobStatus).toHaveBeenCalledTimes(2);
    expect(loader.clear).toHaveBeenCalledTimes(1);
  });
});
