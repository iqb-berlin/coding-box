import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import FileUpload, { StructuredFileData } from '../../entities/file_upload.entity';
import { TestFilesUploadConflictDto, TestFilesUploadResultDto, TestFilesUploadUploadedDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';
import { withWorkspaceFilesMutationLock } from '../shared/workspace-files-lock.util';
import { WorkspaceFileCacheService } from './workspace-file-cache.service';
import { WorkspaceFileFreshnessService } from './workspace-file-freshness.service';
import { toFileWriteData, withNormalizedFileLookupFields } from './workspace-file-write.util';

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
    if (!entries.length) {
      return {
        total: 0, uploaded: 0, failed: 0, uploadedFiles: []
      };
    }
    const workspaceId = Number(entries[0]?.workspace_id);
    if (!Number.isInteger(workspaceId) || workspaceId <= 0 ||
      entries.some(entry => Number(entry?.workspace_id) !== workspaceId)) {
      return this.importFailure(entries.length, new Error('Testcenter files must belong to a single valid workspace.'));
    }
    return withWorkspaceFilesMutationLock(
      this.fileUploadRepository.manager.connection,
      workspaceId,
      runner => this.testCenterImportUnlocked(workspaceId, entries, overwriteFileIds, runner.manager)
    );
  }

  private async testCenterImportUnlocked(
    workspaceId: number,
    entries: Record<string, unknown>[],
    overwriteFileIds: string[] | undefined,
    manager: EntityManager
  ): Promise<TestFilesUploadResultDto> {
    let committed;
    try {
      const normalized = await this.enrichTestCenterImportEntries(entries);
      committed = await manager.transaction(transaction => this.writeImport(
        workspaceId, normalized, overwriteFileIds, transaction.getRepository(FileUpload)
      ));
    } catch (error) {
      return this.importFailure(entries.length, error);
    }

    // Freshness warnings describe committed files. Keep using the locked session until caches are invalidated.
    const { result, changedCodingSchemes } = committed;
    const issues = (await Promise.all(changedCodingSchemes.map(change => (
      this.freshness.markCodingSchemeFreshnessAfterFileChange(
        workspaceId, change.fileId, change.previousData, change.nextData, manager
      )
    )))).filter((issue): issue is TestResultsUploadIssueDto => !!issue);
    if (result.uploaded > 0) {
      const invalidated = await this.caches.invalidateWorkspaceFileCaches(workspaceId, result.uploadedFiles).catch(error => {
        this.logger.error('Could not invalidate workspace caches after Testcenter import', error);
        return false;
      });
      if (!invalidated) {
        issues.push({
          level: 'warning',
          category: 'other',
          message: 'Die Dateien wurden gespeichert, aber der Arbeitsbereichs-Cache konnte nicht aktualisiert werden.'
        });
      }
    }
    return { ...result, issues: issues.length ? issues : undefined };
  }

  private importFailure(total: number, error: unknown): TestFilesUploadResultDto {
    this.logger.error('Error during test center import', error);
    return {
      total,
      uploaded: 0,
      failed: total,
      uploadedFiles: [],
      failedFiles: [{ filename: 'Testcenter import', reason: error instanceof Error ? error.message : 'Import failed' }]
    };
  }

  private async writeImport(
    workspaceId: number,
    normalized: Record<string, unknown>[],
    overwriteFileIds: string[] | undefined,
    repository: Repository<FileUpload>
  ) {
    const {
      attemptedFiles, insertableFiles, overwriteFiles, remainingConflicts, insertableEntries, overwriteEntries
    } = await this.planImport(normalized, workspaceId, overwriteFileIds, repository);
    const changedCodingSchemes = await this.freshness.collectCodingSchemeChangesForFreshness(
      workspaceId, [...insertableEntries, ...overwriteEntries], repository
    );

    if (insertableEntries.length) {
      await repository.insert(repository.create(insertableEntries).map(toFileWriteData));
    }
    if (overwriteEntries.length) {
      const overwrites = repository.create(overwriteEntries.map(entry => ({
        ...entry, created_at: new Date() as unknown as number
      })));
      await repository.upsert(overwrites.map(toFileWriteData), ['file_id', 'workspace_id']);
    }
    const uploadedFiles = [...insertableFiles, ...overwriteFiles];
    return {
      result: {
        total: attemptedFiles.length,
        uploaded: uploadedFiles.length,
        failed: 0,
        uploadedFiles,
        conflicts: remainingConflicts.length ? remainingConflicts : undefined
      },
      changedCodingSchemes
    };
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
      }));
    if (attemptedFiles.some(file => !file.fileId || !file.filename)) {
      throw new Error('Testcenter files must have a file ID and a filename.');
    }

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
