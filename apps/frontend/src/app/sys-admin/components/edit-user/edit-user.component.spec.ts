import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { TranslateModule } from '@ngx-translate/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { EditUserComponent } from './edit-user.component';
import { environment } from '../../../../environments/environment';

describe('EditUserComponent', () => {
  let component: EditUserComponent;
  let fixture: ComponentFixture<EditUserComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MatInputModule,
        MatIconModule,
        HttpClientModule,
        ReactiveFormsModule,
        MatDialogModule,
        MatCheckboxModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { username: 'existing-user', isAdmin: true }
        },
        {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        }
      ]
    })
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(EditUserComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component)
      .toBeTruthy();
  });

  it('keeps an unchecked admin flag valid and includes the disabled username in saved values', () => {
    component.editUserForm.controls.username.disable();
    component.editUserForm.controls.isAdmin.setValue(false);
    expect(component.editUserForm.valid).toBe(true);
    expect(component.editUserForm.getRawValue()).toEqual({ username: 'existing-user', isAdmin: false });
  });

  it('restores the original non-null values on reset', () => {
    component.editUserForm.controls.isAdmin.setValue(false);
    component.editUserForm.reset();
    expect(component.editUserForm.getRawValue()).toEqual({ username: 'existing-user', isAdmin: true });
  });
});
