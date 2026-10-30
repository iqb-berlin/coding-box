import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Repository } from 'typeorm';
import type { VariableCodingData } from '@iqbspecs/coding-scheme';
import * as ExcelJS from 'exceljs';
import { CodingSchemeFactory } from '../generated/autocoder-compatibility-engine';
import { ItemDatasetCellResolver } from '../item-dataset-cell-resolver';
import type { ItemDatasetColumn, ItemDatasetProfile } from '../item-dataset-cell-resolver';
import type { IqbStandardMissingId } from '../missings-profiles.service';
import { buildItemDatasetVariablePositions } from '../item-dataset-variable-positions.util';
import { InterraterReliabilityCalculator } from '../interrater-reliability.calculator';
import { EmptyResponseSelectionService } from '../empty-response-selection.service';
import { resolveVersionedExportValues } from '../versioned-results-missing-resolver';
import type { CodingItemVersionRow } from '../coding-item-builder.service';
import type { ResponseEntity } from '../../../entities/response.entity';
import { statusStringToNumber } from '../../../utils/response-status-converter';
import { getManualCodingScopeKey } from '../../../utils/manual-coding-scope.util';
import { aggregateItemDatasetMissingStates, ItemDatasetMissingState } from '../item-dataset-missing-aggregation.util';
import { CodingProcessService } from '../coding-process.service';
import { CodingItemMatrixExportService } from '../coding-item-matrix-export.service';
import { ItemDatasetMetadataService } from '../item-dataset-metadata.service';

const root = join(process.cwd(), 'scripts/reference/coding-box');
const read = <T>(file: string): T => JSON.parse(readFileSync(join(root, file), 'utf8'));
type Profile = Record<string, [number, number | null]>;
type Result = { id: string; code: number | null; score: number | null; status: string };
type RawResponse = Parameters<typeof CodingSchemeFactory.code>[0][number];
type Unit = { key: string; scheme: VariableCodingData[]; items: { variable_id: string; item_id: string }[] };
type StudyCase = {
  id: string; person: string; unit: string; booklet: string; manualCode: number | null;
  input: RawResponse[]; expected: Result[];
};
const study = read<{
  units: Unit[]; demoUnits: Unit[]; cases: StudyCase[];
  demos: { id: string; unit: string; input: RawResponse[]; expected: Result }[];
  persons: { login_name: string; login_code: string; group_id: string; booklet_id: string }[];
  booklets: { booklet_id: string; unit_key: string }[];
  columns: { unit: string; variable: string; header: string }[];
  matrices: { recode: boolean; rows: { code: number; score: number | null }[][] }[];
}>('study.json');
const edge = read<{
  profile: Profile;
  kappa: { id: string; left: (number | null)[]; right: (number | null)[]; expected: {
    kappa: number | null; agreement: number; validPairs: number;
  } }[];
  fleiss: { ratings: number[][]; expected: number };
  empty: { id: string; target: string; value: string | null; sources: [string, string | null, number][];
    derived: Record<string, string[]>; selected: boolean }[];
  version: { id: string; status: number; code: number | null; score: number | null; expected: [number | string, number | string] }[];
  errors: { id: string; status: number; code: number | null; score: number | null; requested: 'code' | 'score'; reason: string }[];
  aggregate: { id: string; states: ItemDatasetMissingState[]; expected: string }[];
  persistence: { id: string; targets: object[]; duplicate: boolean }[];
  partial: { id: string; sourceType: 'SUM_SCORE' | 'SUM_CODE' | 'CONCAT_CODE'; option: string; status: string;
    enabled: boolean; expectedValue: unknown; expectedStatus: string }[];
  derived: { id: string; sources: string[]; values: [string, number, number | null, number | null][]; reason: string }[];
  primitives: { id: string; value: unknown; code: number; score: number }[];
  scopes: { id: string; scope: 'unit' | 'testlet' | 'booklet'; sameTestlet: boolean; expected: number }[];
}>('edge-cases.json');
const profile = (values: Profile): ItemDatasetProfile => {
  const entries = Object.entries(values).map(([id, [code, score]]) => ({
    id, label: id, code, score
  }));
  return {
    byId: new Map(entries.map(entry => [entry.id as IqbStandardMissingId, entry])),
    byCode: new Map(entries.map(entry => [entry.code, entry]))
  };
};
const projectResult = (response: RawResponse): Result => ({
  id: response.id,
  status: response.status,
  code: response.code ?? null,
  score: response.score ?? null
});
const key = (unit: string, variable: string): string => `${unit}\u001F${variable}`;
const codeStudyCase = (fixture: StudyCase): RawResponse[] => {
  const scheme = study.units.find(u => u.key === fixture.unit)!.scheme;
  const input = structuredClone(fixture.input);
  if (fixture.manualCode !== null) {
    const code = scheme[0].codes?.find(c => c.id === fixture.manualCode);
    input[0].code = fixture.manualCode;
    input[0].score = code?.score ?? 0;
    input[0].status = fixture.manualCode < 0 ? 'DISPLAYED' : 'CODING_COMPLETE';
  }
  return CodingSchemeFactory.code(input, scheme);
};
const column = (unit: string, variable: string, order = 0): ItemDatasetColumn => ({
  key: key(unit, variable),
  header: `${unit}_${variable}`,
  unitName: unit,
  unitId: unit,
  variableId: variable,
  sourceVariableId: variable,
  itemId: variable,
  itemLabel: variable,
  itemOrder: order,
  isDerived: false
});

