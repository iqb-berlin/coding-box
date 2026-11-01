import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject, of, throwError } from 'rxjs';
import { AppService } from '../../../../core/services/app.service';
import { TestPersonCodingService } from '../../../services/test-person-coding.service';
import { CodingBackgroundJobsService } from '../../../services/coding-background-jobs.service';
import { CodingFreshnessSummaryDto, CodingFreshnessScopeDto } from '../../../../../../../../api-dto/coding/coding-freshness.dto';
import { AutocodingReadinessDto } from '../../../../../../../../api-dto/coding/autocoding-readiness.dto';
import { CodingStatusDataFacade } from './coding-status-data.facade';
import { AuthService } from '../../../../core/services/auth.service';
import { CodingReliabilityService } from '../../../services/coding-reliability.service';
import { SERVER_URL } from '../../../../injection-tokens';

const summary = (revision: number): CodingFreshnessSummaryDto => ({ workspaceId: 1, currentRevision: revision, items: [] });
const scope: CodingFreshnessScopeDto = {
  ...summary(1),
  versions: [],
  states: [],
  unitCount: 1,
  personCount: 1,
  groupCount: 1,
  affectedResponseCount: 1,
  unitIds: [1],
  personIds: [1],
  groupNames: ['GROUP'],
  groups: []
};
const readiness: AutocodingReadinessDto = {
  workspaceId: 1,
  autoCoderRun: 1,
  readiness: 'READY',
  blockers: [],
  rawResponsesTotal: 0,
  rawResponsesWithRelevantStatus: 0,
  resultUnitsTotal: 0,
  resultUnitKeysTotal: 0,
  matchedUnitFiles: 0,
  missingUnitFiles: [],
  matchedCodingSchemes: 0,
  missingCodingSchemes: [],
  invalidCodingSchemes: [],
  validVariablePairs: 0,
  validResponses: 0,
  codeableResponses: 0,
  invalidVariableSamples: []
};

