import { CodingScheme } from '../../models/coding-interfaces';
import { findVariableCodingByPublicId } from './coding-scheme.util';

describe('findVariableCodingByPublicId', () => {
  const collisionScheme = {
    version: '1.0',
    variableCodings: [
      { id: '04', alias: '02', codes: [] },
      { id: '07', alias: '04', codes: [] }
    ]
  } as unknown as CodingScheme;

  it('prefers public aliases over colliding technical ids', () => {
    expect(findVariableCodingByPublicId(collisionScheme, '02')?.id).toBe('04');
    expect(findVariableCodingByPublicId(collisionScheme, '04')?.id).toBe('07');
  });

  it('falls back to technical ids when no alias matches', () => {
    expect(findVariableCodingByPublicId(collisionScheme, '07')?.alias).toBe('04');
  });
});
