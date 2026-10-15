import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';
import './test-mocks';

setupZonelessTestEnv();

beforeEach(() => {
  expect('Zone' in globalThis).toBe(false);
});

afterEach(() => {
  expect('Zone' in globalThis).toBe(false);
});
