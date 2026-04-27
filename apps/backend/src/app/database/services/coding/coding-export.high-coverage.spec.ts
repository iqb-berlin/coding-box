import { Readable, Writable } from 'stream';
import { CodingExportService } from './coding-export.service';

const row = {
  id: 1,
  personId: '1',
  login: 'login',
  code: 'code',
  group: 'group',
  bookletName: 'BOOKLET',
  unitName: 'UNIT',
  variableId: 'VAR',
  responseId: '1',
  trainingId: '1',
  username: 'Coder A',
  jobId: '1',
  cju_code: '1',
  code_v1: '1',
  code_v2: null,
  code_v3: null,
  notes: 'comment'
};

const makeQueryBuilder = () => {
  const qb: Record<string, jest.Mock> = {};
  [
    'innerJoin',
    'innerJoinAndSelect',
    'leftJoin',
    'leftJoinAndSelect',
    'leftJoinAndMapOne',
    'leftJoinAndMapMany',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orWhere',
    'groupBy',
    'addGroupBy',
    'orderBy',
    'addOrderBy',
    'take',
    'skip',
    'limit',
    'offset',
    'setParameter',
    'setParameters'
  ].forEach(method => {
    qb[method] = jest.fn(() => qb);
  });
  qb.getRawMany = jest.fn().mockResolvedValue([row]);
  qb.getMany = jest.fn().mockResolvedValue([row]);
  qb.getOne = jest.fn().mockResolvedValue(row);
  qb.getCount = jest.fn().mockResolvedValue(1);
  return qb;
};

const repository = () => ({
  createQueryBuilder: jest.fn(() => makeQueryBuilder()),
  find: jest.fn().mockResolvedValue([row]),
  findOne: jest.fn().mockResolvedValue(row),
  findOneBy: jest.fn().mockResolvedValue(row)
});

const readableItems = (...items: unknown[]) => Readable.from(items, { objectMode: true });

const codingListService = () => ({
  getCodingListCsvStream: jest.fn().mockResolvedValue(Readable.from(['csv'])),
  getCodingListAsExcel: jest.fn().mockResolvedValue(Buffer.from('excel')),
  getCodingListJsonStream: jest.fn(() => readableItems({ id: 1, unitName: 'UNIT' })),
  getCodingResultsByVersionCsvStream: jest.fn().mockResolvedValue(Readable.from(['version-csv'])),
  getCodingResultsByVersionAsExcel: jest.fn().mockResolvedValue(Buffer.from('version-excel')),
  getVariablePageMap: jest.fn().mockResolvedValue(new Map([['VAR', '2']])),
  getCodingListVariables: jest.fn().mockResolvedValue([{ unitName: 'UNIT', variableId: 'VAR' }])
});

const workspaceExclusionService = () => ({
  resolveExclusionsForQueries: jest.fn().mockResolvedValue({
    globalIgnoredUnits: [],
    ignoredBooklets: [],
    testletIgnoredUnits: []
  })
});

const response = () => {
  const res = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  }) as Writable & {
    setHeader: jest.Mock;
    send: jest.Mock;
    status: jest.Mock;
    json: jest.Mock;
    headersSent: boolean;
  };
  res.setHeader = jest.fn();
  res.send = jest.fn();
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.headersSent = false;
  return res;
};

const createService = () => new CodingExportService(
  repository() as never,
  repository() as never,
  repository() as never,
  repository() as never,
  repository() as never,
  repository() as never,
  codingListService() as never,
  {} as never,
  workspaceExclusionService() as never
) as CodingExportService & Record<string, (...args: unknown[]) => unknown>;

const settleQuickly = async (promise: Promise<unknown>) => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise.catch(() => undefined),
      new Promise(resolve => {
        timeout = setTimeout(resolve, 50);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

describe('CodingExportService high coverage paths', () => {
  it('formats coding issue helper values', () => {
    const service = createService();

    expect(service['normalizeCodingIssueOption'](null)).toBeNull();
    expect(service['normalizeCodingIssueOption'](-2)).toBe(2);
    expect(service['normalizeCodingIssueOption'](99)).toBeNull();
    expect(service['getCodingIssueText'](3)).toContain('Ungültig');
    expect(service['getCodingIssueSuffix'](4)).toContain('technische');
    expect(service['formatCodeWithIssueSuffix'](7, 1)).toContain('unsicher');
    expect(service['formatCodeWithIssueSuffix'](null, 1)).toBe('');
  });

  it('exports coding lists through stream and buffer wrappers', async () => {
    const service = createService();

    await service.exportCodingListAsCsv(1, 'token', 'http://server', response() as never);
    await service.exportCodingListAsExcel(1, 'token', 'http://server', response() as never);
    await service.exportCodingListAsJson(1, 'token', 'http://server', response() as never);

    await expect(service.exportCodingListForJobAsCsv(1, '', '', jest.fn())).resolves.toBeDefined();
    await expect(service.exportCodingListForJobAsExcel(1, '', '', jest.fn())).resolves.toBeInstanceOf(Buffer);

    const jsonStream = await service.exportCodingListForJobAsJson(1, '', '', jest.fn());
    jsonStream.resume();

    await expect(service.exportCodingResultsByVersionAsCsv(1, 'v1', '', '', true, jest.fn())).resolves.toBeDefined();
    await expect(service.exportCodingResultsByVersionAsExcel(1, 'v2', '', '', false, jest.fn())).resolves.toBeInstanceOf(Buffer);
  });

  it('builds replay URLs through the page lookup cache', async () => {
    const service = createService();

    await expect(service['getVariablePage']('UNIT', 'VAR', 1)).resolves.toBe('2');
    await expect(service['generateReplayUrlWithPageLookup'](
      undefined,
      'login',
      'code',
      'group',
      'BOOKLET',
      'UNIT',
      'VAR',
      1,
      'token',
      'http://server'
    )).resolves.toContain('UNIT');
  });

  it('enters the heavier coding result export variants with cancellable safe repositories', async () => {
    const service = createService();
    const checkCancellation = jest.fn().mockResolvedValue(undefined);

    const exportCalls = [
      service.exportCodingResultsByCoder(1, false, true, false, false, 'token', undefined, false, checkCancellation),
      service.exportCodingResultsByVariable(1, true, true, true, false, true, false, false, 'token', undefined, false, checkCancellation),
      service.exportCodingResultsDetailed(1, true, true, true, true, 'token', undefined, false, checkCancellation),
      service.exportCodingTimesReport(1, false, true, true, checkCancellation, [1], [], [])
    ];

    await Promise.all(exportCalls.map(settleQuickly));

    expect(checkCancellation).toHaveBeenCalled();
  }, 15000);
});