interface MissingCase {
  id: string; sourceCase: number; recode: boolean; profile: Profile;
  rows: { unit: string; variable: string; testlet: number; position: number; present: boolean;
    status: string | null; code: number | null; score: number | null }[];
  expected: { state: string; code?: number; score?: number | null; reason?: string }[];
  metadata: { unit_key: string; unit_codes: {
    variable_id: string; variable_ref: string; variable_source_type: string;
    variable_page: number | null; variable_section: number | null;
    derive_sources?: string[] | string;
    variable_sources?: { variable_source_ref: string; variable_source_direct: boolean }[];
  }[]; items_list: { variable_id: string; item_no: number }[] }[];
}
const missing = read<MissingCase[]>('missing-cases.json');

const layout = (unit: MissingCase['metadata'][number]): string => {
  const pages: { sections: { elements: { id: string }[] }[] }[] = [];
  unit.unit_codes.filter(c => c.variable_page !== null && c.variable_source_type === 'BASE').forEach(c => {
    const pageIndex = c.variable_page! - 1;
    const sectionIndex = c.variable_section ?? 0;
    while (pages.length <= pageIndex) pages.push({ sections: [] });
    while (pages[pageIndex].sections.length <= sectionIndex) pages[pageIndex].sections.push({ elements: [] });
    pages[pageIndex].sections[sectionIndex].elements.push({ id: c.variable_id });
  });
  return JSON.stringify({ pages });
};

const missingInput = (fixture: MissingCase) => {
  const positions = new Map<string, number>();
  const sources = new Map<string, string[]>();
  fixture.metadata.forEach(unit => {
    const codings = unit.unit_codes.map(c => {
      const raw = c.derive_sources ?? c.variable_sources?.filter(s => s.variable_source_direct).map(s => s.variable_source_ref) ?? [];
      const references = typeof raw === 'string' ? [raw] : raw;
      sources.set(key(unit.unit_key, c.variable_id), references.map(ref => key(unit.unit_key,
        unit.unit_codes.find(v => v.variable_ref === ref)?.variable_id ?? ref)));
      return {
        id: c.variable_ref,
        alias: c.variable_id,
        sourceType: c.variable_source_type,
        ...(c.variable_page !== null ? { page: String(c.variable_page) } : {}),
        deriveSources: references
      };
    });
    buildItemDatasetVariablePositions(unit.unit_key, [], layout(unit), JSON.stringify({ variableCodings: codings }))
      .forEach((value, id) => positions.set(id, value));
  });
  const columns = fixture.rows.map(r => {
    const unit = fixture.metadata.find(u => u.unit_key === r.unit)!;
    // Keep deliberately conflicting output order (case 14). The runtime must
    // obtain MNR order from real VOUD/VOCS parsing, not the expected positions.
    return column(r.unit, r.variable, unit.items_list.find(i => i.variable_id === r.variable)?.item_no ?? 100);
  });
  const design = {
    units: new Map(fixture.rows.map(r => [r.unit, {
      unitId: r.unit, order: Number(r.unit.slice(1)), testletKey: String(r.testlet)
    }]))
  };
  const values = new Map(fixture.rows.filter(r => r.present).map(r => [key(r.unit, r.variable), {
    code: r.code, score: r.score, status: statusStringToNumber(r.status)
  }]));
  return {
    columns, design, values, positions, sources
  };
};

