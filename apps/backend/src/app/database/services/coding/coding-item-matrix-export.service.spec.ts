import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import { PassThrough } from 'stream';
import {
  CodingItemMatrixExportService,
  ItemMatrixExportConfiguration
} from './coding-item-matrix-export.service';
import { ItemDatasetMetadataService } from './item-dataset-metadata.service';

const collectStream = (stream: NodeJS.ReadableStream): Promise<string> => new Promise((resolve, reject) => {
  let output = '';
  stream.on('data', chunk => {
    output += chunk.toString();
  });
  stream.on('end', () => resolve(output));
  stream.on('error', reject);
});

const missingEntries = [
  {
    id: 'mir',
    label: 'invalid',
    code: -81,
    score: 0
  },
  {
    id: 'mci',
    label: 'coding error',
    code: -82,
    score: null
  },
  {
    id: 'mbi_mbo',
    label: 'omitted',
    code: -83,
    score: 0
  },
  {
    id: 'mnr',
    label: 'not reached',
    code: -84,
    score: null
  },
  {
    id: 'mbd',
    label: 'by design',
    code: -85,
    score: null
  }
];

const profile = {
  byId: new Map(missingEntries.map(entry => [entry.id, entry])),
  byCode: new Map(missingEntries.map(entry => [entry.code, entry]))
};

const configuration: ItemMatrixExportConfiguration = {
  missingsProfileId: 4,
  notReachedScope: 'unit',
  recodeTrailingOmissions: false
};

const column = (
  itemId: string,
  unitId = 'UNIT1',
  variableId = `VAR${itemId}`,
  isDerived = false
) => ({
  key: `${unitId}\u001F${variableId}`,
  header: `${unitId}_${itemId}`,
  unitName: unitId,
  unitId,
  variableId,
  sourceVariableId: variableId,
  itemId,
  itemLabel: itemId,
  itemOrder: Number(itemId.replace(/\D/g, '')) || 0,
  isDerived
});

const createService = (
  overrides: {
    responseRepository?: object;
    bookletRepository?: object;
    unitRepository?: object;
    workspaceFilesService?: object;
    workspaceExclusionService?: object;
    missingsProfilesService?: object;
    fileUploadRepository?: object;
    metadataResolver?: object;
  } = {}
) => {
  const workspaceFilesService = overrides.workspaceFilesService || {
    getUnitVariableMap: jest.fn().mockResolvedValue(new Map()),
    getDerivedVariablesBySourceMap: jest.fn().mockResolvedValue(new Map())
  };
  const workspaceExclusionService = overrides.workspaceExclusionService || {
    resolveExclusionsForQueries: jest.fn().mockResolvedValue({
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    })
  };
  const metadataService = new ItemDatasetMetadataService(
    (overrides.unitRepository || {}) as never,
    (overrides.fileUploadRepository || {}) as never,
    workspaceFilesService as never,
    workspaceExclusionService as never,
    (overrides.metadataResolver || {}) as never
  );
  return new CodingItemMatrixExportService(
    (overrides.responseRepository || {}) as never,
    (overrides.bookletRepository || {}) as never,
    workspaceFilesService as never,
    workspaceExclusionService as never,
    (overrides.missingsProfilesService || {}) as never,
    metadataService
  );
};

