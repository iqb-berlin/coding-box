import { OverlayContainer } from '@angular/cdk/overlay';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSelect } from '@angular/material/select';
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

  it('starts job definition filters empty and toggles all options', () => {
    const { component } = createComponent({
      context: 'execution',
      coders: [],
      jobDefinitions: [
        { id: 11, label: 'Definition #11' },
        { id: 12, label: 'Definition #12' }
      ]
    });

    expect(component.selectedJobDefinitionIds).toEqual([]);
    expect(component.areAllJobDefinitionsSelected).toBe(false);

    component.toggleAllJobDefinitions();

    expect(component.selectedJobDefinitionIds).toEqual([11, 12]);
    expect(component.areAllJobDefinitionsSelected).toBe(true);

    component.toggleAllJobDefinitions();

    expect(component.selectedJobDefinitionIds).toEqual([]);
  });

  it('removes the job definition toggle option from the selected ids', () => {
    const { component } = createComponent({
      context: 'execution',
      coders: [],
      jobDefinitions: [{ id: 11, label: 'Definition #11' }]
    });

    component.selectedJobDefinitionIds = [component.selectAllOptionId, 11];
    component.removeJobDefinitionToggleOption();

    expect(component.selectedJobDefinitionIds).toEqual([11]);
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

  it('starts training filters empty and toggles all options', () => {
    const { component } = createComponent({
      context: 'training',
      coders: [],
      coderTrainings: [
        { id: 7, label: 'Schulung A' } as never,
        { id: 8, label: 'Schulung B' } as never
      ]
    });

    expect(component.selectedCoderTrainingIds).toEqual([]);

    component.toggleAllCoderTrainings();

    expect(component.selectedCoderTrainingIds).toEqual([7, 8]);
    expect(component.areAllCoderTrainingsSelected).toBe(true);
  });

  it('removes the training toggle option from the selected ids', () => {
    const { component } = createComponent({
      context: 'training',
      coders: [],
      coderTrainings: [{ id: 7, label: 'Schulung A' } as never]
    });

    component.selectedCoderTrainingIds = [component.selectAllOptionId, 7];
    component.removeCoderTrainingToggleOption();

    expect(component.selectedCoderTrainingIds).toEqual([7]);
  });

  it('returns response data options for new-row-per-variable review exports', () => {
    const { component, dialogRef } = createComponent({
      context: 'execution',
      coders: []
    });

    component.doubleCodingMethod = 'new-row-per-variable';
    component.includeReplayUrl = true;
    component.includeResponseValues = true;

    component.confirm();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        exportType: 'aggregated',
        includeReplayUrl: true,
        includeResponseValues: true
      })
    );
  });

  it('does not return response data options for unsupported review exports', () => {
    const { component, dialogRef } = createComponent({
      context: 'execution',
      coders: []
    });

    component.doubleCodingMethod = 'new-column-per-coder';
    component.includeReplayUrl = true;
    component.includeResponseValues = true;

    expect(component.canIncludeResponseData).toBe(false);

    component.confirm();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        includeReplayUrl: false,
        includeResponseValues: false
      })
    );
  });

  it('returns response data options for detailed report exports', () => {
    const { component, dialogRef } = createComponent({
      context: 'training',
      coders: []
    });

    component.exportMode = 'report';
    component.reportExportType = 'detailed';
    component.includeReplayUrl = true;
    component.includeResponseValues = true;

    component.confirm();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        exportType: 'detailed',
        includeReplayUrl: true,
        includeResponseValues: true
      })
    );
  });

  it('does not return includeReplayUrl for coding-times exports', () => {
    const { component, dialogRef } = createComponent({
      context: 'training',
      coders: []
    });

    component.exportMode = 'report';
    component.reportExportType = 'coding-times';
    component.includeReplayUrl = true;
    component.includeResponseValues = true;

    expect(component.canIncludeResponseData).toBe(false);

    component.confirm();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        exportType: 'coding-times',
        includeReplayUrl: false,
        includeResponseValues: false
      })
    );
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
          {
            provide: MAT_DIALOG_DATA,
            useValue: {
              context: 'training',
              coders: [],
              coderTrainings: [
                { id: 7, label: 'Schulung A' },
                { id: 8, label: 'Schulung B' }
              ]
            }
          }
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

    it('selects and deselects all trainings through the first select option', () => {
      const select = fixture.debugElement.query(By.directive(MatSelect)).componentInstance as MatSelect;
      const overlayContainer = TestBed.inject(OverlayContainer).getContainerElement();

      select.open();
      fixture.detectChanges();
      const toggleOption = overlayContainer.querySelector('mat-option') as HTMLElement;
      toggleOption.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.selectedCoderTrainingIds).toEqual([7, 8]);

      toggleOption.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.selectedCoderTrainingIds).toEqual([]);
    });
  });
});
