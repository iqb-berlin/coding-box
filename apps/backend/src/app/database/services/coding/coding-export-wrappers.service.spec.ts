import { PassThrough, Readable, Writable } from 'stream';
import { finished } from 'stream/promises';
import { CodingExportService } from './coding-export.service';

jest.mock('./coding-list.service', () => ({
  CodingListService: function MockCodingListService() {}
}));
jest.mock('../workspace/workspace-core.service', () => ({
  WorkspaceCoreService: function MockWorkspaceCoreService() {}
}));

const createService = () => {
  const codingListService = {
    getCodingListCsvStream: jest.fn(),
    getCodingListAsExcel: jest.fn(),
    writeCodingListExcelToFile: jest.fn(),
    getCodingListJsonStream: jest.fn(),
    getCodingResultsByVersionCsvStream: jest.fn(),
    getCodingResultsByVersionAsExcel: jest.fn(),
    getVariablePageMap: jest.fn().mockResolvedValue(new Map([['VAR', '2']]))
  };
  const repositories = Array.from({ length: 6 }, () => ({ createQueryBuilder: jest.fn() }));
  const workspaceExclusionService = {
    resolveExclusionsForQueries: jest.fn()
  };
  const service = new CodingExportService(
    repositories[0] as never,
    repositories[1] as never,
    repositories[2] as never,
    repositories[3] as never,
    repositories[4] as never,
    repositories[5] as never,
    codingListService as never,
    {} as never,
    workspaceExclusionService as never
  );

  return {
    service, codingListService, repositories, workspaceExclusionService
  };
};

const collectStream = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const createResponse = () => {
  const chunks: Buffer[] = [];
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  }) as Writable & {
    setHeader: jest.Mock;
    send: jest.Mock;
    status: jest.Mock;
    json: jest.Mock;
    headersSent: boolean;
  };
  response.setHeader = jest.fn();
  response.send = jest.fn();
  response.status = jest.fn(() => response);
  response.json = jest.fn(() => response);
  response.headersSent = false;

  return { response, text: () => Buffer.concat(chunks).toString('utf8') };
};

type ReplayLinkInternals = {
  getVariablePage: (unitName: string, variableId: string, workspaceId: number) => Promise<string>;
  generateReplayUrlWithPageLookup: (
    req: undefined, login: string, code: string, group: string, bookletName: string,
    unitName: string, variableId: string, workspaceId: number, token: string, baseUrl: string
  ) => Promise<string>;
};

type CodingIssueInternals = {
  normalizeCodingIssueOption: (option: number | null) => number | null;
  getCodingIssueText: (issue: number) => string;
  getCodingIssueSuffix: (issue: number) => string;
  formatCodeWithIssueSuffix: (code: number | null, issue: number | null) => string;
};

