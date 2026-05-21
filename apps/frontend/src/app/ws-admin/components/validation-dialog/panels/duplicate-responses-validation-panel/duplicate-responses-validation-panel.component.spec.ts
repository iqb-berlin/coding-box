import { of } from 'rxjs';
import { DuplicateResponseSelectionDto } from '../../../../models/duplicate-response-selection.dto';
import { DuplicateResponsesValidationPanelComponent } from './duplicate-responses-validation-panel.component';

describe('DuplicateResponsesValidationPanelComponent', () => {
  it('should resolve selected duplicate groups without clearing untouched selections', () => {
    const validationService = {
      resolveDuplicateGroup: jest.fn().mockReturnValue(of(undefined))
    };
    const snackBar = {
      open: jest.fn()
    };
    const component = new DuplicateResponsesValidationPanelComponent(
      validationService as never,
      snackBar as never
    );
    jest.spyOn(component, 'onValidate').mockImplementation();

    component.duplicateResponses = [
      {
        key: 'group-a',
        duplicates: [{ responseId: 1 }, { responseId: 2 }]
      },
      {
        key: 'group-b',
        duplicates: [{ responseId: 3 }, { responseId: 4 }]
      },
      {
        key: 'group-c',
        duplicates: [{ responseId: 5 }, { responseId: 6 }]
      }
    ] as DuplicateResponseSelectionDto[];
    component.duplicateResponseSelections.set('group-a', 1);
    component.duplicateResponseSelections.set('group-b', 3);
    component.duplicateResponseSelections.set('group-c', 5);
    component.duplicateResponseTouchedKeys.add('group-a');
    component.duplicateResponseTouchedKeys.add('group-b');

    component.resolveSelectedDuplicates();

    expect(validationService.resolveDuplicateGroup).toHaveBeenCalledTimes(2);
    expect(validationService.resolveDuplicateGroup).toHaveBeenNthCalledWith(1, [
      2
    ]);
    expect(validationService.resolveDuplicateGroup).toHaveBeenNthCalledWith(2, [
      4
    ]);
    expect(component.duplicateResponseSelections.has('group-a')).toBe(false);
    expect(component.duplicateResponseSelections.has('group-b')).toBe(false);
    expect(component.duplicateResponseSelections.get('group-c')).toBe(5);
    expect(component.onValidate).toHaveBeenCalledTimes(1);
  });
});
