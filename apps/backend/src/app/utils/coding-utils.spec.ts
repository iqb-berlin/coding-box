import { mapCodeForExport } from './coding-utils';

describe('coding utils', () => {
  it('does not export the legacy duplicate aggregation marker as a code', () => {
    expect(mapCodeForExport(-111)).toBeNull();
  });

  it('maps manual missing issue options only with profile context', () => {
    expect(mapCodeForExport(-3)).toBeNull();
    expect(mapCodeForExport(-4)).toBeNull();
    expect(mapCodeForExport(-3, { mirCode: -123, mciCode: -124 })).toBe(-123);
    expect(mapCodeForExport(-4, { mirCode: -123, mciCode: -124 })).toBe(-124);
    expect(mapCodeForExport(-1)).toBeNull();
    expect(mapCodeForExport(7)).toBe(7);
  });
});
