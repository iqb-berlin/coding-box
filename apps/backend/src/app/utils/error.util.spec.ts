import { getErrorMessage, getErrorStack, toError } from './error.util';

describe('Unknown error diagnostics', () => {
  it.each([
    [new Error('failure'), 'failure'],
    [{ message: 'driver failure' }, 'driver failure'],
    ['rejected', 'rejected'],
    [null, 'null'],
    [undefined, 'undefined'],
    [42, '42'],
    [{ message: 42 }, '[object Object]']
  ])('reads a safe message from %j', (value, expected) => {
    expect(getErrorMessage(value)).toBe(expected);
  });

  it('retains existing errors and their stack for callback APIs', () => {
    const error = new Error('original');
    expect(toError(error)).toBe(error);
    expect(getErrorStack(error)).toBe(error.stack);
    expect(toError('failure')).toEqual(new Error('failure'));
    expect(getErrorStack({ stack: 42 })).toBeUndefined();
    expect(getErrorStack(null)).toBeUndefined();
  });
});
