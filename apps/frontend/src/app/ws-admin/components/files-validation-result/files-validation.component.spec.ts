import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { FilesValidationDialogComponent } from './files-validation.component';

describe('FilesValidationComponent', () => {
  let component: FilesValidationDialogComponent;
  let fixture: ComponentFixture<FilesValidationDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        FilesValidationDialogComponent,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: MatDialogRef,
          useValue: []
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: []

        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(FilesValidationDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
