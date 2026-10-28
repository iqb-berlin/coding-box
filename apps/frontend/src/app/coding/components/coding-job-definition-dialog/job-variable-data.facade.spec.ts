import { TestBed } from '@angular/core/testing';
import {
  BehaviorSubject, of, Subject, throwError
} from 'rxjs';
import { JobVariableDataFacade } from './job-variable-data.facade';
import { CodingJobBackendService, ManualCodingScopeSummary } from '../../services/coding-job-backend.service';
import { AppService } from '../../../core/services/app.service';
import { Variable } from '../../models/coding-job.model';

describe('JobVariableDataFacade', () => {
  let facade: JobVariableDataFacade;
  let variables: jest.Mock;
  let summary: jest.Mock;
  let workspace: BehaviorSubject<number>;
  const rows = [{ unitName: 'UNIT', variableId: 'V' }];

  beforeEach(() => {
    workspace = new BehaviorSubject(5);
    variables = jest.fn().mockReturnValue(of(rows));
    summary = jest.fn().mockReturnValue(of(null));
    TestBed.configureTestingModule({
      providers: [JobVariableDataFacade,
        { provide: AppService, useValue: { selectedWorkspaceId: 5, selectedWorkspaceId$: workspace } },
        { provide: CodingJobBackendService, useValue: { getCodingIncompleteVariables: variables, getManualCodingScopeSummary: summary } }
      ]
    });
    facade = TestBed.inject(JobVariableDataFacade);
  });

  it('forwards the editing/filter context and uses preloaded rows without requesting them', () => {
    const loaded = jest.fn(); facade.loaded$.subscribe(loaded);
    facade.load({
      workspaceId: 5, unitName: 'UNIT', trainingRequired: true, includeDeriveError: true, editingDefinitionId: 9
    });
    expect(variables).toHaveBeenCalledWith(5, 'UNIT', true, true, 9);
    expect(summary).toHaveBeenCalledWith(5, 'UNIT', true);
    variables.mockClear();
    facade.load({ workspaceId: 5, preloadedVariables: rows });
    expect(variables).not.toHaveBeenCalled();
    expect(loaded).toHaveBeenLastCalledWith(rows);
    expect(facade.isLoading()).toBe(false);
  });

  it.each(['filter', 'workspace', 'destroy'])('cancels both outstanding queries on %s', reason => {
    const rowRequest = new Subject<Variable[]>();
    const scopeRequest = new Subject<ManualCodingScopeSummary>();
    variables.mockReturnValueOnce(rowRequest);
    summary.mockReturnValueOnce(scopeRequest);
    const loaded = jest.fn(); facade.loaded$.subscribe(loaded);
    facade.load({ workspaceId: 5 });
    if (reason === 'filter') facade.load({ workspaceId: 5, unitName: 'next' });
    if (reason === 'workspace') workspace.next(6);
    if (reason === 'destroy') TestBed.resetTestingModule();
    expect(rowRequest.observed).toBe(false);
    expect(scopeRequest.observed).toBe(false);
    expect(facade.isLoading()).toBe(false);
    loaded.mockClear(); rowRequest.next(rows); scopeRequest.error(new Error('late'));
    expect(loaded).not.toHaveBeenCalled();
  });

  it('finishes failed loads so recovery can proceed, and permits retry', () => {
    variables.mockReturnValueOnce(throwError(() => new Error('offline')));
    summary.mockReturnValueOnce(throwError(() => new Error('offline')));
    const finished = jest.fn(); facade.finished$.subscribe(finished);
    facade.load({ workspaceId: 5 });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(facade.summary()).toBeNull();
    expect(facade.isLoading()).toBe(false);
    facade.load({ workspaceId: 5 });
    expect(finished).toHaveBeenCalledTimes(2);
  });

  it('keeps a recovery-triggered reentrant load active when the old request finalizes', () => {
    const pending = new Subject<Variable[]>();
    variables.mockReturnValueOnce(of(rows)).mockReturnValueOnce(pending);
    facade.finished$.subscribe(() => facade.load({ workspaceId: 5, unitName: 'recovered-filter' }));
    facade.load({ workspaceId: 5 });
    expect(facade.isLoading()).toBe(true);
    expect(pending.observed).toBe(true);
  });
});
