import { createFacadeTestProxy } from './facade-test.factory';

class Provider {
  calls: number[] = [];

  perform(value: number): number {
    this.calls.push(value);
    return value + 1;
  }

  execute(value: number): number {
    return this.perform(value);
  }
}

describe('decomposed service test spies', () => {
  it('routes a descriptor replacement and its restoration to the provider used by callers', () => {
    const provider = new Provider();
    const proxy = createFacadeTestProxy({ execute: (value: number) => provider.execute(value) }, [provider]);
    const original = Object.getOwnPropertyDescriptor(proxy, 'perform')!;
    const replacement = jest.fn().mockReturnValue(42);
    Object.defineProperty(proxy, 'perform', { ...original, value: replacement });
    expect(proxy.execute(3)).toBe(42);
    expect(replacement).toHaveBeenCalledWith(3);
    Object.defineProperty(proxy, 'perform', original);
    expect(proxy.execute(3)).toBe(4);
    expect(provider.calls).toEqual([3]);
  });

  it('preserves assignment-based spies and restores their actual provider', () => {
    const provider = new Provider();
    const proxy = createFacadeTestProxy(provider, [provider]);
    const spy = jest.spyOn(proxy, 'perform').mockReturnValue(9);
    expect(proxy.execute(2)).toBe(9);
    expect(spy).toHaveBeenCalledWith(2);
    spy.mockRestore();
    expect(proxy.execute(2)).toBe(3);
  });
});
