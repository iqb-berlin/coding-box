import {
  ExecutionContext, INestApplication
} from '@nestjs/common';
import {
  GUARDS_METADATA
} from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Readable } from 'stream';
import { createRequestValidationPipe } from './request-validation';
import { GlobalHttpExceptionFilter } from './global-http-exception.filter';
import { CodingExportOrchestratorService } from '../database/services/coding/coding-export-orchestrator.service';
import { CodingListExportService } from '../database/services/coding/coding-list-export.service';
import { WorkspaceCoderTrainingController } from '../admin/workspace/workspace-coder-training.controller';
import { WorkspaceCodingAnalysisController } from '../admin/workspace/workspace-coding-analysis.controller';
import { WorkspaceCodingExportController } from '../admin/workspace/workspace-coding-export.controller';
import { WorkspaceCodingJobDefinitionController } from '../admin/workspace/workspace-coding-job-definition.controller';
import { WorkspaceCodingStatisticsController } from '../admin/workspace/workspace-coding-statistics.controller';
import { WorkspaceFilesController } from '../admin/workspace/workspace-files.controller';
import { WorkspacePlayerController } from '../admin/workspace/workspace-player.controller';
import { WorkspaceTestCenterController } from '../admin/workspace/workspace-test-center.controller';
import { WorkspaceTestResultsAnalysisController } from '../admin/workspace/workspace-test-results-analysis.controller';
import { WorkspaceTestResultsImportController } from '../admin/workspace/workspace-test-results-import.controller';
import { WorkspaceTestResultsResponseController } from '../admin/workspace/workspace-test-results-response.controller';
import { WsgCodingJobController } from '../wsg-admin/coding-job/coding-job.controller';

