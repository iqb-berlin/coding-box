import { settleFacetQueries } from './flat-response-facets.util';

describe('Facet query failure cleanup', () => {
  it('keeps the computation pending until every issued query settles after an error', async () => {
    let finish!: (value: string) => void;
    const slow = new Promise<string>(resolve => { finish = resolve; });
    const error = new Error('SQL timeout');
    const result = settleFacetQueries([Promise.reject(error), slow]);
    const observed = jest.fn();
    const outcome = result.then(observed, observed);
    await new Promise(resolve => { setImmediate(resolve); });
    expect(observed).not.toHaveBeenCalled();

    finish('finished');
    await outcome;
    expect(observed).toHaveBeenCalledWith(error);
  });

  it('retains query result ordering when queries complete out of order', async () => {
    let finish!: (value: string) => void;
    const first = new Promise<string>(resolve => { finish = resolve; });
    const result = settleFacetQueries([first, Promise.resolve('second')]);
    finish('first');
    await expect(result).resolves.toEqual(['first', 'second']);
  });
});
