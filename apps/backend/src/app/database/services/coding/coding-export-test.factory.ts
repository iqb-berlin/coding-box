import { Repository } from 'typeorm';
import { createFacadeTestProxy } from '../shared/facade-test.factory';
import { CodingListService } from './coding-list.service';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import User from '../../entities/user.entity';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { MissingsProfilesService } from './missings-profiles.service';
import { CodingExportService } from './coding-export.service';
import { CodingExportQueryService } from './coding-export-query.service';
import { CodingExportFormattingService } from './coding-export-formatting.service';
import { CodingExportReplayService } from './coding-export-replay.service';
import { CodingExportDownloadService } from './coding-export-download.service';
import { CodingAggregatedExportService } from './coding-aggregated-export.service';
import { CodingAggregatedRowsExportService } from './coding-aggregated-rows-export.service';
import { CodingAggregatedColumnsExportService } from './coding-aggregated-columns-export.service';
import { CodingCoderExportService } from './coding-coder-export.service';
import { CodingVariableExportService } from './coding-variable-export.service';
import { CodingCompactExportService } from './coding-compact-export.service';
import { CodingDetailedExportService } from './coding-detailed-export.service';
import { CodingTimingReportExportService } from './coding-timing-report-export.service';

export function createCodingExportService(responseRepository: Repository<ResponseEntity>,
  codingJobRepository: Repository<CodingJob>,
  codingJobVariableRepository: Repository<CodingJobVariable>,
  codingJobUnitRepository: Repository<CodingJobUnit>,
  coderTrainingDiscussionResultRepository: Repository<CoderTrainingDiscussionResult>,
  userRepository: Repository<User>,
  codingListService: CodingListService,
  workspaceExclusionService: WorkspaceExclusionService,
  missingsProfilesService?: MissingsProfilesService,
  replayAnchorService?: CodingReplayAnchorService): CodingExportService {
  const query = new CodingExportQueryService(responseRepository, codingJobUnitRepository, coderTrainingDiscussionResultRepository, userRepository, codingListService, workspaceExclusionService);
  const formatting = new CodingExportFormattingService(missingsProfilesService);
  const replay = new CodingExportReplayService(codingListService, replayAnchorService);
  const downloads = new CodingExportDownloadService(codingListService);
  const rows = new CodingAggregatedRowsExportService(responseRepository, codingJobRepository, codingJobUnitRepository, workspaceExclusionService, query, formatting, replay);
  const columns = new CodingAggregatedColumnsExportService(responseRepository, codingJobRepository, codingJobUnitRepository, workspaceExclusionService, query, formatting);
  const aggregated = new CodingAggregatedExportService(responseRepository, codingJobUnitRepository, workspaceExclusionService, query, formatting, replay, rows, columns);
  const byCoder = new CodingCoderExportService(responseRepository, codingJobRepository, codingJobUnitRepository, workspaceExclusionService, query, formatting, replay);
  const byVariable = new CodingVariableExportService(responseRepository, codingJobUnitRepository, workspaceExclusionService, query, formatting, replay);
  const compact = new CodingCompactExportService(codingJobRepository, codingJobUnitRepository, workspaceExclusionService, query, formatting, replay);
  const detailed = new CodingDetailedExportService(codingJobRepository, codingJobUnitRepository, query, formatting, replay);
  const times = new CodingTimingReportExportService(codingJobUnitRepository, workspaceExclusionService, query);
  const facade = new CodingExportService(downloads, byVariable, aggregated, byCoder, compact, detailed, times);
  const providers = [query, formatting, replay, downloads, aggregated, rows, columns, byCoder, byVariable, compact, detailed, times];
  // Legacy fixtures probe/stub private methods; production uses explicit DI.
  return createFacadeTestProxy(facade, providers);
}
