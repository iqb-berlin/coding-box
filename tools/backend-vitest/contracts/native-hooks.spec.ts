import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const cleanup = vi.fn<() => void>();
beforeEach(() => cleanup.mockClear());
it('retains native Vitest hook teardown functions in native test files', () => {
  expect(cleanup).not.toHaveBeenCalled();
});
afterAll(() => {
  expect(cleanup).toHaveBeenCalledOnce();
});
