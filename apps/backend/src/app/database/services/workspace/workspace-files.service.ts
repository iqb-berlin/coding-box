import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import type { DerivedVariableMetadataSnapshot } from './workspace-file-metadata-reader.token';
import { WorkspaceFileMetadataService } from './workspace-file-metadata.service';
import { FilesDto } from '../../../../../../../api-dto/files/files.dto';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { FileDownloadDto } from '../../../../../../../api-dto/files/file-download.dto';
import { TestFilesUploadResultDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import { FileValidationResultDto } from '../../../../../../../api-dto/files/file-validation-result.dto';
import { ResponseDto } from '../../../../../../../api-dto/responses/response-dto';
import { InvalidVariableDto, VariableValidationSummaryDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import { DuplicateResponsesResultDto } from '../../../../../../../api-dto/files/duplicate-response.dto';
import { UnitVariableDetailsDto } from '../../../models/unit-variable-details.dto';
import { TestTakersValidationDto } from '../../../../../../../api-dto/files/testtakers-validation.dto';
import { ResponseDeletionAuditContext, WorkspaceResponseValidationService } from '../validation/workspace-response-validation.service';
import { WorkspaceTestFilesValidationService } from '../validation/workspace-test-files-validation.service';
import { WorkspaceFileCacheService } from './workspace-file-cache.service';
import { WorkspaceFileQueryService } from './workspace-file-query.service';
import { WorkspaceFileMutationService } from './workspace-file-mutation.service';
import { WorkspaceFileUploadService } from './workspace-file-upload.service';
import { WorkspaceTestcenterFileImportService } from './workspace-testcenter-file-import.service';
import { WorkspaceTestTakersValidationService } from './workspace-test-takers-validation.service';
import { WorkspaceFilesMutationContext } from './workspace-file-write.util';

export type { DerivedVariableMetadataSnapshot } from './workspace-file-metadata-reader.token';

/** Compatibility facade for workspace file workflows. */
@Injectable()
export class WorkspaceFilesService {
  constructor(
    private readonly query: WorkspaceFileQueryService,
    private readonly mutations: WorkspaceFileMutationService,
    private readonly uploads: WorkspaceFileUploadService,
    private readonly testcenter: WorkspaceTestcenterFileImportService,
    private readonly testTakers: WorkspaceTestTakersValidationService,
    private readonly workspaceResponseValidationService: WorkspaceResponseValidationService,
    private readonly workspaceTestFilesValidationService: WorkspaceTestFilesValidationService,
    private readonly fileMetadata: WorkspaceFileMetadataService,
    private readonly caches: WorkspaceFileCacheService
  ) {}

  async findAllFileTypes(workspaceId: number): Promise<string[]> {
    return this.query.findAllFileTypes(workspaceId);
  }

  async findFiles(
    workspaceId: number,
    options?: {
      page: number;
      limit: number;
      fileType?: string;
      fileSize?: string;
      searchText?: string;
      regexSearch?: boolean;
    }
  ): Promise<[FilesDto[], number, string[]]> {
    return this.query.findFiles(workspaceId, options);
  }

  async deleteTestFiles(
    workspace_id: number,
    fileIds: string[]
  ): Promise<boolean> {
    return this.mutations.deleteTestFiles(workspace_id, fileIds);
  }

  async validateTestFiles(
    workspaceId: number,
    onProgress?: (progress: number, message?: string) => void | Promise<void>
  ): Promise<FileValidationResultDto> {
    return this.workspaceTestFilesValidationService.validateTestFiles(
      workspaceId,
      onProgress
    );
  }

  async getTestFilesValidationCacheKey(workspaceId: number): Promise<string> {
    return this.workspaceTestFilesValidationService.getTestFilesFingerprint(
      workspaceId
    );
  }

  async refreshTestFilesValidationResult(
    workspaceId: number,
    result: unknown
  ): Promise<unknown> {
    return this.workspaceTestFilesValidationService.refreshGeoGebraPackageStatus(
      workspaceId,
      result
    );
  }

  async createDummyTestTakerFile(workspaceId: number): Promise<boolean> {
    return this.mutations.createDummyTestTakerFile(workspaceId);
  }

  async getUnitsWithFileIds(
    workspaceId: number
  ): Promise<{ id: number; unitId: string; fileName: string; data: string }[]> {
    return this.query.getUnitsWithFileIds(workspaceId);
  }

  async getVocs(workspaceId: number, vocs: string): Promise<FilesDto[]> {
    return this.query.getVocs(workspaceId, vocs);
  }

  async getItemIdsFromMetadataFiles(
    workspaceId: number
  ): Promise<{ fileId: string; id: number; items: string[] }[]> {
    return this.query.getItemIdsFromMetadataFiles(workspaceId);
  }

  async uploadTestFiles(
    workspace_id: number,
    originalFiles: FileIo[],
    overwriteExisting: boolean,
    overwriteFileIds?: string[]
  ): Promise<TestFilesUploadResultDto> {
    return this.uploads.uploadTestFiles(workspace_id, originalFiles, overwriteExisting, overwriteFileIds);
  }

  async downloadTestFile(
    workspace_id: number,
    fileId: number
  ): Promise<FileDownloadDto> {
    return this.query.downloadTestFile(workspace_id, fileId);
  }

  handleFile(
    workspaceId: number,
    file: FileIo,
    overwriteExisting: boolean,
    overwriteAllowList?: Set<string>,
    mutationContext?: WorkspaceFilesMutationContext
  ): Array<Promise<unknown>> {
    return this.uploads.handleFile(workspaceId, file, overwriteExisting, overwriteAllowList, mutationContext);
  }

  static cleanResponses(rows: ResponseDto[]): ResponseDto[] {
    return Object.values(
      rows.reduce(
        (agg, response) => {
          const key = [response.test_person, response.unit_id].join('@@@@@@');
          if (agg[key]) {
            if (!agg[key].responses?.length && response.responses?.length) {
              agg[key].responses = response.responses;
            }
            if (
              !Object.keys(agg[key].unit_state || {}).length &&
              Object.keys(response.unit_state || {}).length
            ) {
              agg[key].unit_state = response.unit_state;
            }
          } else {
            agg[key] = response;
          }
          return agg;
        },
        <{ [key: string]: ResponseDto }>{}
      )
    );
  }

  async testCenterImport(
    entries: Record<string, unknown>[],
    overwriteFileIds?: string[]
  ): Promise<TestFilesUploadResultDto> {
    return this.testcenter.testCenterImport(entries, overwriteFileIds);
  }

  async getUnitContent(workspaceId: number, unitId: number): Promise<string> {
    return this.query.getUnitContent(workspaceId, unitId);
  }

  async getTestTakerContent(
    workspaceId: number,
    testTakerId: string
  ): Promise<string> {
    return this.query.getTestTakerContent(workspaceId, testTakerId);
  }

  async getCodingSchemeByRef(
    workspaceId: number,
    codingSchemeRef: string
  ): Promise<FileDownloadDto | null> {
    return this.query.getCodingSchemeByRef(workspaceId, codingSchemeRef);
  }

  async getVariableInfoForScheme(
    workspaceId: number,
    schemeFileId: string,
    manager?: EntityManager
  ): Promise<VariableInfo[]> {
    return this.fileMetadata.getVariableInfoForScheme(workspaceId, schemeFileId, manager);
  }

  async downloadWorkspaceFilesAsZip(
    workspaceId: number,
    fileTypes?: string[]
  ): Promise<Buffer> {
    return this.query.downloadWorkspaceFilesAsZip(workspaceId, fileTypes);
  }

  async validateTestTakers(
    workspaceId: number,
    onProgress?: (progress: number) => void
  ): Promise<TestTakersValidationDto> {
    return this.testTakers.validateTestTakers(workspaceId, onProgress);
  }

  async validateDuplicateResponses(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: (progress: number) => void
  ): Promise<DuplicateResponsesResultDto> {
    return this.workspaceResponseValidationService.validateDuplicateResponses(
      workspaceId,
      page,
      limit,
      onProgress
    );
  }

  async validateResponseStatus(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: (progress: number) => void
  ): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.workspaceResponseValidationService.validateResponseStatus(
      workspaceId,
      page,
      limit,
      onProgress
    );
  }

  async validateVariables(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: (progress: number) => void
  ): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
    summary: VariableValidationSummaryDto;
  }> {
    return this.workspaceResponseValidationService.validateVariables(
      workspaceId,
      page,
      limit,
      onProgress
    );
  }

  async validateVariableTypes(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: (progress: number) => void
  ): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.workspaceResponseValidationService.validateVariableTypes(
      workspaceId,
      page,
      limit,
      onProgress
    );
  }

  async validateGroupResponses(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: (progress: number) => void
  ): Promise<{
    testTakersFound: boolean;
    groupsWithResponses: { group: string; hasResponse: boolean }[];
    allGroupsHaveResponses: boolean;
    total: number;
    totalGroupsWithoutResponses: number;
    page: number;
    limit: number;
  }> {
    return this.testTakers.validateGroupResponses(workspaceId, page, limit, onProgress);
  }

  async deleteInvalidResponses(
    workspaceId: number,
    responseIds: number[],
    audit: ResponseDeletionAuditContext = {}
  ): Promise<number> {
    try {
      const deletedCount = await this.workspaceResponseValidationService.deleteInvalidResponses(
        workspaceId,
        responseIds,
        audit
      );
      if (deletedCount > 0) await this.caches.invalidateResponseDeletionCaches(workspaceId);
      return deletedCount;
    } catch (error) {
      await this.caches.invalidateResponseDeletionCaches(workspaceId);
      throw error;
    }
  }

  async deleteAllInvalidResponses(
    workspaceId: number,
    validationType:
    | 'variables'
    | 'variableTypes'
    | 'responseStatus'
    | 'duplicateResponses',
    audit: ResponseDeletionAuditContext = {}
  ): Promise<number> {
    try {
      const deletedCount = await this.workspaceResponseValidationService.deleteAllInvalidResponses(
        workspaceId,
        validationType,
        audit
      );
      if (deletedCount > 0) await this.caches.invalidateResponseDeletionCaches(workspaceId);
      return deletedCount;
    } catch (error) {
      await this.caches.invalidateResponseDeletionCaches(workspaceId);
      throw error;
    }
  }

  async refreshUnitVariableCache(workspaceId: number): Promise<void> {
    return this.fileMetadata.refreshUnitVariableCache(workspaceId);
  }

  async getUnitVariableMap(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<Map<string, Set<string>>> {
    return this.fileMetadata.getUnitVariableMap(workspaceId, manager);
  }

  async getIntendedIncompleteSchemeVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    return this.fileMetadata.getIntendedIncompleteSchemeVariableMap(workspaceId);
  }

  async getDerivedVariableMap(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<Map<string, Set<string>>> {
    return this.fileMetadata.getDerivedVariableMap(workspaceId, manager);
  }

  async getDerivedVariablesBySourceMap(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<Map<string, Set<string>>> {
    return this.fileMetadata.getDerivedVariablesBySourceMap(workspaceId, manager);
  }

  async getDerivedVariableMetadata(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<DerivedVariableMetadataSnapshot> {
    return this.fileMetadata.getDerivedVariableMetadata(workspaceId, manager);
  }

  async getManualInstructionVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    return this.fileMetadata.getManualInstructionVariableMap(workspaceId);
  }

  async getCoderTrainingRequiredVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    return this.fileMetadata.getCoderTrainingRequiredVariableMap(workspaceId);
  }

  async getUnitVariableDetails(
    workspaceId: number,
    options: { includeCodingRules?: boolean } = {}
  ): Promise<UnitVariableDetailsDto[]> {
    return this.fileMetadata.getUnitVariableDetails(workspaceId, options);
  }

  async invalidateWorkspaceFileCaches(workspaceId: number): Promise<void> {
    return this.caches.invalidateWorkspaceFileCaches(workspaceId);
  }

  async readMetadataFile(workspaceId: number, fileId: number): Promise<FileDownloadDto> {
    return this.query.readMetadataFile(workspaceId, fileId);
  }
}
