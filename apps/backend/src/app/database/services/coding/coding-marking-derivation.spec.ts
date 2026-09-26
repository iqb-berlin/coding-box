import { CodingScheme, VariableCodingData } from '@iqbspecs/coding-scheme';
import { CodingProcessService } from './coding-process.service';
import { ResponseEntity } from '../../entities/response.entity';

const createResponse = (id: number, variableid: string, extra: Partial<ResponseEntity> = {}): ResponseEntity => ({
  id,
  unitid: 1,
  variableid,
  value: '',
  status: 3,
  subform: 'elementCodes',
  is_autocoder_generated: false,
  autocoder_invalidated_version: null,
  status_v1: null,
  code_v1: null,
  score_v1: null,
  status_v2: null,
  code_v2: null,
  score_v2: null,
  status_v3: null,
  code_v3: null,
  score_v3: null,
  ...extra
} as ResponseEntity);

const createScheme = (automaticResidual: boolean): CodingScheme => new CodingScheme({
  variableCodings: [
    {
      id: 'marking', alias: '03a', sourceType: 'BASE', codes: []
    },
    {
      id: 'panel',
      alias: '_03_reached',
      sourceType: 'BASE',
      codeModel: 'RULES_ONLY',
      sourceParameters: { processing: ['TAKE_DISPLAYED_AS_VALUE_CHANGED'] },
      codes: [{
        id: 0, type: 'INTENDED_INCOMPLETE', score: 0, ruleSets: []
      }]
    },
    {
      id: 'derived',
      alias: '_03',
      sourceType: 'CONCAT_CODE',
      deriveSources: ['panel', 'marking'],
      codeModel: automaticResidual ? 'RULES_ONLY' : 'MANUAL_AND_RULES',
      codes: [
        {
          id: 1, type: 'FULL_CREDIT', score: 1, ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['0_11'] }] }]
        },
        {
          id: 4, type: 'NO_CREDIT', score: 0, ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['0_41'] }] }]
        },
        {
          id: 0, type: automaticResidual ? 'RESIDUAL_AUTO' : 'RESIDUAL', score: 0, ruleSets: []
        }
      ]
    },
    {
      id: 'manual', alias: 'manual', sourceType: 'BASE', codes: []
    }
  ] as VariableCodingData[]
});

describe('marking derivation through the backend run-2 calculation', () => {
  it.each([
    [false, 11, 5, 2, 'CODING_COMPLETE', 1],
    [false, 41, 5, 2, 'CODING_COMPLETE', 0],
    [false, 0, 12, 2, 'CODING_INCOMPLETE', null],
    [true, 0, 12, 2, 'CODING_COMPLETE', 0],
    [false, 41, 5, 1, 'INVALID', null]
  ])('preserves the schema outcome and v2 inputs (%j)', async (
    automaticResidual, sourceCode, sourceStatus, reachedStatus, expectedStatus, expectedScore
  ) => {
    const service = Object.create(CodingProcessService.prototype) as {
      logger: { log: jest.Mock; warn: jest.Mock };
      validateCodingSchemeForUnit: jest.Mock;
      processAndCodeResponses: (...args: unknown[]) => Promise<{ allCodedResponses: Record<string, unknown>[] }>;
    };
    service.logger = { log: jest.fn(), warn: jest.fn() };
    service.validateCodingSchemeForUnit = jest.fn().mockResolvedValue(undefined);
    const rows = [
      createResponse(1, '03a', {
        value: '[]',
        status_v1: sourceStatus as number,
        code_v1: sourceCode as number,
        score_v1: sourceCode === 11 ? 1 : 0
      }),
      createResponse(2, '_03_reached', { status: reachedStatus as number, value: null }),
      createResponse(3, '_03_reached', {
        subform: '', is_autocoder_generated: true, status_v1: 0, status_v3: 0
      }),
      createResponse(4, 'manual', {
        status_v1: 12,
        code_v1: 0,
        score_v1: 0,
        status_v2: 5,
        code_v2: 7,
        score_v2: 1
      })
    ];
    const before = JSON.stringify(rows);
    const result = await service.processAndCodeResponses(24,
      [{ id: 1, name: 'TEST', alias: 'TEST' }],
      new Map([[1, rows]]),
      new Map([[1, 'TEST.VOCS']]),
      new Map([['TEST.VOCS', createScheme(automaticResidual as boolean)]]),
      rows,
      { totalResponses: 0, statusCounts: {} },
      2);

    expect(result.allCodedResponses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        variableid: '_03',
        isNew: true,
        subform: 'elementCodes',
        status_v3: expectedStatus,
        score_v3: expectedScore
      }),
      expect.objectContaining({
        id: 4, status_v3: 'CODING_COMPLETE', code_v3: 7, score_v3: 1
      })
    ]));
    expect(result.allCodedResponses.some(row => row.id === 3)).toBe(false);
    expect(result.allCodedResponses.every(row => !('code_v1' in row) && !('code_v2' in row))).toBe(true);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
