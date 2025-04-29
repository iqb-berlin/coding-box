import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { FilesValidationDialogComponent } from './files-validation.component';

describe('FilesValidationComponent', () => {
  let component: FilesValidationDialogComponent;
  let fixture: ComponentFixture<FilesValidationDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        FilesValidationDialogComponent,
        TranslateModule.forRoot()
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
