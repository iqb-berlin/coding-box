import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  Inject, Injectable, Logger, Optional, NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager, FindOperator, In, Like, QueryRunner, Repository
} from 'typeorm';
import * as cheerio from 'cheerio';
import AdmZip = require('adm-zip');
import * as path from 'path';

import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import type { DerivedVariableMetadataSnapshot } from './workspace-file-metadata-reader.token';
import { WorkspaceFileMetadataService } from './workspace-file-metadata.service';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import FileUpload, {
  NO_CODING_SCHEME_REF_NORMALIZED,
  StructuredFileData
} from '../../entities/file_upload.entity';
import { FilesDto } from '../../../../../../../api-dto/files/files.dto';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { FileDownloadDto } from '../../../../../../../api-dto/files/file-download.dto';
import {
  TestFilesUploadConflictDto,
  TestFilesUploadFailedDto,
  TestFilesUploadResultDto,
  TestFilesUploadUploadedDto
} from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { FileValidationResultDto } from '../../../../../../../api-dto/files/file-validation-result.dto';
import { ResponseDto } from '../../../../../../../api-dto/responses/response-dto';
import {
  InvalidVariableDto,
  VariableValidationSummaryDto
} from '../../../../../../../api-dto/files/variable-validation.dto';
import { DuplicateResponsesResultDto } from '../../../../../../../api-dto/files/duplicate-response.dto';
import { Unit } from '../../entities/unit.entity';
import { UnitVariableDetailsDto } from '../../../models/unit-variable-details.dto';
import { ResponseEntity } from '../../entities/response.entity';
import {
  MissingPersonDto,
  TestTakerLoginDto,
  TestTakersValidationDto
} from '../../../../../../../api-dto/files/testtakers-validation.dto';
import Persons from '../../entities/persons.entity';

import { CodingStatisticsService } from '../coding/coding-statistics.service';
import { CodingFileCacheService } from '../coding/coding-file-cache.service';

import { CodingFreshnessService } from '../coding/coding-freshness.service';
import {
  CODING_PROCESS_CACHE_INVALIDATOR,
  CodingProcessCacheInvalidator
} from '../coding/coding-process-cache-invalidator.token';
import { WorkspaceXmlSchemaValidationService } from './workspace-xml-schema-validation.service';
import { WorkspaceFileStorageService } from './workspace-file-storage.service';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';
import { ResponseDeletionAuditContext, WorkspaceResponseValidationService } from '../validation/workspace-response-validation.service';

import { WorkspaceTestFilesValidationService } from '../validation/workspace-test-files-validation.service';
import { CacheService } from '../../../cache/cache.service';
import { EXCLUSION_CACHE_PREFIX } from './workspace-constants';

import { WorkspaceTestResultsService } from '../test-results/workspace-test-results.service';

import {
  assertValidRegexSearchPattern,
  withRegexSearchStatementTimeout
} from '../../../utils/regex-search.util';

import { withWorkspaceFilesMutationLock } from '../shared/workspace-files-lock.util';

export type { DerivedVariableMetadataSnapshot } from './workspace-file-metadata-reader.token';

type WorkspaceUnitVisibility = {
  globalIgnoredUnits: Set<string>;
  visibleUnitIds: Set<string> | null;
};

interface VocsCode {
  id?: unknown;
  label?: unknown;
  manualInstruction?: unknown;
  [key: string]: unknown;
}

type WorkspaceFilesMutationContext = {
  manager: EntityManager;
  fileUploadRepository: Repository<FileUpload>;
};

interface VocsVariableCoding {
  id?: unknown;
  alias?: unknown;
  label?: unknown;
  page?: unknown;
  codeModel?: unknown;
  manualInstruction?: unknown;
  codes?: VocsCode[];
  [key: string]: unknown;
}

interface ParsedCodingScheme {
  variableCodings?: VocsVariableCoding[];
}

interface CodingSchemeFreshnessImpact {
  autoCodingChanged: boolean;
  manualCodingChanged: boolean;
}

type UploadedFileForCacheInvalidation = {
  fileId?: string;
  filename?: string;
  fileType?: string;
};

@Injectable()
export class WorkspaceFilesService {
  private readonly logger = new Logger(WorkspaceFilesService.name);
  private readonly resourceTypeLabel = 'Resource';

