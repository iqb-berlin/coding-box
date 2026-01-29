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

  it('should calculate summary correctly', () => {
    // Mock data
    component.data = {
      validationResults: [
        {
          testTaker: 'test1',
          testTakerSchemaValid: true,
          booklets: { complete: true, missing: [], files: [{ filename: 'b1', exists: true }] },
          units: { complete: false, missing: ['u1'], files: [{ filename: 'u1', exists: false }] },
          schemes: { complete: true, missing: [], files: [] },
          schemer: { complete: true, missing: [], files: [] },
          definitions: { complete: true, missing: [], files: [] },
          player: { complete: true, missing: [], files: [] },
          metadata: { complete: true, missing: [], files: [] }
        },
        {
          testTaker: 'test2',
          testTakerSchemaValid: false,
          booklets: { complete: false, missing: ['b2', 'b3'], files: [{ filename: 'b2', exists: false }, { filename: 'b3', exists: false }] },
          units: { complete: true, missing: [], files: [{ filename: 'u2', exists: true }] },
          schemes: { complete: true, missing: [], files: [] },
          schemer: { complete: true, missing: [], files: [] },
          definitions: { complete: true, missing: [], files: [] },
          player: { complete: true, missing: [], files: [] },
          metadata: { complete: true, missing: [], files: [] }
        },
        {
          testTaker: 'test3',
          testTakerSchemaValid: true,
          booklets: { complete: false, missing: ['b2'], files: [{ filename: 'b2', exists: false }] }, // Duplicate missing file b2
          units: { complete: true, missing: [], files: [] },
          schemes: { complete: true, missing: [], files: [] },
          schemer: { complete: true, missing: [], files: [] },
          definitions: { complete: true, missing: [], files: [] },
          player: { complete: true, missing: [], files: [] },
          metadata: { complete: true, missing: [], files: [] }
        }
      ]
    };

    // Trigger calculation (usually done in constructor which we can't easily re-run, so we call private method via any or rely on init if we moved it)
    // Since we called calculateSummary in the constructor, we need to manually call it or re-create component with data.
    // However, for this test, we can just call it if we cast to any or if we made it public (it's private).
    // Let's use brackets to access private method for testing.
    (component as unknown as { calculateSummary: () => void }).calculateSummary();

    expect(component.summary.totalTestTakers).toBe(3);
    expect(component.summary.validTestTakerXmls).toBe(2);
    expect(component.summary.invalidTestTakerXmls).toBe(1);

    expect(component.summary.booklets.complete).toBe(1);
    expect(component.summary.booklets.incomplete).toBe(2);
    expect(component.summary.booklets.missingFiles).toBe(2);
    expect(component.summary.booklets.missingFileNames).toEqual(['b2', 'b3']);

    expect(component.summary.units.complete).toBe(2);
    expect(component.summary.units.incomplete).toBe(1);
    expect(component.summary.units.missingFiles).toBe(1);
    expect(component.summary.units.missingFileNames).toEqual(['u1']);
  });
});