describe('CodingItemMatrixExportService', () => {
  it('handles output stream errors when Excel preparation fails', async () => {
    const outputStream = new PassThrough();
    const createWriteStream = jest
      .spyOn(fs, 'createWriteStream')
      .mockReturnValue(outputStream as never);
    const service = createService();
    const preparationError = new Error('profile validation failed');
    (
      service as never as {
        writeExcel: (
          stream: NodeJS.WritableStream
        ) => Promise<void>;
      }
    ).writeExcel = jest.fn(async stream => {
      expect(stream.listenerCount('error')).toBeGreaterThan(0);
      throw preparationError;
    });

    await expect(
      service.writeItemMatrixExcelToFile(
        '/tmp/item-dataset-stream-error.xlsx',
        7,
        'score',
        'v2',
        configuration
      )
    ).rejects.toBe(preparationError);
    expect(outputStream.destroyed).toBe(true);

    createWriteStream.mockRestore();
  });

  it('uses identical CSV/Excel semantics and names the sheet Itemdatensatz', async () => {
    const service = createService();
    const columns = [column('1'), column('2', 'UNIT2'), column('3')];
    const context = {
      rows: [
        {
          bookletId: 10,
          bookletName: 'BOOKLET-1',
          personLogin: 'login-1',
          personCode: 'code-1',
          personGroup: 'group-1'
        }
      ],
      columns,
      bookletDesigns: new Map([
        [
          'BOOKLET-1',
          {
            units: new Map([
              [
                'UNIT1',
                {
                  unitId: 'UNIT1',
                  order: 0,
                  testletKey: '0:T1'
                }
              ]
            ])
          }
        ]
      ]),
      profile,
      derivedSources: new Map()
    };
    const values = new Map([
      [
        10,
        new Map([
          [columns[0].key, { code: 3, score: 2, status: 5 }],
          [columns[2].key, { code: null, score: 1, status: 5 }]
        ])
      ]
    ]);
    (service as never as { buildMatrixContext: jest.Mock }).buildMatrixContext =
      jest.fn().mockResolvedValue(context);
    (
      service as never as { getResponseValuesForRows: jest.Mock }
    ).getResponseValuesForRows = jest.fn().mockResolvedValue(values);

    const codeCsv = await collectStream(
      service.exportItemMatrixAsCsvStream(7, 'code', 'v2', configuration)
    );
    const scoreCsv = await collectStream(
      service.exportItemMatrixAsCsvStream(7, 'score', 'v2', configuration)
    );
    const excel = await service.exportItemMatrixAsExcel(
      7,
      'score',
      'v2',
      configuration
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excel);
    const excelRow = workbook.getWorksheet('Itemdatensatz')!.getRow(2);

    expect(codeCsv).toContain(
      'person_login;person_code;person_group;booklet_name;UNIT1_1;UNIT2_2;UNIT1_3'
    );
    expect(codeCsv).toContain('login-1;code-1;group-1;BOOKLET-1;3;-85;NA');
    expect(scoreCsv).toContain('login-1;code-1;group-1;BOOKLET-1;2;;1');
    expect(excelRow.getCell(5).value).toBe(2);
    expect(excelRow.getCell(6).value).toBeNull();
    expect(excelRow.getCell(7).value).toBe(1);
  });

  it('maps statuses and internal codes through the selected profile', async () => {
    const service = createService();
    const columns = [
      column('1'),
      column('2'),
      column('3'),
      column('4'),
      column('5'),
      column('6')
    ];
    const responseValues = new Map([
      [columns[0].key, { code: null, score: null, status: 7 }],
      [columns[1].key, { code: null, score: null, status: 9 }],
      [columns[2].key, { code: null, score: null, status: 2 }],
      [columns[3].key, { code: -3, score: null, status: 5 }],
      [columns[4].key, { code: -4, score: null, status: 5 }],
      [columns[5].key, { code: null, score: null, status: 4 }]
    ]);
    const cells = await (
      service as never as {
        resolveRowCells: (
          columnsValue: unknown[],
          design: unknown,
          values: unknown,
          profileValue: unknown,
          derived: unknown,
          config: ItemMatrixExportConfiguration
        ) => Promise<
        Array<{
          code: number | null;
          score: number | null;
          unresolved: boolean;
        }>
        >;
      }
    ).resolveRowCells(
      columns,
      {
        units: new Map([
          [
            'UNIT1',
            {
              unitId: 'UNIT1',
              order: 0,
              testletKey: '0:T1'
            }
          ]
        ])
      },
      responseValues,
      profile,
      new Map(),
      configuration
    );

    expect(cells.map(cellValue => cellValue.code)).toEqual([
      -81, -82, -83, -81, -82, null
    ]);
    expect(cells.map(cellValue => cellValue.score)).toEqual([
      0,
      null,
      0,
      0,
      null,
      null
    ]);
    expect(cells[5].unresolved).toBe(true);
  });

  it('resolves mnr per unit and optionally recodes trailing omissions', async () => {
    const service = createService();
    const columns = [column('1'), column('2'), column('3')];
    const design = {
      units: new Map([
        [
          'UNIT1',
          {
            unitId: 'UNIT1',
            order: 0,
            testletKey: '0:T1'
          }
        ]
      ])
    };
    const values = new Map([
      [columns[0].key, { code: null, score: null, status: 1 }],
      [columns[1].key, { code: null, score: null, status: 2 }],
      [columns[2].key, { code: null, score: null, status: 1 }]
    ]);
    const resolve = (config: ItemMatrixExportConfiguration) => (
      service as never as {
        resolveRowCells: (
          columnsValue: unknown[],
          designValue: unknown,
          responseValues: unknown,
          profileValue: unknown,
          derived: unknown,
          configValue: ItemMatrixExportConfiguration
        ) => Promise<Array<{ code: number }>>;
      }
    ).resolveRowCells(columns, design, values, profile, new Map(), config);

    const defaultCells = await resolve(configuration);
    const recodedCells = await resolve({
      ...configuration,
      notReachedScope: 'booklet',
      recodeTrailingOmissions: true
    });

    expect(defaultCells.map(cellValue => cellValue.code)).toEqual([
      -83, -83, -84
    ]);
    expect(recodedCells.map(cellValue => cellValue.code)).toEqual([
      -84, -84, -84
    ]);
  });

  it('does not treat stored mnr codes as later activity', async () => {
    const service = createService();
    const columns = [column('1'), column('2')];
    const design = {
      units: new Map([
        [
          'UNIT1',
          {
            unitId: 'UNIT1',
            order: 0,
            testletKey: '0:T1'
          }
        ]
      ])
    };
    const values = new Map([
      [columns[1].key, { code: -84, score: null, status: 5 }]
    ]);

    const cells = await (
      service as never as {
        resolveRowCells: (
          columnsValue: unknown[],
          designValue: unknown,
          responseValues: unknown,
          profileValue: unknown,
          derived: unknown,
          configValue: ItemMatrixExportConfiguration
        ) => Promise<Array<{ code: number }>>;
      }
    ).resolveRowCells(columns, design, values, profile, new Map(), {
      ...configuration,
      notReachedScope: 'booklet'
    });

    expect(cells.map(cellValue => cellValue.code)).toEqual([-84, -84]);
  });

  it('recodes stored trailing mbi_mbo codes only when requested', async () => {
    const service = createService();
    const columns = [column('1')];
    const design = {
      units: new Map([
        [
          'UNIT1',
          {
            unitId: 'UNIT1',
            order: 0,
            testletKey: '0:T1'
          }
        ]
      ])
    };
    const values = new Map([
      [columns[0].key, { code: -83, score: 0, status: 5 }]
    ]);
    const resolve = (recodeTrailingOmissions: boolean) => (
      service as never as {
        resolveRowCells: (
          columnsValue: unknown[],
          designValue: unknown,
          responseValues: unknown,
          profileValue: unknown,
          derived: unknown,
          configValue: ItemMatrixExportConfiguration
        ) => Promise<Array<{ code: number }>>;
      }
    ).resolveRowCells(columns, design, values, profile, new Map(), {
      ...configuration,
      notReachedScope: 'booklet',
      recodeTrailingOmissions
    });

    expect((await resolve(false))[0].code).toBe(-83);
    expect((await resolve(true))[0].code).toBe(-84);
  });

  it('distinguishes unit, testlet and booklet mnr ranges', async () => {
    const service = createService();
    const columns = [
      column('1', 'UNIT1'),
      column('2', 'UNIT2'),
      column('3', 'UNIT3'),
      column('4', 'UNIT4')
    ];
    const design = {
      units: new Map([
        ['UNIT1', { unitId: 'UNIT1', order: 0, testletKey: '0:T1' }],
        ['UNIT2', { unitId: 'UNIT2', order: 1, testletKey: '0:T1' }],
        ['UNIT3', { unitId: 'UNIT3', order: 2, testletKey: '1:T2' }],
        ['UNIT4', { unitId: 'UNIT4', order: 3, testletKey: '2:T3' }]
      ])
    };
    const values = new Map([
      [columns[0].key, { code: null, score: null, status: 1 }],
      [columns[1].key, { code: 1, score: 1, status: 5 }],
      [columns[2].key, { code: null, score: null, status: 1 }],
      [columns[3].key, { code: 1, score: 1, status: 5 }]
    ]);
    const resolve = (scope: 'unit' | 'testlet' | 'booklet') => (
      service as never as {
        resolveRowCells: (
          columnsValue: unknown[],
          designValue: unknown,
          responseValues: unknown,
          profileValue: unknown,
          derived: unknown,
          configValue: ItemMatrixExportConfiguration
        ) => Promise<Array<{ code: number }>>;
      }
    ).resolveRowCells(columns, design, values, profile, new Map(), {
      ...configuration,
      notReachedScope: scope
    });

    expect((await resolve('unit')).map(cellValue => cellValue.code)).toEqual([
      -84, 1, -84, 1
    ]);
    expect(
      (await resolve('testlet')).map(cellValue => cellValue.code)
    ).toEqual([-83, 1, -84, 1]);
    expect(
      (await resolve('booklet')).map(cellValue => cellValue.code)
    ).toEqual([-83, 1, -83, 1]);
  });

  it('aggregates nested derived missings and leaves valid-only derivations unresolved', async () => {
    const service = createService();
    const derived = column('3', 'UNIT1', 'DERIVED', true);
    const design = {
      units: new Map([
        [
          'UNIT1',
          {
            unitId: 'UNIT1',
            order: 0,
            testletKey: '0:T1'
          }
        ]
      ])
    };
    const derivedSources = new Map([
      [derived.key, ['UNIT1\u001FINNER', 'UNIT1\u001FBASE3']],
      ['UNIT1\u001FINNER', ['UNIT1\u001FBASE1', 'UNIT1\u001FBASE2']]
    ]);
    const mixedValues = new Map([
      ['UNIT1\u001FBASE1', { code: -81, score: 0, status: 5 }],
      ['UNIT1\u001FBASE2', { code: -83, score: 0, status: 5 }],
      ['UNIT1\u001FBASE3', { code: -81, score: 0, status: 5 }]
    ]);
    const validValues = new Map([
      ['UNIT1\u001FBASE1', { code: 1, score: 1, status: 5 }],
      ['UNIT1\u001FBASE2', { code: 1, score: 1, status: 5 }],
      ['UNIT1\u001FBASE3', { code: 1, score: 1, status: 5 }]
    ]);
    const resolve = (values: Map<string, unknown>) => (
      service as never as {
        resolveRowCells: (
          columnsValue: unknown[],
          designValue: unknown,
          responseValues: unknown,
          profileValue: unknown,
          derivedValue: unknown,
          configValue: ItemMatrixExportConfiguration
        ) => Promise<Array<{ code: number | null; unresolved: boolean }>>;
      }
    ).resolveRowCells(
      [derived],
      design,
      values,
      profile,
      derivedSources,
      configuration
    );

    expect((await resolve(mixedValues))[0].code).toBe(-81);
    expect((await resolve(validValues))[0]).toMatchObject({
      code: null,
      unresolved: true
    });
  });

  it('uses the resolved state of each source for derived missings', async () => {
    const service = createService();
    const source = column('1', 'UNIT1', 'SOURCE');
    const laterActivity = column('2', 'UNIT1', 'ACTIVITY');
    const derived = column('3', 'UNIT1', 'DERIVED', true);
    const design = {
      units: new Map([
        [
          'UNIT1',
          {
            unitId: 'UNIT1',
            order: 0,
            testletKey: '0:T1'
          }
        ]
      ])
    };
    const values = new Map([
      [laterActivity.key, { code: 1, score: 1, status: 5 }]
    ]);
    const derivedSources = new Map([[derived.key, [source.key]]]);

    const cells = await (
      service as never as {
        resolveRowCells: (
          columnsValue: unknown[],
          designValue: unknown,
          responseValues: unknown,
          profileValue: unknown,
          derivedValue: unknown,
          configValue: ItemMatrixExportConfiguration
        ) => Promise<Array<{ code: number | null }>>;
      }
    ).resolveRowCells(
      [source, laterActivity, derived],
      design,
      values,
      profile,
      derivedSources,
      configuration
    );

    expect(cells.map(cellValue => cellValue.code)).toEqual([-83, 1, -83]);
  });

  it('treats score-only sources as valid during derived missing aggregation', async () => {
    const service = createService();
    const derived = column('3', 'UNIT1', 'DERIVED', true);
    const design = {
      units: new Map([
        [
          'UNIT1',
          {
            unitId: 'UNIT1',
            order: 0,
            testletKey: '0:T1'
          }
        ]
      ])
    };
    const derivedSources = new Map([
      [
        derived.key,
        ['UNIT1\u001FSCORE_ONLY', 'UNIT1\u001FCODING_ERROR']
      ]
    ]);
    const values = new Map([
      [
        'UNIT1\u001FSCORE_ONLY',
        { code: null, score: 1, status: 5 }
      ],
      [
        'UNIT1\u001FCODING_ERROR',
        { code: -82, score: null, status: 5 }
      ]
    ]);

    const cells = await (
      service as never as {
        resolveRowCells: (
          columnsValue: unknown[],
          designValue: unknown,
          responseValues: unknown,
          profileValue: unknown,
          derivedValue: unknown,
          configValue: ItemMatrixExportConfiguration
        ) => Promise<Array<{ code: number | null }>>;
      }
    ).resolveRowCells(
      [derived],
      design,
      values,
      profile,
      derivedSources,
      configuration
    );

    expect(cells[0].code).toBe(-82);
  });

  it('treats additional profile missings as errors only for derived aggregation', async () => {
    const service = createService();
    const source = column('1', 'UNIT1', 'SOURCE');
    const derived = column('2', 'UNIT1', 'DERIVED', true);
    const customMissing = {
      id: 'project_missing',
      label: 'project missing',
      code: -90,
      score: 0
    };
    const customProfile = {
      byId: profile.byId,
      byCode: new Map([
        ...profile.byCode,
        [customMissing.code, customMissing]
      ])
    };
    const design = {
      units: new Map([
        [
          'UNIT1',
          {
            unitId: 'UNIT1',
            order: 0,
            testletKey: '0:T1'
          }
        ]
      ])
    };
    const values = new Map([
      [source.key, { code: customMissing.code, score: null, status: 5 }]
    ]);
    const derivedSources = new Map([[derived.key, [source.key]]]);

    const cells = await (
      service as never as {
        resolveRowCells: (
          columnsValue: unknown[],
          designValue: unknown,
          responseValues: unknown,
          profileValue: unknown,
          derivedValue: unknown,
          configValue: ItemMatrixExportConfiguration
        ) => Promise<
        Array<{
          code: number | null;
          score: number | null;
          unresolved: boolean;
        }>
        >;
      }
    ).resolveRowCells(
      [source, derived],
      design,
      values,
      customProfile,
      derivedSources,
      configuration
    );

    expect(cells[0]).toMatchObject({
      code: -90,
      score: 0,
      unresolved: false
    });
    expect(cells[1]).toMatchObject({
      code: null,
      score: null,
      unresolved: true
    });
  });

  it('applies booklet mnr sequencing to derived sources without export columns', async () => {
    const service = createService();
    const derived = column('1', 'UNIT1', 'DERIVED', true);
    const laterActivity = column('2', 'UNIT2', 'ACTIVITY');
    const design = {
      units: new Map([
        ['UNIT1', { unitId: 'UNIT1', order: 0, testletKey: '0:T1' }],
        ['UNIT2', { unitId: 'UNIT2', order: 1, testletKey: '0:T1' }]
      ])
    };
    const derivedSources = new Map([
      [derived.key, ['UNIT1\u001FSOURCE_WITHOUT_ITEM']]
    ]);
    const resolve = (
      values: Map<string, unknown>,
      sources = derivedSources
    ) => (
      service as never as {
        resolveRowCells: (
          columnsValue: unknown[],
          designValue: unknown,
          responseValues: unknown,
          profileValue: unknown,
          derivedValue: unknown,
          configValue: ItemMatrixExportConfiguration
        ) => Promise<Array<{ code: number | null }>>;
      }
    ).resolveRowCells(
      [derived, laterActivity],
      design,
      values,
      profile,
      sources,
      {
        ...configuration,
        notReachedScope: 'booklet'
      }
    );

    const withLaterActivity = await resolve(new Map([
      [laterActivity.key, { code: 1, score: 1, status: 5 }]
    ]));
    const withoutLaterActivity = await resolve(new Map());
    const withSameItemOmission = await resolve(
      new Map([
        [
          'UNIT1\u001FSOURCE_OMISSION',
          { code: null, score: null, status: 0 }
        ]
      ]),
      new Map([
        [
          derived.key,
          [
            'UNIT1\u001FSOURCE_NOT_REACHED',
            'UNIT1\u001FSOURCE_OMISSION'
          ]
        ]
      ])
    );

    expect(withLaterActivity.map(cellValue => cellValue.code)).toEqual([
      -83, 1
    ]);
    expect(withoutLaterActivity.map(cellValue => cellValue.code)).toEqual([
      -84, -84
    ]);
    expect(withSameItemOmission.map(cellValue => cellValue.code)).toEqual([
      -84, -84
    ]);
  });

  it('leaves valid plus mbi_mbo derivations unresolved', async () => {
    const service = createService();
    const derived = column('3', 'UNIT1', 'DERIVED', true);
    const design = {
      units: new Map([
        [
          'UNIT1',
          {
            unitId: 'UNIT1',
            order: 0,
            testletKey: '0:T1'
          }
        ]
      ])
    };
    const derivedSources = new Map([
      [derived.key, ['UNIT1\u001FVALID', 'UNIT1\u001FOMISSION']]
    ]);
    const values = new Map([
      ['UNIT1\u001FVALID', { code: 1, score: 1, status: 5 }],
      ['UNIT1\u001FOMISSION', { code: -83, score: 0, status: 5 }]
    ]);

    const cells = await (
      service as never as {
        resolveRowCells: (
          columnsValue: unknown[],
          designValue: unknown,
          responseValues: unknown,
          profileValue: unknown,
          derivedValue: unknown,
          configValue: ItemMatrixExportConfiguration
        ) => Promise<Array<{ code: number | null; unresolved: boolean }>>;
      }
    ).resolveRowCells(
      [derived],
      design,
      values,
      profile,
      derivedSources,
      configuration
    );

    expect(cells[0]).toMatchObject({ code: null, unresolved: true });
  });

  it('returns selectable VOMD items with one underscore and reports collisions', async () => {
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { unitName: 'UNIT1', unitAlias: 'Aufgabe' },
        { unitName: 'UNIT2', unitAlias: 'Aufgabe' }
      ])
    };
    const mappedItem = (unitName: string, variableId: string) => ({
      key: `${unitName}\u001F${variableId}`,
      unitName,
      variableId,
      sourceVariableId: variableId,
      itemId: 'ITEM1',
      itemLabel: `${unitName} Item`,
      variable: { isDerived: false }
    });
    const service = createService({
      unitRepository: {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
      },
      metadataResolver: {
        buildItemMapping: jest.fn().mockResolvedValue({
          items: [mappedItem('UNIT1', 'VAR1'), mappedItem('UNIT2', 'VAR2')],
          issues: [],
          fallbacks: [],
          byLogicalKey: new Map()
        })
      }
    });

    const options = await service.getItemDatasetOptions(7);

    expect(options.items[0]).toMatchObject({
      unitId: 'UNIT1',
      itemId: 'ITEM1',
      columnName: 'Aufgabe_ITEM1'
    });
    expect(options.mappingIssues[0]).toMatchObject({
      code: 'column-name-collision',
      unitId: 'UNIT2',
      itemId: 'ITEM1',
      columnName: 'Aufgabe_ITEM1'
    });
    expect(options.mappingIssues[0].message).toContain(
      "Spaltenname 'Aufgabe_ITEM1' kollidiert"
    );
  });

  it('reports item headers that collide with fixed identification columns', async () => {
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { unitName: 'UNIT1', unitAlias: 'person' }
      ])
    };
    const service = createService({
      unitRepository: {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
      },
      metadataResolver: {
        buildItemMapping: jest.fn().mockResolvedValue({
          items: [
            {
              unitName: 'UNIT1',
              variableId: 'VAR1',
              sourceVariableId: 'VAR1',
              itemId: 'login',
              itemLabel: 'Login item',
              variable: { isDerived: false }
            }
          ],
          issues: [],
          fallbacks: [],
          byLogicalKey: new Map()
        })
      }
    });

    const options = await service.getItemDatasetOptions(7);

    expect(options.mappingIssues).toContainEqual({
      code: 'column-name-collision',
      message:
        "Spaltenname 'person_login' kollidiert für feste " +
        'Identifikationsspalte und UNIT1\u001Flogin',
      unitId: 'UNIT1',
      itemId: 'login',
      columnName: 'person_login'
    });
  });

  it('excludes globally ignored units before resolving VOMD metadata', async () => {
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([])
    };
    const buildItemMapping = jest.fn().mockResolvedValue({
      items: [],
      issues: [],
      fallbacks: [],
      byLogicalKey: new Map()
    });
    const service = createService({
      unitRepository: {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
      },
      workspaceExclusionService: {
        resolveExclusionsForQueries: jest.fn().mockResolvedValue({
          globalIgnoredUnits: ['IGNORED_UNIT'],
          ignoredBooklets: [],
          testletIgnoredUnits: []
        })
      },
      metadataResolver: { buildItemMapping }
    });

    await service.getItemDatasetOptions(7);

    expect(buildItemMapping).toHaveBeenCalledWith(7, {
      excludedUnitNames: ['IGNORED_UNIT'],
      requireItemIds: true
    });
  });

  it('filters items by unit/item pairs and reports unknown selections', async () => {
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([])
    };
    const service = createService({
      unitRepository: {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
      },
      metadataResolver: {
        buildItemMapping: jest.fn().mockResolvedValue({
          items: [
            {
              unitName: 'UNIT1',
              variableId: 'VAR1',
              sourceVariableId: 'VAR1',
              itemId: 'ITEM1',
              itemLabel: 'Item',
              variable: { isDerived: false }
            }
          ],
          issues: [],
          fallbacks: [],
          byLogicalKey: new Map()
        })
      }
    });
    const result = await (
      service as never as {
        buildColumns: (
          workspaceId: number,
          selection: Array<{ unitId: string; itemId: string }>
        ) => Promise<{
          columns: unknown[];
          issues: Array<{ code: string; message: string }>;
        }>;
      }
    ).buildColumns(7, [{ unitId: 'UNIT1', itemId: 'UNKNOWN' }]);

    expect(result.columns).toHaveLength(0);
    expect(result.issues).toContainEqual({
      code: 'unknown-selection',
      message:
        "Ausgewähltes Item 'UNIT1\u001FUNKNOWN' konnte nicht eindeutig zugeordnet werden",
      unitId: 'UNIT1',
      itemId: 'UNKNOWN'
    });
  });

  it('rejects profiles with an absent score property', async () => {
    const service = createService({
      missingsProfilesService: {
        getMissingsProfileDetails: jest.fn().mockResolvedValue({
          parseMissings: () => [
            ...missingEntries.filter(entry => entry.id !== 'mbd'),
            { id: 'mbd', label: 'by design', code: -85 }
          ]
        })
      }
    });

    await expect(
      (
        service as never as {
          loadAndValidateProfile: (
            workspaceId: number,
            profileId: number
          ) => Promise<unknown>;
        }
      ).loadAndValidateProfile(7, 4)
    ).rejects.toThrow("Missing 'mbd' in Profil 4 hat kein score-Property");
  });

  it('rejects profiles without all required missing IDs', async () => {
    const service = createService({
      missingsProfilesService: {
        getMissingsProfileDetails: jest.fn().mockResolvedValue({
          parseMissings: () => missingEntries.filter(entry => entry.id !== 'mnr')
        })
      }
    });

    await expect(
      (
        service as never as {
          loadAndValidateProfile: (
            workspaceId: number,
            profileId: number
          ) => Promise<unknown>;
        }
      ).loadAndValidateProfile(7, 4)
    ).rejects.toThrow('Missing-Profil 4 enthält nicht: mnr');
  });

  it('checks cancellation while resolving large item rows', async () => {
    const service = createService();
    const columns = Array.from({ length: 101 }, (_, index) => (
      column(String(index + 1))
    ));
    Object.defineProperty(columns[100], 'key', {
      get: () => {
        throw new Error('cell resolution continued past its checkpoint');
      }
    });
    const context = {
      rows: [
        {
          bookletId: 10,
          bookletName: 'BOOKLET-1',
          personLogin: 'login-1',
          personCode: 'code-1',
          personGroup: 'group-1'
        }
      ],
      columns,
      analysisColumns: columns,
      bookletDesigns: new Map([
        [
          'BOOKLET-1',
          {
            units: new Map([
              [
                'UNIT1',
                {
                  unitId: 'UNIT1',
                  order: 0,
                  testletKey: '0:T1'
                }
              ]
            ])
          }
        ]
      ]),
      profile,
      derivedSources: new Map()
    };
    (
      service as never as { getResponseValuesForRows: jest.Mock }
    ).getResponseValuesForRows = jest.fn().mockResolvedValue(new Map());
    const cancellationError = new Error('cancelled');
    const checkCancellation = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(cancellationError);

    const consumeRows = async (): Promise<unknown[]> => {
      const rows = (
        service as never as {
          resolveRows: (
            workspaceId: number,
            contextValue: unknown,
            requestedValue: 'code' | 'score',
            version: 'v1' | 'v2' | 'v3',
            configValue: ItemMatrixExportConfiguration,
            progressCallback: undefined,
            cancellationCheck: () => Promise<void>
          ) => AsyncGenerator<unknown>;
        }
      ).resolveRows(
        7,
        context,
        'code',
        'v2',
        configuration,
        undefined,
        checkCancellation
      );
      const resolved = [];
      for await (const row of rows) {
        resolved.push(row);
      }
      return resolved;
    };

    await expect(consumeRows()).rejects.toBe(cancellationError);
    expect(checkCancellation).toHaveBeenCalledTimes(3);
  });

  it('checks cancellation while indexing large response batches', async () => {
    const responses = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      bookletId: 10,
      bookletName: 'BOOKLET-1',
      unitName: 'UNIT1',
      variableId: 'VAR1',
      status: 5,
      codeV1: 1,
      scoreV1: 1,
      codeV2: 1,
      scoreV2: 1,
      codeV3: 1,
      scoreV3: 1
    }));
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(responses)
    };
    const service = createService({
      responseRepository: {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
      },
      workspaceFilesService: {
        getUnitVariableMap: jest.fn().mockResolvedValue(
          new Map([['UNIT1', new Set(['VAR1'])]])
        )
      }
    });
    const checkCancellation = jest.fn().mockResolvedValue(undefined);

    await (
      service as never as {
        getResponseValuesForRows: (
          workspaceId: number,
          rows: Array<{ bookletId: number }>,
          version: 'v1' | 'v2' | 'v3',
          cancellationCheck: () => Promise<void>
        ) => Promise<unknown>;
      }
    ).getResponseValuesForRows(
      7,
      [{ bookletId: 10 }],
      'v2',
      checkCancellation
    );

    expect(checkCancellation).toHaveBeenCalledTimes(4);
  });

  it('loads ordered units and testlet boundaries from booklet XML', async () => {
    const repository = {
      find: jest.fn().mockResolvedValue([
        {
          file_id: 'Booklet-1',
          data:
            '<Booklet><Testlet id="T1"><Unit id="UNIT1"/></Testlet>' +
            '<Testlet id="T2"><Unit id="UNIT2.xml"/></Testlet></Booklet>'
        }
      ])
    };
    const service = createService({ fileUploadRepository: repository });
    const designs = await (
      service as never as {
        getBookletDesigns: (workspaceId: number) => Promise<
        Map<
        string,
        {
          units: Map<string, { order: number; testletKey: string }>;
        }
        >
        >;
      }
    ).getBookletDesigns(7);

    expect(designs.get('BOOKLET-1')?.units.get('UNIT1')).toMatchObject({
      order: 0,
      testletKey: '0:T1'
    });
    expect(designs.get('BOOKLET-1')?.units.get('UNIT2')).toMatchObject({
      order: 1,
      testletKey: '1:T2'
    });
    expect(repository.find).toHaveBeenCalledWith({
      where: { workspace_id: 7, file_type: 'Booklet' },
      select: ['file_id', 'data'],
      order: { file_id: 'ASC' }
    });
  });

  it('removes testlet-specific exclusions from the effective booklet design', async () => {
    const repository = {
      find: jest.fn().mockResolvedValue([
        {
          file_id: 'Booklet-1',
          data:
            '<Booklet><Testlet id="T1"><Unit id="UNIT1"/></Testlet>' +
            '<Testlet id="T2"><Unit id="UNIT2"/></Testlet></Booklet>'
        }
      ])
    };
    const service = createService({
      fileUploadRepository: repository,
      workspaceExclusionService: {
        resolveExclusionsForQueries: jest.fn().mockResolvedValue({
          globalIgnoredUnits: [],
          ignoredBooklets: [],
          testletIgnoredUnits: [
            { bookletId: 'BOOKLET-1', unitId: 'UNIT1' }
          ]
        })
      }
    });
    const designs = await (
      service as never as {
        getBookletDesigns: (workspaceId: number) => Promise<
        Map<string, { units: Map<string, unknown> }>
        >;
      }
    ).getBookletDesigns(7);

    expect(designs.get('BOOKLET-1')?.units.has('UNIT1')).toBe(false);
    expect(designs.get('BOOKLET-1')?.units.has('UNIT2')).toBe(true);
  });
});