const controllers = [WorkspaceCoderTrainingController, WorkspaceCodingAnalysisController, WorkspaceCodingExportController, WorkspaceCodingJobDefinitionController, WorkspaceCodingStatisticsController, WorkspaceFilesController, WorkspacePlayerController, WorkspaceTestCenterController, WorkspaceTestResultsAnalysisController, WorkspaceTestResultsImportController, WorkspaceTestResultsResponseController, WsgCodingJobController];
// Expected public contracts are independent of the installed parameter pipes.
const booleanQueries = [
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/coder-trainings/7/cohens-kappa',
    flags: [
      'weightedMean'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/coder-trainings/7/interrater-reliability',
    flags: [
      'weightedMean'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/coder-trainings/7/interrater-reliability/export/csv',
    flags: [
      'weightedMean'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/variable-analysis',
    flags: [
      'regexSearch'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/incomplete-variables',
    flags: [
      'trainingRequired',
      'includeDeriveErrorOnly'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/incomplete-variables/scope-summary',
    flags: [
      'trainingRequired'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/incomplete-variables/code-availability',
    flags: [
      'trainingRequired'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/coding-list',
    flags: [
      'trainingRequired'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/coding-list/excel',
    flags: [
      'trainingRequired'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/coding-list/json',
    flags: [
      'trainingRequired'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/results-by-version',
    flags: [
      'includeReplayUrls',
      'includeResponseValues',
      'includeGeoGebraResponseValues'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/results-by-version/excel',
    flags: [
      'includeReplayUrls',
      'includeResponseValues',
      'includeGeoGebraResponseValues',
      'includeGeoGebraFiles'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/export/aggregated',
    flags: [
      'outputCommentsInsteadOfCodes',
      'includeReplayUrl',
      'anonymizeCoders',
      'usePseudoCoders',
      'includeComments',
      'includeModalValue',
      'excludeAutoCoded'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/export/by-coder',
    flags: [
      'outputCommentsInsteadOfCodes',
      'includeReplayUrl',
      'anonymizeCoders',
      'usePseudoCoders',
      'excludeAutoCoded'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/export/by-variable',
    flags: [
      'includeModalValue',
      'includeDoubleCoded',
      'includeComments',
      'outputCommentsInsteadOfCodes',
      'includeReplayUrl',
      'anonymizeCoders',
      'usePseudoCoders',
      'excludeAutoCoded'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/export/detailed',
    flags: [
      'outputCommentsInsteadOfCodes',
      'includeReplayUrl',
      'anonymizeCoders',
      'usePseudoCoders',
      'excludeAutoCoded'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/export/coding-times',
    flags: [
      'anonymizeCoders',
      'usePseudoCoders',
      'excludeAutoCoded'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/job-definitions',
    flags: [
      'includePlannedUsage'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/cohens-kappa',
    flags: [
      'weightedMean',
      'excludeTrainings'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/cohens-kappa/export/csv',
    flags: [
      'weightedMean',
      'excludeTrainings'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/cohens-kappa/export/summary/csv',
    flags: [
      'weightedMean',
      'excludeTrainings'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/cohens-kappa/export/xlsx',
    flags: [
      'weightedMean',
      'excludeTrainings'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/coding/cohens-kappa/workspace-summary',
    flags: [
      'weightedMean',
      'excludeTrainings'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/files',
    flags: [
      'regexSearch'
    ]
  },
  {
    method: 'POST',
    route: '/api/admin/workspace/7/upload',
    flags: [
      'overwriteExisting'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/booklet/7/units',
    flags: [
      'includeReplayStatus'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/importWorkspaceFiles',
    flags: [
      'overwriteExistingLogs'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/test-results/flat-responses',
    flags: [
      'regexSearch'
    ]
  },
  {
    method: 'POST',
    route: '/api/admin/workspace/7/upload/results/logs',
    flags: [
      'overwriteExisting'
    ]
  },
  {
    method: 'GET',
    route: '/api/admin/workspace/7/responses/search',
    flags: [
      'geogebra',
      'derivedOnly',
      'regexSearch'
    ]
  },
  {
    method: 'GET',
    route: '/api/wsg-admin/workspace/7/coding-job/',
    flags: [
      'includeIssueSummary'
    ]
  },
  {
    method: 'GET',
    route: '/api/wsg-admin/workspace/7/coding-job/7/replay-session',
    flags: [
      'onlyOpen'
    ]
  },
  {
    method: 'GET',
    route: '/api/wsg-admin/workspace/7/coding-job/7/units',
    flags: [
      'onlyOpen'
    ]
  }
].flatMap(({ method, route, flags }) => flags.map(flag => ({ method, route, flag })));

describe('Boolean query contracts over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const exports = {
    exportDetailed: jest.fn().mockResolvedValue(Buffer.from('detailed-results')),
    exportResultsByVersionAsCsv: jest.fn(async () => Readable.from(['versioned-results']))
  };
  const lists = {
    exportCodingListAsCsv: jest.fn(async (_workspace, _token, _url, response, trainingRequired) => {
      response.json({ trainingRequired: trainingRequired ?? null });
    })
  };

  beforeAll(async () => {
    const builder = Test.createTestingModule({
      controllers,
      providers: [
        { provide: CodingExportOrchestratorService, useValue: exports },
        { provide: CodingListExportService, useValue: lists }
      ]
    }).useMocker(() => ({}));
    const guards = new Set(controllers.flatMap(controller => [
      ...(Reflect.getMetadata(GUARDS_METADATA, controller) || []),
      ...Object.getOwnPropertyNames(controller.prototype).flatMap(name => (
        Reflect.getMetadata(GUARDS_METADATA, controller.prototype[name]) || []
      ))
    ]));
    guards.forEach(guard => builder.overrideGuard(guard).useValue({
      canActivate(context: ExecutionContext) {
        context.switchToHttp().getRequest().user = { id: 7, userId: 7 };
        return true;
      }
    }));
    const module = await builder.compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createRequestValidationPipe());
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => { await app?.close(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it.each(booleanQueries)('rejects invalid $flag on $method $route before invoking application services', async ({ method, route, flag }) => {
    for (const invalid of ['garbage', '', '0', '1', 'TRUE', 'false,true']) {
      const query = new URLSearchParams({ [flag]: invalid });
      const response = await fetch(`${baseUrl + route}?${query}`, { method });
      expect({ flag, invalid, status: response.status }).toEqual({ flag, invalid, status: 400 });
    }
    const repeated = new URLSearchParams([[flag, 'true'], [flag, 'false']]);
    expect((await fetch(`${baseUrl + route}?${repeated}`, { method })).status).toBe(400);
    expect(exports.exportDetailed).not.toHaveBeenCalled();
    expect(exports.exportResultsByVersionAsCsv).not.toHaveBeenCalled();
    expect(lists.exportCodingListAsCsv).not.toHaveBeenCalled();
  });

  it.each([true, false])('passes parsed %s flags to detailed exports', async value => {
    const query = new URLSearchParams(Object.fromEntries([
      'outputCommentsInsteadOfCodes', 'includeReplayUrl', 'anonymizeCoders', 'usePseudoCoders', 'excludeAutoCoded'
    ].map(name => [name, String(value)])));
    const response = await fetch(`${baseUrl}/api/admin/workspace/7/coding/export/detailed?${query}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('detailed-results');
    expect(exports.exportDetailed).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 7,
      outputCommentsInsteadOfCodes: value,
      includeReplayUrl: value,
      anonymizeCoders: value,
      usePseudoCoders: value,
      excludeAutoCoded: value
    }));
  });

  it.each([
    ['', false, true, false],
    ['&includeReplayUrls=false&includeResponseValues=false&includeGeoGebraResponseValues=false', false, false, false],
    ['&includeReplayUrls=true&includeResponseValues=true&includeGeoGebraResponseValues=true', true, true, true]
  ])('preserves versioned export defaults and explicit false values: %s', async (query, replay, responses, geogebra) => {
    const response = await fetch(`${baseUrl}/api/admin/workspace/7/coding/results-by-version?version=v2&missingsProfileId=7${query}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('versioned-results');
    expect(exports.exportResultsByVersionAsCsv).toHaveBeenCalledWith(expect.objectContaining({
      includeReplayUrl: replay, includeResponseValues: responses, includeGeoGebraResponseValues: geogebra
    }));
  });

  it.each([undefined, true, false])('retains the three-way training filter %s', async trainingRequired => {
    const query = trainingRequired === undefined ? '' : `?trainingRequired=${trainingRequired}`;
    const response = await fetch(`${baseUrl}/api/admin/workspace/7/coding/coding-list${query}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ trainingRequired: trainingRequired ?? null });
    expect(lists.exportCodingListAsCsv).toHaveBeenCalledWith(7, undefined, undefined, expect.anything(), trainingRequired);
  });
});
