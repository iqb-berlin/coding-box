import { TestBed } from '@angular/core/testing';
import {
  BehaviorSubject, Subject, of, throwError
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { CodingJobBackendService, JobDefinition } from '../../services/coding-job-backend.service';
import { CoderService } from '../../services/coder.service';
import { Coder } from '../../models/coder.model';
import { ManualCodingExportScopeFacade } from './manual-coding-export-scope.facade';

describe('ManualCodingExportScopeFacade', () => {
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: BehaviorSubject<number> };
  let getDefinitions: jest.Mock;
  let getCoders: jest.Mock;
  let scope: ManualCodingExportScopeFacade;
  beforeEach(() => {
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new BehaviorSubject(5) };
    getDefinitions = jest.fn().mockReturnValue(of([{ id: 3 }]));
    getCoders = jest.fn().mockReturnValue(of([{ id: 1, name: 'A' }]));
    TestBed.configureTestingModule({ providers: [ManualCodingExportScopeFacade, { provide: AppService, useValue: app }, { provide: CodingJobBackendService, useValue: { getJobDefinitions: getDefinitions } }, { provide: CoderService, useValue: { getCodersForExport: getCoders } }] });
    scope = TestBed.inject(ManualCodingExportScopeFacade);
    expect(Reflect.get(scope.coders, 'set')).toBeUndefined();
    expect(Reflect.get(scope.isLoadingCodersForExport, 'set')).toBeUndefined();
  });

  it('keeps a successful empty scope distinct from an unloaded scope', () => {
    getDefinitions.mockReturnValue(of([]));
    getCoders.mockReturnValue(of([]));
    expect(scope.ensureDefinitionsReady(false)).toBe(false);
    expect(scope.ensureCodersReady()).toBe(false);
    expect(scope.ensureDefinitionsReady(false)).toBe(true);
    expect(scope.ensureCodersReady()).toBe(true);
    expect(getDefinitions).toHaveBeenCalledTimes(1);
    expect(getCoders).toHaveBeenCalledTimes(1);
    expect(scope.getDefinitions()).toEqual([]);
  });

  it('cancels superseded requests and keeps the latest definitions and coders', () => {
    const olderDefinitions = new Subject<JobDefinition[]>();
    const olderCoders = new Subject<Coder[]>();
    getDefinitions.mockReturnValueOnce(olderDefinitions);
    getCoders.mockReturnValueOnce(olderCoders);
    scope.loadJobDefinitionsForExport(); scope.loadCodersForExport();
    scope.loadJobDefinitionsForExport(); scope.loadCodersForExport();
    olderDefinitions.next([{ id: 99 }]); olderCoders.error(new Error('old error'));
    expect(scope.getDefinitions()).toEqual([{ id: 3 }]);
    expect(scope.coders()).toEqual([{ id: 1, name: 'A' }]);
    expect(scope.isLoadingCodersForExport()).toBe(false);
  });

  it('discards caches and pending responses across an A-B-A workspace change', () => {
    const delayed = new Subject<JobDefinition[]>();
    scope.loadCodersForExport();
    getDefinitions.mockReturnValueOnce(delayed);
    scope.loadJobDefinitionsForExport();
    app.selectedWorkspaceId = 6; app.selectedWorkspaceId$.next(6);
    app.selectedWorkspaceId = 5; app.selectedWorkspaceId$.next(5);
    delayed.next([{ id: 99 }]);
    expect(scope.getDefinitions()).toEqual([]);
    expect(scope.coders()).toEqual([]);
    expect(scope.ensureDefinitionsReady(false)).toBe(false);
    expect(scope.getDefinitions()).toEqual([{ id: 3 }]);
  });

  it('retries failed loading and cancels on destruction', () => {
    getDefinitions.mockReturnValueOnce(throwError(() => new Error('failed')));
    scope.loadJobDefinitionsForExport();
    expect(scope.ensureDefinitionsReady(false)).toBe(false);
    expect(scope.getDefinitions()).toEqual([{ id: 3 }]);
    const delayed = new Subject<Coder[]>();
    getCoders.mockReturnValue(delayed);
    scope.loadCodersForExport();
    TestBed.resetTestingModule();
    delayed.next([{ id: 99, name: 'old' }]);
    expect(scope.coders()).toEqual([]);
    expect(scope.isLoadingCodersForExport()).toBe(false);
  });
});