  private toFileWriteData(file: FileUpload): QueryDeepPartialEntity<FileUpload> {
    const { structured_data: structuredData, ...columns } = file;
    return {
      ...columns,
      // PostgreSQL serializes jsonb as one value. TypeORM's deep partial type
      // instead treats its arbitrary JSON keys as nested entity properties.
      structured_data: structuredData as QueryDeepPartialEntity<StructuredFileData>
    };
  }

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @Inject(CodingStatisticsService)
    private codingStatisticsService: CodingStatisticsService,
    private workspaceXmlSchemaValidationService: WorkspaceXmlSchemaValidationService,
    private workspaceFileStorageService: WorkspaceFileStorageService,
    private workspaceFileParsingService: WorkspaceFileParsingService,
    private workspaceResponseValidationService: WorkspaceResponseValidationService,
    private workspaceTestFilesValidationService: WorkspaceTestFilesValidationService,
    private cacheService: CacheService,
    @Inject(WorkspaceTestResultsService)
    private readonly workspaceTestResultsService: WorkspaceTestResultsService,
    private readonly fileMetadata: WorkspaceFileMetadataService,
    @Optional()
    @Inject(CodingFreshnessService)
    private readonly codingFreshnessService?: CodingFreshnessService,
    @Optional()
    private readonly codingFileCacheService?: CodingFileCacheService,
    @Optional()
    @Inject(CODING_PROCESS_CACHE_INVALIDATOR)
    private readonly codingProcessCacheInvalidator?: CodingProcessCacheInvalidator
  ) {}

  private async getWorkspaceUnitVisibility(
    workspaceId: number
  ): Promise<WorkspaceUnitVisibility> {
    return this.fileMetadata.getWorkspaceUnitVisibility(workspaceId);
  }

  private isUnitVisibleInWorkspace(
    unitId: string | null | undefined,
    visibility: WorkspaceUnitVisibility
  ): boolean {
    return this.fileMetadata.isUnitVisibleInWorkspace(unitId, visibility);
  }

  private getResourceSubtypeExtension(fileType: string): string | null {
    const match = fileType.match(/^Resource\s*\((\.[^)]+)\)$/i);
    return match ? match[1].toLowerCase() : null;
  }

  private isCodingSchemeFileId(fileId: unknown): boolean {
    return String(fileId || '').trim().toUpperCase().endsWith('.VOCS');
  }

  private isUploadedCodingSchemeFile(
    file: UploadedFileForCacheInvalidation
  ): boolean {
    return [file.fileId, file.filename]
      .some(value => this.isCodingSchemeFileId(value));
  }

  private shouldInvalidateCodingStatisticsAfterUpload(
    result: TestFilesUploadResultDto
  ): boolean {
    const uploadedFiles = result.uploadedFiles || [];
    if (uploadedFiles.length === 0) {
      return false;
    }
    return !uploadedFiles.every(file => this.isUploadedCodingSchemeFile(file));
  }

  private hasUploadedFiles(result: TestFilesUploadResultDto): boolean {
    return (result.uploadedFiles || []).length > 0;
  }

  private mergeExtractedFileInfo(
    existingStructuredData: unknown,
    extractedInfo: Record<string, unknown>
  ): StructuredFileData {
    const existing =
      existingStructuredData &&
      typeof existingStructuredData === 'object' &&
      !Array.isArray(existingStructuredData) ?
        existingStructuredData as StructuredFileData :
        {};

    return {
      ...existing,
      extractedInfo: {
        ...(existing.extractedInfo || {}),
        ...extractedInfo
      }
    };
  }

  private async enrichTestCenterUnitEntry(
    entry: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (String(entry.file_type || '').toLowerCase() !== 'unit') {
      return entry;
    }
    if (entry.data === null || entry.data === undefined) {
      return entry;
    }

    try {
      const xmlContent = Buffer.isBuffer(entry.data) ?
        entry.data.toString('utf8') :
        String(entry.data);
      const xmlDocument = cheerio.load(xmlContent, { xmlMode: true });
      const extractedInfo =
        await this.workspaceFileParsingService.extractUnitInfo(xmlDocument);

      if (Object.keys(extractedInfo).length === 0) {
        return entry;
      }

      return {
        ...entry,
        structured_data: this.mergeExtractedFileInfo(
          entry.structured_data,
          extractedInfo
        )
      };
    } catch (error) {
      this.logger.warn(
        `Could not extract Unit metadata from Testcenter import file ${
          String(entry.file_id || entry.filename || '')
        }: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return entry;
    }
  }

  private async enrichTestCenterImportEntries(
    entries: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[]> {
    const enrichedEntries =
      await Promise.all(entries.map(entry => this.enrichTestCenterUnitEntry(entry)));
    return enrichedEntries.map(entry => this.withNormalizedFileLookupFields(entry));
  }

  private normalizeCodingSchemeUnitName(fileId: unknown): string {
    return String(fileId || '')
      .trim()
      .toUpperCase()
      .replace(/\.VOCS$/i, '');
  }

  private normalizeFileIdForLookup(fileId: unknown): string | null {
    const normalized = String(fileId || '')
      .trim()
      .toUpperCase()
      .replace(/\.XML$/i, '');
    return normalized || null;
  }

  private normalizeCodingSchemeRefForLookup(value: unknown): string | null {
    const normalized = String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\.VOCS$/i, '')
      .replace(/\.XML$/i, '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || '';
    return normalized || null;
  }

  private getCodingSchemeRefForLookup(
    fileType: unknown,
    structuredData: StructuredFileData | null | undefined
  ): string | null {
    if (String(fileType || '').toLowerCase() !== 'unit') {
      return null;
    }

    const extractedInfo = structuredData?.extractedInfo || {};
    const refs = extractedInfo.codingSchemeRefs;
    if (Array.isArray(refs) && refs.length > 0) {
      return this.normalizeCodingSchemeRefForLookup(refs[0]) ||
        NO_CODING_SCHEME_REF_NORMALIZED;
    }

    return this.normalizeCodingSchemeRefForLookup(
      extractedInfo.codingSchemeRefNormalized ||
        extractedInfo.codingSchemeRef
    ) || NO_CODING_SCHEME_REF_NORMALIZED;
  }

  private withNormalizedFileLookupFields(
    entry: Record<string, unknown>
  ): Record<string, unknown> {
    const structuredData = entry.structured_data as StructuredFileData | null | undefined;
    return {
      ...entry,
      file_id_normalized: this.normalizeFileIdForLookup(entry.file_id),
      coding_scheme_ref_normalized: this.getCodingSchemeRefForLookup(
        entry.file_type,
        structuredData
      )
    };
  }

  private parseCodingSchemeData(data: unknown): ParsedCodingScheme | null {
    if (data === null || data === undefined) {
      return null;
    }

    try {
      const parsed =
        typeof data === 'string' || Buffer.isBuffer(data) ?
          JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : data) :
          data;

      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      return parsed as ParsedCodingScheme;
    } catch {
      return null;
    }
  }

  private getCodingSchemeVariableMap(
    data: unknown
  ): Map<string, VocsVariableCoding> | null {
    const parsed = this.parseCodingSchemeData(data);
    if (!parsed || !Array.isArray(parsed.variableCodings)) {
      return null;
    }

    const variables = new Map<string, VocsVariableCoding>();
    parsed.variableCodings.forEach(variableCoding => {
      const key = this.getCodingSchemeVariableKey(variableCoding);
      if (key) {
        variables.set(key, variableCoding);
      }
    });
    return variables;
  }

  private getCodingSchemeVariableKey(variableCoding: VocsVariableCoding): string {
    return String(variableCoding.id || variableCoding.alias || '').trim();
  }

  private getCodingSchemeRuleSignature(variableCoding: VocsVariableCoding): string {
    return this.stableStringify(
      this.omitKeysDeep(
        variableCoding,
        new Set(['manualInstruction', 'label', 'page'])
      )
    );
  }

  private getCodingSchemeManualSignature(variableCoding: VocsVariableCoding): string {
    const codes = Array.isArray(variableCoding.codes) ?
      variableCoding.codes.map(code => ({
        id: code.id ?? null,
        label: code.label ?? null,
        manualInstruction: code.manualInstruction ?? null
      })) :
      [];

    return this.stableStringify({
      codeModel: variableCoding.codeModel ?? null,
      label: variableCoding.label ?? null,
      manualInstruction: variableCoding.manualInstruction ?? null,
      page: variableCoding.page ?? null,
      codes
    });
  }

  private omitKeysDeep(value: unknown, omittedKeys: Set<string>): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.omitKeysDeep(item, omittedKeys));
    }

    if (!value || typeof value !== 'object') {
      return value ?? null;
    }

    const result: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>)
      .sort()
      .forEach(key => {
        if (!omittedKeys.has(key)) {
          result[key] = this.omitKeysDeep(
            (value as Record<string, unknown>)[key],
            omittedKeys
          );
        }
      });
    return result;
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.sortObjectKeysDeep(value));
  }

  private sortObjectKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.sortObjectKeysDeep(item));
    }

    if (!value || typeof value !== 'object') {
      return value ?? null;
    }

    const result: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>)
      .sort()
      .forEach(key => {
        result[key] = this.sortObjectKeysDeep(
          (value as Record<string, unknown>)[key]
        );
      });
    return result;
  }

  private codingSchemeDataToText(data: unknown): string {
    if (data === null || data === undefined) {
      return '';
    }
    if (Buffer.isBuffer(data)) {
      return data.toString('utf8');
    }
    if (typeof data === 'string') {
      return data;
    }
    return this.stableStringify(data);
  }

  private getCodingSchemeFreshnessImpact(
    previousData: unknown,
    nextData: unknown
  ): CodingSchemeFreshnessImpact {
    const previousVariables = previousData === null || previousData === undefined ?
      new Map<string, VocsVariableCoding>() :
      this.getCodingSchemeVariableMap(previousData);
    const nextVariables = this.getCodingSchemeVariableMap(nextData);

    if (!previousVariables || !nextVariables) {
      const changed =
        this.codingSchemeDataToText(previousData) !== this.codingSchemeDataToText(nextData);
      return {
        autoCodingChanged: changed,
        manualCodingChanged: changed
      };
    }

    const allVariableKeys = new Set([
      ...previousVariables.keys(),
      ...nextVariables.keys()
    ]);
    let autoCodingChanged = false;
    let manualCodingChanged = false;

    allVariableKeys.forEach(variableKey => {
      const previousVariable = previousVariables.get(variableKey);
      const nextVariable = nextVariables.get(variableKey);

      if (!previousVariable || !nextVariable) {
        autoCodingChanged = true;
        manualCodingChanged = true;
        return;
      }

      if (
        this.getCodingSchemeRuleSignature(previousVariable) !==
        this.getCodingSchemeRuleSignature(nextVariable)
      ) {
        autoCodingChanged = true;
        manualCodingChanged = true;
        return;
      }

      if (
        this.getCodingSchemeManualSignature(previousVariable) !==
        this.getCodingSchemeManualSignature(nextVariable)
      ) {
        manualCodingChanged = true;
      }
    });

    return { autoCodingChanged, manualCodingChanged };
  }

  private async markCodingSchemeFreshnessAfterFileChange(
    workspaceId: number,
    fileId: unknown,
    previousData: unknown,
    nextData: unknown,
    manager?: EntityManager
  ): Promise<TestResultsUploadIssueDto | undefined> {
    if (!this.codingFreshnessService || !this.isCodingSchemeFileId(fileId)) {
      return undefined;
    }

    const unitName = this.normalizeCodingSchemeUnitName(fileId);
    if (!unitName) {
      return undefined;
    }

    const impact = this.getCodingSchemeFreshnessImpact(previousData, nextData);
    if (!impact.autoCodingChanged && !impact.manualCodingChanged) {
      return undefined;
    }

    try {
      const scope = {
        autoCodingSchemeRefs: impact.autoCodingChanged ? [unitName] : [],
        manualCodingSchemeRefs: impact.manualCodingChanged ? [unitName] : []
      };
      if (manager) {
        await this.codingFreshnessService.markUnitsStaleAfterCodingSchemeChange(
          workspaceId,
          scope,
          manager
        );
      } else {
        await this.codingFreshnessService.markUnitsStaleAfterCodingSchemeChange(
          workspaceId,
          scope
        );
      }
      return undefined;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not update coding freshness after coding scheme change ${unitName}: ${detail}`
      );
      return {
        level: 'warning',
        category: 'coding_freshness',
        message: 'Datei wurde gespeichert, aber der Kodierstand konnte nicht zuverlässig aktualisiert werden. Bitte prüfen Sie den Kodierstand erneut.',
        fileName: String(fileId || unitName)
      };
    }
  }

  async findAllFileTypes(workspaceId: number): Promise<string[]> {
    this.logger.log(`Fetching all file types for workspace: ${workspaceId}`);

    try {
      const result = await this.fileUploadRepository
        .createQueryBuilder('file')
        .select('DISTINCT file.file_type', 'file_type')
        .where('file.workspace_id = :workspaceId', { workspaceId })
        .andWhere('file.file_type IS NOT NULL')
        .getRawMany();

      const fileTypes = result.map(item => item.file_type);
      const resourceExtensions = new Set(['.vocs', '.voud', '.vomd', '.html']);
      if (fileTypes.includes(this.resourceTypeLabel)) {
        const resourceFiles = await this.fileUploadRepository
          .createQueryBuilder('file')
          .select('file.filename', 'filename')
          .where('file.workspace_id = :workspaceId', { workspaceId })
          .andWhere('file.file_type = :fileType', {
            fileType: this.resourceTypeLabel
          })
          .getRawMany();

        const resourceSubTypes = new Set<string>();
        resourceFiles.forEach(({ filename }) => {
          const extension = path.extname(String(filename)).toLowerCase();
          if (resourceExtensions.has(extension)) {
            resourceSubTypes.add(`${this.resourceTypeLabel} (${extension})`);
          }
        });

        resourceSubTypes.forEach(t => fileTypes.push(t));
      }

      return Array.from(new Set(fileTypes)).sort();
    } catch (error) {
      this.logger.error(
        `Error fetching file types for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return [];
    }
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
    this.logger.log(`Fetching test files for workspace: ${workspaceId}`);
    const {
      page = 1,
      limit = 20,
      fileType,
      fileSize,
      searchText,
      regexSearch
    } = options || {};
    const MAX_LIMIT = 10000;
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

    const runFindFiles = async (
      queryRunner?: QueryRunner
    ): Promise<[FilesDto[], number, string[]]> => {
      let qb = this.fileUploadRepository
        .createQueryBuilder('file', queryRunner)
        .where('file.workspace_id = :workspaceId', { workspaceId });

      if (fileType) {
        const resourceExtension = this.getResourceSubtypeExtension(fileType);
        if (resourceExtension) {
          qb = qb
            .andWhere('file.file_type = :fileType', {
              fileType: this.resourceTypeLabel
            })
            .andWhere('LOWER(file.filename) LIKE :extension', {
              extension: `%${resourceExtension}`
            });
        } else {
          qb = qb.andWhere('file.file_type = :fileType', { fileType });
        }
      }

      if (fileSize) {
        const KB = 1024;
        const MB = 1024 * KB;
        // eslint-disable-next-line default-case
        switch (fileSize) {
          case '0-10KB':
            qb = qb.andWhere('file.file_size < :max', { max: 10 * KB });
            break;
          case '10KB-100KB':
            qb = qb.andWhere('file.file_size >= :min AND file.file_size < :max', {
              min: 10 * KB,
              max: 100 * KB
            });
            break;
          case '100KB-1MB':
            qb = qb.andWhere('file.file_size >= :min AND file.file_size < :max', {
              min: 100 * KB,
              max: MB
            });
            break;
          case '1MB-10MB':
            qb = qb.andWhere('file.file_size >= :min AND file.file_size < :max', {
              min: MB,
              max: 10 * MB
            });
            break;
          case '10MB+':
            qb = qb.andWhere('file.file_size >= :min', { min: 10 * MB });
            break;
        }
      }

      if (searchText) {
        if (regexSearch) {
          const searchRegex = assertValidRegexSearchPattern(searchText, 'searchText');
          if (searchRegex) {
            qb = qb.andWhere(
              "(file.filename ~ :searchRegex OR file.file_type ~ :searchRegex OR TO_CHAR(file.created_at, 'DD.MM.YYYY HH24:MI') ~ :searchRegex)",
              { searchRegex }
            );
          }
        } else {
          const search = `%${searchText.toLowerCase()}%`;
          qb = qb.andWhere(
            "(LOWER(file.filename) LIKE :search OR LOWER(file.file_type) LIKE :search OR TO_CHAR(file.created_at, 'DD.MM.YYYY HH24:MI') ILIKE :search)",
            { search }
          );
        }
      }

      qb = qb
        .select([
          'file.id',
          'file.filename',
          'file.file_id',
          'file.file_size',
          'file.file_type',
          'file.created_at'
        ])
        .orderBy('file.created_at', 'DESC')
        .skip((validPage - 1) * validLimit)
        .take(validLimit);

      const [files, total] = await qb.getManyAndCount();
      this.logger.log(
        `Found ${files.length} files (page ${validPage}, limit ${validLimit}, total ${total}).`
      );

      const fileTypes = await this.findAllFileTypes(workspaceId);

      return [files, total, fileTypes];
    };

    if (regexSearch) {
      return withRegexSearchStatementTimeout(
        this.fileUploadRepository.manager.connection,
        runFindFiles
      );
    }

    return runFindFiles();
  }

  async deleteTestFiles(
    workspace_id: number,
    fileIds: string[]
  ): Promise<boolean> {
    return withWorkspaceFilesMutationLock(
      this.fileUploadRepository.manager.connection,
      workspace_id,
      queryRunner => this.deleteTestFilesUnlocked(
        workspace_id,
        fileIds,
        this.getWorkspaceFilesMutationContext(queryRunner)
      )
    );
  }

  private getWorkspaceFilesMutationContext(
    queryRunner: QueryRunner
  ): WorkspaceFilesMutationContext {
    return {
      manager: queryRunner.manager,
      fileUploadRepository: queryRunner.manager.getRepository(FileUpload)
    };
  }

  private async deleteTestFilesUnlocked(
    workspace_id: number,
    fileIds: string[],
    mutationContext: WorkspaceFilesMutationContext
  ): Promise<boolean> {
    this.logger.log(`Delete test files for workspace ${workspace_id}`);
    const numericIds = Array.from(new Set(
      fileIds
        .filter(id => /^[1-9]\d*$/.test(id))
        .map(id => Number(id))
        .filter(id => Number.isSafeInteger(id))
    ));

    if (numericIds.length === 0) {
      this.logger.warn(
        `No valid test file IDs provided for workspace ${workspace_id}`
      );
      return false;
    }

    const res = await mutationContext.fileUploadRepository
      .createQueryBuilder()
      .delete()
      .from(FileUpload)
      .where('workspace_id = :workspaceId', { workspaceId: workspace_id })
      .andWhere('id IN (:...ids)', { ids: numericIds })
      .execute();

    // Invalidate memory caches inside this service
    await this.invalidateWorkspaceFileCaches(workspace_id);

    // Invalidate coding statistics cache since test files changed
    await this.codingStatisticsService.invalidateCache(workspace_id);

    const deletedCount = res.affected ?? 0;
    const success = deletedCount === numericIds.length;
    if (!success) {
      this.logger.warn(
        `Requested deletion of ${numericIds.length} test files for workspace ${workspace_id}, but deleted ${deletedCount}`
      );
    }

    return success;
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
    return withWorkspaceFilesMutationLock(
      this.fileUploadRepository.manager.connection,
      workspaceId,
      queryRunner => this.createDummyTestTakerFileUnlocked(
        workspaceId,
        this.getWorkspaceFilesMutationContext(queryRunner)
      )
    );
  }

  private async createDummyTestTakerFileUnlocked(
    workspaceId: number,
    mutationContext: WorkspaceFilesMutationContext
  ): Promise<boolean> {
    const { fileUploadRepository } = mutationContext;
    try {
      const booklets = await fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Booklet' }
      });

      if (!booklets || booklets.length === 0) {
        const units = await fileUploadRepository.find({
          where: { workspace_id: workspaceId, file_type: 'Unit' }
        });

        if (!units || units.length === 0) {
          this.logger.warn(
            `No booklets or units found in workspace with ID ${workspaceId}.`
          );
          return false;
        }

        // Create a fake booklet that includes all available units
        const unitRefs = units
          .map(unit => `  <Unit id="${unit.file_id}"/>`)
          .join('\n');
        const fakeBookletId = 'AUTO-GENERATED-BOOKLET';
        const fakeBookletXml = `<?xml version="1.0" encoding="utf-8"?>
<Booklet>
  <Metadata>
    <Id>${fakeBookletId}</Id>
    <Label>Auto-generated Booklet</Label>
    <Description>Auto-generated booklet including all units</Description>
  </Metadata>
  <Units>
${unitRefs}
  </Units>
</Booklet>`;

        const fakeBooklet = fileUploadRepository.create({
          workspace_id: workspaceId,
          filename: 'auto-generated-booklet.xml',
          file_id: fakeBookletId,
          file_type: 'Booklet',
          file_size: fakeBookletXml.length,
          data: fakeBookletXml
        });

        await fileUploadRepository.save(fakeBooklet);
        this.logger.log(
          `Created fake booklet for workspace ${workspaceId} with ${units.length} units.`
        );

        const dummyTestTakerXml = `<?xml version="1.0" encoding="utf-8"?>
<TestTakers>
  <Metadata>
    <Description>Auto-generated TestTakers file with auto-generated booklet</Description>
  </Metadata>
  <Group id="auto-generated" label="Auto-generated">
    <Login name="auto-generated" mode="run-hot-return">
      <Booklet>${fakeBookletId}</Booklet>
    </Login>
  </Group>
</TestTakers>`;

        const newTestTakerFile = fileUploadRepository.create({
          workspace_id: workspaceId,
          filename: 'auto-generated-testtakers.xml',
          file_id: 'AUTO-GENERATED-TESTTAKERS',
          file_type: 'TestTakers',
          file_size: dummyTestTakerXml.length,
          data: dummyTestTakerXml
        });

        await fileUploadRepository.save(newTestTakerFile);
        this.logger.log(
          `Created dummy TestTakers file for workspace ${workspaceId} with auto-generated booklet.`
        );
        return true;
      }

      const bookletRefs = booklets
        .map(booklet => `    <Booklet>${booklet.file_id}</Booklet>`)
        .join('\n');

      const dummyTestTakerXml = `<?xml version="1.0" encoding="utf-8"?>
<TestTakers>
  <Metadata>
    <Description>Auto-generated TestTakers file including all booklets</Description>
  </Metadata>
  <Group id="auto-generated" label="Auto-generated">
    <Login name="auto-generated" mode="run-hot-return">
${bookletRefs}
    </Login>
  </Group>
</TestTakers>`;

      const newTestTakerFile = fileUploadRepository.create({
        workspace_id: workspaceId,
        filename: 'auto-generated-testtakers.xml',
        file_id: 'AUTO-GENERATED-TESTTAKERS',
        file_type: 'TestTakers',
        file_size: dummyTestTakerXml.length,
        data: dummyTestTakerXml
      });

      await fileUploadRepository.save(newTestTakerFile);

      this.logger.log(
        `Created dummy TestTakers file for workspace ${workspaceId} with ${booklets.length} booklets.`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Error creating dummy TestTakers file for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return false;
    }
  }

  async getUnitsWithFileIds(
    workspaceId: number
  ): Promise<{ id: number; unitId: string; fileName: string; data: string }[]> {
    try {
      const units = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_id: Like('%.VOCS')
        }
      });

      if (!units || units.length === 0) {
        this.logger.warn(
          `No schmemes found in workspace with ID ${workspaceId}.`
        );
        return [];
      }

      const visibility = await this.getWorkspaceUnitVisibility(workspaceId);
      return units
        .filter(unit => this.isUnitVisibleInWorkspace(unit.file_id, visibility))
        .map(unit => ({
          id: unit.id,
          unitId: unit.file_id,
          fileName: unit.filename,
          data: unit.data
        }));
    } catch (error) {
      this.logger.error(
        `Error getting units with file IDs for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return [];
    }
  }

  async getVocs(workspaceId: number, vocs: string): Promise<FilesDto[]> {
    try {
      const fileId = vocs.toUpperCase().endsWith('.VOCS') ?
        vocs.toUpperCase() :
        `${vocs.toUpperCase()}.VOCS`;

      const vocsFile = await this.fileUploadRepository.findOne({
        where: {
          workspace_id: workspaceId,
          file_id: fileId
        }
      });

      if (!vocsFile) {
        this.logger.warn(
          `VOCS file for ${vocs} not found in workspace ${workspaceId}`
        );
        return [];
      }

      return [
        {
          file_id: vocsFile.file_id,
          data: vocsFile.data.toString(),
          workspace_id: vocsFile.workspace_id
        }
      ];
    } catch (error) {
      this.logger.error(`Error retrieving VOCS file: ${getErrorMessage(error)}`);
      return [];
    }
  }

  async getItemIdsFromMetadataFiles(
    workspaceId: number
  ): Promise<{ fileId: string; id: number; items: string[] }[]> {
    try {
      const metadataFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Resource',
          filename: Like('%.vomd')
        }
      });

      const result: { fileId: string; id: number; items: string[] }[] = [];

      metadataFiles.forEach(file => {
        try {
          const content = JSON.parse(file.data);
          if (Array.isArray(content.items)) {
            const ids: string[] = [];
            content.items.forEach((item: { id?: string | number }) => {
              if (item.id) {
                ids.push(String(item.id));
              }
            });
            if (ids.length > 0) {
              result.push({
                fileId: file.file_id,
                id: file.id,
                items: ids.sort()
              });
            }
          }
        } catch (e) {
          this.logger.warn(
            `Failed to parse metadata file ${file.filename}: ${getErrorMessage(e)}`
          );
        }
      });

      return result.sort((a, b) => a.fileId.localeCompare(b.fileId));
    } catch (error) {
      this.logger.error(
        `Error fetching item IDs from metadata files: ${getErrorMessage(error)}`
      );
      return [];
    }
  }

  async uploadTestFiles(
    workspace_id: number,
    originalFiles: FileIo[],
    overwriteExisting: boolean,
    overwriteFileIds?: string[]
  ): Promise<TestFilesUploadResultDto> {
    return withWorkspaceFilesMutationLock(
      this.fileUploadRepository.manager.connection,
      workspace_id,
      queryRunner => this.uploadTestFilesUnlocked(
        workspace_id,
        originalFiles,
        overwriteExisting,
        overwriteFileIds,
        this.getWorkspaceFilesMutationContext(queryRunner)
      )
    );
  }

  private async uploadTestFilesUnlocked(
    workspace_id: number,
    originalFiles: FileIo[],
    overwriteExisting: boolean,
    overwriteFileIds: string[] | undefined,
    mutationContext: WorkspaceFilesMutationContext
  ): Promise<TestFilesUploadResultDto> {
    this.logger.log(`Uploading test files for workspace ${workspace_id}`);

    if (!Array.isArray(originalFiles)) {
      this.logger.error(
        `uploadTestFiles received non-array originalFiles for workspace ${workspace_id}`
      );
      return {
        total: 0,
        uploaded: 0,
        failed: 0,
        failedFiles: [
          { filename: 'unknown', reason: 'Invalid files input: not an array' }
        ]
      };
    }

    const overwriteAllowList =
      overwriteFileIds && overwriteFileIds.length > 0 ?
        new Set(
          overwriteFileIds
            .map(s => (s || '').trim().toUpperCase())
            .filter(Boolean)
        ) :
        undefined;

    const MAX_CONCURRENT_UPLOADS = 5;
    const processInBatches = async (
      files: FileIo[],
      batchSize: number,
      overwriteExistingParam: boolean,
      overwriteAllowListParam?: Set<string>
    ): Promise<TestFilesUploadResultDto> => {
      const conflicts: TestFilesUploadConflictDto[] = [];
      const failedFiles: TestFilesUploadFailedDto[] = [];
      const uploadedFiles: TestFilesUploadUploadedDto[] = [];
      const issues: TestResultsUploadIssueDto[] = [];
      let uploaded = 0;

      const isConflict = (
        value: unknown
      ): value is TestFilesUploadConflictDto & { conflict: true } => !!value &&
        typeof value === 'object' &&
        (value as { conflict?: unknown }).conflict === true;

      const isFailedResult = (
        value: unknown
      ): value is {
        failed: true;
        filename: string;
        reason: string;
        details?: string[];
      } => !!value &&
        typeof value === 'object' &&
        (value as { failed?: unknown }).failed === true &&
        typeof (value as { filename?: unknown }).filename === 'string' &&
        typeof (value as { reason?: unknown }).reason === 'string';

      const collectResultValue = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(collectResultValue);
          return;
        }

        if (value && typeof value === 'object') {
          const resultIssues = (value as { issues?: unknown }).issues;
          if (Array.isArray(resultIssues)) {
            issues.push(...(resultIssues as TestResultsUploadIssueDto[]));
          }
        }

        if (isFailedResult(value)) {
          failedFiles.push({
            filename: value.filename,
            reason: value.reason,
            details: Array.isArray(value.details) ? value.details : undefined
          });
          return;
        }

        if (isConflict(value)) {
          conflicts.push({
            fileId: value.fileId,
            filename: value.filename,
            fileType: value.fileType
          });
          return;
        }

        if (this.isUploaded(value)) {
          uploaded += 1;
          uploadedFiles.push({
            fileId: value.fileId,
            filename: value.filename,
            fileType: value.fileType
          });
          return;
        }

        if (typeof value !== 'undefined') {
          uploaded += 1;
        }
      };

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const tasks: Array<{ filename: string; promise: Promise<unknown> }> =
          [];

        batch.forEach(file => {
          const promises = this.handleFile(
            workspace_id,
            file,
            overwriteExistingParam,
            overwriteAllowListParam,
            mutationContext
          );
          promises.forEach(p => tasks.push({ filename: file.originalname, promise: p })
          );
        });

        const settled = await Promise.allSettled(tasks.map(t => t.promise));
        settled.forEach((result, idx) => {
          const task = tasks[idx];
          if (result.status === 'rejected') {
            const reason = (result as PromiseRejectedResult).reason;
            failedFiles.push({
              filename: task?.filename || 'unknown',
              reason: reason instanceof Error ? reason.message : String(reason)
            });
            return;
          }

          collectResultValue(result.value);
        });
      }

      return {
        total: Array.isArray(originalFiles) ? originalFiles.length : 0,
        uploaded,
        failed: failedFiles.length,
        conflicts: conflicts.length > 0 ? conflicts : undefined,
        failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
        uploadedFiles: uploadedFiles.length > 0 ? uploadedFiles : undefined,
        issues: issues.length > 0 ? issues : undefined
      };
    };

    try {
      const result = await processInBatches(
        originalFiles,
        MAX_CONCURRENT_UPLOADS,
        overwriteExisting,
        overwriteAllowList
      );
      // Invalidate memory caches inside this service
      await this.invalidateWorkspaceFileCaches(workspace_id);

      if (this.shouldInvalidateCodingStatisticsAfterUpload(result)) {
        await this.codingStatisticsService.invalidateCache(workspace_id);
      }
      if (this.hasUploadedFiles(result)) {
        await this.codingStatisticsService.invalidateIncompleteVariablesCache(
          workspace_id
        );
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Unexpected error while uploading files for workspace ${workspace_id}:`,
        error
      );
      return {
        total: Array.isArray(originalFiles) ? originalFiles.length : 0,
        uploaded: 0,
        failed: Array.isArray(originalFiles) ? originalFiles.length : 0,
        failedFiles: Array.isArray(originalFiles) ?
          originalFiles.map(file => ({
            filename: file.originalname,
            reason: getErrorMessage(error)
          })) :
          []
      };
    }
  }

  async downloadTestFile(
    workspace_id: number,
    fileId: number
  ): Promise<FileDownloadDto> {
    this.logger.log(
      `Downloading file with ID ${fileId} for workspace ${workspace_id}`
    );

    const file = await this.fileUploadRepository.findOne({
      where: { id: fileId, workspace_id: workspace_id }
    });

    if (!file) {
      this.logger.warn(
        `File with ID ${fileId} not found in workspace ${workspace_id}`
      );
      throw new Error('File not found');
    }

    this.logger.log(
      `File ${file.filename} found. Preparing to convert to Base64.`
    );

    let base64Data: string;
    try {
      // If data is already base64-encoded (binary files), use it directly
      // Base64 strings are valid UTF-8 and contain specific character patterns
      if (
        /^[A-Za-z0-9+/]*={0,2}$/.test(file.data) &&
        file.data.length % 4 === 0
      ) {
        base64Data = file.data;
        this.logger.log(`File ${file.filename} already stored as base64.`);
      } else {
        // For UTF-8 text files, convert the string to base64
        base64Data = Buffer.from(file.data, 'utf8').toString('base64');
        this.logger.log(
          `File ${file.filename} converted from UTF-8 to base64.`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to process file data for ${file.filename}, falling back to binary conversion: ${getErrorMessage(error)}`
      );
      base64Data = Buffer.from(file.data, 'binary').toString('base64');
    }

    this.logger.log(`File ${file.filename} successfully converted to Base64.`);

    return {
      filename: file.filename,
      base64Data,
      mimeType: 'application/xml'
    };
  }

  handleFile(
    workspaceId: number,
    file: FileIo,
    overwriteExisting: boolean,
    overwriteAllowList?: Set<string>,
    mutationContext?: WorkspaceFilesMutationContext
  ): Array<Promise<unknown>> {
    const filePromises: Array<Promise<unknown>> = [];
    const fileExtension = path.extname(file.originalname || '').toLowerCase();

    const normalizedMimetype = (file.mimetype || '')
      .toLowerCase()
      .split(';')[0]
      .trim();

    const xmlMimeTypes = ['text/xml', 'application/xml', 'application/x-xml'];

    if (
      fileExtension === '.xml' &&
      !xmlMimeTypes.includes(normalizedMimetype) &&
      this.shouldUseXmlUploadHandler(file)
    ) {
      filePromises.push(
        this.handleXmlFile(
          workspaceId,
          file,
          overwriteExisting,
          overwriteAllowList,
          mutationContext
        ).catch(error => this.toFailedUploadResult(file.originalname, error)
        )
      );
      return filePromises;
    }

    switch (normalizedMimetype) {
      case 'text/xml':
      case 'application/xml':
      case 'application/x-xml':
        filePromises.push(
          this.handleXmlFile(
            workspaceId,
            file,
            overwriteExisting,
            overwriteAllowList,
            mutationContext
          ).catch(error => this.toFailedUploadResult(file.originalname, error)
          )
        );
        break;
      case 'text/html':
        filePromises.push(
          this.handleHtmlFile(
            workspaceId,
            file,
            overwriteExisting,
            overwriteAllowList,
            mutationContext
          ).catch(error => this.toFailedUploadResult(file.originalname, error)
          )
        );
        break;
      case 'application/octet-stream':
        filePromises.push(
          this.handleOctetStreamFile(
            workspaceId,
            file,
            overwriteExisting,
            overwriteAllowList,
            mutationContext
          ).catch(error => this.toFailedUploadResult(file.originalname, error)
          )
        );
        break;
      case 'application/zip':
      case 'application/x-zip-compressed':
      case 'application/x-zip':
        filePromises.push(
          this.handleZipFile(
            workspaceId,
            file,
            overwriteExisting,
            overwriteAllowList,
            mutationContext
          )
        );
        break;
      default:
        this.logger.warn(`Unsupported file type: ${file.mimetype}`);
        filePromises.push(
          Promise.resolve(
            this.toFailedUploadResult(
              file.originalname,
              `Unsupported file type: ${file.mimetype}`
            )
          )
        );
    }

    return filePromises;
  }

  private unsupportedFile(message: string): Error {
    return new Error(message);
  }

  private toFailedUploadResult(
    filename: string,
    reason: unknown,
    details?: string[]
  ): {
    failed: true;
    filename: string;
    reason: string;
    details?: string[];
  } {
    return {
      failed: true,
      filename,
      reason: reason instanceof Error ? reason.message : String(reason),
      details: details && details.length > 0 ? details : undefined
    };
  }

  private shouldUseXmlUploadHandler(file: FileIo): boolean {
    try {
      const xmlDocument = cheerio.load(file.buffer.toString('utf8'), {
        xml: true
      });
      const firstChild = xmlDocument.root().children().first();
      const rootTagName = (firstChild.prop('tagName') || '').toString();
      const normalizedRootTagName = rootTagName.toUpperCase();

      return ['UNIT', 'BOOKLET', 'TESTTAKERS'].includes(normalizedRootTagName);
    } catch (_error) {
      return true;
    }
  }

  private async handleXmlFile(
    workspaceId: number,
    file: FileIo,
    overwriteExisting: boolean,
    overwriteAllowList?: Set<string>,
    mutationContext?: WorkspaceFilesMutationContext
  ): Promise<unknown> {
    const fileUploadRepository =
      mutationContext?.fileUploadRepository ?? this.fileUploadRepository;
    try {
      if (!file.buffer || !file.buffer.length) {
        this.logger.warn('Empty file buffer');
        return await Promise.resolve();
      }

      const xmlContent = file.buffer.toString('utf8');
      const xmlDocument = cheerio.load(file.buffer.toString('utf8'), {
        xml: true
      });
      const firstChild = xmlDocument.root().children().first();
      const rootTagName = firstChild ? firstChild.prop('tagName') : null;
      const normalizedRootTagName = (rootTagName || '').toUpperCase();

      if (!normalizedRootTagName) {
        throw this.unsupportedFile('Invalid XML: No root tag found');
      }

      const fileTypeMapping: Record<string, string> = {
        UNIT: 'Unit',
        BOOKLET: 'Booklet',
        TESTTAKERS: 'TestTakers'
      };

      const fileType = fileTypeMapping[normalizedRootTagName];
      if (!fileType) {
        throw this.unsupportedFile(`Unsupported root tag: ${rootTagName}`);
      }

      let xmlValidation: { schemaValid: boolean; errors: string[] };
      try {
        xmlValidation =
          await this.workspaceXmlSchemaValidationService.validateXmlViaXsdUrl(
            xmlContent
          );
      } catch (e) {
        const message =
          e instanceof Error ?
            e.message :
            'Unknown XML schema validation error';
        throw this.unsupportedFile(message);
      }

      if (!xmlValidation.schemaValid) {
        const maxErrors = 10;
        const errorsPreview = (xmlValidation.errors || []).slice(0, maxErrors);
        const failureMessage = `XSD validation failed: ${file.originalname}`;
        this.logger.warn(
          `XSD validation failed on upload: ${file.originalname} (errors: ${
            xmlValidation.errors.length
          }) ${JSON.stringify(errorsPreview)}`
        );
        return this.toFailedUploadResult(
          file.originalname,
          failureMessage,
          errorsPreview
        );
      }

      const metadata = xmlDocument('Metadata');
      const idElement = metadata.find('Id');
      const fileId = idElement.length ?
        idElement.text().toUpperCase().trim() :
        null;
      const resolvedFileId =
        fileType === 'TestTakers' ? fileId || file.originalname : fileId;
      if (!resolvedFileId) throw new Error('File metadata must contain an ID');
      const resolvedFileIdNormalized = resolvedFileId.toUpperCase();

      const existingFile = await fileUploadRepository.findOne({
        where: { file_id: resolvedFileId, workspace_id: workspaceId }
      });
      if (existingFile) {
        const overwriteAllowed =
          overwriteExisting &&
          (!overwriteAllowList ||
            overwriteAllowList.has(resolvedFileIdNormalized));
        if (!overwriteAllowed) {
          if (overwriteExisting && overwriteAllowList) {
            return await Promise.resolve();
          }
          this.logger.warn(
            `File with ID ${resolvedFileId} in Workspace ${workspaceId} already exists.`
          );
          return {
            conflict: true,
            fileId: resolvedFileId,
            filename: file.originalname,
            fileType
          };
        }
      }

      let extractedInfo: Record<string, unknown> = {};
      try {
        if (fileType === 'Unit') {
          extractedInfo =
            await this.workspaceFileParsingService.extractUnitInfo(xmlDocument);
        } else if (fileType === 'Booklet') {
          extractedInfo =
            await this.workspaceFileParsingService.extractBookletInfo(
              xmlDocument
            );
        } else if (fileType === 'TestTakers') {
          extractedInfo =
            await this.workspaceFileParsingService.extractTestTakersInfo(
              xmlDocument
            );
        }
        this.logger.log(
          `Extracted information from ${fileType} file: ${JSON.stringify(
            extractedInfo
          )}`
        );
      } catch (extractError) {
        this.logger.error(
          `Error extracting information from ${fileType} file: ${getErrorMessage(extractError)}`
        );
      }

      const structuredData: StructuredFileData = {
        extractedInfo
      };

      await fileUploadRepository.upsert(
        this.withNormalizedFileLookupFields({
          workspace_id: workspaceId,
          filename: file.originalname,
          file_type: fileType,
          file_size: file.size,
          created_at: new Date() as unknown as number,
          data: file.buffer.toString(),
          file_id: resolvedFileId,
          structured_data: structuredData
        }),
        ['file_id', 'workspace_id']
      );

      return {
        fileId: resolvedFileId,
        filename: file.originalname,
        fileType
      };
    } catch (error) {
      this.logger.error(`Error processing XML file: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  private async handleHtmlFile(
    workspaceId: number,
    file: FileIo,
    overwriteExisting: boolean,
    overwriteAllowList?: Set<string>,
    mutationContext?: WorkspaceFilesMutationContext
  ): Promise<unknown> {
    const fileUploadRepository =
      mutationContext?.fileUploadRepository ?? this.fileUploadRepository;
    try {
      const playerCode = file.buffer.toString();
      const playerContent = cheerio.load(playerCode);
      const metaDataElement = playerContent(
        'script[type="application/ld+json"]'
      );
      let metadata: Record<string, unknown> = {};

      try {
        metadata = JSON.parse(metaDataElement.text());
      } catch (metadataError) {
        this.logger.warn(
          `Error parsing metadata from HTML file: ${getErrorMessage(metadataError)}`
        );
      }
      const structuredData: StructuredFileData = {
        metadata
      };

      if (metadata['@type'] === 'schemer') {
        const resourceFileId =
          this.workspaceFileParsingService.getSchemerId(file);
        const existing = await fileUploadRepository.findOne({
          where: { file_id: resourceFileId, workspace_id: workspaceId }
        });
        const resourceFileIdNormalized = (resourceFileId || '').toUpperCase();
        const overwriteAllowed =
          overwriteExisting &&
          (!overwriteAllowList ||
            overwriteAllowList.has(resourceFileIdNormalized));
        if (existing && !overwriteAllowed) {
          if (overwriteExisting && overwriteAllowList) {
            return await Promise.resolve();
          }
          return {
            conflict: true,
            fileId: resourceFileId,
            filename: file.originalname,
            fileType: 'Schemer'
          };
        }
        await fileUploadRepository.upsert(
          this.withNormalizedFileLookupFields({
            filename: file.originalname,
            workspace_id: workspaceId,
            file_type: 'Schemer',
            file_size: file.size,
            created_at: new Date() as unknown as number,
            file_id: resourceFileId,
            data: file.buffer.toString(),
            structured_data: structuredData
          }),
          ['file_id', 'workspace_id']
        );

        return {
          fileId: resourceFileId,
          filename: file.originalname,
          fileType: 'Schemer'
        };
      }

      const resourceFileId = this.workspaceFileParsingService.getPlayerId(file);
      const existing = await fileUploadRepository.findOne({
        where: { file_id: resourceFileId, workspace_id: workspaceId }
      });
      const resourceFileIdNormalized = (resourceFileId || '').toUpperCase();
      const overwriteAllowed =
        overwriteExisting &&
        (!overwriteAllowList ||
          overwriteAllowList.has(resourceFileIdNormalized));
      if (existing && !overwriteAllowed) {
        if (overwriteExisting && overwriteAllowList) {
          return await Promise.resolve();
        }
        return {
          conflict: true,
          fileId: resourceFileId,
          filename: file.originalname,
          fileType: 'Resource'
        };
      }
      await fileUploadRepository.upsert(
        this.withNormalizedFileLookupFields({
          filename: file.originalname,
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_size: file.size,
          created_at: new Date() as unknown as number,
          file_id: resourceFileId,
          data: file.buffer.toString(),
          structured_data: structuredData
        }),
        ['file_id', 'workspace_id']
      );

      return {
        fileId: resourceFileId,
        filename: file.originalname,
        fileType: 'Resource'
      };
    } catch (error) {
      const resourceFileId =
        this.workspaceFileParsingService.getResourceId(file);
      await fileUploadRepository.upsert(
        this.withNormalizedFileLookupFields({
          filename: file.originalname,
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_size: file.size,
          created_at: new Date() as unknown as number,
          file_id: resourceFileId,
          data: file.buffer.toString(),
          structured_data: { metadata: {} }
        }),
        ['file_id', 'workspace_id']
      );

      return {
        fileId: resourceFileId,
        filename: file.originalname,
        fileType: 'Resource'
      };
    }
  }

  private async handleOctetStreamFile(
    workspaceId: number,
    file: FileIo,
    overwriteExisting: boolean,
    overwriteAllowList?: Set<string>,
    mutationContext?: WorkspaceFilesMutationContext
  ): Promise<unknown> {
    const fileUploadRepository =
      mutationContext?.fileUploadRepository ?? this.fileUploadRepository;
    this.logger.log(
      `Processing octet-stream file: ${file.originalname} for workspace ${workspaceId}`
    );
    try {
      const fileExtension = path.extname(file.originalname).toLowerCase();
      let fileType = 'Resource';
      let fileContent: string | Buffer;
      let extractedInfo: Record<string, unknown> = {};

      const textFileExtensions = [
        '.xml',
        '.html',
        '.htm',
        '.xhtml',
        '.txt',
        '.json',
        '.csv',
        '.voud',
        '.vocs',
        '.vomd'
      ];

      if (textFileExtensions.includes(fileExtension)) {
        // For text files, convert buffer to UTF8 string
        fileContent = file.buffer.toString('utf8');
      } else {
        // For binary files, convert to base64 to ensure valid UTF8 storage in database
        fileContent = file.buffer.toString('base64');
      }

      if (fileExtension === '.xml') {
        try {
          const $ = cheerio.load(fileContent as string, { xmlMode: true });
          if ($('Testtakers').length > 0) {
            fileType = 'TestTakers';
            extractedInfo = {
              rootElement: 'Testtakers',
              detectedVia: 'octet-stream-handler'
            };
          } else if ($('Booklet').length > 0) {
            fileType = 'Booklet';
            extractedInfo = {
              rootElement: 'Booklet',
              detectedVia: 'octet-stream-handler'
            };
          } else if ($('Unit').length > 0) {
            fileType = 'Unit';
            extractedInfo = {
              rootElement: 'Unit',
              detectedVia: 'octet-stream-handler',
              ...await this.workspaceFileParsingService.extractUnitInfo($)
            };
          } else if ($('SysCheck').length > 0) {
            fileType = 'SysCheck';
            extractedInfo = {
              rootElement: 'SysCheck',
              detectedVia: 'octet-stream-handler'
            };
          }
        } catch (error) {
          this.logger.warn(
            `Could not parse XML content for ${file.originalname}: ${getErrorMessage(error)}`
          );
        }
      }

      const structuredData: StructuredFileData = {
        extractedInfo
      };

      const fileUpload = fileUploadRepository.create(
        this.withNormalizedFileLookupFields({
          workspace_id: workspaceId,
          filename: file.originalname,
          file_id: file.originalname.toUpperCase(),
          file_type: fileType,
          file_size: file.size,
          created_at: new Date() as unknown as number,
          data: fileContent,
          structured_data: structuredData
        })
      );

      const existing = await fileUploadRepository.findOne({
        where: { file_id: fileUpload.file_id, workspace_id: workspaceId }
      });
      const fileIdNormalized = (fileUpload.file_id || '').toUpperCase();

      this.logger.log(
        `[OctetStream] Checking existing file: ID=${fileIdNormalized}, Exists=${!!existing}`
      );
      if (overwriteAllowList) {
        this.logger.log(
          `[OctetStream] OverwriteAllowList: ${Array.from(overwriteAllowList).join(', ')}`
        );
      }

      const overwriteAllowed =
        overwriteExisting &&
        (!overwriteAllowList || overwriteAllowList.has(fileIdNormalized));

      this.logger.log(
        `[OctetStream] Overwrite Decision: Allowed=${overwriteAllowed}, OverwriteExisting=${overwriteExisting}`
      );

      if (existing && !overwriteAllowed) {
        if (overwriteExisting && overwriteAllowList) {
          this.logger.log(
            `[OctetStream] Skipping because not in allow list: ${fileIdNormalized}`
          );
          return await Promise.resolve();
        }
        this.logger.log(
          `[OctetStream] Conflict detected for ${fileIdNormalized}`
        );
        return {
          conflict: true,
          fileId: fileUpload.file_id,
          filename: file.originalname,
          fileType
        };
      }

      this.logger.log(`[OctetStream] Proceeding to upsert ${fileIdNormalized}`);

      await fileUploadRepository.upsert(this.toFileWriteData(fileUpload), [
        'file_id',
        'workspace_id'
      ]);
      const freshnessIssue = await this.markCodingSchemeFreshnessAfterFileChange(
        workspaceId,
        fileUpload.file_id,
        existing?.data,
        fileContent,
        mutationContext?.manager
      );
      this.logger.log(
        `Successfully processed octet-stream file: ${file.originalname} as ${fileType}`
      );
      return {
        fileId: fileUpload.file_id,
        filename: file.originalname,
        fileType,
        issues: freshnessIssue ? [freshnessIssue] : undefined
      };
    } catch (error) {
      this.logger.error(
        `Error processing octet-stream file ${file.originalname}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw error;
    }
  }

  private isUploaded(value: unknown): value is TestFilesUploadUploadedDto {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const v = value as { filename?: unknown; fileId?: unknown };
    return (
      typeof v.filename === 'string' &&
      (typeof v.fileId === 'string' || typeof v.fileId === 'undefined')
    );
  }

  private async handleZipFile(
    workspaceId: number,
    file: FileIo,
    overwriteExisting: boolean,
    overwriteAllowList?: Set<string>,
    mutationContext?: WorkspaceFilesMutationContext
  ): Promise<unknown[]> {
    this.logger.log(
      `Processing ZIP file: ${file.originalname} for workspace ${workspaceId}`
    );
    const results: unknown[] = [];
    try {
      const zip = new AdmZip(file.buffer);
      const zipEntries = zip.getEntries().filter(entry => !entry.isDirectory);
      this.logger.log(
        `Found ${zipEntries.length} entries in ZIP file ${file.originalname}`
      );

      const ENTRY_BATCH_SIZE = 25;
      for (let i = 0; i < zipEntries.length; i += ENTRY_BATCH_SIZE) {
        const batch = zipEntries.slice(i, i + ENTRY_BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async entry => {
            const sanitizedEntryName =
              this.workspaceFileStorageService.sanitizePath(entry.entryName);
            const entryData = entry.getData();
            const nestedFile = <FileIo>{
              originalname: path.basename(sanitizedEntryName),
              buffer: entryData,
              mimetype:
                this.workspaceFileStorageService.getMimeType(
                  sanitizedEntryName
                ),
              size: entryData.length,
              fieldname: '',
              encoding: ''
            };

            const nestedPromises = this.handleFile(
              workspaceId,
              nestedFile,
              overwriteExisting,
              overwriteAllowList,
              mutationContext
            );
            return Promise.all(nestedPromises);
          })
        );
        batchResults.forEach(res => results.push(...res));
      }
      return results;
    } catch (error) {
      this.logger.error(
        `Error processing ZIP file ${file.originalname}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return [this.toFailedUploadResult(file.originalname, error)];
    }
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

  private async collectCodingSchemeChangesForFreshness(
    workspaceId: number,
    entries: Record<string, unknown>[],
    fileUploadRepository: Repository<FileUpload>
  ): Promise<Array<{ fileId: string; previousData: unknown; nextData: unknown }>> {
    if (!workspaceId || entries.length === 0) {
      return [];
    }

    const codingSchemeEntries = entries
      .map(entry => ({
        fileId: String(entry.file_id || '').trim(),
        data: entry.data
      }))
      .filter(entry => this.isCodingSchemeFileId(entry.fileId));
    if (codingSchemeEntries.length === 0) {
      return [];
    }

    const fileIds = Array.from(new Set(
      codingSchemeEntries.map(entry => entry.fileId)
    ));
    const existingFiles = await fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_id: In(fileIds)
      }
    });
    const existingDataByFileId = new Map(
      existingFiles.map(file => [String(file.file_id || ''), file.data])
    );

    return codingSchemeEntries.map(entry => ({
      fileId: entry.fileId,
      previousData: existingDataByFileId.get(entry.fileId),
      nextData: entry.data
    }));
  }

  async testCenterImport(
    entries: Record<string, unknown>[]
  ): Promise<TestFilesUploadResultDto>;
  async testCenterImport(
    entries: Record<string, unknown>[],
    overwriteFileIds?: string[]
  ): Promise<TestFilesUploadResultDto> {
    const workspaceId = Number(
      (entries[0] as { workspace_id?: unknown } | undefined)?.workspace_id
    );
    if (Number.isInteger(workspaceId) && workspaceId > 0) {
      return withWorkspaceFilesMutationLock(
        this.fileUploadRepository.manager.connection,
        workspaceId,
        queryRunner => this.testCenterImportUnlocked(
          entries,
          overwriteFileIds,
          this.getWorkspaceFilesMutationContext(queryRunner)
        )
      );
    }
    return this.testCenterImportUnlocked(entries, overwriteFileIds);
  }

  private async testCenterImportUnlocked(
    entries: Record<string, unknown>[],
    overwriteFileIds?: string[],
    mutationContext?: WorkspaceFilesMutationContext
  ): Promise<TestFilesUploadResultDto> {
    const fileUploadRepository =
      mutationContext?.fileUploadRepository ?? this.fileUploadRepository;
    try {
      const normalized = await this.enrichTestCenterImportEntries(
        Array.isArray(entries) ? entries : []
      );
      const workspaceId = Number(
        (normalized[0] as { workspace_id?: unknown } | undefined)?.workspace_id
      );

      const requestedFileIds = normalized
        .map(e => String((e as { file_id?: unknown }).file_id ?? ''))
        .filter(Boolean);

      const conflicts: TestFilesUploadConflictDto[] =
        workspaceId && requestedFileIds.length ?
          (
            await fileUploadRepository
              .createQueryBuilder('file')
              .select(['file.file_id', 'file.filename', 'file.file_type'])
              .where('file.workspace_id = :workspaceId', { workspaceId })
              .andWhere('file.file_id IN (:...fileIds)', {
                fileIds: requestedFileIds
              })
              .getMany()
          ).map(f => ({
            fileId: String(f.file_id || ''),
            filename: String(f.filename || ''),
            fileType: String(f.file_type || '')
          })) :
          [];

      const conflictIds = new Set(conflicts.map(c => c.fileId));
      const overwriteIdSet = new Set((overwriteFileIds || []).filter(Boolean));

      const attemptedFiles: TestFilesUploadUploadedDto[] = normalized
        .map(e => ({
          fileId: String((e as { file_id?: unknown }).file_id ?? ''),
          filename: String((e as { filename?: unknown }).filename ?? ''),
          fileType: String((e as { file_type?: unknown }).file_type ?? '')
        }))
        .filter(f => !!f.fileId && !!f.filename);

      const shouldOverwrite = (fileId: string): boolean => !!fileId && overwriteIdSet.has(fileId);

      const insertableFiles = attemptedFiles.filter(
        f => !conflictIds.has(f.fileId ?? '')
      );
      const overwriteFiles = attemptedFiles.filter(
        f => conflictIds.has(f.fileId ?? '') && shouldOverwrite(f.fileId ?? '')
      );
      const remainingConflicts = conflicts.filter(
        c => !shouldOverwrite(c.fileId)
      );

      const insertableEntries = normalized.filter(e => {
        const id = String((e as { file_id?: unknown }).file_id ?? '');
        return !!id && !conflictIds.has(id);
      });
      const overwriteEntries = normalized.filter(e => {
        const id = String((e as { file_id?: unknown }).file_id ?? '');
        return !!id && conflictIds.has(id) && shouldOverwrite(id);
      });
      const changedCodingSchemes =
        await this.collectCodingSchemeChangesForFreshness(
          workspaceId,
          [...insertableEntries, ...overwriteEntries],
          fileUploadRepository
        );

      const registry = fileUploadRepository.create(insertableEntries);
      if (registry.length > 0) {
        await fileUploadRepository
          .createQueryBuilder()
          .insert()
          .into(FileUpload)
          .values(registry.map(entry => this.toFileWriteData(entry)))
          .orIgnore()
          .execute();
      }

      const overwriteRegistry = fileUploadRepository.create(
        overwriteEntries.map(e => ({
          ...(e as Record<string, unknown>),
          created_at: new Date() as unknown as number
        }))
      );
      if (overwriteRegistry.length > 0) {
        await fileUploadRepository.upsert(overwriteRegistry.map(entry => this.toFileWriteData(entry)), [
          'file_id',
          'workspace_id'
        ]);
      }
      const freshnessIssues = (await Promise.all(changedCodingSchemes.map(change => (
        this.markCodingSchemeFreshnessAfterFileChange(
          workspaceId,
          change.fileId,
          change.previousData,
          change.nextData,
          mutationContext?.manager
        )
      )))).filter((issue): issue is TestResultsUploadIssueDto => !!issue);
      if (registry.length > 0 || overwriteRegistry.length > 0) {
        await this.invalidateWorkspaceFileCaches(workspaceId);
      }
      return {
        total: attemptedFiles.length,
        uploaded: insertableFiles.length + overwriteFiles.length,
        failed: 0,
        uploadedFiles: [...insertableFiles, ...overwriteFiles],
        conflicts: remainingConflicts.length ? remainingConflicts : undefined,
        failedFiles: undefined,
        issues: freshnessIssues.length ? freshnessIssues : undefined
      };
    } catch (error) {
      this.logger.error('Error during test center import', error);
      return {
        total: Array.isArray(entries) ? entries.length : 0,
        uploaded: 0,
        failed: Array.isArray(entries) ? entries.length : 0,
        uploadedFiles: [],
        failedFiles: [
          {
            filename: 'Testcenter import',
            reason: error instanceof Error ? error.message : 'Import failed'
          }
        ]
      };
    }
  }

  async getUnitContent(workspaceId: number, unitId: number): Promise<string> {
    const unitFile = await this.fileUploadRepository.findOne({
      where: { workspace_id: workspaceId, file_id: `${unitId}` }
    });

    if (!unitFile) {
      this.logger.error(
        `Unit file with ID ${unitId} not found in workspace ${workspaceId}`
      );
      throw new Error(`Unit file with ID ${unitId} not found`);
    }

    if (!unitFile.data) {
      this.logger.error(`Unit file with ID ${unitId} has no data content`);
      throw new Error('Unit file has no data content');
    }

    return unitFile.data.toString();
  }

  async getTestTakerContent(
    workspaceId: number,
    testTakerId: string
  ): Promise<string> {
    const testTakerFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: In(['TestTakers', 'Testtakers']),
        file_id: testTakerId
      }
    });

    if (!testTakerFile) {
      this.logger.error(
        `TestTakers file with ID ${testTakerId} not found in workspace ${workspaceId}`
      );
      throw new Error(`TestTakers file with ID ${testTakerId} not found`);
    }

    if (!testTakerFile.data) {
      this.logger.error(
        `TestTakers file with ID ${testTakerId} has no data content`
      );
      throw new Error('TestTakers file has no data content');
    }

    return testTakerFile.data.toString();
  }

  async getCodingSchemeByRef(
    workspaceId: number,
    codingSchemeRef: string
  ): Promise<FileDownloadDto | null> {
    try {
      const fileId = codingSchemeRef.toUpperCase().endsWith('.VOCS') ?
        codingSchemeRef.toUpperCase() :
        `${codingSchemeRef.toUpperCase()}.VOCS`;

      const codingSchemeFile = await this.fileUploadRepository.findOne({
        where: {
          workspace_id: workspaceId,
          file_id: fileId
        }
      });

      if (!codingSchemeFile) {
        this.logger.warn(
          `Coding scheme file '${codingSchemeRef.toUpperCase()}' not found in workspace ${workspaceId}`
        );
        return null;
      }

      const base64Data = codingSchemeFile.data.toString();

      return {
        filename: codingSchemeFile.filename,
        base64Data,
        mimeType: codingSchemeFile.file_type
      };
    } catch (error) {
      this.logger.error(
        `Error retrieving coding scheme: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return null;
    }
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
    try {
      this.logger.log(`Creating ZIP file for workspace ${workspaceId}`);

      const normalizedFileTypes = (fileTypes || [])
        .map(t => t.trim())
        .filter(Boolean);
      const resourceExtensions = new Set<string>();
      let resourceAllSelected = false;
      const baseTypes = new Set<string>();

      normalizedFileTypes.forEach(type => {
        if (type === this.resourceTypeLabel) {
          resourceAllSelected = true;
          baseTypes.add(this.resourceTypeLabel);
          resourceExtensions.clear();
          return;
        }
        const extension = this.getResourceSubtypeExtension(type);
        if (extension) {
          if (!resourceAllSelected) {
            resourceExtensions.add(extension);
          }
          baseTypes.add(this.resourceTypeLabel);
          return;
        }
        baseTypes.add(type);
      });

      let where: { workspace_id: number; file_type?: FindOperator<string> } = {
        workspace_id: workspaceId
      };
      if (baseTypes.size > 0) {
        where = {
          workspace_id: workspaceId,
          file_type: In(Array.from(baseTypes))
        };
      }

      let files = await this.fileUploadRepository.find({
        where,
        order: { file_type: 'ASC', filename: 'ASC' }
      });

      if (!resourceAllSelected && resourceExtensions.size > 0) {
        files = files.filter(file => {
          if (file.file_type !== this.resourceTypeLabel) return true;
          const extension = path.extname(file.filename).toLowerCase();
          return resourceExtensions.has(extension);
        });
      }

      if (!files || files.length === 0) {
        this.logger.error(`No files found in workspace ${workspaceId}`);
      }

      this.logger.log(`Found ${files.length} files to include in ZIP`);

      const folderNameMap: Record<string, string> = {
        Booklet: 'Testhefte',
        Unit: 'Aufgaben',
        Resource: 'Ressourcen',
        Schemer: 'Kodierschemata',
        TestTakers: 'Testteilnehmer',
        Testtakers: 'Testteilnehmer'
      };

      const zipBuffer =
        this.workspaceFileStorageService.createZipBufferFromFiles(
          files,
          folderNameMap
        );
      this.logger.log(
        `ZIP file created successfully (${zipBuffer.length} bytes)`
      );

      return zipBuffer;
    } catch (error) {
      this.logger.error(
        `Error creating ZIP file for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw new Error(`Failed to create ZIP file: ${getErrorMessage(error)}`);
    }
  }

  async validateTestTakers(
    workspaceId: number,
    onProgress?: (progress: number) => void
  ): Promise<TestTakersValidationDto> {
    try {
      if (onProgress) onProgress(10);
      const testTakers = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: In(['TestTakers', 'Testtakers'])
        }
      });

      if (!testTakers || testTakers.length === 0) {
        this.logger.warn(
          `No TestTakers found in workspace with ID ${workspaceId}.`
        );
        return {
          testTakersFound: false,
          totalGroups: 0,
          totalLogins: 0,
          totalBookletCodes: 0,
          missingPersons: []
        };
      }

      if (onProgress) onProgress(30);

      const testTakerLogins: TestTakerLoginDto[] = [];
      let totalGroups = 0;
      let totalLogins = 0;
      let totalBookletCodes = 0;

      for (const testTaker of testTakers) {
        const xmlDocument = cheerio.load(testTaker.data, { xml: true });
        const groupElements = xmlDocument('Group');

        if (groupElements.length === 0) {
          this.logger.warn(
            `No <Group> elements found in TestTakers file ${testTaker.file_id}.`
          );
          continue;
        }

        totalGroups += groupElements.length;

        // Extract data from each group
        for (let i = 0; i < groupElements.length; i += 1) {
          const groupElement = groupElements[i];
          const groupId = xmlDocument(groupElement).attr('id');
          const loginElements = xmlDocument(groupElement).find('Login');

          // Extract data from each login
          for (let j = 0; j < loginElements.length; j += 1) {
            const loginElement = loginElements[j];
            const loginName = xmlDocument(loginElement).attr('name');
            const loginMode = xmlDocument(loginElement).attr('mode');

            // Only include logins with mode "run-hot-return" or "run-hot-restart"
            if (
              loginMode === 'run-hot-return' ||
              loginMode === 'run-hot-restart'
            ) {
              totalLogins += 1;

              const bookletElements = xmlDocument(loginElement).find('Booklet');
              const bookletCodes: string[] = [];

              // Extract data from each booklet
              for (let k = 0; k < bookletElements.length; k += 1) {
                const bookletElement = bookletElements[k];
                const codes = xmlDocument(bookletElement).attr('codes');
                if (codes) {
                  bookletCodes.push(codes);
                  totalBookletCodes += 1;
                }
              }

              testTakerLogins.push({
                group: groupId || '',
                login: loginName || '',
                mode: loginMode || '',
                bookletCodes
              });
            }
          }
        }
      }

      if (onProgress) onProgress(60);

      const persons = await this.personsRepository.find({
        where: { workspace_id: workspaceId, consider: true }
      });

      const missingPersons: MissingPersonDto[] = [];
      const totalPersons = persons.length;
      let processedPersons = 0;

      for (const person of persons) {
        processedPersons += 1;
        if (processedPersons % 50 === 0 && onProgress) {
          onProgress(60 + Math.floor((processedPersons / totalPersons) * 35));
        }
        const found = testTakerLogins.some(
          login => login.group === person.group && login.login === person.login
        );

        if (!found) {
          missingPersons.push({
            group: person.group,
            login: person.login,
            code: person.code,
            reason: 'Person not found in TestTakers XML'
          });
        }
      }

      return {
        testTakersFound: true,
        totalGroups,
        totalLogins,
        totalBookletCodes,
        missingPersons
      };
    } catch (error) {
      this.logger.error(
        `Error validating TestTakers for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw new Error(
        `Error validating TestTakers for workspace ${workspaceId}: ${getErrorMessage(error)}`
      );
    }
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
    try {
      if (onProgress) onProgress(10);
      if (!workspaceId) {
        this.logger.error('Workspace ID is required');
        return {
          testTakersFound: false,
          groupsWithResponses: [],
          allGroupsHaveResponses: false,
          total: 0,
          totalGroupsWithoutResponses: 0,
          page,
          limit
        };
      }
      const testTakers = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: In(['TestTakers', 'Testtakers'])
        }
      });

      if (!testTakers || testTakers.length === 0) {
        this.logger.warn(
          `No TestTakers found in workspace with ID ${workspaceId}.`
        );
        return {
          testTakersFound: false,
          groupsWithResponses: [],
          allGroupsHaveResponses: false,
          total: 0,
          totalGroupsWithoutResponses: 0,
          page,
          limit
        };
      }

      if (onProgress) onProgress(20);

      const groups: Set<string> = new Set();

      for (const testTaker of testTakers) {
        const xmlDocument = cheerio.load(testTaker.data, { xml: true });
        const groupElements = xmlDocument('Group');

        if (groupElements.length === 0) {
          this.logger.warn(
            `No <Group> elements found in TestTakers file ${testTaker.file_id}.`
          );
          continue;
        }

        // Extract data from each group
        for (let i = 0; i < groupElements.length; i += 1) {
          const groupElement = groupElements[i];
          const groupId = xmlDocument(groupElement).attr('id');
          const loginElements = xmlDocument(groupElement).find('Login');

          // Check if there's at least one login with mode "run-hot-return" or "run-hot-restart"
          let hasValidLogin = false;
          for (let j = 0; j < loginElements.length; j += 1) {
            const loginElement = loginElements[j];
            const loginMode = xmlDocument(loginElement).attr('mode');

            if (
              loginMode === 'run-hot-return' ||
              loginMode === 'run-hot-restart'
            ) {
              hasValidLogin = true;
              break;
            }
          }

          // Only add groups with valid logins
          if (hasValidLogin && groupId) {
            groups.add(groupId);
          }
        }
      }

      if (groups.size === 0) {
        this.logger.warn(
          `No valid groups found in TestTakers files for workspace ${workspaceId}.`
        );
        return {
          testTakersFound: true,
          groupsWithResponses: [],
          allGroupsHaveResponses: false,
          total: 0,
          totalGroupsWithoutResponses: 0,
          page,
          limit
        };
      }

      if (onProgress) onProgress(40);

      // Check if each group has at least one response
      const groupsWithResponses: { group: string; hasResponse: boolean }[] = [];
      let allGroupsHaveResponses = true;
      let totalGroupsWithoutResponses = 0;
      const totalGroups = groups.size;
      let processedGroups = 0;

      for (const group of groups) {
        processedGroups += 1;
        if (onProgress) {
          onProgress(40 + Math.floor((processedGroups / totalGroups) * 55));
        }
        // Find persons with this group ID
        const persons = await this.personsRepository.find({
          where: { workspace_id: workspaceId, group, consider: true }
        });

        if (persons.length === 0) {
          // No persons found for this group
          groupsWithResponses.push({ group, hasResponse: false });
          allGroupsHaveResponses = false;
          totalGroupsWithoutResponses += 1;
          continue;
        }

        // Get all person IDs
        const personIds = persons.map(person => person.id);

        if (personIds.length === 0) {
          this.logger.warn(
            `No person IDs found for group ${group} in workspace ${workspaceId}`
          );
          groupsWithResponses.push({ group, hasResponse: false });
          allGroupsHaveResponses = false;
          totalGroupsWithoutResponses += 1;
          continue;
        }

        const batchSize = 1000;
        let allUnits: Unit[] = [];

        for (let i = 0; i < personIds.length; i += batchSize) {
          const personIdsBatch = personIds.slice(i, i + batchSize);

          // Find units for this batch of person IDs
          const unitsBatch = await this.unitRepository
            .createQueryBuilder('unit')
            .innerJoin('unit.booklet', 'booklet')
            .where('booklet.personid IN (:...personIdsBatch)', {
              personIdsBatch
            })
            .getMany();

          allUnits = [...allUnits, ...unitsBatch];
        }

        if (allUnits.length === 0) {
          groupsWithResponses.push({ group, hasResponse: false });
          allGroupsHaveResponses = false;
          totalGroupsWithoutResponses += 1;
          continue;
        }

        const unitIds = allUnits.map(unit => unit.id);

        if (unitIds.length === 0) {
          this.logger.warn(
            `No unit IDs found for group ${group} in workspace ${workspaceId}`
          );
          groupsWithResponses.push({ group, hasResponse: false });
          allGroupsHaveResponses = false;
          totalGroupsWithoutResponses += 1;
          continue;
        }

        let totalResponseCount = 0;

        for (let i = 0; i < unitIds.length; i += batchSize) {
          const unitIdsBatch = unitIds.slice(i, i + batchSize);

          const responseCountBatch = await this.responseRepository.count({
            where: { unitid: In(unitIdsBatch) }
          });

          totalResponseCount += responseCountBatch;
        }

        const hasResponse = totalResponseCount > 0;
        groupsWithResponses.push({ group, hasResponse });

        if (!hasResponse) {
          allGroupsHaveResponses = false;
          totalGroupsWithoutResponses += 1;
        }
      }

      // Apply pagination
      const validPage = Math.max(1, page);
      const validLimit = Math.max(1, limit);
      const startIndex = (validPage - 1) * validLimit;
      const endIndex = startIndex + validLimit;
      const paginatedGroupsWithResponses = groupsWithResponses.slice(
        startIndex,
        endIndex
      );

      return {
        testTakersFound: true,
        groupsWithResponses: paginatedGroupsWithResponses,
        allGroupsHaveResponses,
        total: groupsWithResponses.length,
        totalGroupsWithoutResponses,
        page: validPage,
        limit: validLimit
      };
    } catch (error) {
      this.logger.error(
        `Error validating group responses for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw new Error(
        `Error validating group responses for workspace ${workspaceId}: ${getErrorMessage(error)}`
      );
    }
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
      if (deletedCount > 0) await this.invalidateResponseDeletionCaches(workspaceId);
      return deletedCount;
    } catch (error) {
      await this.invalidateResponseDeletionCaches(workspaceId);
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
      if (deletedCount > 0) await this.invalidateResponseDeletionCaches(workspaceId);
      return deletedCount;
    } catch (error) {
      await this.invalidateResponseDeletionCaches(workspaceId);
      throw error;
    }
  }

  private async invalidateResponseDeletionCaches(workspaceId: number): Promise<void> {
    try {
      await Promise.all([
        this.workspaceTestResultsService.invalidateWorkspaceStatsCache(workspaceId),
        this.workspaceTestResultsService.invalidateCodingStatisticsCache(workspaceId),
        this.workspaceTestResultsService.invalidateCodingAvailabilityCache(workspaceId)
      ]);
    } catch (error) {
      this.logger.error(`Could not invalidate response deletion caches for workspace ${workspaceId}: ${getErrorMessage(error)}`);
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

  /**
   * Returns a map of unitName → Set of variable IDs that have INTENDED_INCOMPLETE
   * code type in their coding scheme. Responses with status INTENDED_INCOMPLETE
   * for these variables should be EXCLUDED from manual coding (they were auto-coded
   * as intended-incomplete and do not need manual review).
   */
  async getIntendedIncompleteSchemeVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    return this.fileMetadata.getIntendedIncompleteSchemeVariableMap(workspaceId);
  }

  /**
   * Returns a map of unitName → Set of variable aliases that are derived variables.
   * Derived variables have their own manual coding tasks (they are not BASE type).
   */
  async getDerivedVariableMap(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<Map<string, Set<string>>> {
    return this.fileMetadata.getDerivedVariableMap(workspaceId, manager);
  }

  /**
   * Returns a map keyed by "UNIT␟sourceAlias" where each value is the set of
   * derived variable aliases that use this source variable in the same unit.
   */
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

  /**
   * Returns a map of unitName → Set of variable aliases where at least one
   * code has a manual instruction. General variable-level instructions alone
   * do not make a variable selectable in manual coding.
   */
  async getManualInstructionVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    return this.fileMetadata.getManualInstructionVariableMap(workspaceId);
  }

  /**
   * Returns a map of unitName → Set of variable aliases that have CODER_TRAINING_REQUIRED
   * processing property in their coding scheme.
   */
  async getCoderTrainingRequiredVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    return this.fileMetadata.getCoderTrainingRequiredVariableMap(workspaceId);
  }

  async getUnitVariableDetails(
    workspaceId: number
  ): Promise<UnitVariableDetailsDto[]> {
    return this.fileMetadata.getUnitVariableDetails(workspaceId);
  }

  /**
   * Invalidates memory map caches for a given workspace. This is called when
   * files are uploaded or deleted to ensure that updated coding schemes, etc.
   * are correctly parsed on the next request.
   */
  async invalidateWorkspaceFileCaches(workspaceId: number): Promise<void> {
    await Promise.all([
      this.fileMetadata.invalidateMetadataCache(workspaceId),
      this.cacheService.delete(`${EXCLUSION_CACHE_PREFIX}${workspaceId}`)
    ]);
    await this.workspaceTestResultsService.invalidateWorkspaceStatsCache(
      workspaceId
    );
    this.codingFileCacheService?.clearCaches();
    this.codingProcessCacheInvalidator?.invalidateWorkspaceCaches(workspaceId);
    this.logger.log(
      `Invalidated workspace files caches for workspace ${workspaceId} in Redis`
    );
  }

  async readMetadataFile(workspaceId: number, fileId: number): Promise<FileDownloadDto> {
    const file = await this.fileUploadRepository.findOne({
      where: { id: fileId, workspace_id: workspaceId, file_type: 'Resource' }
    });
    if (!file || !file.filename.toLowerCase().endsWith('.vomd')) {
      throw new NotFoundException('Metadata resource not found');
    }
    return {
      filename: file.filename,
      base64Data: Buffer.from(file.data, 'utf8').toString('base64'),
      mimeType: 'application/json'
    };
  }
}
