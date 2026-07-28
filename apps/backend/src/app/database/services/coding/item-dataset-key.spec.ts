import {
  ItemDatasetResponseKey,
  ItemDatasetSelectionKey
} from '../../../../../../../api-dto/coding/item-dataset-key';

describe('item dataset keys', () => {
  it('normalizes unit and item IDs for selection keys', () => {
    expect(
      ItemDatasetSelectionKey.from(' folder/unit.xml ', ' item-1 ').toString()
    ).toBe('FOLDER/UNIT\u001Fitem-1');
  });

  it('normalizes unit and variable IDs for response keys', () => {
    expect(
      ItemDatasetResponseKey.from(' unit.xml ', ' variable_1 ').toString()
    ).toBe('UNIT\u001Fvariable_1');
  });

  it('parses normalized key values', () => {
    expect(ItemDatasetSelectionKey.parse('unit\u001Fitem')?.itemId).toBe(
      'item'
    );
    expect(ItemDatasetResponseKey.parse('unit\u001Fvariable')?.variableId).toBe(
      'variable'
    );
  });

  it('keeps case-sensitive item and variable IDs distinct', () => {
    expect(ItemDatasetSelectionKey.from('unit', 'item').toString()).not.toBe(
      ItemDatasetSelectionKey.from('unit', 'ITEM').toString()
    );
    expect(ItemDatasetResponseKey.from('unit', 'variable').toString()).not.toBe(
      ItemDatasetResponseKey.from('unit', 'VARIABLE').toString()
    );
  });
});
