import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  Observable, Subject, of, throwError
} from 'rxjs';
import { CodingJobBackendService } from '../../coding/services/coding-job-backend.service';
import type { ReplayCodingSessionDto } from '../../../../../../api-dto/coding/replay-coding-session.dto';
import {
  ReplaySessionLoadRequest,
  ReplaySessionLoadError,
  ReplaySessionLoaderService
} from './replay-session-loader.service';

describe('ReplaySessionLoaderService', () => {
  let service: ReplaySessionLoaderService;
  let codingJobBackendService: {
    getReplayCodingSession: jest.Mock;
    getCodingJobUnits: jest.Mock;
  };

  const request: ReplaySessionLoadRequest = {
    workspaceId: 47,
    codingJobId: 77,
    authToken: 'replay-token',
    onlyOpen: true
  };

  const session: ReplayCodingSessionDto = {
    units: [{
      responseId: 1,
      unitName: 'unit-1',
      unitAlias: 'Unit 1',
      variableId: 'VAR1',
      variableAnchor: 'VAR1',
      variablePage: '2',
      bookletName: 'Booklet 1',
      personLogin: 'person',
      personCode: 'code',
      personGroup: 'group',
      variableBundleId: null,
      bundleContext: null
    }],
    progress: {},
    notes: {},
    job: {
      status: 'active',
      comment: null,
      showScore: false,
      allowComments: true,
      suppressGeneralInstructions: false
    },
    serverTimings: {
      totalMs: 15
    }
  };

  beforeEach(() => {
    codingJobBackendService = {
      getReplayCodingSession: jest.fn().mockReturnValue(of(session)),
      getCodingJobUnits: jest.fn().mockReturnValue(of([]))
    };

    TestBed.configureTestingModule({
      providers: [
        ReplaySessionLoaderService,
        {
          provide: CodingJobBackendService,
          useValue: codingJobBackendService
        }
      ]
    });

    service = TestBed.inject(ReplaySessionLoaderService);
  });

  it('loads and maps a replay session', async () => {
    const result = await service.load(request);

    expect(codingJobBackendService.getReplayCodingSession)
      .toHaveBeenCalledWith(47, 77, 'replay-token', true);
    expect(codingJobBackendService.getCodingJobUnits).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      session,
      source: 'session',
      unitsData: {
        id: 77,
        name: 'Coding-Job: 77',
        currentUnitIndex: 0,
        units: [{
          id: 0,
          name: 'unit-1',
          alias: 'Unit 1',
          bookletId: 0,
          testPerson: 'person@code@group@Booklet 1',
          variableId: 'VAR1',
          variableAnchor: 'VAR1',
          variablePage: '2',
          variableBundleId: null,
          bundleContext: null
        }]
      },
      timings: {
        serverTimings: {
          codingSessionTotalMs: 15
        }
      }
    });
    expect(result.timings.responseReceivedAt)
      .toBeGreaterThanOrEqual(result.timings.requestStartedAt);
  });

  it.each([404, 405])(
    'falls back to legacy units for a %i response',
    async status => {
      codingJobBackendService.getReplayCodingSession.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status }))
      );
      codingJobBackendService.getCodingJobUnits.mockReturnValue(of(session.units));

      const result = await service.load(request);

      expect(codingJobBackendService.getCodingJobUnits)
        .toHaveBeenCalledWith(47, 77, 'replay-token', true);
      expect(result.source).toBe('legacy');
      expect(result.session).toBeNull();
      expect(result.unitsData?.units).toHaveLength(1);
      expect(result.timings.serverTimings).toBeNull();
    }
  );

  it('does not hide replay-session server errors with a legacy request', async () => {
    const error = new HttpErrorResponse({ status: 500 });
    codingJobBackendService.getReplayCodingSession.mockReturnValue(
      throwError(() => error)
    );

    await expect(service.load(request)).rejects.toMatchObject({
      requestError: error,
      timings: {
        serverTimings: null
      }
    });
    expect(codingJobBackendService.getCodingJobUnits).not.toHaveBeenCalled();
  });

  it('exposes a legacy fallback error with the session request timings', async () => {
    const legacyError = new HttpErrorResponse({ status: 503 });
    codingJobBackendService.getReplayCodingSession.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404 }))
    );
    codingJobBackendService.getCodingJobUnits.mockReturnValue(
      throwError(() => legacyError)
    );

    await expect(service.load(request)).rejects.toMatchObject({
      requestError: legacyError,
      timings: {
        serverTimings: null
      }
    });
  });

  it('shares an in-flight request for the same replay session', async () => {
    const response = new Subject<ReplayCodingSessionDto>();
    codingJobBackendService.getReplayCodingSession.mockReturnValue(
      response.asObservable() as Observable<ReplayCodingSessionDto>
    );

    const firstLoad = service.load(request);
    const secondLoad = service.load(request);
    response.next(session);
    response.complete();

    await expect(firstLoad).resolves.toEqual(await secondLoad);
    expect(codingJobBackendService.getReplayCodingSession).toHaveBeenCalledTimes(1);
  });

  it('evicts an abandoned request when the requested coding job changes', async () => {
    const firstResponse = new Subject<ReplayCodingSessionDto>();
    const secondResponse = new Subject<ReplayCodingSessionDto>();
    const repeatedFirstResponse = new Subject<ReplayCodingSessionDto>();
    const otherRequest: ReplaySessionLoadRequest = {
      ...request,
      codingJobId: 88
    };
    codingJobBackendService.getReplayCodingSession
      .mockReturnValueOnce(firstResponse.asObservable())
      .mockReturnValueOnce(secondResponse.asObservable())
      .mockReturnValueOnce(repeatedFirstResponse.asObservable());

    const firstLoad = service.load(request);
    const secondLoad = service.load(otherRequest);
    const repeatedFirstLoad = service.load(request);

    expect(codingJobBackendService.getReplayCodingSession).toHaveBeenCalledTimes(3);

    firstResponse.next(session);
    firstResponse.complete();
    await firstLoad;
    service.discard(request, firstLoad);

    const sharedRepeatedFirstLoad = service.load(request);

    expect(sharedRepeatedFirstLoad).toBe(repeatedFirstLoad);
    expect(codingJobBackendService.getReplayCodingSession).toHaveBeenCalledTimes(3);

    secondResponse.next(session);
    secondResponse.complete();
    repeatedFirstResponse.next(session);
    repeatedFirstResponse.complete();

    await Promise.all([
      secondLoad,
      repeatedFirstLoad,
      sharedRepeatedFirstLoad
    ]);
  });

  it('can discard a failed request before retrying it', async () => {
    codingJobBackendService.getReplayCodingSession.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 500 }))
    );

    const failedLoad = service.load(request);
    await expect(failedLoad).rejects.toBeInstanceOf(ReplaySessionLoadError);
    service.discard(request, failedLoad);
    await expect(service.load(request)).resolves.toMatchObject({
      source: 'session'
    });

    expect(codingJobBackendService.getReplayCodingSession).toHaveBeenCalledTimes(2);
  });
});
