import { variableKey } from './variable-key.util';

it('retains variable identity across refreshes without merging names containing separators', () => {
  const variable = { unitName: 'UNIT:A', variableId: 'B' };
  expect(variableKey({ ...variable })).toBe(variableKey(variable));
  expect(variableKey(variable)).not.toBe(variableKey({ unitName: 'UNIT', variableId: 'A:B' }));
});