describe('Versioned Kodierbox reference corpus (independent Python/R expectations)', () => {
  it('keeps reference data outside production artifact and Docker copy boundaries', () => {
    execFileSync(process.execPath, ['--test', 'scripts/qa/verify-reference-packaging.test.mjs'], {
      cwd: process.cwd(), stdio: 'pipe'
    });
  });
  it('binds every checked source, oracle and fixture to the independently verified artifact', () => {
    const proof = read<{ files: Record<string, string> }>('verification.json');
    expect(Object.keys(proof.files)).toEqual(expect.arrayContaining([
      'generate.py', 'verify-independent.R', 'verify-upstream.R', 'study.json', 'edge-cases.json', 'missing-cases.json', 'missing-oracle.json'
    ]));
    const list = (directory = ''): string[] => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
      const file = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.name === '__pycache__' || entry.name === 'verification.json') return [];
      return entry.isDirectory() ? list(file) : [file];
    });
    expect(Object.keys(proof.files).sort()).toEqual(list().sort());
    Object.entries(proof.files).forEach(([file, hash]) => {
      expect({ file, hash: createHash('sha256').update(readFileSync(join(root, file))).digest('hex') }).toEqual({ file, hash });
    });
  });

  it.each(study.cases)('$id: codes frozen workshop responses with the production engine', fixture => {
    const snapshot = structuredClone(fixture.input);
    const actual = codeStudyCase(fixture).map(projectResult).sort((a, b) => a.id.localeCompare(b.id));
    expect(actual).toEqual([...fixture.expected].sort((a, b) => a.id.localeCompare(b.id)));
    expect(fixture.input).toEqual(snapshot);
  });

  it.each(study.demos)('$id: separates code, score and source point sum', fixture => {
    const result = CodingSchemeFactory.code(structuredClone(fixture.input), study.demoUnits[0].scheme);
    expect(projectResult(result.find(r => r.id === '01')!)).toEqual(fixture.expected);
  });

  describe.each(study.matrices)('40-person item matrix, recode=$recode', matrix => {
    it.each(['code', 'score'] as const)('exports all independent %s expectations identically as CSV and Excel', async requested => {
      const exclusions = { resolveExclusionsForQueries: jest.fn().mockResolvedValue({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] }) };
      const bySource = new Map<string, Set<string>>();
      const items = study.units.flatMap(unit => unit.items.map((item, order) => {
        const coding = unit.scheme.find(c => c.id === item.variable_id)!;
        coding.deriveSources?.forEach(source => bySource.set(key(unit.key, source), new Set([coding.id])));
        return {
          ...column(unit.key, item.variable_id, order),
          itemId: item.item_id,
          variable: { isDerived: coding.sourceType !== 'BASE', sourceType: coding.sourceType }
        };
      }));
      const workspaceFiles = { getDerivedVariablesBySourceMap: jest.fn().mockResolvedValue(bySource) };
      const unitQuery = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([])
      };
      const resources = study.units.map(unit => ({ file_id: `${unit.key}.VOCS`, data: JSON.stringify({ variableCodings: unit.scheme }) }));
      const booklets = ['B1', 'B2'].map(id => ({ file_id: id, data: `<Booklet><Testlet id="T1">${study.booklets.filter(b => b.booklet_id === id).map(b => `<Unit id="${b.unit_key}"/>`).join('')}</Testlet></Booklet>` }));
      const files = { find: jest.fn().mockImplementation(async ({ where }: { where: { file_type: string } }) => (where.file_type === 'Booklet' ? booklets : resources)) };
      const metadata = new ItemDatasetMetadataService({ createQueryBuilder: () => unitQuery } as never, files as never, workspaceFiles as never, exclusions as never, { buildItemMapping: jest.fn().mockResolvedValue({ items, issues: [], fallbacks: [] }) } as never);
      const service = new CodingItemMatrixExportService({} as never, {} as never, workspaceFiles as never, exclusions as never, { getResolvedMissingsProfileForExport: jest.fn().mockResolvedValue(profile(edge.profile)) } as never, metadata);
      // Only persistence transport is mocked. Metadata parsing, production
      // coding, cell resolution, Missing profiles and serializers run normally.
      const values = new Map(study.persons.map((person, i) => [i + 1, new Map(study.cases.filter(c => c.person === person.login_name)
        .flatMap(c => codeStudyCase(c).map(r => [key(c.unit, r.id), { code: r.code ?? null, score: r.score ?? null, status: statusStringToNumber(r.status) }] as const)))]));
      const internals = service as unknown as { getRows: jest.Mock; getResponseValuesForRows: jest.Mock };
      internals.getRows = jest.fn().mockResolvedValue(study.persons.map((person, i) => ({
        bookletId: i + 1, bookletName: person.booklet_id, personLogin: person.login_name, personCode: person.login_code, personGroup: person.group_id
      })));
      internals.getResponseValuesForRows = jest.fn().mockResolvedValue(values);
      const config = { missingsProfileId: 1, notReachedScope: 'testlet' as const, recodeTrailingOmissions: matrix.recode };
      const expected: (string | number)[][] = [
        ['person_login', 'person_code', 'person_group', 'booklet_name', ...study.columns.map(c => c.header)],
        ...study.persons.map((person, i) => [person.login_name, person.login_code, person.group_id, person.booklet_id,
          ...matrix.rows[i].map(cell => cell[requested] ?? 'NA')])
      ];
      let csv = '';
      for await (const chunk of service.exportItemMatrixAsCsvStream(1, requested, 'v1', config)) csv += chunk.toString();
      expect(csv.trim()).toBe(readFileSync(join(root, `expected-matrix-${matrix.recode ? 'recode' : 'keep'}-${requested}.csv`), 'utf8').trim());
      expect(csv.trim().split(/\r?\n/).map(row => row.split(';'))).toEqual(expected.map(row => row.map(String)));
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await service.exportItemMatrixAsExcel(1, requested, 'v1', config) as never);
      const actual: unknown[][] = [];
      workbook.worksheets[0].eachRow(row => actual.push((row.values as unknown[]).slice(1)));
      expect(actual).toEqual(expected);
    });
  });

  it.each(missing)('$id: agrees with the external R oracle including real layout and both export cells', fixture => {
    const {
      columns, design, values, positions, sources
    } = missingInput(fixture);
    fixture.rows.forEach(r => expect(positions.get(key(r.unit, r.variable))).toBe(r.position));
    const before = JSON.stringify([...values]);
    const resolver = new ItemDatasetCellResolver();
    const cells = resolver.resolve(columns, design, values, profile(fixture.profile), sources, {
      notReachedScope: 'testlet', recodeTrailingOmissions: fixture.recode, variablePositions: positions
    });
    cells.forEach((cell, index) => {
      const expected = fixture.expected[index];
      expect(cell.state).toBe(expected.state);
      if (expected.reason) {
        expect(() => resolver.getExportValue(cell, 'code')).toThrow(expected.reason);
      } else {
        expect(resolver.getExportValue(cell, 'code')).toBe(expected.code);
        expect(resolver.getExportValue(cell, 'score')).toBe(expected.score ?? 'NA');
      }
    });
    expect(JSON.stringify([...values])).toBe(before);
    // Shuffling transport or output columns must not change classification.
    const reversed = resolver.resolve([...columns].reverse(), design, new Map([...values].reverse()), profile(fixture.profile), sources, {
      notReachedScope: 'testlet', recodeTrailingOmissions: fixture.recode, variablePositions: positions
    });
    expect(reversed.reverse()).toEqual(cells);
  });

  it.each(edge.kappa)('$id: retains exact independent statistics before presentation rounding', fixture => {
    const result = InterraterReliabilityCalculator.calculatePairwise([{
      coder1Id: 1,
      coder1Name: 'R1',
      coder2Id: 2,
      coder2Name: 'R2',
      codes: fixture.left.map((code1, i) => ({ code1, code2: fixture.right[i] }))
    }])[0];
    expect(result.validPairs).toBe(fixture.expected.validPairs);
    expect(result.agreement).toBeCloseTo(fixture.expected.agreement, 10);
    if (fixture.expected.kappa === null) expect(result.kappa).toBeNull();
    else expect(result.kappa).toBeCloseTo(fixture.expected.kappa, 10);
  });

  it('matches the independently evaluated Fleiss contingency table', () => {
    const result = InterraterReliabilityCalculator.calculateFleiss(edge.fleiss.ratings);
    expect(result.fleissKappa).toBe(Math.round(edge.fleiss.expected * 1000) / 1000);
    expect(result.completeCaseCount).toBe(6);
  });

  it.each(edge.empty)('$id: selects manual empty cases from leaf sources and v1 statuses', async fixture => {
    const target = {
      id: 1, unitid: 1, variableid: fixture.target, value: fixture.value, status_v1: 8, unit: { name: 'UNIT' }
    } as ResponseEntity;
    const sourceRows = fixture.sources.map(([variableid, value, status_v1], i) => ({
      id: i + 2, unitid: 1, variableid, value, status_v1, unit: { name: 'UNIT' }
    } as ResponseEntity));
    const builder = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue(sourceRows) };
    const service = new EmptyResponseSelectionService({ createQueryBuilder: () => builder } as unknown as Repository<ResponseEntity>, {} as never);
    const original = JSON.stringify([target, sourceRows]);
    const selected = await service.filterEffectivelyEmptyResponses([target], {
      metadataAvailable: true,
      derivedVariableMap: new Map([['UNIT', new Set(Object.keys(fixture.derived))]]),
      sourceVariablesByDerivedKey: new Map(Object.entries(fixture.derived).map(([id, sources]) => [getManualCodingScopeKey('UNIT', id), new Set(sources)]))
    });
    expect(selected.map(r => r.id)).toEqual(fixture.selected ? [1] : []);
    expect(JSON.stringify([target, sourceRows])).toBe(original);
  });

  it.each(edge.version)('$id: profiles v1/v3 and preserves stored v2', fixture => {
    const row = {
      statusV1: fixture.status,
      codeV1: fixture.code,
      scoreV1: fixture.score,
      statusV2: fixture.status,
      codeV2: fixture.code,
      scoreV2: fixture.score,
      statusV3: fixture.status,
      codeV3: fixture.code,
      scoreV3: fixture.score
    } as CodingItemVersionRow;
    const result = resolveVersionedExportValues(row, 'v3', { ...profile(edge.profile), id: 1, label: 'Reference' });
    const expected = { code: fixture.expected[0], score: fixture.expected[1] };
    expect(result.v1).toEqual(expected);
    expect(result.v3).toEqual(expected);
    expect(result.v2).toEqual(fixture.code === null && fixture.score === null ? { code: '', score: '' } : expected);
  });

  it.each(edge.errors)('$id: reports the exact failure instead of inventing a value', fixture => {
    const resolver = new ItemDatasetCellResolver();
    const [cell] = resolver.resolve([column('UNIT', 'V')], { units: new Map([['UNIT', { unitId: 'UNIT', order: 1, testletKey: 'T' }]]) }, new Map([[key('UNIT', 'V'), fixture]]), profile(edge.profile), new Map(), {});
    expect(() => resolver.getExportValue(cell, fixture.requested)).toThrow(fixture.reason);
  });

  it.each(edge.aggregate)('$id: applies the independently checked Missing priority policy', fixture => {
    expect(aggregateItemDatasetMissingStates(fixture.states)).toBe(fixture.expected);
    expect(aggregateItemDatasetMissingStates([...fixture.states].reverse())).toBe(fixture.expected);
  });

  it.each(edge.derived)('$id: retains the precise diagnostic for an unexportable derived result', fixture => {
    const resolver = new ItemDatasetCellResolver();
    const target = { ...column('UNIT', 'D'), isDerived: true, sourceType: 'SUM_SCORE' };
    const [cell] = resolver.resolve([target], { units: new Map([['UNIT', { unitId: 'UNIT', order: 1, testletKey: 'T' }]]) }, new Map(fixture.values.map(([id, status, code, score]) => [key('UNIT', id), { status, code, score }])), profile(edge.profile), new Map([[target.key, fixture.sources.map(id => key('UNIT', id))]]), {});
    expect(cell.failureReason).toBe(fixture.reason);
    expect(() => resolver.getExportValue(cell, 'code')).toThrow(fixture.reason);
    expect(() => resolver.getExportValue(cell, 'score')).toThrow(fixture.reason);
  });

  it('classifies a unit outside the booklet as Missing by Design even if a response exists', () => {
    const resolver = new ItemDatasetCellResolver();
    const [cell] = resolver.resolve([column('OTHER_UNIT', 'V')], { units: new Map() }, new Map([[key('OTHER_UNIT', 'V'), { code: 1, score: 1, status: 5 }]]), profile(edge.profile), new Map(), {});
    expect(resolver.getExportValue(cell, 'code')).toBe(-95);
    expect(resolver.getExportValue(cell, 'score')).toBe('NA');
  });

  it('distinguishes code agreement from score agreement on the same coder pairs', () => {
    const fixture = edge.kappa[0];
    const pair = {
      coder1Id: 1,
      coder1Name: 'R1',
      coder2Id: 2,
      coder2Name: 'R2',
      codes: fixture.left.map((code1, i) => ({ code1, code2: fixture.right[i] })),
      scores: fixture.left.map((code, i) => ({ score1: code === null ? null : 0, score2: fixture.right[i] === null ? null : 0 }))
    };
    expect(InterraterReliabilityCalculator.calculatePairwise([pair], 'code')[0].kappa).toBeCloseTo(fixture.expected.kappa!, 10);
    expect(InterraterReliabilityCalculator.calculatePairwise([pair], 'score')[0].kappa).toBe(1);
  });

  it.each(edge.persistence)('$id: rejects ambiguous write targets while preserving distinct subforms', fixture => {
    const service = Object.create(CodingProcessService.prototype) as {
      assertUniqueAutocoderPersistenceTargets: (targets: object[]) => void;
    };
    const before = JSON.stringify(fixture.targets);
    const check = () => service.assertUniqueAutocoderPersistenceTargets(fixture.targets);
    if (fixture.duplicate) expect(check).toThrow('Autocoder produced multiple updates');
    else expect(check).not.toThrow();
    expect(JSON.stringify(fixture.targets)).toBe(before);
  });

  it.each(edge.partial)('$id: retains the source while applying the configured partial response rule', fixture => {
    const source = { id: 'B', value: null, status: fixture.status } as RawResponse;
    const result = CodingSchemeFactory.code([
      {
        id: 'A', value: 1, status: 'CODING_COMPLETE', code: 2, score: 3
      }, structuredClone(source)
    ], [
      { id: 'A', sourceType: 'BASE', codes: [] }, { id: 'B', sourceType: 'BASE', codes: [] },
      {
        id: 'D',
        sourceType: fixture.sourceType,
        deriveSources: ['A', 'B'],
        codes: [],
        sourceParameters: { processing: fixture.enabled ? [fixture.option] : [] }
      } as VariableCodingData
    ]);
    const target = result.find(r => r.id === 'D')!;
    expect(target.status).toBe(fixture.expectedStatus);
    if (fixture.enabled) expect(target.value).toBe(fixture.expectedValue);
    expect(result.find(r => r.id === 'B')).toEqual(source);
  });

  it.each(edge.primitives)('$id: preserves the input type and separates null from empty values', fixture => {
    const input = { id: 'V', value: structuredClone(fixture.value), status: 'VALUE_CHANGED' } as RawResponse;
    const result = CodingSchemeFactory.code([input], [{
      id: 'V',
      sourceType: 'BASE',
      sourceParameters: { processing: ['TAKE_EMPTY_AS_VALID'] },
      codes: [
        {
          id: 7, score: 2, type: 'FULL_CREDIT', ruleSets: [{ rules: [{ method: 'IS_NULL' }] }]
        },
        {
          id: 8, score: 3, type: 'FULL_CREDIT', ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['null'] }] }]
        },
        { id: 0, score: 0, type: 'RESIDUAL_AUTO' }
      ]
    }])[0];
    expect(result).toMatchObject({
      value: fixture.value, code: fixture.code, score: fixture.score, status: 'CODING_COMPLETE'
    });
  });

  it.each(edge.scopes)('$id: honors the configured MNR boundary', fixture => {
    const resolver = new ItemDatasetCellResolver();
    const cells = resolver.resolve([column('U1', 'V'), column('U2', 'V')], {
      units: new Map([
        ['U1', { unitId: 'U1', order: 1, testletKey: 'T1' }],
        ['U2', { unitId: 'U2', order: 2, testletKey: fixture.sameTestlet ? 'T1' : 'T2' }]
      ])
    }, new Map([
      [key('U1', 'V'), { code: null, score: null, status: 1 }],
      [key('U2', 'V'), { code: 1, score: 1, status: 5 }]
    ]), profile(edge.profile), new Map(), { notReachedScope: fixture.scope });
    expect(resolver.getExportValue(cells[0], 'code')).toBe(fixture.expected);
  });
});
