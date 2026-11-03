import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import AdmZip = require('adm-zip');
import * as path from 'path';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import FileUpload from '../../entities/file_upload.entity';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import {
  TestFilesUploadConflictDto, TestFilesUploadFailedDto, TestFilesUploadResultDto, TestFilesUploadUploadedDto
} from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { CodingStatisticsService } from '../coding/coding-statistics.service';
import { WorkspaceFileStorageService } from './workspace-file-storage.service';
import { withWorkspaceFilesMutationLock } from '../shared/workspace-files-lock.util';
import { WorkspaceFileCacheService } from './workspace-file-cache.service';
import { WorkspaceXmlFileUploadService } from './workspace-xml-file-upload.service';
import { WorkspaceResourceFileUploadService } from './workspace-resource-file-upload.service';
import {
  isCodingSchemeFileId, toFailedUploadResult, getWorkspaceFilesMutationContext, WorkspaceFilesMutationContext
} from './workspace-file-write.util';

type UploadedFileForCacheInvalidation = {
  fileId?: string;
  filename?: string;
  fileType?: string;
};

@Injectable()
export class WorkspaceFileUploadService {
  private readonly logger = new Logger(WorkspaceFileUploadService.name);

  constructor(
    @InjectRepository(FileUpload) private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly xml: WorkspaceXmlFileUploadService,
    private readonly resources: WorkspaceResourceFileUploadService,
    private readonly workspaceFileStorageService: WorkspaceFileStorageService,
    private readonly caches: WorkspaceFileCacheService,
    private readonly codingStatisticsService: CodingStatisticsService
  ) {}

  private isUploadedCodingSchemeFile(
    file: UploadedFileForCacheInvalidation
  ): boolean {
    return [file.fileId, file.filename]
      .some(value => isCodingSchemeFileId(value));
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
        getWorkspaceFilesMutationContext(queryRunner)
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

    try {
      const result = await this.processInBatches(
        workspace_id,
        originalFiles,
        5,
        overwriteExisting,
        overwriteAllowList,
        mutationContext
      );
      // Refresh shared file caches even when every file fails or conflicts.
      await this.caches.invalidateWorkspaceFileCaches(workspace_id);

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
        this.xml.handleXmlFile(
          workspaceId,
          file,
          overwriteExisting,
          overwriteAllowList,
          mutationContext
        ).catch(error => toFailedUploadResult(file.originalname, error)
        )
      );
      return filePromises;
    }

    switch (normalizedMimetype) {
      case 'text/xml':
      case 'application/xml':
      case 'application/x-xml':
        filePromises.push(
          this.xml.handleXmlFile(
            workspaceId,
            file,
            overwriteExisting,
            overwriteAllowList,
            mutationContext
          ).catch(error => toFailedUploadResult(file.originalname, error)
          )
        );
        break;
      case 'text/html':
        filePromises.push(
          this.resources.handleHtmlFile(
            workspaceId,
            file,
            overwriteExisting,
            overwriteAllowList,
            mutationContext
          ).catch(error => toFailedUploadResult(file.originalname, error)
          )
        );
        break;
      case 'application/octet-stream':
        filePromises.push(
          this.resources.handleOctetStreamFile(
            workspaceId,
            file,
            overwriteExisting,
            overwriteAllowList,
            mutationContext
          ).catch(error => toFailedUploadResult(file.originalname, error)
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
            toFailedUploadResult(
              file.originalname,
              `Unsupported file type: ${file.mimetype}`
            )
          )
        );
    }

    return filePromises;
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
      return [toFailedUploadResult(file.originalname, error)];
    }
  }

  private collectUploadResults(values: unknown[], failedFiles: TestFilesUploadFailedDto[], conflicts: TestFilesUploadConflictDto[], uploadedFiles: TestFilesUploadUploadedDto[], issues: TestResultsUploadIssueDto[]): number {
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

    values.forEach(collectResultValue);
    return uploaded;
  }

  private async processInBatches(workspace_id: number, files: FileIo[], batchSize: number, overwriteExistingParam: boolean, overwriteAllowListParam: Set<string> | undefined, mutationContext: WorkspaceFilesMutationContext): Promise<TestFilesUploadResultDto> {
    const conflicts: TestFilesUploadConflictDto[] = [];
    const failedFiles: TestFilesUploadFailedDto[] = [];
    const uploadedFiles: TestFilesUploadUploadedDto[] = [];
    const issues: TestResultsUploadIssueDto[] = [];
    let uploaded = 0;
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
      // Preserve task order across returned failures, rejections and nested ZIP results.
      uploaded += settled.reduce((count, result, idx) => {
        const task = tasks[idx];
        if (result.status === 'rejected') {
          const reason = (result as PromiseRejectedResult).reason;
          failedFiles.push({
            filename: task?.filename || 'unknown',
            reason: reason instanceof Error ? reason.message : String(reason)
          });
          return count;
        }

        return count + this.collectUploadResults([result.value], failedFiles, conflicts, uploadedFiles, issues);
      }, 0);
    }

    return {
      total: files.length,
      uploaded,
      failed: failedFiles.length,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
      uploadedFiles: uploadedFiles.length > 0 ? uploadedFiles : undefined,
      issues: issues.length > 0 ? issues : undefined
    };
  }
}
