import { PsychometricAnalysisEngine } from './psychometric-analysis-engine';
import {
  NormalizedPsychometricExportServiceOptions,
  PsychometricItemMapping,
  PsychometricRawResponseRow,
  PsychometricResponseSnapshot
} from './psychometric-export.types';
import { getPsychometricLogicalKey } from './psychometric-key.util';

describe('PsychometricAnalysisEngine', () => {
  const createMapping = (): PsychometricItemMapping => {
    const vomd = {
      fileName: 'UNIT_A.vomd',
      unitKey: 'UNIT_A',
      profiles: [],
      items: []
    };
    const items = [
      {
        key: getPsychometricLogicalKey('UNIT_A', 'V1'),
        unitName: 'UNIT_A',
        variableId: 'V1',
        sourceVariableId: 'V1',
        itemId: 'ITEM_1',
        itemLabel: 'Item 1',
        variable: {
          id: 'V1',
          alias: 'V1',
          type: 'string',
          multiple: false,
          hasCodingScheme: true,
          codes: [
            { id: 0, label: 'incorrect', score: 0 },
            { id: 1, label: 'correct', score: 1 }
          ],
          values: [
            { value: 'A', label: 'Option A' },
            { value: 'B', label: 'Unused option' }
          ]
        },
        vomd,
        vomdItem: {
          id: 'ITEM_1',
          variableId: 'V1',
          profiles: []
        },
        domain: {
          id: 'WORKSPACE',
          label: 'Gesamter Workspace'
        }
      },
      {
        key: getPsychometricLogicalKey('UNIT_A', 'V2'),
        unitName: 'UNIT_A',
        variableId: 'V2',
        sourceVariableId: 'V2',
        itemId: 'ITEM_2',
        itemLabel: 'Item 2',
        variable: {
          id: 'V2',
          alias: 'V2',
          type: 'string',
          multiple: false,
          hasCodingScheme: true,
          codes: [
            { id: 0, label: 'incorrect', score: 0 },
            { id: 1, label: 'correct', score: 1 }
          ],
          values: [{ value: 'X', label: 'Option X' }]
        },
        vomd,
        vomdItem: {
          id: 'ITEM_2',
          variableId: 'V2',
          profiles: []
        },
        domain: {
          id: 'WORKSPACE',
          label: 'Gesamter Workspace'
        }
      }
    ] as PsychometricItemMapping['items'];

    return {
      items,
      byLogicalKey: new Map(items.map(item => [item.key, item])),
      issues: []
    };
  };

  const createRow = (
    responseId: number,
    personId: number,
    variableId: string,
    value: string,
    code: number,
    score: number
  ): PsychometricRawResponseRow => ({
    responseId,
    personId,
    unitName: 'UNIT_A',
    variableId,
    value,
    codeV1: code,
    scoreV1: score,
    codeV2: code,
    scoreV2: score,
    codeV3: code,
    scoreV3: score
  });

  it('calculates deterministically without mutating metadata or using I/O mocks', async () => {
    const engine = new PsychometricAnalysisEngine();
    const mapping = createMapping();
    const rows = [
      createRow(1, 1, 'V1', 'A', 1, 1),
      createRow(2, 1, 'V2', 'X', 1, 1),
      createRow(3, 2, 'V1', 'A', 0, 0),
      createRow(4, 2, 'V2', 'X', 1, 1),
      createRow(5, 3, 'V1', 'A', 0, 0),
      createRow(6, 3, 'V2', 'X', 0, 0)
    ];
    const snapshot: PsychometricResponseSnapshot = {
      duplicatePersonIds: new Set(),
      totalRows: rows.length,
      forEachBatch: async callback => callback(rows, rows.length)
    };
    const options: NormalizedPsychometricExportServiceOptions = {
      workspaceId: 7,
      version: 'v2',
      partWholeCorrection: true,
      domain: { mode: 'workspace' },
      maxCategoryCount: 10
    };
    const input = {
      options,
      mapping,
      missingDefinitions: [],
      snapshot
    };

    const first = await engine.analyze(input);
    const second = await engine.analyze(input);

    expect(second).toEqual(first);
    expect(mapping.items[0]).not.toHaveProperty('codeDefinitions');
    expect(first.rows).toContainEqual(
      expect.objectContaining({
        type: 'SCORE',
        variable: 'V1',
        n: 3
      })
    );
    expect(first.rows).toContainEqual(
      expect.objectContaining({
        type: 'CATEGORY',
        variable: 'V1',
        category: 'B',
        n: 3,
        positiveN: 0,
        status: 'CONSTANT_ITEM'
      })
    );
  });

  it('excludes duplicate persons supplied by the response reader', async () => {
    const engine = new PsychometricAnalysisEngine();
    const mapping = createMapping();
    const rows = [
      createRow(1, 1, 'V1', 'A', 1, 1),
      createRow(2, 1, 'V2', 'X', 1, 1),
      createRow(3, 2, 'V1', 'A', 0, 0),
      createRow(4, 2, 'V2', 'X', 0, 0)
    ];

    const analysis = await engine.analyze({
      options: {
        workspaceId: 7,
        version: 'v2',
        partWholeCorrection: false,
        domain: { mode: 'workspace' },
        maxCategoryCount: 10
      },
      mapping,
      missingDefinitions: [],
      snapshot: {
        duplicatePersonIds: new Set([2]),
        totalRows: rows.length,
        forEachBatch: async callback => callback(rows, rows.length)
      }
    });

    expect(analysis.summary).toContainEqual({
      key: 'Ausgeschlossene Testpersonen mit Duplikaten',
      value: 1
    });
    expect(analysis.summary).toContainEqual({
      key: 'Berücksichtigte Testpersonen',
      value: 1
    });
  });

  it('normalizes missing codes and scores through the public analysis result', async () => {
    const engine = new PsychometricAnalysisEngine();
    const mapping = createMapping();
    mapping.items = [mapping.items[0]];
    mapping.byLogicalKey = new Map([
      [mapping.items[0].key, mapping.items[0]]
    ]);
    const rows = [
      createRow(1, 1, 'V1', '', -3, 99),
      createRow(2, 2, 'V1', 'A', 1, 1)
    ];

    const analysis = await engine.analyze({
      options: {
        workspaceId: 7,
        version: 'v2',
        partWholeCorrection: false,
        domain: { mode: 'workspace' },
        maxCategoryCount: 10
      },
      mapping,
      missingDefinitions: [
        {
          id: 'mir',
          code: -98,
          score: 0,
          label: 'MIR'
        }
      ],
      snapshot: {
        duplicatePersonIds: new Set(),
        totalRows: rows.length,
        forEachBatch: async callback => callback(rows, rows.length)
      }
    });

    expect(analysis.rows).toContainEqual(
      expect.objectContaining({
        type: 'CODE',
        code: '-98',
        label: 'MIR',
        score: 0,
        source: 'MISSING_PROFILE',
        n: 2,
        positiveN: 1
      })
    );
  });

  it('bounds category discovery without exposing initialization helpers', async () => {
    const engine = new PsychometricAnalysisEngine();
    const mapping = createMapping();
    mapping.items = [mapping.items[0]];
    mapping.byLogicalKey = new Map([
      [mapping.items[0].key, mapping.items[0]]
    ]);
    mapping.items[0].variable.values = Array.from(
      { length: 1000 },
      (_value, index) => ({
        value: `category-${index}`,
        label: `Category ${index}`
      })
    );

    const analysis = await engine.analyze({
      options: {
        workspaceId: 7,
        version: 'v2',
        partWholeCorrection: false,
        domain: { mode: 'workspace' },
        maxCategoryCount: 10
      },
      mapping,
      missingDefinitions: [],
      snapshot: {
        duplicatePersonIds: new Set(),
        totalRows: 0,
        forEachBatch: async () => undefined
      }
    });

    expect(
      analysis.rows.filter(row => row.type === 'CATEGORY')
    ).toEqual([
      expect.objectContaining({
        status: 'TOO_MANY_CATEGORIES'
      })
    ]);
  });

  it('preserves explicitly valid empty response categories', async () => {
    const engine = new PsychometricAnalysisEngine();
    const mapping = createMapping();
    mapping.items = [mapping.items[0]];
    mapping.byLogicalKey = new Map([
      [mapping.items[0].key, mapping.items[0]]
    ]);
    mapping.items[0].variable.processing = ['TAKE_EMPTY_AS_VALID'];
    mapping.items[0].variable.values = [
      { value: '', label: 'Leere Antwort' },
      { value: 'A', label: 'Option A' }
    ];
    const rows = [
      createRow(1, 1, 'V1', '', 0, 0),
      createRow(2, 2, 'V1', 'A', 1, 1)
    ];

    const analysis = await engine.analyze({
      options: {
        workspaceId: 7,
        version: 'v2',
        partWholeCorrection: false,
        domain: { mode: 'workspace' },
        maxCategoryCount: 10
      },
      mapping,
      missingDefinitions: [],
      snapshot: {
        duplicatePersonIds: new Set(),
        totalRows: rows.length,
        forEachBatch: async callback => callback(rows, rows.length)
      }
    });

    expect(analysis.rows).toContainEqual(
      expect.objectContaining({
        type: 'CATEGORY',
        category: '___EMPTY___',
        label: 'Leere Antwort',
        n: 2,
        positiveN: 1
      })
    );
  });
});
