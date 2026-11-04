/** Test-only view over decomposed providers, including descriptor-based spies. */
export function createFacadeTestProxy<T extends object>(facade: T, providers: object[]): T {
  const owners = new Map<PropertyKey, object>();
  for (const provider of providers) {
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(provider))) {
      if (key !== 'constructor') owners.set(key, provider);
    }
  }
  const ownerFor = (key: PropertyKey) => owners.get(key) || providers.find(provider => Reflect.has(provider, key));
  return new Proxy(facade, {
    get(target, key) {
      const owner = ownerFor(key);
      const value = Reflect.get(owner || target, key);
      return owner && typeof value === 'function' && !Reflect.get(value, '_isMockFunction') ? value.bind(owner) : value;
    },
    set(target, key, value) {
      const owner = owners.get(key);
      if (owner) return Reflect.set(owner, key, value);
      const matching = providers.filter(provider => Reflect.has(provider, key));
      if (matching.length) return matching.every(provider => Reflect.set(provider, key, value));
      return Reflect.set(target, key, value);
    },
    defineProperty(target, key, descriptor) {
      const owner = ownerFor(key);
      return Reflect.defineProperty(owner || target, key, descriptor);
    },
    getOwnPropertyDescriptor(target, key) {
      const owner = owners.get(key);
      if (owner) {
        return {
          configurable: true, enumerable: true, writable: true, value: Reflect.get(owner, key)
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
}
