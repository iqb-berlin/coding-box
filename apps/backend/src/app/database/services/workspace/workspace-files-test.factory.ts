import { Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import Persons from '../../entities/persons.entity';
import { CodingStatisticsService } from '../coding/coding-statistics.service';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import { CodingFileCacheService } from '../coding/coding-file-cache.service';
import { CodingProcessCacheInvalidator } from '../coding/coding-process-cache-invalidator.token';
import { CacheService } from '../../../cache/cache.service';
import { WorkspaceTestResultsService } from '../test-results/workspace-test-results.service';
import { WorkspaceResponseValidationService } from '../validation/workspace-response-validation.service';
import { WorkspaceTestFilesValidationService } from '../validation/workspace-test-files-validation.service';
import { WorkspaceXmlSchemaValidationService } from './workspace-xml-schema-validation.service';
import { WorkspaceFileStorageService } from './workspace-file-storage.service';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';
import { WorkspaceFileMetadataService } from './workspace-file-metadata.service';
import { WorkspaceFileCacheService } from './workspace-file-cache.service';
import { WorkspaceFileFreshnessService } from './workspace-file-freshness.service';
import { WorkspaceFileQueryService } from './workspace-file-query.service';
import { WorkspaceFileMutationService } from './workspace-file-mutation.service';
import { WorkspaceFileUploadService } from './workspace-file-upload.service';
import { WorkspaceXmlFileUploadService } from './workspace-xml-file-upload.service';
import { WorkspaceResourceFileUploadService } from './workspace-resource-file-upload.service';
import { WorkspaceTestcenterFileImportService } from './workspace-testcenter-file-import.service';
import { WorkspaceTestTakersValidationService } from './workspace-test-takers-validation.service';
import { WorkspaceFilesService } from './workspace-files.service';

// The existing characterization fixtures supply infrastructure doubles in this order.
// Construct the real workflow graph so those assertions exercise facade and workflows.
export function createWorkspaceFilesService(
  files: Repository<FileUpload>,
  responses: Repository<ResponseEntity>,
  units: Repository<Unit>,
  persons: Repository<Persons>,
  statistics: CodingStatisticsService,
  schema: WorkspaceXmlSchemaValidationService,
  storage: WorkspaceFileStorageService,
  parsing: WorkspaceFileParsingService,
  responseValidation: WorkspaceResponseValidationService,
  testFilesValidation: WorkspaceTestFilesValidationService,
  cache: CacheService,
  results: WorkspaceTestResultsService,
  metadata: WorkspaceFileMetadataService,
  codingFreshness?: CodingFreshnessService,
  codingCache?: CodingFileCacheService,
  processCache?: CodingProcessCacheInvalidator
): WorkspaceFilesService {
  const caches = new WorkspaceFileCacheService(metadata, cache, results, codingCache, processCache);
  const freshness = new WorkspaceFileFreshnessService(codingFreshness);
  const xml = new WorkspaceXmlFileUploadService(files, schema, parsing);
  const resources = new WorkspaceResourceFileUploadService(files, parsing, freshness);
  const uploads = new WorkspaceFileUploadService(files, xml, resources, storage, caches, statistics);
  const mutations = new WorkspaceFileMutationService(files, caches, statistics);
  const testcenter = new WorkspaceTestcenterFileImportService(files, parsing, freshness, caches);
  const testTakers = new WorkspaceTestTakersValidationService(files, persons, units, responses);
  return new WorkspaceFilesService(
    new WorkspaceFileQueryService(files, metadata, storage), mutations, uploads, testcenter, testTakers, responseValidation, testFilesValidation, metadata, caches
  );
}

export function xmlUploads(service: WorkspaceFilesService): WorkspaceXmlFileUploadService {
  return Reflect.get(Reflect.get(service, 'uploads'), 'xml');
}

export function resourceUploads(service: WorkspaceFilesService): WorkspaceResourceFileUploadService {
  return Reflect.get(Reflect.get(service, 'uploads'), 'resources');
}

export function fileCaches(service: WorkspaceFilesService): WorkspaceFileCacheService {
  return Reflect.get(service, 'caches');
}
