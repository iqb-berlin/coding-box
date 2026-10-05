import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, Subject } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { Variable, VariableBundle } from '../../models/coding-job.model';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import {
  VariableBundleDialogComponent,
  VariableBundleGroupDialogData
} from './variable-bundle-dialog.component';

describe('VariableBundleDialogComponent', () => {
  let component: VariableBundleDialogComponent;
  let backend: { getCodingIncompleteVariables: jest.Mock };
  let dialogRef: { close: jest.Mock };
  let dialogData: VariableBundleGroupDialogData;
  const variables: Variable[] = [
    { unitName: 'UNIT1', variableId: 'VAR1' },
    { unitName: 'UNIT2', variableId: 'VAR2' }
  ];

  beforeEach(() => {
    backend = { getCodingIncompleteVariables: jest.fn(() => of(variables)) };
    dialogRef = { close: jest.fn() };
    dialogData = { isEdit: false };
    TestBed.configureTestingModule({
      providers: [
        VariableBundleDialogComponent,
        FormBuilder,
        { provide: CodingJobBackendService, useValue: backend },
        { provide: AppService, useValue: { selectedWorkspaceId: 5 } },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: dialogRef }
      ]
    });
    component = TestBed.inject(VariableBundleDialogComponent);
  });

  afterEach(() => component.ngOnDestroy());

  it('reuses preloaded variables and restores only matching bundle selections', fakeAsync(() => {
    dialogData.preloadedIncompleteVariables = variables;
    dialogData.isEdit = true;
    dialogData.bundleGroup = {
      id: 9,
      name: 'Existing bundle',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      variables: [variables[1], { unitName: 'REMOVED', variableId: 'VAR3' }]
    };
    component.ngOnInit();
    tick();
    expect(backend.getCodingIncompleteVariables).not.toHaveBeenCalled();
    expect(component.dataSource.data).toEqual(variables);
    expect(component.selectedVariables.selected).toEqual([variables[1]]);
    expect(component.isLoadingVariableAnalysis).toBe(false);
  }));

  it('submits the selected variables with their generated name', fakeAsync(() => {
    component.ngOnInit();
    component.selectedVariables.select(...variables);
    tick(300);
    component.onSubmit();
    expect(backend.getCodingIncompleteVariables).toHaveBeenCalledWith(5, undefined);
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
      id: 0,
      name: 'UNIT1_VAR1-UNIT2_VAR2',
      variables,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date)
    }));
  }));

  it('preserves a manually edited name when the selection changes', fakeAsync(() => {
    component.ngOnInit();
    component.selectedVariables.select(variables[0]);
    tick(300);
    component.bundleGroupForm.patchValue({ name: 'My bundle' });
    tick(300);
    component.selectedVariables.select(variables[1]);
    expect(component.bundleGroupForm.value.name).toBe('My bundle');
    tick(300);
  }));

  it('selects only variables matching both case-insensitive table filters', fakeAsync(() => {
    component.ngOnInit();
    tick();
    component.unitNameFilter = 'unit2';
    component.variableIdFilter = 'var2';
    component.applyFilter();
    component.selectAll();
    expect(component.selectedVariables.selected).toEqual([variables[1]]);
    tick(300);
  }));

  it('releases the loading state when variable analysis fails', () => {
    const pendingVariables = new Subject<Variable[]>();
    backend.getCodingIncompleteVariables.mockReturnValue(pendingVariables.asObservable());
    component.initForm();
    component.loadCodingIncompleteVariables();
    expect(component.isLoadingVariableAnalysis).toBe(true);
    pendingVariables.error(new Error('analysis unavailable'));
    expect(component.isLoadingVariableAnalysis).toBe(false);
    expect(component.dataSource.data).toEqual([]);
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('does not submit an invalid bundle and preserves identity when editing', fakeAsync(() => {
    component.initForm();
    component.onSubmit();
    expect(dialogRef.close).not.toHaveBeenCalled();
    const original: VariableBundle = {
      id: 9,
      name: 'Existing bundle',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      variables: [variables[0]]
    };
    dialogData.bundleGroup = original;
    component.bundleGroupForm.patchValue({ name: 'Renamed bundle' });
    component.selectedVariables.select(variables[0]);
    tick(300);
    component.onSubmit();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
      id: 9,
      name: 'Renamed bundle',
      createdAt: original.createdAt,
      variables: [variables[0]]
    }));
  }));
});
