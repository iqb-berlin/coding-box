import { Injectable } from '@nestjs/common';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { FileQueryService } from './file-query.service';
import { FileDownloadService } from './file-download.service';
import { FileValidationService } from './file-validation.service';
import { FileUploadService } from './file-upload.service';
import { FileIo } from '../../admin/workspace/file-io.interface';
import { TestFilesUploadResultDto } from '../../../../../../api-dto/files/test-files-upload-result.dto';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { UnitVariableDetailsDto } from '../../models/unit-variable-details.dto';
import { TestTakersValidationDto } from '../../../../../../api-dto/files/testtakers-validation.dto';
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';
import { InvalidVariableDto } from '../../../../../../api-dto/files/variable-validation.dto';
import { DuplicateResponsesResultDto } from '../../../../../../api-dto/files/duplicate-response.dto';

@Injectable()
export class WorkspaceFilesFacade {
  constructor(
    private readonly queryService: FileQueryService,
    private readonly downloadService: FileDownloadService,
    private readonly validationService: FileValidationService,
    private readonly uploadService: FileUploadService
  ) {}

  // Query Methods
  async findAllFileTypes(workspaceId: number): Promise<string[]> {
    return this.queryService.findAllFileTypes(workspaceId);
  }

  async findFiles(
    workspaceId: number,
    options?: {
      page: number;
      limit: number;
      fileType?: string;
      fileSize?: string;
      searchText?: string;
    }
  ): Promise<[FilesDto[], number, string[]]> {
    return this.queryService.findFiles(workspaceId, options);
  }

  async getUnitsWithFileIds(workspaceId: number): Promise<{ unitId: string; fileName: string }[]> {
    return this.queryService.getUnitsWithFileIds(workspaceId);
  }

  async getVariablePageMap(unitName: string, workspaceId: number): Promise<Map<string, string>> {
    return this.queryService.getVariablePageMap(unitName, workspaceId);
  }

  async getUnitVariableMap(workspaceId: number): Promise<Map<string, Set<string>>> {
    return this.queryService.getUnitVariableMap(workspaceId);
  }

  async getUnitVariableDetails(workspaceId: number): Promise<UnitVariableDetailsDto[]> {
    return this.queryService.getUnitVariableDetails(workspaceId);
  }

  async refreshUnitVariableCache(workspaceId: number): Promise<void> {
    return this.queryService.refreshUnitVariableCache(workspaceId);
  }

  // Download Methods
  async downloadTestFile(workspaceId: number, fileId: number): Promise<FileDownloadDto> {
    return this.downloadService.downloadTestFile(workspaceId, fileId);
  }

  async downloadWorkspaceFilesAsZip(workspaceId: number, fileTypes?: string[]): Promise<Buffer> {
    return this.downloadService.downloadWorkspaceFilesAsZip(workspaceId, fileTypes);
  }

  async getUnitContent(workspaceId: number, unitId: number): Promise<string> {
    return this.downloadService.getUnitContent(workspaceId, unitId);
  }

  async getTestTakerContent(workspaceId: number, testTakerId: string): Promise<string> {
    return this.downloadService.getTestTakerContent(workspaceId, testTakerId);
  }

  async getCodingSchemeByRef(workspaceId: number, codingSchemeRef: string): Promise<FileDownloadDto | null> {
    return this.downloadService.getCodingSchemeByRef(workspaceId, codingSchemeRef);
  }

  async getVariableInfoForScheme(workspaceId: number, schemeFileId: string): Promise<VariableInfo[]> {
    return this.downloadService.getVariableInfoForScheme(workspaceId, schemeFileId);
  }

  // Validation Methods
  async validateTestFiles(workspaceId: number): Promise<FileValidationResultDto> {
    return this.validationService.validateTestFiles(workspaceId);
  }

  async validateVariables(workspaceId: number, page?: number, limit?: number): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.validationService.validateVariables(workspaceId, page, limit);
  }

  async validateVariableTypes(workspaceId: number, page?: number, limit?: number): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.validationService.validateVariableTypes(workspaceId, page, limit);
  }

  async validateTestTakers(workspaceId: number): Promise<TestTakersValidationDto> {
    return this.validationService.validateTestTakers(workspaceId);
  }

  async validateDuplicateResponses(
    workspaceId: number,
    page?: number,
    limit?: number
  ): Promise<DuplicateResponsesResultDto> {
    return this.validationService.validateDuplicateResponses(workspaceId, page, limit);
  }

  async validateResponseStatus(workspaceId: number, page?: number, limit?: number): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.validationService.validateResponseStatus(workspaceId, page, limit);
  }

  async validateGroupResponses(workspaceId: number, page?: number, limit?: number): Promise<{
    testTakersFound: boolean;
    groupsWithResponses: { group: string; hasResponse: boolean }[];
    allGroupsHaveResponses: boolean;
    total: number;
    page: number;
    limit: number;
  }> {
    return this.validationService.validateGroupResponses(workspaceId, page, limit);
  }

  async deleteInvalidResponses(workspaceId: number, responseIds: number[]): Promise<number> {
    return this.validationService.deleteInvalidResponses(workspaceId, responseIds);
  }

  async deleteAllInvalidResponses(
    workspaceId: number,
    validationType: 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses'
  ): Promise<number> {
    return this.validationService.deleteAllInvalidResponses(workspaceId, validationType);
  }

  // Upload Methods
  async uploadTestFiles(
    workspaceId: number,
    files: FileIo[],
    overwriteExisting: boolean,
    overwriteFileIds?: string[]
  ): Promise<TestFilesUploadResultDto> {
    return this.uploadService.uploadTestFiles(workspaceId, files, overwriteExisting, overwriteFileIds);
  }

  async deleteTestFiles(workspaceId: number, fileIds: string[]): Promise<boolean> {
    return this.uploadService.deleteTestFiles(workspaceId, fileIds);
  }

  async createDummyTestTakerFile(workspaceId: number): Promise<boolean> {
    return this.uploadService.createDummyTestTakerFile(workspaceId);
  }

  async testCenterImport(
    entries: Record<string, unknown>[],
    overwriteFileIds?: string[]
  ): Promise<TestFilesUploadResultDto> {
    return this.uploadService.testCenterImport(entries, overwriteFileIds);
  }
}
