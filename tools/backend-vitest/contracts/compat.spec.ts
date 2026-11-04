import fs from 'node:fs';
import * as nativeFs from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMock } from '../deep-mock';
import { replaceProperty, restoreAllMocks, fn, mocked, spyOn } from '../compat';
import { resetMock, typedMock, genericMock, constructors } from './fixtures/legacy-test.factory';
import type { Mock } from '../types';

afterEach(() => { restoreAllMocks(); });

describe('legacy test contracts on native Vitest mocks', () => {
  it('resets a function implementation to the empty Jest contract', () => {
    expect(resetMock()).toBeUndefined();
    resetMock.mockReturnValue('changed');
    resetMock.mockReset();
    expect(resetMock()).toBeUndefined();
  });
  it('does not execute a hook-returned mock as a teardown callback', () => {
    resetMock.mockImplementation(() => { throw new Error('must never be called by teardown'); });
    expect(resetMock).not.toHaveBeenCalled();
  });
  it('supports constructible mock implementations', () => {
    expect(new constructors.Database()).toEqual({ value: 42 });
    expect(constructors.Database).toHaveBeenCalledOnce();
  });
  it('retains the generic order and generic call signatures', () => {
    const result: string = typedMock(4);
    const genericResult: { id: number } = genericMock({ id: 3 });
    expect(result).toBe('4'); expect(genericResult).toEqual({ id: 3 });
    const typed: Mock<string, [number]> = typedMock;
    expect(typed(5)).toBe('5');
  });
  it('tracks nested repository methods with descriptor-based spies', async () => {
    const repository = createMock<{ manager: { transaction: (operation: () => Promise<number>) => Promise<number> } }>();
    const spy = vi.spyOn(repository.manager, 'transaction').mockImplementation(operation => operation());
    await expect(repository.manager.transaction(() => Promise.resolve(7))).resolves.toBe(7);
    expect(spy).toHaveBeenCalledOnce();
  });
  it('preserves explicit undefined implementations and promise probing', async () => {
    const mock = createMock<{ nested: { result: () => number | undefined } }>();
    vi.spyOn(mock.nested, 'result').mockReturnValue(undefined);
    expect(mock.nested.result()).toBeUndefined();
    expect(await Promise.resolve(mock)).toBe(mock);
  });
  it('restores replaced properties alongside native spies', () => {
    const object = { limit: 2, read: () => 1 };
    const property = replaceProperty(object, 'limit', 4);
    property.replaceValue(8);
    vi.spyOn(object, 'read').mockReturnValue(9);
    expect(object.limit).toBe(8); expect(object.read()).toBe(9);
    restoreAllMocks();
    expect(object.limit).toBe(2); expect(object.read()).toBe(1);
  });
  it('does not replace accessors or absent properties', () => {
    const object = { get limit() { return 2; } };
    expect(() => replaceProperty(object, 'limit', 9)).toThrow(TypeError);
    expect(() => replaceProperty({} as { limit: number }, 'limit', 9)).toThrow(TypeError);
  });
  it('synchronizes builtin named exports with spies and restores native identity', () => {
    const original = nativeFs.existsSync;
    const spy = spyOn(fs, 'existsSync').mockReturnValue(true);
    expect(nativeFs.existsSync).toBe(spy);
    expect(nativeFs.existsSync('/synthetic/no-io')).toBe(true);
    spy.mockRestore();
    expect(nativeFs.existsSync).toBe(original);
    spyOn(fs, 'existsSync').mockReturnValue(false);
    restoreAllMocks();
    expect(nativeFs.existsSync).toBe(original);
  });
  it('keeps mocked identity and strict argument/return types', () => {
    const mock = fn((value: number) => String(value));
    expect(mocked(mock)).toBe(mock);
    mocked(mock).mockReturnValue('result');
    expect(mock(1)).toBe('result');
    const checkedOnly = () => {
      // @ts-expect-error a string argument is not accepted
      typedMock('wrong');
      // @ts-expect-error a numeric result is not accepted
      typedMock.mockReturnValue(1);
    };
    expect(typeof checkedOnly).toBe('function');
  });
});