describe('CodingExportService wrappers and replay links', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('formats coding issue labels and suppresses invalid issue options', () => {
    const { service } = createService();
    const issues = service as unknown as CodingIssueInternals;

    expect(issues.normalizeCodingIssueOption(null)).toBeNull();
    expect(issues.normalizeCodingIssueOption(-2)).toBe(2);
    expect(issues.normalizeCodingIssueOption(99)).toBeNull();
    expect(issues.getCodingIssueText(3)).toBe('Ungültig (Spaßantwort)');
    expect(issues.getCodingIssueSuffix(4)).toBe('technische Probleme');
    expect(issues.formatCodeWithIssueSuffix(7, 1)).toBe('7 (unsicher)');
    expect(issues.formatCodeWithIssueSuffix(null, 1)).toBe('');
  });

  it('streams the complete CSV with its UTF-8 BOM and attachment headers', async () => {
    const { service, codingListService } = createService();
    const csv = 'unit;variable\r\nUNIT;VAR\r\n';
    codingListService.getCodingListCsvStream.mockResolvedValue(Readable.from([csv]));
    const { response, text } = createResponse();
    const completed = finished(response);

    await service.exportCodingListAsCsv(7, 'token', 'http://server', response as never);
    await completed;

    expect(text()).toBe(`\uFEFF${csv}`);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition', expect.stringMatching(/^attachment; filename="coding-list-\d{4}-\d{2}-\d{2}\.csv"$/)
    );
    expect(codingListService.getCodingListCsvStream).toHaveBeenCalledWith(7, 'token', 'http://server');
  });

  it('sends the generated Excel buffer with its download content type', async () => {
    const { service, codingListService } = createService();
    const workbook = Buffer.from('generated-workbook');
    codingListService.getCodingListAsExcel.mockResolvedValue(workbook);
    const { response } = createResponse();

    await service.exportCodingListAsExcel(7, '', '', response as never);

    expect(response.send).toHaveBeenCalledWith(workbook);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(codingListService.getCodingListAsExcel).toHaveBeenCalledWith(7, '', '');
  });

  it.each([
    { items: [] },
    { items: [{ id: 1, unitName: 'UNIT' }, { id: 2, unitName: 'UNIT-2' }] }
  ])(
    'finishes direct JSON downloads as a complete array for %j',
    async ({ items }) => {
      const { service, codingListService } = createService();
      codingListService.getCodingListJsonStream.mockReturnValue(Readable.from(items, { objectMode: true }));
      const { response, text } = createResponse();
      const completed = finished(response);

      await service.exportCodingListAsJson(7, 'token', 'http://server', response as never);
      await completed;

      expect(text()).toBe(JSON.stringify(items));
      expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(codingListService.getCodingListJsonStream).toHaveBeenCalledWith(7, 'token', 'http://server');
    }
  );

  it.each([false, true])('handles direct JSON source errors when headersSent is %s', async headersSent => {
    const { service, codingListService } = createService();
    const source = new PassThrough({ objectMode: true });
    codingListService.getCodingListJsonStream.mockReturnValue(source);
    const { response } = createResponse();
    response.headersSent = headersSent;
    const endSpy = jest.spyOn(response, 'end');
    jest.spyOn(
      (service as unknown as { logger: { error: (message: string) => void } }).logger, 'error'
    ).mockImplementation(() => undefined);

    try {
      await service.exportCodingListAsJson(7, '', '', response as never);
      source.emit('error', new Error('source failed'));

      if (headersSent) {
        expect(endSpy).toHaveBeenCalledTimes(1);
        expect(response.status).not.toHaveBeenCalled();
        expect(response.json).not.toHaveBeenCalled();
      } else {
        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.json).toHaveBeenCalledWith({ error: 'Export failed' });
      }
    } finally {
      source.destroy();
      response.destroy();
    }
  });

  it('forwards training and cancellation options to queued CSV and Excel exports', async () => {
    const { service, codingListService } = createService();
    const progress = jest.fn().mockResolvedValue(undefined);
    const cancellation = jest.fn().mockResolvedValue(undefined);
    const csv = Readable.from(['complete-csv']);
    const workbook = Buffer.from('complete-workbook');
    codingListService.getCodingListCsvStream.mockResolvedValue(csv);
    codingListService.getCodingListAsExcel.mockResolvedValue(workbook);

    await expect(service.exportCodingListForJobAsCsv(7, 'token', 'http://server', progress, true, cancellation))
      .resolves.toBe(csv);
    await expect(collectStream(csv)).resolves.toBe('complete-csv');
    await expect(service.exportCodingListForJobAsExcel(7, 'token', 'http://server', progress, true, cancellation))
      .resolves.toBe(workbook);
    expect(codingListService.getCodingListCsvStream).toHaveBeenCalledWith(
      7, 'token', 'http://server', progress, true, cancellation
    );
    expect(codingListService.getCodingListAsExcel).toHaveBeenCalledWith(
      7, 'token', 'http://server', progress, true, cancellation
    );
  });

  it('fails a queued Excel file export with the original writer error', async () => {
    const { service, codingListService } = createService();
    const error = new Error('destination unavailable');
    const progress = jest.fn().mockResolvedValue(undefined);
    const cancellation = jest.fn().mockResolvedValue(undefined);
    codingListService.writeCodingListExcelToFile.mockRejectedValue(error);

    await expect(service.exportCodingListForJobAsExcelToFile(
      '/tmp/result.xlsx', 7, 'token', 'http://server', progress, true, cancellation
    )).rejects.toBe(error);
    expect(codingListService.writeCodingListExcelToFile).toHaveBeenCalledWith(
      '/tmp/result.xlsx', 7, 'token', 'http://server', progress, true, cancellation
    );
  });

  it.each([{ items: [] }, { items: [{ id: 1 }, { id: 2 }] }])('returns a complete queued JSON array for %j', async ({ items }) => {
    const { service, codingListService } = createService();
    const progress = jest.fn().mockResolvedValue(undefined);
    const cancellation = jest.fn().mockResolvedValue(undefined);
    codingListService.getCodingListJsonStream.mockReturnValue(Readable.from(items, { objectMode: true }));

    const output = await service.exportCodingListForJobAsJson(7, 'token', 'http://server', progress, true, cancellation);

    await expect(collectStream(output)).resolves.toBe(JSON.stringify(items));
    expect(codingListService.getCodingListJsonStream).toHaveBeenCalledWith(
      7, 'token', 'http://server', progress, true, cancellation
    );
  });

  it('propagates queued JSON source errors to the consumer', async () => {
    const { service, codingListService } = createService();
    const source = new PassThrough({ objectMode: true });
    codingListService.getCodingListJsonStream.mockReturnValue(source);
    const output = await service.exportCodingListForJobAsJson(7, '', '');
    const error = new Error('source failed');
    const result = collectStream(output);
    const rejected = expect(result).rejects.toBe(error);

    try {
      source.emit('error', error);
      await rejected;
    } finally {
      source.destroy();
      output.destroy();
    }
  });

  it('preserves the version, profile and response-value options for CSV and Excel exports', async () => {
    const { service, codingListService } = createService();
    const progress = jest.fn().mockResolvedValue(undefined);
    const csv = Readable.from(['versioned-csv']);
    const workbook = Buffer.from('versioned-workbook');
    codingListService.getCodingResultsByVersionCsvStream.mockResolvedValue(csv);
    codingListService.getCodingResultsByVersionAsExcel.mockResolvedValue(workbook);

    await expect(service.exportCodingResultsByVersionAsCsv(7, 'v3', 4, 'token', 'http://server', true, progress, false, true))
      .resolves.toBe(csv);
    await expect(collectStream(csv)).resolves.toBe('versioned-csv');
    await expect(service.exportCodingResultsByVersionAsExcel(7, 'v3', 4, 'token', 'http://server', true, progress, false, true))
      .resolves.toBe(workbook);
    expect(codingListService.getCodingResultsByVersionCsvStream).toHaveBeenCalledWith(
      7, 'v3', 4, 'token', 'http://server', true, progress, false, true, undefined
    );
    expect(codingListService.getCodingResultsByVersionAsExcel).toHaveBeenCalledWith(
      7, 'v3', 4, 'token', 'http://server', true, progress, false, true, undefined
    );
  });

  it('propagates CSV and Excel generation failures instead of completing successfully', async () => {
    const { service, codingListService } = createService();
    const error = new Error('generation failed');
    codingListService.getCodingListCsvStream.mockRejectedValue(error);
    codingListService.getCodingListAsExcel.mockRejectedValue(error);

    await expect(service.exportCodingListForJobAsCsv(7, '', '')).rejects.toBe(error);
    await expect(service.exportCodingListForJobAsExcel(7, '', '')).rejects.toBe(error);
  });

  it.each<[string, (service: CodingExportService, cancel: () => Promise<void>) => Promise<Buffer>]>([
    ['by coder', (service, cancel) => service.exportCodingResultsByCoder(7, false, false, false, false, '', undefined, false, cancel)],
    ['by variable', (service, cancel) => service.exportCodingResultsByVariable(7, false, false, false, false, false, false, false, '', undefined, false, cancel)],
    ['detailed', (service, cancel) => service.exportCodingResultsDetailed(7, false, false, false, false, '', undefined, false, cancel)],
    ['coding times', (service, cancel) => service.exportCodingTimesReport(7, false, false, false, cancel)]
  ])('rejects a cancelled %s export before querying its repositories', async (_variant, exportResult) => {
    const { service, repositories, workspaceExclusionService } = createService();
    const error = new Error('Export job job-7 was cancelled');
    const cancellation = jest.fn().mockRejectedValue(error);

    await expect(exportResult(service, cancellation)).rejects.toBe(error);
    expect(cancellation).toHaveBeenCalledTimes(1);
    repositories.forEach(repository => expect(repository.createQueryBuilder).not.toHaveBeenCalled());
    expect(workspaceExclusionService.resolveExclusionsForQueries).not.toHaveBeenCalled();
  });

  it('uses the cached page in replay URLs and reloads it when the workspace changes', async () => {
    const { service, codingListService } = createService();
    const replay = service as unknown as ReplayLinkInternals;
    codingListService.getVariablePageMap
      .mockResolvedValueOnce(new Map([['VAR', '2']]))
      .mockResolvedValueOnce(new Map([['VAR', '8']]));

    await expect(replay.generateReplayUrlWithPageLookup(
      undefined, 'login', 'code', 'group', 'BOOKLET', 'UNIT', 'VAR', 7, 'token', 'http://server'
    )).resolves.toBe('http://server/#/replay/login@code@group@BOOKLET/UNIT/2/VAR?auth=token');
    await expect(replay.getVariablePage('UNIT', 'VAR', 7)).resolves.toBe('2');
    await expect(replay.getVariablePage('UNIT', 'missing', 7)).resolves.toBe('0');
    expect(codingListService.getVariablePageMap).toHaveBeenCalledTimes(1);
    await expect(replay.getVariablePage('UNIT', 'VAR', 8)).resolves.toBe('8');
    expect(codingListService.getVariablePageMap).toHaveBeenNthCalledWith(2, 'UNIT', 8);
  });
});
