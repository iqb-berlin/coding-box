export type ItemDatasetMissingState =
  'valid' | 'mir' | 'mci' | 'mnr' | 'mbd' | 'mbi_mbo' | 'error';

const pair = (
  left: ItemDatasetMissingState,
  right: ItemDatasetMissingState
): string => [left, right].sort().join('|');

const aggregationRules = new Map<string, ItemDatasetMissingState>([
  [pair('valid', 'valid'), 'valid'],
  [pair('valid', 'mir'), 'valid'],
  [pair('valid', 'mci'), 'mci'],
  [pair('valid', 'mnr'), 'valid'],
  [pair('valid', 'mbd'), 'error'],
  [pair('valid', 'mbi_mbo'), 'valid'],
  [pair('mir', 'mir'), 'mir'],
  [pair('mir', 'mci'), 'mci'],
  [pair('mir', 'mnr'), 'mir'],
  [pair('mir', 'mbd'), 'error'],
  [pair('mir', 'mbi_mbo'), 'mir'],
  [pair('mci', 'mci'), 'mci'],
  [pair('mci', 'mnr'), 'mci'],
  [pair('mci', 'mbd'), 'error'],
  [pair('mci', 'mbi_mbo'), 'mci'],
  [pair('mnr', 'mnr'), 'mnr'],
  [pair('mnr', 'mbd'), 'error'],
  [pair('mnr', 'mbi_mbo'), 'mnr'],
  [pair('mbd', 'mbd'), 'mbd'],
  [pair('mbd', 'mbi_mbo'), 'error'],
  [pair('mbi_mbo', 'mbi_mbo'), 'mbi_mbo']
]);

export const aggregateItemDatasetMissingStates = (
  states: ItemDatasetMissingState[]
): ItemDatasetMissingState => {
  if (states.length === 0) {
    return 'error';
  }

  return states.slice(1).reduce<ItemDatasetMissingState>((result, state) => {
    if (result === 'error' || state === 'error') {
      return 'error';
    }
    return aggregationRules.get(pair(result, state)) || 'error';
  }, states[0]);
};
