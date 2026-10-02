import { VariableCodingData } from '@iqbspecs/coding-scheme';
import { ResponseEntity } from '../../entities/response.entity';
import { omitShadowedGeneratedSourcePlaceholders } from './autocoder-source-placeholder.util';

const codings = [
  { id: 'panel', alias: '_03_reached', sourceType: 'BASE' },
  {
    id: 'derived', alias: '_03', sourceType: 'CONCAT_CODE', deriveSources: ['panel']
  }
] as VariableCodingData[];
const imported = {
  id: 1, variableid: '_03_reached', status: 2, subform: 'elementCodes'
} as ResponseEntity;
const placeholder = {
  id: 2,
  variableid: '_03_reached',
  status: 3,
  status_v1: 0,
  status_v3: 0,
  subform: '',
  value: '',
  is_autocoder_generated: true
} as ResponseEntity;

describe('omitShadowedGeneratedSourcePlaceholders', () => {
  it('omits only the generated global empty source, preserving imported data', () => {
    const rows = [imported, placeholder];
    expect(omitShadowedGeneratedSourcePlaceholders(rows, codings)).toEqual([imported]);
    expect(rows).toEqual([imported, placeholder]);
  });

  it.each([
    { status_v2: 8 }, { code_v2: 0, score_v2: 0 }, { code_v3: 0 },
    { value: '0' }, { subform: 'other' }, { is_autocoder_generated: false },
    { autocoder_invalidated_version: 'v2' }
  ])('preserves a placeholder with meaningful data or provenance: %j', change => {
    const row = { ...placeholder, ...change } as ResponseEntity;
    expect(omitShadowedGeneratedSourcePlaceholders([imported, row], codings)).toEqual([imported, row]);
  });

  it('preserves missing-source and unrelated placeholders', () => {
    expect(omitShadowedGeneratedSourcePlaceholders([placeholder], codings)).toEqual([placeholder]);
    expect(omitShadowedGeneratedSourcePlaceholders([imported, placeholder], [])).toEqual([imported, placeholder]);
  });
});
