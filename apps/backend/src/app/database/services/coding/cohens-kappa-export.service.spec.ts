import * as ExcelJS from 'exceljs';
import { CohensKappaExportService } from './cohens-kappa-export.service';
import { KappaSourceItem, KappaStatisticsOptions, KappaStatisticsResponse } from './cohens-kappa.types';

const statistics: KappaStatisticsResponse = {
  variables: [],
  workspaceSummary: {
    totalCodedResponses: 0,
    totalDoubleCodedResponses: 0,
    totalCoderPairs: 0,
    averageKappa: null,
    meanAgreement: null,
    variablesIncluded: 0,
    codersIncluded: 0,
    weightingMethod: 'weighted',
    calculationLevel: 'code'
  }
};
const options: KappaStatisticsOptions = {
  weightedMean: true,
  excludeTrainings: true,
  jobDefinitionIds: [],
  coderTrainingIds: [],
  coderIds: [],
  calculationLevel: 'code'
};
const makeItem = (responseId: number, unitName = 'UNIT', variableId = 'VAR'): KappaSourceItem => ({
  responseId,
  unitName,
  variableId,
  variableAnchor: '',
  personLogin: '=person',
  personCode: 'secret',
  personGroup: 'GROUP',
  bookletName: 'BOOKLET',
  coderResults: [{
    coderId: 1,
    coderName: 'Coder',
    jobId: 10,
    jobName: 'Job',
    code: 0,
    score: 0,
    notes: 'note',
    codedAt: new Date('2026-01-01T00:00:00.000Z')
  }]
});
const loadWorkbook = async (buffer: Buffer): Promise<ExcelJS.Workbook> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
};

describe('CohensKappaExportService', () => {
  const replay = { generateReplayUrlsForItemsBulk: jest.fn() };
  let service: CohensKappaExportService;

  beforeEach(() => {
    replay.generateReplayUrlsForItemsBulk.mockReset();
    service = new CohensKappaExportService(replay as never);
  });

  it('writes header-only CSVs with the UTF-8 BOM for an empty scope', async () => {
    expect(await service.createSummaryCsv(statistics)).toBe('\uFEFFsubunit;nCases;nDop;percDop;meankappa;meanagree');
    const details = await service.createDetailsCsv(statistics, options);
    expect(details.startsWith('\uFEFFVariable;Unit;Variablen-ID;')).toBe(true);
    expect(details.endsWith('Unit-Filter;Variablen-Filter;Exportiert am')).toBe(true);
    expect(details.split('\n')).toHaveLength(1);
  });

  it('writes all three styled sheets without looking up replay URLs for an empty scope', async () => {
    const workbook = await loadWorkbook(await service.createWorkbook(5, statistics, [], {
      serverUrl: 'https://example.test', authToken: 'token'
    }));

    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      'Übereinstimmung_gesamt', 'Übereinstimmung_paarweise', 'Kodierergebnisse'
    ]);
    workbook.worksheets.forEach(sheet => {
      expect(sheet.actualRowCount).toBe(1);
      expect(sheet.getRow(1).font).toMatchObject({ bold: true });
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(sheet.autoFilter).toBeDefined();
    });
    expect(replay.generateReplayUrlsForItemsBulk).not.toHaveBeenCalled();
  });

  it('maps bulk replay results by the full item identity even when reordered', async () => {
    const items = [makeItem(1), makeItem(2), makeItem(1, 'OTHER'), makeItem(1, 'UNIT', 'OTHER')];
    replay.generateReplayUrlsForItemsBulk.mockResolvedValue([
      {
        responseId: 1, unitName: 'UNIT', variableId: 'OTHER', replayUrl: 'https://example.test/fourth'
      },
      {
        responseId: 1, unitName: 'OTHER', variableId: 'VAR', replayUrl: 'https://example.test/third'
      },
      {
        responseId: 2, unitName: 'UNIT', variableId: 'VAR', replayUrl: 'https://example.test/second'
      },
      {
        responseId: 1, unitName: 'UNIT', variableId: 'VAR', replayUrl: 'https://example.test/first'
      }
    ]);

    const workbook = await loadWorkbook(await service.createWorkbook(5, statistics, items, {
      serverUrl: 'https://example.test', authToken: 'export-token'
    }));
    const sheet = workbook.getWorksheet('Kodierergebnisse')!;

    expect([2, 3, 4, 5].map(row => sheet.getRow(row).getCell(6).value)).toEqual([
      'https://example.test/first', 'https://example.test/second',
      'https://example.test/third', 'https://example.test/fourth'
    ]);
    expect(sheet.getRow(2).getCell(1).value).toBe("'=person");
    expect(sheet.getRow(2).getCell(7).value).toBe(0);
    expect(sheet.getRow(2).getCell(8).value).toBe(0);
    expect(replay.generateReplayUrlsForItemsBulk).toHaveBeenCalledWith(5,
      expect.arrayContaining([expect.objectContaining({ responseId: 1, variableAnchor: 'VAR' })]),
      'https://example.test',
      'export-token');
  });

  it('keeps empty replay cells when no server URL is available', async () => {
    const workbook = await loadWorkbook(await service.createWorkbook(5, statistics, [makeItem(1)], {
      serverUrl: '', authToken: ''
    }));

    expect(workbook.getWorksheet('Kodierergebnisse')!.getRow(2).getCell(6).value).toBe('');
    expect(replay.generateReplayUrlsForItemsBulk).not.toHaveBeenCalled();
  });
});
