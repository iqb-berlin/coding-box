import { CodingItemMatrixExportService } from './coding-item-matrix-export.service';

const collectStream = (stream: NodeJS.ReadableStream): Promise<string> => (
  new Promise((resolve, reject) => {
    let output = '';
    stream.on('data', chunk => {
      output += chunk.toString();
    });
    stream.on('end', () => resolve(output));
    stream.on('error', reject);
  })
);

describe('CodingItemMatrixExportService', () => {
  const createService = (
    missingsProfilesService: {
      getMissingByIdForProfileOrDefault?: jest.Mock;
      getMissingByCodeForProfileOrDefault?: jest.Mock;
    } = {}
  ) => new CodingItemMatrixExportService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    missingsProfilesService as never
  );

  it('streams score matrix rows with stable metadata and item columns', async () => {
    const service = createService();
    (service as never as {
      buildMatrixContext: jest.Mock;
      getResponseValuesForRows: jest.Mock;
    }).buildMatrixContext = jest.fn().mockResolvedValue({
      rows: [{
        bookletId: 10,
        bookletName: 'BOOKLET-1',
        personLogin: 'login-1',
        personCode: 'code-1',
        personGroup: 'group-1'
      }],
      columns: [{
        key: 'UNIT1\u001FVAR1',
        header: 'Alias1__VAR1',
        unitName: 'UNIT1',
        variableId: 'VAR1'
      }]
    });
    (service as never as { getResponseValuesForRows: jest.Mock }).getResponseValuesForRows =
      jest.fn().mockResolvedValue(new Map([
        [10, new Map([['UNIT1\u001FVAR1', { code: 3, score: 2 }]])]
      ]));

    const output = await collectStream(service.exportItemMatrixAsCsvStream(7, 'score', 'v2'));

    expect(output).toContain('person_login;person_code;person_group;booklet_name;Alias1__VAR1');
    expect(output).toContain('login-1;code-1;group-1;BOOKLET-1;2');
  });

  it('maps internal manual missing codes through the missing profile', async () => {
    const missingsProfilesService = {
      getMissingByIdForProfileOrDefault: jest.fn().mockResolvedValue({
        id: 'mir',
        label: 'missing invalid response',
        code: -98,
        score: null
      })
    };
    const service = createService(missingsProfilesService);
    (service as never as {
      buildMatrixContext: jest.Mock;
      getResponseValuesForRows: jest.Mock;
    }).buildMatrixContext = jest.fn().mockResolvedValue({
      rows: [{
        bookletId: 11,
        bookletName: 'BOOKLET-1',
        personLogin: 'login-1',
        personCode: 'code-1',
        personGroup: 'group-1'
      }],
      columns: [{
        key: 'UNIT1\u001FVAR1',
        header: 'UNIT1__VAR1',
        unitName: 'UNIT1',
        variableId: 'VAR1'
      }]
    });
    (service as never as { getResponseValuesForRows: jest.Mock }).getResponseValuesForRows =
      jest.fn().mockResolvedValue(new Map([
        [11, new Map([['UNIT1\u001FVAR1', { code: -3, score: null }]])]
      ]));

    const output = await collectStream(service.exportItemMatrixAsCsvStream(7, 'code', 'v2'));
    const scoreOutput = await collectStream(service.exportItemMatrixAsCsvStream(7, 'score', 'v2'));

    expect(output).toContain('login-1;code-1;group-1;BOOKLET-1;-98');
    expect(scoreOutput).toContain('login-1;code-1;group-1;BOOKLET-1;NA');
    expect(missingsProfilesService.getMissingByIdForProfileOrDefault)
      .toHaveBeenCalledWith(7, null, 'mir');
  });

  it('exports existing concrete missing codes without resolving them through the default profile', async () => {
    const missingsProfilesService = {
      getMissingByIdForProfileOrDefault: jest.fn(),
      getMissingByCodeForProfileOrDefault: jest.fn()
    };
    const service = createService(missingsProfilesService);
    (service as never as {
      buildMatrixContext: jest.Mock;
      getResponseValuesForRows: jest.Mock;
    }).buildMatrixContext = jest.fn().mockResolvedValue({
      rows: [{
        bookletId: 12,
        bookletName: 'BOOKLET-1',
        personLogin: 'login-1',
        personCode: 'code-1',
        personGroup: 'group-1'
      }],
      columns: [{
        key: 'UNIT1\u001FVAR1',
        header: 'UNIT1__VAR1',
        unitName: 'UNIT1',
        variableId: 'VAR1'
      }]
    });
    (service as never as { getResponseValuesForRows: jest.Mock }).getResponseValuesForRows =
      jest.fn().mockResolvedValue(new Map([
        [12, new Map([['UNIT1\u001FVAR1', { code: -96, score: null }]])]
      ]));

    const codeOutput = await collectStream(service.exportItemMatrixAsCsvStream(7, 'code', 'v2'));
    const scoreOutput = await collectStream(service.exportItemMatrixAsCsvStream(7, 'score', 'v2'));

    expect(codeOutput).toContain('login-1;code-1;group-1;BOOKLET-1;-96');
    expect(scoreOutput).toContain('login-1;code-1;group-1;BOOKLET-1;NA');
    expect(missingsProfilesService.getMissingByIdForProfileOrDefault).not.toHaveBeenCalled();
    expect(missingsProfilesService.getMissingByCodeForProfileOrDefault).not.toHaveBeenCalled();
  });

  it('falls back to the unit key when aliases differ for the same unit', async () => {
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { unitName: 'UNIT1', unitAlias: 'AliasA' },
        { unitName: 'UNIT1', unitAlias: 'AliasB' },
        { unitName: 'UNIT2', unitAlias: 'AliasC' }
      ])
    };
    const unitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
    };
    const workspaceFilesService = {
      getUnitVariableMap: jest.fn().mockResolvedValue(new Map([
        ['UNIT1', new Set(['VAR1'])],
        ['UNIT2', new Set(['VAR1'])]
      ]))
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const service = new CodingItemMatrixExportService(
      {} as never,
      {} as never,
      unitRepository as never,
      workspaceFilesService as never,
      workspaceExclusionService as never
    );

    const columns = await (service as never as {
      getColumns: (workspaceId: number) => Promise<Array<{ header: string }>>;
    }).getColumns(7);

    expect(columns.map(column => column.header)).toEqual([
      'UNIT1__VAR1',
      'AliasC__VAR1'
    ]);
  });

  it('does not create matrix columns for globally excluded units', async () => {
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([])
    };
    const unitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
    };
    const workspaceFilesService = {
      getUnitVariableMap: jest.fn().mockResolvedValue(new Map([
        ['UNIT1', new Set(['VAR1'])],
        ['UNIT2', new Set(['VAR2'])]
      ]))
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: ['UNIT1'],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const service = new CodingItemMatrixExportService(
      {} as never,
      {} as never,
      unitRepository as never,
      workspaceFilesService as never,
      workspaceExclusionService as never
    );

    const columns = await (service as never as {
      getColumns: (workspaceId: number) => Promise<Array<{ header: string }>>;
    }).getColumns(7);

    expect(columns.map(column => column.header)).toEqual(['UNIT2__VAR2']);
  });
});
