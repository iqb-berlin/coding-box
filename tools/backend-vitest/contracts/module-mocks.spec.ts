import { dependencyTree } from './fixtures/engine';
import callable from './fixtures/callable';

jest.mock('./fixtures/engine', () => ({
  dependencyTree: jest.fn((value: string) => jest.requireActual<typeof import('./fixtures/engine')>('./fixtures/engine').dependencyTree(value))
}));
jest.mock('./fixtures/callable', () => jest.fn((value: string) => 'mock:' + value));

it('retains synchronous callbacks when requireActual needs an async import', () => {
  expect(dependencyTree('tree')).toBe('TREE');
  expect(dependencyTree).toHaveBeenCalledWith('tree');
});

it('adapts a callable CommonJS module factory without losing its mock identity', () => {
  expect(callable('value')).toBe('mock:value');
  expect(callable).toHaveBeenCalledWith('value');
});
