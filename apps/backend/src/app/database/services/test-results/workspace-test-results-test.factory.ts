import {
  DataSource,
  Repository
} from 'typeorm';
import { CacheService } from '../../../cache/cache.service';
import { Booklet } from '../../entities/booklet.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import Persons from '../../entities/persons.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Session } from '../../entities/session.entity';
import { Unit } from '../../entities/unit.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import { CodingListService } from '../coding/coding-list.service';
import { CodingStatisticsService } from '../coding/coding-statistics.service';
import { CodingValidationService } from '../coding/coding-validation.service';
import { JournalService } from '../shared';
import { UnitTagService } from '../workspace/unit-tag.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import {
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { WorkspaceStatsCacheService } from '../workspace/workspace-stats-cache.service';
import { ResponseManagementService } from './response-management.service';
import { TestResultsAnomaliesService } from './test-results-anomalies.service';
import { TestResultsCacheService } from './test-results-cache.service';
import { TestResultsDeletionQueryService } from './test-results-deletion-query.service';
import { TestResultsExportService } from './test-results-export.service';
import { TestResultsMutationService } from './test-results-mutation.service';
import { TestResultsQueryService } from './test-results-query.service';
import { TestResultsReplayService } from './test-results-replay.service';
import { TestResultsFrequenciesService } from './test-results-frequencies.service';
import { TestResultsFilterOptionsService } from './test-results-filter-options.service';
import { TestResultsResponsesService } from './test-results-responses.service';
import { TestResultsSearchService } from './test-results-search.service';
import { WorkspaceTestResultsService } from './workspace-test-results.service';

export function createWorkspaceTestResultsService(personsRepository: Repository<Persons>,
  unitRepository: Repository<Unit>,
  bookletRepository: Repository<Booklet>,
  responseRepository: Repository<ResponseEntity>,
  bookletInfoRepository: Repository<BookletInfo>,
  bookletLogRepository: Repository<BookletLog>,
  sessionRepository: Repository<Session>,
  unitLogRepository: Repository<UnitLog>,
  chunkRepository: Repository<ChunkEntity>,
  connection: DataSource,
  unitTagService: UnitTagService,
  journalService: JournalService,
  cacheService: CacheService,
  codingListService: CodingListService,
  codingValidationService: CodingValidationService,
  responseManagementService: ResponseManagementService,
  workspaceCoreService: WorkspaceCoreService,
  workspaceExclusionService: WorkspaceExclusionService,
  workspaceStatsCacheService: WorkspaceStatsCacheService,
  codingFreshnessService?: CodingFreshnessService,
  codingStatisticsService?: CodingStatisticsService): WorkspaceTestResultsService {
  const anomalies = new TestResultsAnomaliesService(unitRepository, bookletRepository, bookletLogRepository, sessionRepository, unitLogRepository, workspaceExclusionService);
  const cache = new TestResultsCacheService(codingValidationService, workspaceStatsCacheService, codingStatisticsService);
  const query = new TestResultsQueryService(personsRepository, unitRepository, bookletRepository, responseRepository, bookletLogRepository, sessionRepository, unitLogRepository, unitTagService, cacheService, workspaceExclusionService);
  const responses = new TestResultsResponsesService(responseRepository, connection, workspaceExclusionService, anomalies);
  const frequencies = new TestResultsFrequenciesService(responseRepository, cacheService, workspaceExclusionService);
  const filterOptions = new TestResultsFilterOptionsService(responseRepository, connection, workspaceExclusionService);
  const replay = new TestResultsReplayService(personsRepository, unitRepository, bookletRepository, responseRepository, bookletInfoRepository, chunkRepository, cacheService, workspaceExclusionService);
  const deletionQuery = new TestResultsDeletionQueryService(personsRepository, unitRepository, bookletRepository, connection, workspaceExclusionService, codingFreshnessService);
  const mutation = new TestResultsMutationService(connection, journalService, codingValidationService, responseManagementService, cache, deletionQuery, codingFreshnessService);
  const search = new TestResultsSearchService(responseRepository, connection, codingListService, workspaceExclusionService);
  const exporter = new TestResultsExportService(personsRepository, unitRepository, bookletRepository, responseRepository, bookletLogRepository, sessionRepository, unitLogRepository, chunkRepository, connection, workspaceExclusionService, anomalies);
  const facade = new WorkspaceTestResultsService(anomalies, cache, query, responses, frequencies, filterOptions, replay, mutation, search, exporter);
  const providers = [anomalies, cache, query, responses, frequencies, filterOptions, replay, deletionQuery, mutation, search, exporter];
  // Legacy behavioral fixtures probe private methods. Production uses explicit DI.
  const owners = new Map<string, object>();
  for (const provider of providers) {
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(provider))) {
      if (key !== 'constructor') owners.set(key, provider);
    }
  }
  return new Proxy(facade, {
    get(target, key) {
      const owner = (typeof key === 'string' ? owners.get(key) : undefined) || providers.find(provider => Reflect.has(provider, key));
      const value = Reflect.get(owner || target, key);
      return owner && typeof value === 'function' && !Reflect.get(value, '_isMockFunction') ? value.bind(owner) : value;
    },
    set(target, key, value) {
      const owner = typeof key === 'string' ? owners.get(key) : undefined;
      if (owner) return Reflect.set(owner, key, value);
      const matching = providers.filter(provider => Reflect.has(provider, key));
      if (matching.length) { matching.forEach(provider => Reflect.set(provider, key, value)); return true; }
      return Reflect.set(target, key, value);
    },
    getOwnPropertyDescriptor(target, key) {
      const owner = typeof key === 'string' ? owners.get(key) : undefined;
      if (owner) {
        return {
          configurable: true, enumerable: true, writable: true, value: Reflect.get(owner, key)
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
}
