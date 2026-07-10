import * as ExcelJS from 'exceljs';
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
      }],
      bookletUnits: new Map([['BOOKLET-1', new Set(['UNIT1'])]]),
      mbdMissing: {
        id: 'mbd', label: 'missing by design', code: -94, score: null
      }
    });
    (service as never as { getResponseValuesForRows: jest.Mock }).getResponseValuesForRows =
      jest.fn().mockResolvedValue(new Map([
        [10, new Map([['UNIT1\u001FVAR1', { code: 3, score: 2 }]])]
      ]));

    const output = await collectStream(service.exportItemMatrixAsCsvStream(7, 'score', 'v2'));

    expect(output).toContain('person_login;person_code;person_group;booklet_name;Alias1__VAR1');
    expect(output).toContain('login-1;code-1;group-1;BOOKLET-1;2');
  });

  it('exports mbd only for units outside the row booklet in code and score matrices', async () => {
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
      columns: [
        {
          key: 'UNIT1\u001FVAR1',
          header: 'UNIT1__VAR1',
          unitName: 'UNIT1',
          variableId: 'VAR1'
        },
        {
          key: 'UNIT2\u001FVAR1',
          header: 'UNIT2__VAR1',
          unitName: 'UNIT2',
          variableId: 'VAR1'
        }
      ],
      bookletUnits: new Map([['BOOKLET-1', new Set(['UNIT1'])]]),
      mbdMissing: {
        id: 'mbd', label: 'missing by design', code: -94, score: null
      }
    });
    (service as never as { getResponseValuesForRows: jest.Mock }).getResponseValuesForRows =
      jest.fn().mockResolvedValue(new Map());

    const codeOutput = await collectStream(service.exportItemMatrixAsCsvStream(7, 'code'));
    const scoreOutput = await collectStream(service.exportItemMatrixAsCsvStream(7, 'score'));
    const excelBuffer = await service.exportItemMatrixAsExcel(7, 'score');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelBuffer);
    const excelRow = workbook.getWorksheet('Itemmatrix')!.getRow(2);

    expect(codeOutput).toContain('login-1;code-1;group-1;BOOKLET-1;;-94');
    expect(scoreOutput).toContain('login-1;code-1;group-1;BOOKLET-1;;NA');
    expect(excelRow.getCell(5).value).toBeNull();
    expect(excelRow.getCell(6).value).toBe('NA');
  });

  it('loads and normalizes expected units from booklet XML', async () => {
    const fileUploadRepository = {
      find: jest.fn().mockResolvedValue([{
        file_id: 'Booklet-1',
        data: '<Booklet><Testlet><Unit id="unit1.xml"/><Unit id="UNIT2"/></Testlet></Booklet>'
      }])
    };
    const service = new CodingItemMatrixExportService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      fileUploadRepository as never
    );

    const bookletUnits = await (service as never as {
      getBookletUnits: (workspaceId: number) => Promise<Map<string, Set<string>>>;
    }).getBookletUnits(7);

    expect(fileUploadRepository.find).toHaveBeenCalledWith({
      where: { workspace_id: 7, file_type: 'Booklet' },
      select: ['file_id', 'data']
    });
    expect(bookletUnits.get('BOOKLET-1')).toEqual(new Set(['UNIT1', 'UNIT2']));
  });

  it('fails before matrix creation when mbd is missing from the profile', async () => {
    const missingsProfilesService = {
      getMissingByIdForProfileOrDefault: jest.fn().mockRejectedValue(
        new Error("Missing 'mbd' not found in profile 3")
      )
    };
    const service = createService(missingsProfilesService);
    (service as never as {
      getRows: jest.Mock;
      getColumns: jest.Mock;
      getBookletUnits: jest.Mock;
    }).getRows = jest.fn().mockResolvedValue([]);
    (service as never as { getColumns: jest.Mock }).getColumns = jest.fn().mockResolvedValue([]);
    (service as never as { getBookletUnits: jest.Mock }).getBookletUnits =
      jest.fn().mockResolvedValue(new Map());

    await expect((service as never as {
      buildMatrixContext: (workspaceId: number) => Promise<unknown>;
    }).buildMatrixContext(7)).rejects.toThrow("Missing 'mbd' not found in profile 3");
    expect(missingsProfilesService.getMissingByIdForProfileOrDefault)
      .toHaveBeenCalledWith(7, null, 'mbd');
  });

  it('checks cancellation before writing item matrix rows', async () => {
    const service = createService();
    const cancellationError = new Error('cancelled');
    const checkCancellation = jest.fn().mockRejectedValue(cancellationError);
    const buildMatrixContext = jest.fn(async (
      _workspaceId: number,
      passedCheckCancellation?: () => Promise<void>
    ) => {
      await passedCheckCancellation?.();
      return {
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
      };
    });
    const getResponseValuesForRows = jest.fn();
    (service as never as {
      buildMatrixContext: typeof buildMatrixContext;
      getResponseValuesForRows: typeof getResponseValuesForRows;
    }).buildMatrixContext = buildMatrixContext;
    (service as never as {
      getResponseValuesForRows: typeof getResponseValuesForRows;
    }).getResponseValuesForRows = getResponseValuesForRows;

    await expect(collectStream(
      service.exportItemMatrixAsCsvStream(7, 'score', 'v2', undefined, checkCancellation)
    )).rejects.toThrow('cancelled');

    expect(buildMatrixContext).toHaveBeenCalledWith(7, checkCancellation);
    expect(getResponseValuesForRows).not.toHaveBeenCalled();
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
      }],
      bookletUnits: new Map([['BOOKLET-1', new Set(['UNIT1'])]]),
      mbdMissing: {
        id: 'mbd', label: 'missing by design', code: -94, score: null
      }
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
      }],
      bookletUnits: new Map([['BOOKLET-1', new Set(['UNIT1'])]]),
      mbdMissing: {
        id: 'mbd', label: 'missing by design', code: -94, score: null
      }
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

  it('loads item-matrix response values with raw selects instead of hydrated entities', async () => {
    const responseQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{
        id: '1',
        bookletId: '10',
        bookletName: 'BOOKLET-1',
        unitName: 'UNIT1',
        variableId: 'VAR1',
        codeV1: null,
        scoreV1: null,
        codeV2: '4',
        scoreV2: '2',
        codeV3: null,
        scoreV3: null
      }])
    };
    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(responseQueryBuilder)
    };
    const workspaceFilesService = {
      getUnitVariableMap: jest.fn().mockResolvedValue(new Map([
        ['UNIT1', new Set(['VAR1'])]
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
      responseRepository as never,
      {} as never,
      {} as never,
      workspaceFilesService as never,
      workspaceExclusionService as never
    );

    const values = await (service as never as {
      getResponseValuesForRows: (
        workspaceId: number,
        rows: Array<{
          bookletId: number;
          bookletName: string;
          personLogin: string;
          personCode: string;
          personGroup: string;
        }>,
        version: 'v1' | 'v2' | 'v3'
      ) => Promise<Map<number, Map<string, { code: number | null; score: number | null }>>>;
    }).getResponseValuesForRows(
      7,
      [{
        bookletId: 10,
        bookletName: 'BOOKLET-1',
        personLogin: 'login-1',
        personCode: 'code-1',
        personGroup: 'group-1'
      }],
      'v2'
    );

    expect(responseQueryBuilder.innerJoin).toHaveBeenCalledWith('response.unit', 'unit');
    expect(responseQueryBuilder.innerJoin).toHaveBeenCalledWith('unit.booklet', 'booklet');
    expect(responseQueryBuilder.innerJoin).toHaveBeenCalledWith('booklet.bookletinfo', 'bookletinfo');
    expect(responseQueryBuilder.getRawMany).toHaveBeenCalled();
    expect(values.get(10)?.get('UNIT1\u001FVAR1')).toEqual({ code: 4, score: 2 });
  });
});
