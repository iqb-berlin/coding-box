import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import {
  BaseValidationService, DuplicateResponsesValidationService, GroupResponsesValidationService,
  ResponseStatusValidationService, TestTakersValidationService, VariableTypeValidationService,
  VariableValidationService
} from './index';
import { AppService } from '../../../core/services/app.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { ValidationTaskStateService, ValidationType } from '../../../shared/services/validation/validation-task-state.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

const cases: [ValidationType, Type<BaseValidationService<unknown>>][] = [
  ['variables', VariableValidationService],
  ['variableTypes', VariableTypeValidationService],
  ['responseStatus', ResponseStatusValidationService],
  ['testTakers', TestTakersValidationService],
  ['groupResponses', GroupResponsesValidationService],
  ['duplicateResponses', DuplicateResponsesValidationService]
];

const result = {
  data: [],
  total: 0,
  page: 1,
  limit: 10,
  testTakersFound: true,
  missingPersons: [],
  allGroupsHaveResponses: true,
  groupsWithResponses: []
};

describe.each(cases)('%s validation workspace context', (type, Service) => {
  it.each(['creation', 'polling', 'results'])('keeps the original workspace when switching during %s', phase => {
    const creation = new Subject<ValidationTaskDto>();
    const polling = new Subject<ValidationTaskDto>();
    const results = new Subject<typeof result>();
    const backend = {
      createValidationTask: jest.fn().mockReturnValue(creation),
      pollValidationTask: jest.fn().mockReturnValue(polling),
      getValidationResults: jest.fn().mockReturnValue(results)
    };
    const app = { selectedWorkspaceId: 5 };
    TestBed.configureTestingModule({
      providers: [Service, { provide: AppService, useValue: app }, { provide: ValidationService, useValue: backend }]
    });
    const state = TestBed.inject(ValidationTaskStateService);
    const otherResult = { status: 'success' as const, timestamp: 1, details: { marker: 'workspace 6' } };
    state.setValidationResult(6, type, otherResult);
    const task: ValidationTaskDto = {
      id: 101,
      workspace_id: 5,
      validation_type: type,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date()
    };
    const next = jest.fn();
    TestBed.inject(Service).validate(1, 10).subscribe(next);
    if (phase === 'creation') app.selectedWorkspaceId = 6;
    creation.next(task);
    creation.complete();
    if (phase === 'polling') app.selectedWorkspaceId = 6;
    polling.next({ ...task, status: 'completed' });
    polling.complete();
    if (phase === 'results') app.selectedWorkspaceId = 6;
    results.next(result);
    results.complete();
    expect(backend.pollValidationTask).toHaveBeenCalledWith(5, 101, 2000);
    expect(backend.getValidationResults).toHaveBeenCalledWith(5, 101);
    expect(state.getAllValidationResults(5)[type]?.details).toEqual(result);
    expect(state.getAllValidationResults(6)[type]).toEqual(otherResult);
    expect(state.getAllTaskIds(5)[type]).toBeUndefined();
    expect(state.getAllTaskIds(6)[type]).toBeUndefined();
    expect(next).toHaveBeenCalledWith(result);
  });
});

describe('Validation pagination workspace context', () => {
  it.each([
    ['variables', 'validateVariables', () => TestBed.inject(VariableValidationService).fetchPage(2, 10)],
    ['variableTypes', 'validateVariableTypes', () => TestBed.inject(VariableTypeValidationService).fetchPage(2, 10)],
    ['responseStatus', 'validateResponseStatus', () => TestBed.inject(ResponseStatusValidationService).fetchPage(2, 10)],
    ['groupResponses', 'validateGroupResponses', () => TestBed.inject(GroupResponsesValidationService).fetchPage(2, 10)],
    ['duplicateResponses', 'validateDuplicateResponses', () => TestBed.inject(DuplicateResponsesValidationService).fetchPage(2, 10)]
  ] as const)('keeps %s pages in their original workspace', (type, method, run) => {
    const response = new Subject<typeof result>();
    const backend = { [method]: jest.fn().mockReturnValue(response) };
    const app = { selectedWorkspaceId: 5 };
    TestBed.configureTestingModule({
      providers: [{ provide: AppService, useValue: app }, { provide: ValidationService, useValue: backend }]
    });
    const state = TestBed.inject(ValidationTaskStateService);
    run().subscribe();
    app.selectedWorkspaceId = 6;
    response.next(result);
    response.complete();
    expect(backend[method]).toHaveBeenCalledWith(5, 2, 10);
    expect(state.getAllValidationResults(5)[type]?.details).toEqual(result);
    expect(state.getAllValidationResults(6)[type]).toBeUndefined();
  });
});

describe('Validation mutation workspace context', () => {
  it.each([
    ['variables', 'selected', () => TestBed.inject(VariableValidationService).deleteSelected([1])],
    ['variables', 'all', () => TestBed.inject(VariableValidationService).deleteAll()],
    ['variableTypes', 'selected', () => TestBed.inject(VariableTypeValidationService).deleteSelected([1])],
    ['variableTypes', 'all', () => TestBed.inject(VariableTypeValidationService).deleteAll()],
    ['responseStatus', 'selected', () => TestBed.inject(ResponseStatusValidationService).deleteSelected([1])],
    ['responseStatus', 'all', () => TestBed.inject(ResponseStatusValidationService).deleteAll()],
    ['duplicateResponses', 'selected', () => TestBed.inject(DuplicateResponsesValidationService).resolveDuplicateGroup([1])],
    ['duplicateResponses', 'all', () => TestBed.inject(DuplicateResponsesValidationService).resolveAllDuplicates()]
  ] as const)('keeps %s %s task creation in its original workspace', (type, selection, run) => {
    const creation = new Subject<ValidationTaskDto>();
    const polling = new Subject<ValidationTaskDto>();
    const backend = {
      createDeleteResponsesTask: jest.fn().mockReturnValue(creation),
      createDeleteAllResponsesTask: jest.fn().mockReturnValue(creation),
      pollValidationTask: jest.fn().mockReturnValue(polling)
    };
    const app = { selectedWorkspaceId: 5 };
    TestBed.configureTestingModule({
      providers: [{ provide: AppService, useValue: app }, { provide: ValidationService, useValue: backend }]
    });
    const state = TestBed.inject(ValidationTaskStateService);
    run().subscribe();
    app.selectedWorkspaceId = 6;
    const task: ValidationTaskDto = {
      id: 101,
      workspace_id: 5,
      validation_type: selection === 'all' ? 'deleteAllResponses' : 'deleteResponses',
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date()
    };
    creation.next(task);
    expect(state.getAllTaskIds(5)[type]).toEqual(task);
    expect(state.getAllTaskIds(6)[type]).toBeUndefined();
    polling.next({ ...task, status: 'completed' });
    polling.complete();
    creation.complete();
    expect(state.getAllTaskIds(5)[type]).toBeUndefined();
  });
});
