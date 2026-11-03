import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import FileUpload, { StructuredFileData } from '../../entities/file_upload.entity';
import { TestFilesUploadConflictDto, TestFilesUploadResultDto, TestFilesUploadUploadedDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';
import { withWorkspaceFilesMutationLock } from '../shared/workspace-files-lock.util';
import { WorkspaceFileCacheService } from './workspace-file-cache.service';
import { WorkspaceFileFreshnessService } from './workspace-file-freshness.service';
import {
  toFileWriteData, withNormalizedFileLookupFields, getWorkspaceFilesMutationContext, WorkspaceFilesMutationContext
} from './workspace-file-write.util';

@Injectable()
export class WorkspaceTestcenterFileImportService {
  private readonly logger = new Logger(WorkspaceTestcenterFileImportService.name);

  constructor(
    @InjectRepository(FileUpload) private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly workspaceFileParsingService: WorkspaceFileParsingService,
    private readonly freshness: WorkspaceFileFreshnessService,
    private readonly caches: WorkspaceFileCacheService
  ) {}

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
    return enrichedEntries.map(entry => withNormalizedFileLookupFields(entry));
  }

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
          getWorkspaceFilesMutationContext(queryRunner)
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

      const {
        attemptedFiles, insertableFiles, overwriteFiles, remainingConflicts, insertableEntries, overwriteEntries
      } =
        await this.planImport(normalized, workspaceId, overwriteFileIds, fileUploadRepository);
      const changedCodingSchemes =
        await this.freshness.collectCodingSchemeChangesForFreshness(
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
          .values(registry.map(entry => toFileWriteData(entry)))
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
        await fileUploadRepository.upsert(overwriteRegistry.map(entry => toFileWriteData(entry)), [
          'file_id',
          'workspace_id'
        ]);
      }
      const freshnessIssues = (await Promise.all(changedCodingSchemes.map(change => (
        this.freshness.markCodingSchemeFreshnessAfterFileChange(
          workspaceId,
          change.fileId,
          change.previousData,
          change.nextData,
          mutationContext?.manager
        )
      )))).filter((issue): issue is TestResultsUploadIssueDto => !!issue);
      if (registry.length > 0 || overwriteRegistry.length > 0) {
        await this.caches.invalidateWorkspaceFileCaches(workspaceId);
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

  private async planImport(normalized: Record<string, unknown>[], workspaceId: number, overwriteFileIds: string[] | undefined, fileUploadRepository: Repository<FileUpload>) {
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
    return {
      attemptedFiles, insertableFiles, overwriteFiles, remainingConflicts, insertableEntries, overwriteEntries
    };
  }
}
