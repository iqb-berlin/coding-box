import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, throwError } from 'rxjs';
import { VariableTypeValidationService } from '../../../../services/validation';
import { VariableTypesValidationPanelComponent } from './variable-types-validation-panel.component';

describe('VariableTypesValidationPanelComponent', () => {
  let component: VariableTypesValidationPanelComponent;
  let service: {
    observeValidationResult: jest.Mock;
    observeValidationTask: jest.Mock;
    getValidationStatus: jest.Mock;
    validate: jest.Mock;
    fetchPage: jest.Mock;
    deleteSelected: jest.Mock;
  };
  let snackBar: { open: jest.Mock };
  const rows = [{
    responseId: 11,
    fileName: 'UNIT1.xml',
    variableId: 'VAR1',
    value: 'invalid',
    expectedType: 'integer',
    errorReason: 'Invalid response'
  }];
  const pageResult = {
    data: rows, total: 1, page: 1, limit: 10
  };

  beforeEach(() => {
    service = {
      observeValidationResult: jest.fn(() => of(null)),
      observeValidationTask: jest.fn(() => of(null)),
      getValidationStatus: jest.fn(() => 'not-run'),
      validate: jest.fn(() => of(pageResult)),
      fetchPage: jest.fn(() => of(pageResult)),
      deleteSelected: jest.fn(() => of(undefined))
    };
    snackBar = { open: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        VariableTypesValidationPanelComponent,
        { provide: VariableTypeValidationService, useValue: service },
        { provide: MatSnackBar, useValue: snackBar }
      ]
    });
    component = TestBed.inject(VariableTypesValidationPanelComponent);
  });

  afterEach(() => component.ngOnDestroy());

  it('shows the completed validation result and emits the validation action', () => {
    const pending = new Subject<typeof pageResult>();
    service.validate.mockReturnValue(pending.asObservable());
    const validateAction = jest.spyOn(component.validate, 'emit');
    component.onValidate();
    expect(component.isRunning).toBe(true);
    expect(service.validate).toHaveBeenCalledWith(1, 10);
    expect(validateAction).toHaveBeenCalledTimes(1);
    pending.next(pageResult);
    pending.complete();
    expect(component.invalidTypeVariables).toEqual(rows);
    expect(component.errorCount).toBe(1);
    expect(component.wasRun).toBe(true);
    expect(component.isRunning).toBe(false);
  });

  it('does not start a second validation while running or disabled', () => {
    component.disabled = true;
    component.onValidate();
    component.disabled = false;
    component.isRunning = true;
    component.onValidate();
    expect(service.validate).not.toHaveBeenCalled();
  });

  it('reports validation failure and releases the running state', () => {
    service.validate.mockReturnValue(throwError(() => new Error('validation unavailable')));
    component.onValidate();
    expect(component.isRunning).toBe(false);
    expect(component.wasRun).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith(
      'Fehler bei der Validierung', 'Schließen', { duration: 5000 }
    );
  });

  it('uses one-based API pagination and replaces rows only after the page arrives', () => {
    const pending = new Subject<typeof pageResult>();
    service.fetchPage.mockReturnValue(pending.asObservable());
    component.onPageChange({ pageIndex: 2, pageSize: 25, length: 60 });
    expect(service.fetchPage).toHaveBeenCalledWith(3, 25);
    expect(component.isLoadingPage).toBe(true);
    pending.next({ ...pageResult, page: 3, limit: 25 });
    pending.complete();
    expect(component.invalidTypeVariables).toEqual(rows);
    expect(component.currentPage).toBe(3);
    expect(component.pageSize).toBe(25);
    expect(component.isLoadingPage).toBe(false);
  });

  it('keeps the current rows visible if a page request fails', () => {
    component.invalidTypeVariables = rows;
    service.fetchPage.mockReturnValue(throwError(() => new Error('page unavailable')));
    component.onPageChange({ pageIndex: 1, pageSize: 10, length: 20 });
    expect(component.invalidTypeVariables).toEqual(rows);
    expect(component.isLoadingPage).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith(
      'Fehler beim Laden der Seite', 'Schließen', { duration: 5000 }
    );
  });

  it('clears selections and reloads validation only after successful deletion', () => {
    const pendingDelete = new Subject<void>();
    service.deleteSelected.mockReturnValue(pendingDelete.asObservable());
    service.validate.mockReturnValue(of({ ...pageResult, data: [], total: 0 }));
    component.selectedResponses = new Set([11]);
    component.deleteSelected();
    expect(service.deleteSelected).toHaveBeenCalledWith([11]);
    expect(component.isDeletingResponses).toBe(true);
    expect(service.validate).not.toHaveBeenCalled();
    pendingDelete.next();
    pendingDelete.complete();
    expect(component.selectedResponses.size).toBe(0);
    expect(component.isDeletingResponses).toBe(false);
    expect(service.validate).toHaveBeenCalledTimes(1);
    expect(component.invalidTypeVariables).toEqual([]);
    expect(component.errorCount).toBe(0);
  });

  it('keeps the selection available for retry when deletion fails', () => {
    service.deleteSelected.mockReturnValue(throwError(() => new Error('delete unavailable')));
    component.selectedResponses = new Set([11]);
    component.deleteSelected();
    expect(component.selectedResponses).toEqual(new Set([11]));
    expect(component.isDeletingResponses).toBe(false);
    expect(service.validate).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith('Fehler beim Löschen', 'Schließen', { duration: 5000 });
  });

  it('shows cached validation errors and stops observing after destruction', () => {
    const cachedResult = new Subject<{ status: string; details: { error: string } }>();
    service.observeValidationResult.mockReturnValue(cachedResult.asObservable());
    component.invalidTypeVariables = rows;
    component.totalInvalid = 1;
    component.ngOnInit();
    cachedResult.next({ status: 'failed', details: { error: 'Stored validation failure' } });
    expect(component.errorMessage).toBe('Stored validation failure');
    expect(component.invalidTypeVariables).toEqual([]);
    expect(component.errorCount).toBe(0);
    component.ngOnDestroy();
    cachedResult.next({ status: 'failed', details: { error: 'Later failure' } });
    expect(component.errorMessage).toBe('Stored validation failure');
  });
});
