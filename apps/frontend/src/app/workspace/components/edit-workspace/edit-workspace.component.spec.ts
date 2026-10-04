import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatInputModule } from '@angular/material/input';
import { EditWorkspaceComponent } from './edit-workspace.component';

describe('EditWorkspaceComponent', () => {
  let component: EditWorkspaceComponent;
  let fixture: ComponentFixture<EditWorkspaceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MatInputModule,
        ReactiveFormsModule,
        MatDialogModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { ws: { name: 'Existing workspace' }, title: 'Edit workspace', saveButtonLabel: 'Save' }
        }
      ]
    })
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(EditWorkspaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component)
      .toBeTruthy();
  });

  it('rejects empty and short names before accepting a valid rename', () => {
    component.editWorkspaceForm.controls.name.setValue('');
    expect(component.editWorkspaceForm.hasError('required', 'name')).toBe(true);
    component.editWorkspaceForm.controls.name.setValue('ab');
    expect(component.editWorkspaceForm.hasError('minlength', 'name')).toBe(true);
    component.editWorkspaceForm.controls.name.setValue('Renamed workspace');
    expect(component.editWorkspaceForm.valid).toBe(true);
  });

  it('restores the original name instead of null when reset', () => {
    component.editWorkspaceForm.controls.name.setValue('Changed');
    component.editWorkspaceForm.reset();
    expect(component.editWorkspaceForm.getRawValue()).toEqual({ name: 'Existing workspace' });
  });
});
