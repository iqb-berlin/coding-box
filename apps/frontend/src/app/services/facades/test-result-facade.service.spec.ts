import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TestResultFacadeService } from './test-result-facade.service';
import { TestResultService } from '../../shared/services/test-result/test-result.service';
import { TestResultBackendService } from '../../shared/services/test-result/test-result-backend.service';
import { ResponseService } from '../../shared/services/response/response.service';
import { FileService } from '../../shared/services/file/file.service';

const createDependencyMock = (): Record<string, jest.Mock> => new Proxy({} as Record<string, jest.Mock>, {
  get(target, property: string) {
    if (!target[property]) {
      target[property] = jest.fn().mockReturnValue(of({ ok: true }));
    }
    return target[property];
  }
}) as Record<string, jest.Mock>;

describe('TestResultFacadeService', () => {
  let service: TestResultFacadeService;
  let dependencies: Record<string, jest.Mock>[];

  beforeEach(() => {
    dependencies = Array.from({ length: 4 }, () => createDependencyMock());

    TestBed.configureTestingModule({
      providers: [
        TestResultFacadeService,
        { provide: TestResultService, useValue: dependencies[0] },
        { provide: TestResultBackendService, useValue: dependencies[1] },
        { provide: ResponseService, useValue: dependencies[2] },
        { provide: FileService, useValue: dependencies[3] }
      ]
    });

    service = TestBed.inject(TestResultFacadeService);
  });

  it('delegates all public facade methods to their backing services', () => {
    const methodNames = Object.getOwnPropertyNames(TestResultFacadeService.prototype)
      .filter(methodName => methodName !== 'constructor');
    const args = [
      1,
      2,
      'booklet',
      { variableId: 'VAR' },
      3,
      ['file'],
      'responses',
      true,
      'skip',
      'person'
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
