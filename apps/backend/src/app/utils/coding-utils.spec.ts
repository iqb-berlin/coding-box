import { mapCodeForExport } from './coding-utils';

describe('coding utils', () => {
  it('does not export the legacy duplicate aggregation marker as a code', () => {
    expect(mapCodeForExport(-111)).toBeNull();
  });

  it('keeps existing special export mappings', () => {
    expect(mapCodeForExport(-3)).toBe(-98);
    expect(mapCodeForExport(-4)).toBe(-97);
    expect(mapCodeForExport(-1)).toBeNull();
    expect(mapCodeForExport(7)).toBe(7);
  });
});
