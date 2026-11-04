import { createMock } from '@golevelup/ts-jest';
import { expect, it, vi } from 'vitest';

it('adapts Jest deep-mock imports even when no Jest namespace is referenced', () => {
  const object = createMock<{ read: () => number }>();
  const spy = vi.spyOn(object, 'read').mockReturnValue(7);
  expect(object.read()).toBe(7);
  expect(spy).toHaveBeenCalledOnce();
});
