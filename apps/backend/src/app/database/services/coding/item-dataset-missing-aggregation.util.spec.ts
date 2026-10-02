import { aggregateItemDatasetMissingStates } from './item-dataset-missing-aggregation.util';

describe('aggregateItemDatasetMissingStates', () => {
  it.each([
    [['valid', 'valid'], 'valid'],
    [['valid', 'mir'], 'valid'],
    [['valid', 'mci'], 'mci'],
    [['valid', 'mnr'], 'valid'],
    [['valid', 'mbd'], 'error'],
    [['valid', 'mbi_mbo'], 'valid'],
    [['mir', 'mir'], 'mir'],
    [['mir', 'mci'], 'mci'],
    [['mir', 'mnr'], 'mir'],
    [['mir', 'mbd'], 'error'],
    [['mir', 'mbi_mbo'], 'mir'],
    [['mci', 'mci'], 'mci'],
    [['mci', 'mnr'], 'mci'],
    [['mci', 'mbd'], 'error'],
    [['mci', 'mbi_mbo'], 'mci'],
    [['mnr', 'mnr'], 'mnr'],
    [['mnr', 'mbd'], 'error'],
    [['mnr', 'mbi_mbo'], 'mnr'],
    [['mbd', 'mbd'], 'mbd'],
    [['mbd', 'mbi_mbo'], 'error'],
    [['mbi_mbo', 'mbi_mbo'], 'mbi_mbo']
  ] as const)('aggregates %j to %s', (states, expected) => {
    expect(aggregateItemDatasetMissingStates([...states])).toBe(expected);
  });

  it('combines nested intermediate results pairwise', () => {
    expect(aggregateItemDatasetMissingStates(['mci', 'mir', 'mbi_mbo'])).toBe(
      'mci'
    );
  });
});
