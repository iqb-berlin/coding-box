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
});
