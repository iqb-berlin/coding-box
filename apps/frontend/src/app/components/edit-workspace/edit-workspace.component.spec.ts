import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
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
        NoopAnimationsModule,
        MatDialogModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {}
        },
        {
          provide: FormBuilder,
          useValue: {}
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
});
