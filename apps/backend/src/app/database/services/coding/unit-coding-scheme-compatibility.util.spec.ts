import { VariableCodingData } from '@iqbspecs/coding-scheme';
import {
  getUnitCodingSchemeCompatibilityErrors,
  validateUnitCodingSchemeCompatibility
} from './unit-coding-scheme-compatibility.util';

describe('Unit/VOCS compatibility', () => {
  const base = { id: 'technical-a', alias: '01a' };
  const coding: VariableCodingData = { ...base, sourceType: 'BASE', codes: [] };

  it('reports both original namespaces in the MMV032 reproduction without changing them', async () => {
    const xml = `<Unit><BaseVariables>
      <Variable id="text-field-simple_1776092737364_1" alias="01a" type="string"/>
      <Variable id="text-field-simple_1776092748928_1" alias="01b" type="string"/>
    </BaseVariables></Unit>`;
    const codings: VariableCodingData[] = [
      { id: 'text-field-simple_1776092737364_1', alias: 'text-field-simple_1', sourceType: 'BASE' },
      { id: 'text-field-simple_1776092748928_1', alias: 'text-field-simple_2', sourceType: 'BASE' }
    ];
    const original = JSON.stringify(codings);
    const errors = await validateUnitCodingSchemeCompatibility(xml, codings, 'MMV032', 'MMV032.VOCS');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('MMV032.VOCS');
    expect(errors[0]).toContain('Unit "MMV032"');
    expect(errors[0]).toContain('"text-field-simple_1776092737364_1"');
    expect(errors[0]).toContain('"01a", im VOCS jedoch "text-field-simple_1"');
    expect(errors[1]).toContain('"01b", im VOCS jedoch "text-field-simple_2"');
    expect(JSON.stringify(codings)).toBe(original);
  });

  it('accepts matching aliases and legitimate implicit aliases equal to the technical ID', () => {
    expect(getUnitCodingSchemeCompatibilityErrors([base], [coding])).toEqual([]);
    expect(getUnitCodingSchemeCompatibilityErrors([{ id: 'plain' }], [{ id: 'plain', sourceType: 'BASE' }])).toEqual([]);
  });

  it.each(['BASE', 'BASE_NO_VALUE'] as const)('checks original aliases for %s', sourceType => {
    const errors = getUnitCodingSchemeCompatibilityErrors([base], [{ ...coding, sourceType, alias: 'wrong' }]);
    expect(errors).toEqual([expect.stringContaining('"01a", im VOCS jedoch "wrong"')]);
  });

  it('detects a missing explicit alias when the other side uses a different public alias', () => {
    expect(getUnitCodingSchemeCompatibilityErrors([base], [{ id: base.id, sourceType: 'BASE' }]))
      .toEqual([expect.stringContaining('im VOCS jedoch "technical-a"')]);
    expect(getUnitCodingSchemeCompatibilityErrors([{ id: base.id }], [coding]))
      .toEqual([expect.stringContaining('Unit den Alias "technical-a"')]);
  });

  it('rejects empty IDs, duplicate IDs and Unit aliases, including collisions by case', () => {
    expect(getUnitCodingSchemeCompatibilityErrors([{ alias: 'a' }], []))
      .toEqual([expect.stringContaining('keine technische ID')]);
    expect(getUnitCodingSchemeCompatibilityErrors([base, base], []))
      .toEqual(expect.arrayContaining([expect.stringContaining('technische ID'), expect.stringContaining('Alias')]));
    expect(getUnitCodingSchemeCompatibilityErrors([base, { id: 'b', alias: '01A' }], []))
      .toEqual([expect.stringContaining('mehrfach vorhanden')]);
  });

  it('rejects missing BASE variables, duplicate VOCS aliases and missing derivation sources', () => {
    expect(getUnitCodingSchemeCompatibilityErrors([], [coding]))
      .toEqual([expect.stringContaining('fehlt in der Unit')]);
    expect(getUnitCodingSchemeCompatibilityErrors([base, { id: 'b', alias: '01a' }], [coding, { ...coding, id: 'b' }]))
      .toEqual(expect.arrayContaining([expect.stringContaining('duplicate output alias')]));
    expect(getUnitCodingSchemeCompatibilityErrors([base], [coding, {
      id: 'derived', sourceType: 'SUM_SCORE', deriveSources: ['absent']
    }])).toEqual([expect.stringContaining('fehlende technische Quellvariable "absent"')]);
  });

  it('accepts derived targets absent from Unit base variables and chains of technical sources', () => {
    expect(getUnitCodingSchemeCompatibilityErrors([base], [coding,
      {
        id: 'derived', alias: '01', sourceType: 'SUM_SCORE', deriveSources: [base.id]
      },
      { id: 'chain', sourceType: 'SUM_SCORE', deriveSources: ['derived'] }
    ])).toEqual([]);
  });

  it('accepts the existing BASE/derived output shadow', () => {
    expect(getUnitCodingSchemeCompatibilityErrors([{ id: '_01' }, { id: 'source' }], [
      { id: '_01', sourceType: 'BASE' },
      { id: 'source', sourceType: 'BASE' },
      {
        id: 'derived-_01', alias: '_01', sourceType: 'CONCAT_CODE', deriveSources: ['source', '_01']
      }
    ])).toEqual([]);
  });

  it('accepts structural BASE_NO_VALUE shadows and retains legacy virtual no-value support', () => {
    const codings: VariableCodingData[] = [
      {
        id: 'structural', alias: '01', sourceType: 'BASE_NO_VALUE', codes: []
      },
      { id: base.id, alias: base.alias, sourceType: 'BASE' },
      {
        id: '01', alias: '01', sourceType: 'SUM_SCORE', deriveSources: [base.id]
      }
    ];
    expect(getUnitCodingSchemeCompatibilityErrors([base, { id: 'structural', alias: '01' }], codings)).toEqual([]);
    expect(getUnitCodingSchemeCompatibilityErrors([base], codings)).toEqual([]);
  });

  it.each(['<Unit>', '<not-a-unit/>'])('fails closed for unreadable Unit XML: %s', async xml => {
    expect(await validateUnitCodingSchemeCompatibility(xml, [coding], 'U', 'S.VOCS'))
      .toEqual([expect.stringContaining('Die Unit-XML ist nicht lesbar')]);
  });
});
