import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { FileIo } from '../../admin/workspace/file-io.interface';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { TestFilesUploadResultDto } from '../../../../../../api-dto/files/test-files-upload-result.dto';
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';
import { UnitVariableDetailsDto } from '../../models/unit-variable-details.dto';
import { TestTakersValidationDto } from '../../../../../../api-dto/files/testtakers-validation.dto';
import { InvalidVariableDto } from '../../../../../../api-dto/files/variable-validation.dto';
import { DuplicateResponsesResultDto } from '../../../../../../api-dto/files/duplicate-response.dto';
import { WorkspaceFilesFacade } from './workspace-files-facade.service';

/**
 * WorkspaceFilesService
 *
 * LEGACY SERVICE - Being gradually migrated to use WorkspaceFilesFacade
 */
@Injectable()
export class WorkspaceFilesService implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceFilesService.name);

  constructor(
    private readonly facade: WorkspaceFilesFacade
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing WorkspaceFilesService');
    // Note: Initialization logic moved to facade if needed,
    // but usually facade handles delegation and specialized services handle logic.
  }

  async findAllFileTypes(workspaceId: number): Promise<string[]> {
    return this.facade.findAllFileTypes(workspaceId);
  }

  async getVariablePageMap(unitName: string, workspaceId: number): Promise<Map<string, string>> {
    return this.facade.getVariablePageMap(unitName, workspaceId);
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
    return this.facade.findFiles(workspaceId, options);
  }

  async deleteTestFiles(workspaceId: number, fileIds: string[]): Promise<boolean> {
    return this.facade.deleteTestFiles(workspaceId, fileIds);
  }

  async validateTestFiles(workspaceId: number): Promise<FileValidationResultDto> {
    return this.facade.validateTestFiles(workspaceId);
  }

  async createDummyTestTakerFile(workspaceId: number): Promise<boolean> {
    return this.facade.createDummyTestTakerFile(workspaceId);
  }

  async getUnitsWithFileIds(workspaceId: number): Promise<{ unitId: string; fileName: string }[]> {
    return this.facade.getUnitsWithFileIds(workspaceId);
  }

  async uploadTestFiles(
    workspaceId: number,
    files: FileIo[],
    overwriteExisting: boolean,
    overwriteFileIds?: string[]
  ): Promise<TestFilesUploadResultDto> {
    return this.facade.uploadTestFiles(workspaceId, files, overwriteExisting, overwriteFileIds);
  }

  async downloadTestFile(workspaceId: number, fileId: number): Promise<FileDownloadDto> {
    return this.facade.downloadTestFile(workspaceId, fileId);
  }

  async getUnitContent(workspaceId: number, unitId: number): Promise<string> {
    return this.facade.getUnitContent(workspaceId, unitId);
  }

  async getTestTakerContent(workspaceId: number, testTakerId: string): Promise<string> {
    return this.facade.getTestTakerContent(workspaceId, testTakerId);
  }

  async getCodingSchemeByRef(workspaceId: number, codingSchemeRef: string): Promise<FileDownloadDto | null> {
    return this.facade.getCodingSchemeByRef(workspaceId, codingSchemeRef);
  }

  async getVariableInfoForScheme(workspaceId: number, schemeFileId: string): Promise<VariableInfo[]> {
    return this.facade.getVariableInfoForScheme(workspaceId, schemeFileId);
  }

  async downloadWorkspaceFilesAsZip(workspaceId: number, fileTypes?: string[]): Promise<Buffer> {
    return this.facade.downloadWorkspaceFilesAsZip(workspaceId, fileTypes);
  }

  async validateVariables(workspaceId: number, page?: number, limit?: number): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.facade.validateVariables(workspaceId, page, limit);
  }

  async validateVariableTypes(workspaceId: number, page?: number, limit?: number): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.facade.validateVariableTypes(workspaceId, page, limit);
  }

  async validateTestTakers(workspaceId: number): Promise<TestTakersValidationDto> {
    return this.facade.validateTestTakers(workspaceId);
  }

  async validateDuplicateResponses(
    workspaceId: number,
    page?: number,
    limit?: number
  ): Promise<DuplicateResponsesResultDto> {
    return this.facade.validateDuplicateResponses(workspaceId, page, limit);
  }

  async validateResponseStatus(workspaceId: number, page?: number, limit?: number): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.facade.validateResponseStatus(workspaceId, page, limit);
  }

  async validateGroupResponses(workspaceId: number, page?: number, limit?: number): Promise<{
    testTakersFound: boolean;
    groupsWithResponses: { group: string; hasResponse: boolean }[];
    allGroupsHaveResponses: boolean;
    total: number;
    page: number;
    limit: number;
  }> {
    return this.facade.validateGroupResponses(workspaceId, page, limit);
  }

  async deleteInvalidResponses(workspaceId: number, responseIds: number[]): Promise<number> {
    return this.facade.deleteInvalidResponses(workspaceId, responseIds);
  }

  async deleteAllInvalidResponses(
    workspaceId: number,
    validationType: 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses'
  ): Promise<number> {
    return this.facade.deleteAllInvalidResponses(workspaceId, validationType);
  }

  async getUnitVariableMap(workspaceId: number): Promise<Map<string, Set<string>>> {
    return this.facade.getUnitVariableMap(workspaceId);
  }

  async getUnitVariableDetails(workspaceId: number): Promise<UnitVariableDetailsDto[]> {
    return this.facade.getUnitVariableDetails(workspaceId);
  }

  async testCenterImport(
    entries: Record<string, unknown>[],
    overwriteFileIds?: string[]
  ): Promise<TestFilesUploadResultDto> {
    return this.facade.testCenterImport(entries, overwriteFileIds);
  }
}
