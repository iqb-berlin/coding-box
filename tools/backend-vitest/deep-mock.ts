// Adapted from @golevelup/ts-jest, copyright (c) 2019 Jesse Carter, MIT.
// See THIRD_PARTY_LICENSES.md. Vitest requires descriptors for proxy-backed spies.
import { vi } from 'vitest';
import type { MockInstance } from './types';

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends Array<infer U> ? Array<DeepPartial<U>> : unknown extends T[P] ? T[P] : DeepPartial<T[P]>;
};
type PartialFuncReturn<T> = {
  [K in keyof T]?: T[K] extends (...args: infer A) => infer U ? (...args: A) => PartialFuncReturn<U> : DeepPartial<T[K]>;
};
export type DeepMocked<T> = {
  [K in keyof T]: Required<T>[K] extends (...args: infer A) => infer U ? MockInstance<U, A> & ((...args: A) => DeepMocked<U>) : T[K];
} & T;

const mockKeys = new Set([
  '_isMockFunction', 'mock', 'mockClear', 'mockImplementation', 'mockImplementationOnce',
  'mockName', 'getMockName', 'getMockImplementation', 'mockRejectedValue', 'mockRejectedValueOnce',
  'mockReset', 'mockResolvedValue', 'mockResolvedValueOnce', 'mockRestore', 'mockReturnThis',
  'mockReturnValue', 'mockReturnValueOnce', 'withImplementation', 'calls'
]);
const isProbe = (key: PropertyKey) => key === 'then' || key === 'inspect' || key === 'asymmetricMatch' ||
  key === Symbol.toPrimitive || key === Symbol.for('nodejs.util.inspect.custom');

function createProxy(name: string, base?: object): any {
  const cache = new Map<PropertyKey, unknown>();
  const target = base || vi.fn();
  const get = (object: any, key: PropertyKey, receiver: unknown): unknown => {
    if (isProbe(key)) return undefined;
    if (!base && mockKeys.has(String(key))) return Reflect.get(object, key, receiver);
    if (cache.has(key)) return cache.get(key);
    const value = key in object ? (typeof object[key] === 'function' ? vi.fn().mockImplementation(object[key]) : object[key]) : createProxy(`${name}.${String(key)}`);
    cache.set(key, value);
    return value;
  };
  const handler: ProxyHandler<any> = {
    get,
    set(object, key, value) {
      cache.set(key, value);
      return Reflect.set(object, key, value);
    },
    defineProperty(object, key, descriptor) {
      if ('value' in descriptor) cache.set(key, descriptor.value);
      return Reflect.defineProperty(object, key, descriptor);
    },
    getOwnPropertyDescriptor(object, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      if (isProbe(key)) return descriptor;
      if (descriptor) {
        if (!('value' in descriptor) || (!descriptor.configurable && !descriptor.writable)) return descriptor;
        // Spies must see the same cached mock as ordinary property access.
        return { ...descriptor, value: get(object, key, object) };
      }
      return { configurable: true, enumerable: true, writable: true, value: get(object, key, object) };
    }
  };
  if (!base) handler.apply = (object, receiver, args) => {
    const value = Reflect.apply(object, receiver, args);
    if (object.getMockImplementation() || value !== undefined) return value;
    if (!cache.has('__apply')) cache.set('__apply', createProxy(name));
    return cache.get('__apply');
  };
  return new Proxy(target, handler);
}

export function createMock<T extends object>(partial: PartialFuncReturn<T> = {}, options: { name?: string } = {}): DeepMocked<T> {
  return createProxy(options.name || 'mock', partial);
}
