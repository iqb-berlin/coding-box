import { INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import * as ExcelJS from 'exceljs';
import { WorkspaceCodingStatisticsController } from '../admin/workspace/workspace-coding-statistics.controller';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CohensKappaStatisticsService } from '../database/services/coding/cohens-kappa-statistics.service';
import { CohensKappaExportService } from '../database/services/coding/cohens-kappa-export.service';
import { CodingStatisticsService } from '../database/services/coding/coding-statistics.service';
import { CodingReplayService } from '../database/services/coding/coding-replay.service';
import { DoubleCodingReviewQueryService } from '../database/services/coding/double-coding-review-query.service';

describe('Cohen kappa service wiring and HTTP contracts', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authenticated = true;
  let workspaceAccess = true;
  const query = {
    getCodedVariablesForKappa: jest.fn(),
    getWorkspaceCohensKappaSummary: jest.fn()
  };
  const replay = { generateReplayUrlsForItemsBulk: jest.fn().mockResolvedValue([]) };
  const paths = ['', '/export/csv', '/export/summary/csv', '/export/xlsx', '/workspace-summary'];
  const items = [0, 1].map((code, index) => ({
    responseId: index + 1,
    unitName: 'UNIT',
    variableId: 'VAR',
    variableAnchor: 'ANCHOR',
    personLogin: `person-${index}`,
    personCode: 'secret',
    personGroup: 'GROUP',
    bookletName: 'BOOKLET',
    coderResults: [1, 2].map(coderId => ({
      coderId,
      coderName: `Coder ${coderId}`,
      jobId: coderId + 10,
      jobName: `Job ${coderId}`,
      jobDefinitionId: coderId + 20,
      trainingId: null,
      trainingLabel: null,
      code,
      score: code,
      notes: null,
      codedAt: new Date('2026-01-01T00:00:00.000Z')
    }))
  }));

  beforeAll(async () => {
    // Use the actual production registrations; stub only external domain dependencies.
    const registrations = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WorkspaceModule) as unknown[];
    const providers = registrations.filter((provider): provider is typeof CohensKappaStatisticsService | typeof CohensKappaExportService => (
      provider === CohensKappaStatisticsService || provider === CohensKappaExportService
    ));
    expect(providers).toHaveLength(2);
    const builder = Test.createTestingModule({
      controllers: [WorkspaceCodingStatisticsController],
      providers: [
        ...providers,
        { provide: DoubleCodingReviewQueryService, useValue: query },
        { provide: CodingReplayService, useValue: replay },
        {
          provide: CodingStatisticsService,
          useValue: {
            calculateCohensKappa: CodingStatisticsService.prototype.calculateCohensKappa,
            roundKappaCalculationResult: CodingStatisticsService.prototype.roundKappaCalculationResult
          }
        }
      ]
    }).useMocker(() => ({}));
    builder.overrideGuard(JwtAuthGuard).useValue({ canActivate: () => authenticated });
    builder.overrideGuard(WorkspaceGuard).useValue({ canActivate: () => workspaceAccess });
    const module = await builder.compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    baseUrl = `${await app.getUrl()}/api/admin/workspace/5/coding/cohens-kappa`;
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    authenticated = true;
    workspaceAccess = true;
    jest.clearAllMocks();
    query.getCodedVariablesForKappa.mockResolvedValue(items);
    query.getWorkspaceCohensKappaSummary.mockResolvedValue({ coderPairs: [], workspaceSummary: {} });
  });

  it('exports both services to the admin module', () => {
    const exported = Reflect.getMetadata(MODULE_METADATA.EXPORTS, WorkspaceModule) as unknown[];
    expect(exported).toEqual(expect.arrayContaining([CohensKappaStatisticsService, CohensKappaExportService]));
  });

  it('returns only the public JSON shape with the production calculator', async () => {
    const response = await fetch(baseUrl);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      variables: [{
        unitName: 'UNIT',
        variableId: 'VAR',
        meanKappa: 1,
        meanAgreement: 1,
        caseCount: 2,
        doubleCodedCount: 2,
        doubleCodedRate: 1,
        validPairCount: 2,
        coderPairCount: 1,
        coderPairs: [{
          coder1Id: 1,
          coder1Name: 'Coder 1',
          coder2Id: 2,
          coder2Name: 'Coder 2',
          kappa: 1,
          agreement: 1,
          totalItems: 2,
          validPairs: 2,
          interpretation: 'kappa.almost_perfect',
          jobNames: ['Job 1', 'Job 2'],
          jobDefinitionIds: [21, 22],
          trainingIds: [],
          trainingLabels: []
        }]
      }],
      workspaceSummary: {
        totalCodedResponses: 2,
        totalDoubleCodedResponses: 2,
        totalCoderPairs: 1,
        averageKappa: 1,
        meanAgreement: 1,
        variablesIncluded: 1,
        codersIncluded: 2,
        weightingMethod: 'weighted',
        calculationLevel: 'code'
      }
    });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(body).not.toHaveProperty('sourceItems');
  });

  it('preserves repeated/comma-separated scopes, training inclusion and score selection', async () => {
    const response = await fetch(`${baseUrl}?weightedMean=false&excludeTrainings=true&jobDefinitionIds=11,12&coderTrainingIds=21&coderIds=31&coderIds=32&level=score`);

    expect(response.status).toBe(200);
    expect(query.getCodedVariablesForKappa).toHaveBeenCalledWith(5, false, [11, 12], [21], [31, 32], 'score', { unitName: undefined, variableId: undefined });
    expect((await response.json()).workspaceSummary).toMatchObject({ weightingMethod: 'unweighted', calculationLevel: 'score' });
  });

  it.each(paths.slice(0, 4))('rejects invalid options before data access on %s', async path => {
    const response = await fetch(`${baseUrl}${path}?coderIds=0&level=score`);
    expect(response.status).toBe(400);
    expect(query.getCodedVariablesForKappa).not.toHaveBeenCalled();
    expect(replay.generateReplayUrlsForItemsBulk).not.toHaveBeenCalled();
  });

  it.each(paths)('enforces both guards before data access on %s', async path => {
    authenticated = false;
    expect((await fetch(`${baseUrl}${path}`)).status).toBe(403);
    authenticated = true;
    workspaceAccess = false;
    expect((await fetch(`${baseUrl}${path}`)).status).toBe(403);
    expect(query.getCodedVariablesForKappa).not.toHaveBeenCalled();
    expect(query.getWorkspaceCohensKappaSummary).not.toHaveBeenCalled();
  });

  it.each([
    ['/export/csv', 'details', 'Variable;Unit;Variablen-ID;'],
    ['/export/summary/csv', 'summary', 'subunit;nCases;nDop;percDop;meankappa;meanagree']
  ])('serves CSV with BOM and download headers on %s', async (path, kind, header) => {
    const response = await fetch(`${baseUrl}${path}`);
    const text = Buffer.from(await response.arrayBuffer()).toString('utf8');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="cohens-kappa-${kind}-5-\\d{4}-\\d{2}-\\d{2}\\.csv"$`));
    expect(text.startsWith(`\uFEFF${header}`)).toBe(true);
    expect(text).toContain('UNIT');
  });

  it('serves the three-sheet workbook with request-derived replay context', async () => {
    const response = await fetch(`${baseUrl}/export/xlsx?authToken=export-token`, {
      headers: { 'x-forwarded-proto': 'https, http' }
    });
    const workbook = new ExcelJS.Workbook();
    const buffer = Buffer.from(await response.arrayBuffer());
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="cohens-kappa-5-.*\.xlsx"$/);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      'Übereinstimmung_gesamt', 'Übereinstimmung_paarweise', 'Kodierergebnisse'
    ]);
    expect(workbook.getWorksheet('Übereinstimmung_gesamt')!.getRow(2).values)
      .toEqual([undefined, 'UNIT_VAR', 2, 2, 100, 1, 1]);
    expect(replay.generateReplayUrlsForItemsBulk).toHaveBeenCalledWith(5,
      expect.arrayContaining([expect.objectContaining({ variableAnchor: 'ANCHOR' })]),
      expect.stringMatching(/^https:\/\/127\.0\.0\.1:/),
      'export-token');
  });

  it('keeps workspace-summary on its separate query path', async () => {
    const response = await fetch(`${baseUrl}/workspace-summary?weightedMean=false&coderTrainingIds=21&coderIds=31`);

    expect(response.status).toBe(200);
    expect(query.getWorkspaceCohensKappaSummary).toHaveBeenCalledWith(5, false, false, [], [21], [31]);
    expect(query.getCodedVariablesForKappa).not.toHaveBeenCalled();
  });
});
