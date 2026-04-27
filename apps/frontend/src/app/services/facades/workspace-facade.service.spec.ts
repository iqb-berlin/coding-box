import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { WorkspaceFacadeService } from './workspace-facade.service';
import { UserBackendService } from '../../shared/services/user/user-backend.service';
import { WorkspaceBackendService } from '../../workspace/services/workspace-backend.service';
import { FileService } from '../../shared/services/file/file.service';
import { FileBackendService } from '../../shared/services/file/file-backend.service';
import { ImportService } from '../../shared/services/file/import.service';
import { UnitTagService } from '../../shared/services/unit/unit-tag.service';
import { UnitNoteService } from '../../shared/services/unit/unit-note.service';
import { ResourcePackageService } from '../../shared/services/response/resource-package.service';
import { UnitService } from '../../shared/services/unit/unit.service';

const createDependencyMock = (): Record<string, jest.Mock> => new Proxy({} as Record<string, jest.Mock>, {
  get(target, property: string) {
    if (!target[property]) {
      target[property] = jest.fn().mockReturnValue(of({ ok: true }));
    }
    return target[property];
  }
}) as Record<string, jest.Mock>;

describe('WorkspaceFacadeService', () => {
  let service: WorkspaceFacadeService;
  let dependencies: Record<string, jest.Mock>[];

  beforeEach(() => {
    dependencies = Array.from({ length: 9 }, () => createDependencyMock());

    TestBed.configureTestingModule({
      providers: [
        WorkspaceFacadeService,
        { provide: UserBackendService, useValue: dependencies[0] },
        { provide: WorkspaceBackendService, useValue: dependencies[1] },
        { provide: FileService, useValue: dependencies[2] },
        { provide: FileBackendService, useValue: dependencies[3] },
        { provide: ImportService, useValue: dependencies[4] },
        { provide: UnitTagService, useValue: dependencies[5] },
        { provide: UnitNoteService, useValue: dependencies[6] },
        { provide: ResourcePackageService, useValue: dependencies[7] },
        { provide: UnitService, useValue: dependencies[8] }
      ]
    });

    service = TestBed.inject(WorkspaceFacadeService);
  });

  it('delegates all public facade methods to their backing services', () => {
    const methodNames = Object.getOwnPropertyNames(WorkspaceFacadeService.prototype)
      .filter(methodName => methodName !== 'constructor');
    const args = [
      1,
      2,
      'unit-id',
      'server',
      'url',
      'token',
      { logs: true },
      ['group-a'],
      true,
      ['file-id']
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
