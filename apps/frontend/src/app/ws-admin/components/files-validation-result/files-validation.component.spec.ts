import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideHttpClient } from '@angular/common/http';
import { FilesValidationDialogComponent } from './files-validation.component';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';

describe('FilesValidationComponent', () => {
  let component: FilesValidationDialogComponent;
  let fixture: ComponentFixture<FilesValidationDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FilesValidationDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatDialogRef,
          useValue: []
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: []
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
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
