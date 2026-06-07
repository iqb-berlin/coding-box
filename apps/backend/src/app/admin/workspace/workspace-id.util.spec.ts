import { parseWorkspaceId } from './workspace-id.util';

describe('parseWorkspaceId', () => {
  it.each([
    ['1', 1],
    ['123', 123],
    [123, 123]
  ])('parses %p', (value, expected) => {
    expect(parseWorkspaceId(value)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    '0',
    '-1',
    '00123',
    '1e2',
    '0x10',
    '1.5',
    '123abc',
    Number.MAX_SAFE_INTEGER + 1
  ])('rejects %p', value => {
    expect(parseWorkspaceId(value)).toBeNull();
  });
});
