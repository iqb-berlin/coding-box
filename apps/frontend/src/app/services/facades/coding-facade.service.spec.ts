import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CodingFacadeService } from './coding-facade.service';
import { CodingExecutionService } from '../../coding/services/coding-execution.service';
import { CodingExportService } from '../../coding/services/coding-export.service';
import { CodingStatisticsService } from '../../coding/services/coding-statistics.service';
import { CodingVersionService } from '../../coding/services/coding-version.service';
import { DistributedCodingService } from '../../coding/services/distributed-coding.service';
import { MissingsProfileService } from '../../coding/services/missings-profile.service';
import { CodingJobBackendService } from '../../coding/services/coding-job-backend.service';
import { ReplayBackendService } from '../../replay/services/replay-backend.service';
import { CodingTrainingBackendService } from '../../coding/services/coding-training-backend.service';
import { VariableAnalysisService } from '../../shared/services/response/variable-analysis.service';

const createDependencyMock = (): Record<string, jest.Mock> => new Proxy({} as Record<string, jest.Mock>, {
  get(target, property: string) {
    if (!target[property]) {
      target[property] = jest.fn().mockReturnValue(of({ ok: true }));
    }
    return target[property];
  }
}) as Record<string, jest.Mock>;

describe('CodingFacadeService', () => {
  let service: CodingFacadeService;
  let dependencies: Record<string, jest.Mock>[];

  beforeEach(() => {
    dependencies = Array.from({ length: 10 }, () => createDependencyMock());

    TestBed.configureTestingModule({
      providers: [
        CodingFacadeService,
        { provide: CodingExecutionService, useValue: dependencies[0] },
        { provide: CodingExportService, useValue: dependencies[1] },
        { provide: CodingStatisticsService, useValue: dependencies[2] },
        { provide: CodingVersionService, useValue: dependencies[3] },
        { provide: DistributedCodingService, useValue: dependencies[4] },
        { provide: MissingsProfileService, useValue: dependencies[5] },
        { provide: CodingJobBackendService, useValue: dependencies[6] },
        { provide: ReplayBackendService, useValue: dependencies[7] },
        { provide: CodingTrainingBackendService, useValue: dependencies[8] },
        { provide: VariableAnalysisService, useValue: dependencies[9] }
      ]
    });

    service = TestBed.inject(CodingFacadeService);
  });

  it('delegates all public facade methods to their backing services', () => {
    const methodNames = Object.getOwnPropertyNames(CodingFacadeService.prototype)
      .filter(methodName => methodName !== 'constructor');
    const args = [
      1,
      2,
      'v1',
      true,
      [{ id: 1, name: 'Coder', username: 'coder' }],
      [{ unitName: 'UNIT', variableId: 'VAR' }],
      { exportType: 'coding-list' },
      { label: 'Profile' }
    ];

    expect(methodNames.length).toBeGreaterThan(0);

    methodNames.forEach(methodName => {
      const result = (service as unknown as Record<string, (...methodArgs: unknown[]) => unknown>)[methodName](...args);
      expect(result).toBeDefined();
    });

    const delegatedCalls = dependencies
      .flatMap(dependency => Object.values(dependency))
      .reduce((sum, mock) => sum + mock.mock.calls.length, 0);

    expect(delegatedCalls).toBe(methodNames.length);
  });
});
