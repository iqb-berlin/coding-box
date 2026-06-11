import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ManualCodingExportDialogComponent } from './manual-coding-export-dialog.component';

describe('ManualCodingExportDialogComponent', () => {
  const createComponent = (
    data: ConstructorParameters<typeof ManualCodingExportDialogComponent>[1]
  ): {
    component: ManualCodingExportDialogComponent;
    dialogRef: { close: jest.Mock };
  } => {
    const dialogRef = { close: jest.fn() };
    return {
      component: new ManualCodingExportDialogComponent(dialogRef as never, data),
      dialogRef
    };
  };

  it('requires at least one job definition when execution options are available', () => {
    const { component, dialogRef } = createComponent({
      context: 'execution',
      coders: [],
      jobDefinitions: [{ id: 11, label: 'Definition #11' }]
    });

    component.selectedJobDefinitionIds = [];

    expect(component.canConfirm).toBe(false);

    component.confirm();

    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('requires at least one coder training when training options are available', () => {
    const { component, dialogRef } = createComponent({
      context: 'training',
      coders: [],
      coderTrainings: [{ id: 7, label: 'Schulung A' } as never]
    });

    component.selectedCoderTrainingIds = [];

    expect(component.canConfirm).toBe(false);

    component.confirm();

    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  describe('template', () => {
    let fixture: ComponentFixture<ManualCodingExportDialogComponent>;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [
          ManualCodingExportDialogComponent,
          NoopAnimationsModule,
          TranslateModule.forRoot()
        ],
        providers: [
          { provide: MatDialogRef, useValue: { close: jest.fn() } },
          { provide: MAT_DIALOG_DATA, useValue: { context: 'training', coders: [] } }
        ]
      }).compileComponents();

      const translateService = TestBed.inject(TranslateService);
      translateService.setTranslation('de', {
        'ws-admin': {
          'export-options': {
            'most-frequent-random': 'Kodierer: häufigster Code',
            'new-column-per-coder': 'pro Kodierer neue Spalte',
            'new-row-per-variable': 'pro Variable neue Zeile'
          }
        }
      });
      translateService.use('de');

      fixture = TestBed.createComponent(ManualCodingExportDialogComponent);
      fixture.detectChanges();
    });

    it('renders translated double-coding method labels', () => {
      const textContent = fixture.nativeElement.textContent;

      expect(textContent).toContain('Kodierer: häufigster Code');
      expect(textContent).toContain('pro Kodierer neue Spalte');
      expect(textContent).toContain('pro Variable neue Zeile');
      expect(textContent).not.toContain('ws-admin.export-options.double-coding-methods');
    });
  });
});
