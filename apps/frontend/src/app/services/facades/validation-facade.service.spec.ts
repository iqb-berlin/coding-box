import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ValidationFacadeService } from './validation-facade.service';
import { ValidationService } from '../../shared/services/validation/validation.service';

const createDependencyMock = (): Record<string, jest.Mock> => new Proxy({} as Record<string, jest.Mock>, {
  get(target, property: string) {
    if (!target[property]) {
      target[property] = jest.fn().mockReturnValue(of({ ok: true }));
    }
    return target[property];
  }
}) as Record<string, jest.Mock>;

describe('ValidationFacadeService', () => {
  let service: ValidationFacadeService;
  let validationService: Record<string, jest.Mock>;

  beforeEach(() => {
    validationService = createDependencyMock();

    TestBed.configureTestingModule({
      providers: [
        ValidationFacadeService,
        { provide: ValidationService, useValue: validationService }
      ]
    });

    service = TestBed.inject(ValidationFacadeService);
  });

  it('delegates all public facade methods to the validation service', () => {
    const methodNames = Object.getOwnPropertyNames(ValidationFacadeService.prototype)
      .filter(methodName => methodName !== 'constructor');
    const args = [1, 'variables', 2, 25, { responseIds: [1, 2] }];

    expect(methodNames.length).toBeGreaterThan(0);

    methodNames.forEach(methodName => {
      const result = (service as unknown as Record<string, (...methodArgs: unknown[]) => unknown>)[methodName](...args);
      expect(result).toBeDefined();
    });

    const delegatedCalls = Object.values(validationService)
      .reduce((sum, mock) => sum + mock.mock.calls.length, 0);

    expect(delegatedCalls).toBe(methodNames.length);
  });
});
