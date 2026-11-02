import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import * as path from 'path';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import FileUpload, { StructuredFileData } from '../../entities/file_upload.entity';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';
import { WorkspaceFileFreshnessService } from './workspace-file-freshness.service';
import { toFileWriteData, withNormalizedFileLookupFields, WorkspaceFilesMutationContext } from './workspace-file-write.util';

@Injectable()
export class WorkspaceResourceFileUploadService {
  private readonly logger = new Logger(WorkspaceResourceFileUploadService.name);

  constructor(
    @InjectRepository(FileUpload) private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly workspaceFileParsingService: WorkspaceFileParsingService,
    private readonly freshness: WorkspaceFileFreshnessService
  ) {}

  async handleHtmlFile(
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

      const isSchemer = metadata['@type'] === 'schemer';
      const resourceFileId = isSchemer ?
        this.workspaceFileParsingService.getSchemerId(file) :
        this.workspaceFileParsingService.getPlayerId(file);
      const fileType = isSchemer ? 'Schemer' : 'Resource';
      const existing = await fileUploadRepository.findOne({
        where: { file_id: resourceFileId, workspace_id: workspaceId }
      });
      const overwriteAllowed = overwriteExisting &&
        (!overwriteAllowList || overwriteAllowList.has((resourceFileId || '').toUpperCase()));
      if (existing && !overwriteAllowed) {
        if (overwriteExisting && overwriteAllowList) return undefined;
        return {
          conflict: true, fileId: resourceFileId, filename: file.originalname, fileType
        };
      }
      await fileUploadRepository.upsert(withNormalizedFileLookupFields({
        filename: file.originalname,
        workspace_id: workspaceId,
        file_type: fileType,
        file_size: file.size,
        created_at: new Date() as unknown as number,
        file_id: resourceFileId,
        data: file.buffer.toString(),
        structured_data: structuredData
      }), ['file_id', 'workspace_id']);
      return { fileId: resourceFileId, filename: file.originalname, fileType };
    } catch (error) {
      const resourceFileId =
        this.workspaceFileParsingService.getResourceId(file);
      await fileUploadRepository.upsert(
        withNormalizedFileLookupFields({
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

  async handleOctetStreamFile(
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
      const { fileType, fileContent, structuredData } = await this.prepareOctetStreamFile(file);

      const fileUpload = fileUploadRepository.create(
        withNormalizedFileLookupFields({
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

      await fileUploadRepository.upsert(toFileWriteData(fileUpload), [
        'file_id',
        'workspace_id'
      ]);
      const freshnessIssue = await this.freshness.markCodingSchemeFreshnessAfterFileChange(
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

  private async prepareOctetStreamFile(file: FileIo): Promise<{ fileType: string; fileContent: string | Buffer; structuredData: StructuredFileData }> {
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

    return { fileType, fileContent, structuredData };
  }
}
