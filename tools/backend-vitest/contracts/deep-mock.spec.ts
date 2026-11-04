import { describe, expect, it, vi } from 'vitest';
import { createMock } from '../deep-mock';

type Reader = { read: (id: string) => string };
const seeds = [
  { label: 'plain function', create: () => (id: string) => 'seed:' + id },
  { label: 'native mock', create: () => vi.fn((id: string) => 'seed:' + id) }
];

describe('deep-mock descriptors for seeded methods', () => {
  it.each(seeds)('spies on the configured wrapper for a $label', ({ create }) => {
    const mock = createMock<Reader>({ read: create() });
    const visible = mock.read;
    visible.mockReturnValue('configured');
    expect(Object.getOwnPropertyDescriptor(mock, 'read')?.value).toBe(visible);

    const spy = vi.spyOn(mock, 'read').mockReturnValue('spied');
    expect(spy).toBe(visible);
    expect(mock.read('item')).toBe('spied');
    expect(spy).toHaveBeenCalledExactlyOnceWith('item');
  });

  it.each(seeds)('retains the mock API after restoring a $label', ({ create }) => {
    const mock = createMock<Reader>({ read: create() });
    // Let spyOn discover the descriptor before the first property access.
    const spy = vi.spyOn(mock, 'read').mockReturnValue('spied');
    expect(mock.read('item')).toBe('spied');
    spy.mockRestore();

    expect(mock.read).toBe(spy);
    expect(vi.isMockFunction(mock.read)).toBe(true);
    // The legacy Jest helper resets a mocked implementation to an empty function.
    expect(mock.read('item')).toBeUndefined();
    mock.read.mockReturnValue('reconfigured');
    expect(mock.read('next')).toBe('reconfigured');
    expect(mock.read).toHaveBeenLastCalledWith('next');
    expect(Object.getOwnPropertyDescriptor(mock, 'read')?.value).toBe(mock.read);
  });

  it('preserves descriptor flags and does not evaluate accessors during inspection', () => {
    const getter = vi.fn(() => 'value');
    const partial = Object.defineProperties({}, {
      read: { configurable: true, enumerable: false, writable: false, value: (id: string) => id },
      value: { configurable: true, enumerable: true, get: getter },
      locked: { configurable: false, enumerable: true, writable: false, value: 1 }
    }) as Reader & { value: string; locked: number };
    const mock = createMock<Reader & { value: string; locked: number }>(partial);

    expect(Object.getOwnPropertyDescriptor(mock, 'read')).toEqual({
      configurable: true, enumerable: false, writable: false, value: mock.read
    });
    expect(Object.getOwnPropertyDescriptor(mock, 'value')?.get).toBe(getter);
    expect(getter).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(mock, 'locked')).toEqual({
      configurable: false, enumerable: true, writable: false, value: 1
    });
  });

  it('retains the mock API for a writable, non-configurable seeded method', () => {
    const partial = Object.defineProperty({}, 'read', {
      configurable: false, enumerable: false, writable: true, value: (id: string) => 'seed:' + id
    }) as Reader;
    const mock = createMock<Reader>(partial);
    const spy = vi.spyOn(mock, 'read').mockReturnValue('spied');
    expect(mock.read('item')).toBe('spied');
    spy.mockRestore();

    expect(mock.read).toBe(spy);
    mock.read.mockReturnValue('reconfigured');
    expect(mock.read('next')).toBe('reconfigured');
    expect(Object.getOwnPropertyDescriptor(mock, 'read')).toEqual({
      configurable: false, enumerable: false, writable: true, value: spy
    });
  });
});