describe('CodingStatusDataFacade', () => {
  let facade: CodingStatusDataFacade;
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: Subject<number> };
  let backend: { getCodingFreshness: jest.Mock; getCodingFreshnessScope: jest.Mock; getAppliedResultsOverview: jest.Mock;
    getAutocodingReadiness: jest.Mock; getCachedCodingStatusOverview: jest.Mock; getCachedAutocodingReadiness: jest.Mock };
  let jobs: { isStatusCheckGuardActive: jest.Mock };

  beforeEach(() => {
    app = { selectedWorkspaceId: 1, selectedWorkspaceId$: new Subject<number>() };
    jobs = { isStatusCheckGuardActive: jest.fn().mockReturnValue(false) };
    backend = {
      getCodingFreshness: jest.fn().mockReturnValue(of(summary(1))),
      getCodingFreshnessScope: jest.fn().mockReturnValue(of(scope)),
      getAppliedResultsOverview: jest.fn().mockReturnValue(of(null)),
      getAutocodingReadiness: jest.fn().mockReturnValue(of(readiness)),
      getCachedCodingStatusOverview: jest.fn().mockReturnValue(null),
      getCachedAutocodingReadiness: jest.fn().mockReturnValue(of(null))
    };
    TestBed.configureTestingModule({
      providers: [
        CodingStatusDataFacade,
        { provide: AppService, useValue: app },
        { provide: TestPersonCodingService, useValue: backend },
        { provide: CodingBackgroundJobsService, useValue: jobs }
      ]
    });
    facade = TestBed.inject(CodingStatusDataFacade);
  });

  it('keeps the lightweight initial request separate from a full status check', () => {
    facade.loadCodingFreshness(false);
    expect(facade.codingFreshnessSummary()).toEqual(summary(1));
    expect(facade.hasLoadedFullCodingStatusOverview()).toBe(false);
    expect(backend.getAutocodingReadiness).not.toHaveBeenCalled();
    expect(backend.getCodingFreshnessScope).not.toHaveBeenCalled();
    expect(backend.getAppliedResultsOverview).not.toHaveBeenCalled();
  });

  it('loads affected groups only when freshness warnings need them', () => {
    backend.getCodingFreshness.mockReturnValue(of({
      ...summary(1),
      items: [
        {
          version: 'v1', state: 'PENDING', unitCount: 1, affectedResponseCount: 1
        }
      ]
    }));
    facade.loadCodingFreshness();
    expect(backend.getCodingFreshnessScope).toHaveBeenCalledWith(1);
    expect(facade.codingFreshnessScope()).toEqual(scope);
    expect(facade.hasWarnings()).toBe(true);
  });

  it('replaces pending requests before setting the new loading state', () => {
    const old = new Subject<CodingFreshnessSummaryDto>();
    const current = new Subject<CodingFreshnessSummaryDto>();
    backend.getCodingFreshness.mockReturnValueOnce(old).mockReturnValueOnce(current);
    facade.loadCodingFreshness();
    facade.loadCodingFreshness();
    expect(old.observed).toBe(false);
    expect(facade.isLoadingCodingFreshness()).toBe(true);
    old.next(summary(1));
    expect(facade.codingFreshnessSummary()).toBeNull();
    current.next(summary(2));
    current.complete();
    expect(facade.codingFreshnessSummary()).toEqual(summary(2));
    expect(facade.isLoadingCodingFreshness()).toBe(false);
  });

  it.each(['workspace-return', 'destroy', 'dispose'])('ignores delayed status replies after %s', end => {
    const pending = new Subject<CodingFreshnessSummaryDto>();
    backend.getCodingFreshness.mockReturnValue(pending);
    facade.loadCodingFreshness();
    if (end === 'destroy') TestBed.resetTestingModule();
    else if (end === 'dispose') facade.dispose();
    else {
      app.selectedWorkspaceId = 2;
      app.selectedWorkspaceId$.next(2);
      app.selectedWorkspaceId = 1;
      app.selectedWorkspaceId$.next(1);
    }
    pending.next(summary(5));
    expect(pending.observed).toBe(false);
    expect(facade.codingFreshnessSummary()).toBeNull();
    expect(facade.isLoadingCodingFreshness()).toBe(false);
  });

  it('cancels an obsolete group request when a newer freshness summary clears warnings', () => {
    const pending = new Subject<CodingFreshnessScopeDto>();
    backend.getCodingFreshnessScope.mockReturnValue(pending);
    facade.loadCodingFreshnessScope();
    facade.loadCodingFreshness();
    pending.next(scope);
    expect(pending.observed).toBe(false);
    expect(facade.codingFreshnessScope()).toBeNull();
  });

  it('reports readiness errors and allows an explicit forced retry', () => {
    backend.getAutocodingReadiness.mockReturnValueOnce(throwError(() => new Error('Unavailable')));
    facade.loadAutocodingReadiness();
    expect(facade.autocodingReadinessLoadFailed()).toBe(true);
    expect(facade.isLoadingAutocodingReadiness()).toBe(false);
    facade.loadAutocodingReadiness(true);
    expect(backend.getAutocodingReadiness).toHaveBeenLastCalledWith(1, 1, true);
    expect(facade.autocodingReadiness()).toEqual(readiness);
    expect(facade.autocodingReadinessLoadFailed()).toBe(false);
    expect(facade.hasLoadedFullCodingStatusOverview()).toBe(true);
  });

  it('defers automatic and forced reads under a background-job guard without running them', () => {
    jobs.isStatusCheckGuardActive.mockReturnValue(true);
    const deferred: boolean[] = [];
    facade.deferredRefresh$.subscribe(force => deferred.push(force));
    facade.loadCodingFreshness();
    facade.loadManualAppliedResultsOverview();
    facade.loadAutocodingReadiness(true);
    facade.loadCachedAutocodingReadiness();
    expect(deferred).toEqual([false, false, true]);
    expect(backend.getCodingFreshness).not.toHaveBeenCalled();
    expect(backend.getAutocodingReadiness).not.toHaveBeenCalled();
    expect(backend.getAppliedResultsOverview).not.toHaveBeenCalled();
    expect(backend.getCachedCodingStatusOverview).not.toHaveBeenCalled();
  });

  it('restores the complete cached overview without running an expensive read', () => {
    backend.getCachedCodingStatusOverview.mockReturnValue({
      codingFreshness: summary(5), autocodingReadiness: readiness, appliedResultsOverview: null
    });
    facade.loadCachedAutocodingReadiness();
    expect(facade.codingFreshnessSummary()).toEqual(summary(5));
    expect(facade.autocodingReadiness()).toEqual(readiness);
    expect(facade.hasLoadedFullCodingStatusOverview()).toBe(true);
    expect(backend.getAutocodingReadiness).not.toHaveBeenCalled();
    expect(backend.getCachedAutocodingReadiness).not.toHaveBeenCalled();
  });

  it('does not let a late cache lookup overwrite a forced readiness result', () => {
    const cached = new Subject<AutocodingReadinessDto | null>();
    backend.getCachedAutocodingReadiness.mockReturnValue(cached);
    facade.loadCachedAutocodingReadiness();
    facade.loadAutocodingReadiness(true);
    cached.next({ ...readiness, readiness: 'BLOCKED' });
    expect(cached.observed).toBe(false);
    expect(facade.autocodingReadiness()).toEqual(readiness);
  });

  it('marks unavailable applied results as failed and clears them without a workspace', () => {
    facade.loadManualAppliedResultsOverview();
    expect(facade.manualAppliedResultsOverviewLoadFailed()).toBe(true);
    app.selectedWorkspaceId = 0;
    facade.loadManualAppliedResultsOverview();
    expect(facade.manualAppliedResultsOverview()).toBeNull();
    expect(facade.manualAppliedResultsOverviewLoadFailed()).toBe(false);
    facade.dispose();
    facade.dispose();
    app.selectedWorkspaceId = 1;
    facade.loadCodingFreshness();
    expect(backend.getCodingFreshness).not.toHaveBeenCalled();
  });
});

describe('CodingStatusDataFacade with shared HTTP caching', () => {
  let facade: CodingStatusDataFacade;
  let http: HttpTestingController;
  const url = '/api/admin/workspace/1/coding/readiness';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        CodingStatusDataFacade,
        TestPersonCodingService,
        { provide: SERVER_URL, useValue: '/api/' },
        { provide: AuthService, useValue: {} },
        { provide: CodingReliabilityService, useValue: {} },
        { provide: AppService, useValue: { selectedWorkspaceId: 1, selectedWorkspaceId$: new Subject<number>() } },
        { provide: CodingBackgroundJobsService, useValue: { isStatusCheckGuardActive: () => false } }
      ]
    });
    facade = TestBed.inject(CodingStatusDataFacade);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    facade.dispose();
    http.verify();
  });

  it.each(['cached', 'live'])('retains the service cache after replacing an unfinished %s readiness read', kind => {
    const load = () => {
      if (kind === 'cached') facade.loadCachedAutocodingReadiness();
      else facade.loadAutocodingReadiness();
    };
    load();
    const old = http.expectOne(request => request.url === url);
    load();
    expect(old.cancelled).toBe(true);
    const replacement = http.expectOne(request => request.url === url);
    replacement.flush(readiness);
    expect(facade.autocodingReadiness()).toEqual(readiness);

    load();
    http.expectNone(request => request.url === url);
    expect(facade.autocodingReadiness()).toEqual(readiness);
  });
});
