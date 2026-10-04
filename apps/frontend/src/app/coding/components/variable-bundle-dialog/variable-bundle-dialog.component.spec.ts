import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { VariableBundleDialogComponent } from './variable-bundle-dialog.component';

describe('VariableBundleDialog read-only view', () => {
  it('shows the existing selection and prevents card, checkbox, bulk and save actions', async () => {
    const variables = [{ unitName: 'UNIT', variableId: 'V1' }, { unitName: 'UNIT', variableId: 'V2' }];
    const close = jest.fn();
    await TestBed.configureTestingModule({
      imports: [VariableBundleDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        { provide: CodingJobBackendService, useValue: { getCodingIncompleteVariables: () => of(variables) } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { readOnly: true, isEdit: true, bundleGroup: { name: 'Bundle', variables: [variables[0]] } } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(VariableBundleDialogComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component.bundleGroupForm.disabled).toBe(true);
    expect(component.bundleGroupForm.get('name')?.value).toBe('Bundle');
    expect(component.selectedVariables.selected).toEqual([variables[0]]);
    expect(fixture.nativeElement.textContent).toContain('UNIT_V1');
    expect(fixture.nativeElement.textContent).not.toContain('Speichern');
    expect(fixture.nativeElement.querySelector('.mat-mdc-checkbox input').disabled).toBe(true);
    fixture.nativeElement.querySelector('.variable-card').click();
    component.toggleVariable(variables[1]);
    component.selectAll();
    component.deselectAll();
    component.onSubmit();
    expect(component.selectedVariables.selected).toEqual([variables[0]]);
    expect(close).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
