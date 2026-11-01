import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Mocked, MockedFunction } from './types';

type Procedure = (...args: any[]) => any;
type FunctionMock<T extends Procedure> = T & Omit<Mock<T>, keyof T> & { new (...args: Parameters<T>): ReturnType<T> };

/** Unlike vi.fn(implementation), Jest resets these mocks to an empty function. */
export function fn(): Mock<Procedure>;
export function fn<T extends Procedure>(): Mock<T>;
export function fn<T extends Procedure>(implementation: T): FunctionMock<NoInfer<T>>;
export function fn(implementation?: Procedure): Mock<Procedure> {
  const mock = vi.fn<Procedure>();
  if (implementation) mock.mockImplementation(implementation);
  return mock;
}

export function mocked<T>(value: T, _options?: boolean | { shallow?: boolean }): T extends Procedure ? MockedFunction<T> : Mocked<T> {
  return value as T extends Procedure ? MockedFunction<T> : Mocked<T>;
}

const replacements = new Set<() => void>();

/** Jest's replaceProperty is deliberately restricted to existing writable data. */
export function replaceProperty<T extends object, K extends keyof T>(object: T, key: K, value: T[K]) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !('value' in descriptor) || !descriptor.configurable || !descriptor.writable) {
    throw new TypeError(`Cannot replace ${String(key)}; expected a configurable, writable own data property`);
  }
  const restore = () => {
    Object.defineProperty(object, key, descriptor);
    replacements.delete(restore);
  };
  const replaceValue = (next: T[K]) => {
    Object.defineProperty(object, key, { ...descriptor, value: next });
    return handle;
  };
  const handle = { restore, replaceValue };
  replacements.add(restore);
  return replaceValue(value);
}

export function restoreAllMocks() {
  vi.restoreAllMocks();
  for (const restore of [...replacements].reverse()) restore();
}
